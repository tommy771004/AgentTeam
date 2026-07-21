/**
 * AI Agent Loop Engine v2
 * Receive → Process → Execute → Validate → Terminate/Iterate
 * + Multi-agent roles, safety HITL, LLM steps, knowledge graph
 */

import { v4 as uuid } from 'uuid'
import type {
  AgentState,
  ExecutionStep,
  InterventionState,
  LlmSettings,
  LogEntry,
  LogLevel,
  LoopType,
  RuntimeOverrides,
  SubAgentNode,
} from './types'
import { buildParseResult, formatPlanBubble, parseUserRequest } from './parser'
import { evaluateDoD } from './dodEvaluator'
import { parseWithLlm } from './llmParser'
import { replanCorrectiveSteps } from './replan'
import {
  buildContinueGoalSnapshot,
  formatContinueGoalOffer,
} from './continueGoal'
import { evaluateSafety, formatPayloadForDisplay } from './safety'
import { emptyKnowledge, extractKnowledge } from './knowledge'
import {
  DEFAULT_LLM_SETTINGS,
  resolveRoleModel,
  synthesizeReport,
  withRoleModel,
} from './llm'
import { learningLoop } from './hermes/learning'
import { BUILTIN_RUNNER_CAPABILITIES } from './runners'
import { skillsStore } from './hermes/skills'
import {
  isClaimedScheduleTrigger,
  validateScheduleTriggerSnapshot,
  type ScheduleTriggerValidation,
} from './scheduler'
import { validateEventTriggerSnapshot } from './eventMatcher'
import {
  DEFAULT_SUPERVISOR_LIMITS,
  SupervisorViolation,
  type SupervisorLimits,
} from './supervisor'
import { pickAgentForStep, runStep, type AskDecision } from './loop/stepRun.ts'
type Listener = (state: AgentState) => void

/** @deprecated Alias kept so resolveIntervention's external signature is untouched — use AskDecision. */
type InterventionDecision = AskDecision

function nowTime(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false })
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function emptyIntervention(): InterventionState {
  return {
    active: false,
    reason: '',
    payloadJson: '',
    safety: null,
    timeoutSec: 900,
  }
}

export class AgentLoopEngine {
  private state: AgentState
  private listeners: Listener[] = []
  private aborted = false
  private pauseResolve: (() => void) | null = null
  private interventionResolve: ((d: InterventionDecision) => void) | null = null
  private settings: LlmSettings = { ...DEFAULT_LLM_SETTINGS }
  private overrides: RuntimeOverrides = {}
  private stepOutputs: string[] = []
  private attachedSkillContext = ''
  /** Phase 4: session recall kept separate for ContextPacket (not mashed into skills blob). */
  private sessionRecallBlock = ''
  /** Last DoD missing[] for continueGoal snapshot */
  private lastDodMissing: string[] = []
  /** W2: persistent project guidance (AGENTS.md) resolved per run */
  private projectGuidance = ''
  /** Vision / file attachments for this run (FC multimodal) */
  private userAttachments: import('./types').ChatAttachment[] = []

  constructor() {
    this.state = this.emptyState()
  }

  private emptyState(): AgentState {
    return {
      id: '',
      objective: '',
      loopConfig: {
        loopType: 'Goal-based',
        trigger: '',
        executionSequence: [],
        definitionOfDone: '',
        maxIterations: 5,
        fallbackProtocol: '',
        nextState: 'Halt',
      },
      status: 'idle',
      currentIteration: 0,
      steps: [],
      logs: [],
      confidence: 0,
      progress: 0,
      startedAt: null,
      finishedAt: null,
      subAgents: [],
      knowledge: emptyKnowledge(),
      intervention: emptyIntervention(),
      tokensUsed: 0,
      minConfidence: 0.8,
      toolCalls: [],
      loadedCapabilityIds: [],
      unlockedToolNames: [],
      violation: null,
      executionKind: 'loop',
      runnerCapabilities: { ...BUILTIN_RUNNER_CAPABILITIES },
      metrics: {
        vramLabel: '—',
        apiCredits: 0,
        executionMs: 0,
      },
    }
  }

  private supervisorLimits(): SupervisorLimits {
    const kb = this.settings.maxToolPayloadKb || 50
    return {
      ...DEFAULT_SUPERVISOR_LIMITS,
      maxToolPayloadBytes: Math.max(4, kb) * 1024,
      maxToolRounds: this.settings.maxToolRounds || 4,
    }
  }

  configure(settings: LlmSettings) {
    this.settings = { ...settings }
  }

  getState(): AgentState {
    return structuredClone(this.state)
  }

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn)
    }
  }

  private emit() {
    const snap = this.getState()
    for (const l of this.listeners) l(snap)
  }

  private log(level: LogLevel, message: string) {
    const entry: LogEntry = {
      id: uuid(),
      timestamp: nowTime(),
      level,
      message,
    }
    this.state.logs = [...this.state.logs, entry]
    this.emit()
  }

  private setStep(index: number, patch: Partial<ExecutionStep>) {
    this.state.steps = this.state.steps.map((s, i) => (i === index ? { ...s, ...patch } : s))
    this.emit()
  }

  private updateProgress() {
    const done = this.state.steps.filter((s) => s.status === 'COMPLETED').length
    const total = this.state.steps.length || 1
    this.state.progress = Math.round((done / total) * 100)
    this.refreshKnowledge()
    this.emit()
  }

  private refreshKnowledge() {
    this.state.knowledge = extractKnowledge(
      this.state.objective,
      this.stepOutputs,
      this.state.confidence,
    )
  }

  private minConfidence(): number {
    return this.overrides.minConfidence ?? this.settings.minConfidence ?? 0.8
  }

  private maxIterations(): number {
    return (
      this.overrides.maxIterations ??
      this.state.loopConfig.maxIterations ??
      this.settings.maxIterationsDefault
    )
  }

  private async validateTimeBasedTrigger(): Promise<ScheduleTriggerValidation> {
    if (this.overrides.sourceKind !== 'schedule') {
      return { ok: false, reason: 'source 不是 schedule' }
    }
    const validation = validateScheduleTriggerSnapshot(this.overrides.scheduleTrigger)
    if (!validation.ok) return validation
    try {
      const { useScheduleStore } = await import('../store/scheduleStore')
      const store = useScheduleStore.getState()
      if (!store.loaded) await store.load()
      const job = useScheduleStore
        .getState()
        .jobs.find((candidate) => candidate.id === validation.snapshot.jobId)
      return isClaimedScheduleTrigger(job, validation.snapshot)
        ? validation
        : { ok: false, reason: '找不到與 trigger snapshot 一致的已 claim ScheduledJob' }
    } catch {
      return { ok: false, reason: '無法載入 schedule store 驗證 trigger snapshot' }
    }
  }

  private useLlm(): boolean {
    if (this.overrides.useLlm === false) return false
    return this.settings.enabled && Boolean(this.settings.apiKey)
  }

  private subAgentsEnabled(): boolean {
    return this.settings.subAgentsEnabled === true
  }

  /** Role models are only authoritative when Sub Agent mode is enabled. */
  private executionSettings(role: string): LlmSettings {
    return this.subAgentsEnabled() ? withRoleModel(this.settings, role) : this.settings
  }

  private executionModel(role: string): ReturnType<typeof resolveRoleModel> {
    if (this.subAgentsEnabled()) return resolveRoleModel(this.settings, role)
    return {
      model: this.settings.model || '',
      source: this.settings.model ? 'primary' : 'none',
      roleKey: null,
      usedFallback: true,
    }
  }

  stop() {
    this.aborted = true
    if (this.pauseResolve) {
      this.pauseResolve()
      this.pauseResolve = null
    }
    if (this.interventionResolve) {
      this.interventionResolve({ action: 'abort' })
      this.interventionResolve = null
    }
  }

  continueTurn() {
    if (this.pauseResolve) {
      this.pauseResolve()
      this.pauseResolve = null
    }
  }

  resolveIntervention(decision: InterventionDecision) {
    if (this.interventionResolve) {
      this.interventionResolve(decision)
      this.interventionResolve = null
    }
  }

  private waitForUser(): Promise<void> {
    this.state.status = 'awaiting_user'
    this.emit()
    return new Promise((resolve) => {
      this.pauseResolve = resolve
    })
  }

  private waitForIntervention(): Promise<InterventionDecision> {
    this.state.status = 'manual_intervention'
    const unattended = this.overrides.unattended === true
    // Unattended (cron/webhook/telegram): short timeout so a run cannot hang overnight
    const timeoutSec = unattended
      ? Math.max(15, Math.min(120, Math.round((this.overrides.hitlTimeoutMs || 45_000) / 1000)))
      : this.state.intervention.timeoutSec || 900
    this.state.intervention = {
      ...this.state.intervention,
      active: true,
      timeoutSec,
    }
    this.emit()
    return new Promise((resolve) => {
      let settled = false
      const ms = timeoutSec * 1000
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.interventionResolve = null
        this.log(
          'WARN',
          `Safety intervention 逾時 ${timeoutSec}s → 自動拒絕${unattended ? '（無人值守）' : ''}`,
        )
        resolve({ action: 'reject' })
      }, ms)
      this.interventionResolve = (d) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.interventionResolve = null
        resolve(d)
      }
    })
  }

  async start(
    rawInput: string,
    forceLoopType?: LoopType,
    overrides?: RuntimeOverrides,
  ): Promise<AgentState> {
    this.aborted = false
    this.overrides = overrides || {}
    this.stepOutputs = []
    this.lastDodMissing = []
    this.attachedSkillContext = ''
    this.sessionRecallBlock = ''
    this.userAttachments = this.overrides.userAttachments || []
    // Tool calls receive this run's identity explicitly. The old module-level
    // runContext was safe only while a single engine could run at once.
    // Per-conversation model override (thread settings)
    if (this.overrides.model?.trim()) {
      this.settings = { ...this.settings, model: this.overrides.model.trim() }
    }
    // Composer approval is a run-scoped snapshot. It must not write back to
    // Settings, while plan/deny/capability guards remain enforced downstream.
    if (this.overrides.approvalMode) {
      this.settings = { ...this.settings, approvalMode: this.overrides.approvalMode }
    }
    if (this.overrides.maxToolRounds != null && this.overrides.maxToolRounds > 0) {
      this.settings = {
        ...this.settings,
        maxToolRounds: this.overrides.maxToolRounds,
      }
    }
    if (this.overrides.attachedSkills?.length) {
      const bodies = this.overrides.attachedSkills
        .map((name) => skillsStore.get(name))
        .filter(Boolean)
        .map((s) => `### Skill: ${s!.meta.name}\n${s!.body.slice(0, 2500)}`)
      this.attachedSkillContext = bodies.join('\n\n')
    }
    if (this.overrides.extraSystemContext) {
      this.attachedSkillContext = [
        this.attachedSkillContext,
        this.overrides.extraSystemContext,
      ]
        .filter(Boolean)
        .join('\n\n')
    }
    this.state = this.emptyState()
    this.state.scheduleTrigger = this.overrides.scheduleTrigger
    this.state.eventTrigger = this.overrides.eventTrigger
    this.state.status = 'parsing'
    this.state.startedAt = new Date().toISOString()
    this.state.minConfidence = this.minConfidence()
    // W2: resolve persistent project guidance (AGENTS.md hierarchy) for this run
    this.projectGuidance = ''
    try {
      const { resolveProjectContext, formatProjectGuidance, summarizeProjectContext } =
        await import('./projectContext')
      let root = (this.overrides.projectRoot || '').trim()
      if (!root) {
        const { useProjectStore } = await import('../store/projectStore')
        root = useProjectStore.getState().root || ''
      }
      const docs = await resolveProjectContext(root)
      if (docs.length) {
        this.projectGuidance = formatProjectGuidance(docs)
        // Run snapshot: source + hash + bytes go to logs (archived)
        this.log('INFO', `專案指引已載入：${summarizeProjectContext(docs)}`)
      }
      // W3: OpenCode instructions — temporary apply per run（不寫入全域設定）
      try {
        const { useOpenCodeConfigStore } = await import('../store/opencodeConfigStore')
        // Per-run project pin — must not use wrong UI project's instructions
        const pinRoot = (this.overrides.projectRoot || root || '').trim()
        const oc = useOpenCodeConfigStore.getState()
        // Ensure cache has this root (schedule A while UI on B)
        if (pinRoot && pinRoot !== oc.lastProjectRoot && !oc.instructionsByRoot[pinRoot]) {
          await oc.hydrate(pinRoot)
        }
        const note = useOpenCodeConfigStore
          .getState()
          .temporaryInstructionsNote(pinRoot || undefined)
        if (note) {
          this.projectGuidance = [this.projectGuidance, note]
            .filter(Boolean)
            .join('\n\n')
          this.log(
            'INFO',
            `OpenCode instructions 已暫時套用（本 run · project=${pinRoot || '—'}，見設定匯入報告）`,
          )
        }
      } catch {
        /* non-fatal */
      }
    } catch {
      /* non-fatal — run continues without project guidance */
    }
    // Cross-run restore (thread history) — seed before first step
    if (this.overrides.preloadCapabilityIds?.length) {
      this.state.loadedCapabilityIds = [...new Set(this.overrides.preloadCapabilityIds)]
    }
    if (this.overrides.preloadUnlockedTools?.length) {
      this.state.unlockedToolNames = [...new Set(this.overrides.preloadUnlockedTools)]
    }
    this.emit()

    const t0 = Date.now()

    try {
      // Resolve force vs auto: overrides.loopTypeMode wins; else forceLoopType arg means force.
      const loopMode: 'force' | 'auto' =
        this.overrides.loopTypeMode ||
        (forceLoopType || this.overrides.forceLoopType ? 'force' : 'auto')
      const effectiveForce: LoopType | undefined =
        loopMode === 'force'
          ? forceLoopType || this.overrides.forceLoopType
          : undefined

      // P3: continueGoal — skip re-parse; restore DoD + corrective steps
      const cg = this.overrides.continueGoal
      if (cg?.objective && cg.definitionOfDone) {
        const missing = (cg.missing || []).filter(Boolean)
        const sequence =
          missing.length > 0
            ? replanCorrectiveSteps(missing, cg.objective, { maxSteps: 3 }).map(
                (s) => s.description,
              )
            : cg.steps?.length
              ? cg.steps
              : ['依 Definition of Done 補齊未完成項目', '重新驗證並產出完整結果']
        const maxIter =
          this.overrides.maxIterations ||
          this.settings.maxIterationsDefault ||
          5
        const resumed = buildParseResult(
          cg.objective,
          'Goal-based',
          sequence,
          cg.definitionOfDone,
          maxIter,
        )
        this.state.id =
          this.overrides.runId?.trim() ||
          `exe_${uuid().slice(0, 12).toUpperCase().replace(/-/g, '')}`
        this.state.objective = resumed.objective
        this.state.loopConfig = resumed.config
        this.state.steps = resumed.steps
        if (cg.priorDigest) {
          this.stepOutputs.push(`### 先前執行摘要\n${cg.priorDigest.slice(0, 2000)}`)
        }
        if (missing.length) {
          this.stepOutputs.push(
            `### 待補齊缺口\n${missing.map((m) => `- ${m}`).join('\n')}`,
          )
        }
        if (cg.userHint?.trim()) {
          this.stepOutputs.push(`### 本輪使用者指示\n${cg.userHint.trim().slice(0, 800)}`)
        }
        this.log(
          'INFO',
          `continueGoal 恢復：DoD 保留 · ${resumed.steps.length} 修正步驟 · 缺口 ${missing.length}`,
        )
      } else {
        // forceLoopType re-derives steps/DoD/maxIterations (not just renames the loop)
        const parsed = parseUserRequest(rawInput, effectiveForce)
        if (parsed.config.loopType === 'Goal-based') {
          parsed.config.maxIterations = this.settings.maxIterationsDefault || 5
        }
        if (this.overrides.maxIterations) {
          parsed.config.maxIterations = this.overrides.maxIterations
        }

        // runTask trace id wins so thread / archive / queue / HITL correlate on one id
        this.state.id =
          this.overrides.runId?.trim() ||
          `exe_${uuid().slice(0, 12).toUpperCase().replace(/-/g, '')}`
        this.state.objective = parsed.objective
        this.state.loopConfig = parsed.config
        this.state.steps = parsed.steps
        // 規格 03：將啟發式 schema 精煉成貼合目標的 LLM 計畫；任何失敗皆保留 fallback。
        // Auto mode: do not pass forceLoopType so LLM may reclassify Turn vs Goal.
        if (this.useLlm() && this.settings.llmParseEnabled !== false) {
          try {
            const refined = await parseWithLlm(
              this.executionSettings('orchestrator'),
              rawInput,
              effectiveForce,
            )
            if (refined) {
              // Settings / runtime override owns the iteration budget for Goal; else use plan.
              if (refined.config.loopType === 'Goal-based') {
                refined.config.maxIterations =
                  this.overrides.maxIterations ||
                  this.settings.maxIterationsDefault ||
                  refined.config.maxIterations
              } else {
                refined.config.maxIterations = this.overrides.maxIterations || 1
              }
              this.state.loopConfig = refined.config
              this.state.steps = refined.steps
              this.log(
                'INFO',
                `LLM 解析：${refined.config.loopType} · ${refined.steps.length} steps · DoD=${refined.config.definitionOfDone.slice(0, 80)}`,
              )
            }
          } catch (e) {
            this.log(
              'WARN',
              `LLM 解析失敗，使用啟發式計畫：${e instanceof Error ? e.message : e}`,
            )
          }
        }
      }

      // Defense in depth: taskRunCoordinator validates before reservation,
      // while the engine protects direct callers from bypassing that seam.
      if (this.state.loopConfig.loopType === 'Time-based') {
        const validation = await this.validateTimeBasedTrigger()
        if (!validation.ok) {
          this.state.status = 'failed'
          this.state.haltReason = `Time-based trigger 無效：${validation.reason}`
          this.log('ERROR', this.state.haltReason)
          this.state.metrics.executionMs = Date.now() - t0
          this.state.finishedAt = new Date().toISOString()
          this.emit()
          return this.getState()
        }
        this.state.scheduleTrigger = validation.snapshot
        this.log(
          'INFO',
          `Schedule trigger 已驗證：${validation.snapshot.jobId} · ${validation.snapshot.triggeredAt}`,
        )
      }

      // Proactive may only consume matcher-produced boolean evidence. The
      // objective is never a substitute for an event payload anymore.
      if (this.state.loopConfig.loopType === 'Proactive') {
        const validation = validateEventTriggerSnapshot(this.overrides.eventTrigger)
        if (!validation.ok) {
          this.state.status = 'failed'
          this.state.haltReason = `Proactive trigger 無效：${validation.reason}`
          this.log('ERROR', this.state.haltReason)
          this.state.metrics.executionMs = Date.now() - t0
          this.state.finishedAt = new Date().toISOString()
          this.emit()
          return this.getState()
        }
        this.state.eventTrigger = validation.snapshot
        this.log(
          'INFO',
          `Event matcher evidence 已驗證：${validation.snapshot.eventId} · ${validation.snapshot.matchedAt}`,
        )
      }

      // Phase 4: session recall as a ContextPacket slot (top-k, failure-first)
      const temporaryRun =
        this.overrides.temporary === true || this.settings.temporaryChatDefault === true
      if (
        this.settings.sessionRecallEnabled !== false &&
        !temporaryRun
      ) {
        try {
          const { searchSessions } = await import('./hermes/sessionSearch')
          const { formatSessionRecallBlock } = await import('./hermes/contextPacket')
          const { SESSION_RECALL_CONTEXT_CHARS } = await import('./chatHistory')
          const { useAgentStore } = await import('../store/agentStore')
          const hits = searchSessions(rawInput, useAgentStore.getState().archive || [], 8)
          if (hits.length) {
            this.sessionRecallBlock = formatSessionRecallBlock(hits, {
              maxHits: 3,
              maxChars: SESSION_RECALL_CONTEXT_CHARS,
            })
            this.log(
              'INFO',
              `Session 召回：${hits.length} 命中 → packet top-k（failure-first）`,
            )
          }
        } catch {
          /* non-fatal */
        }
      } else if (temporaryRun) {
        this.log('INFO', 'Temporary chat：略過 session recall（ContextPacket diagnostics）')
      }

      this.state.subAgents = this.spawnSubAgents(this.state.loopConfig.loopType)
      if (effectiveForce) {
        this.log(
          'INFO',
          `forceLoopType=${effectiveForce} → ${this.state.steps.length} steps re-derived`,
        )
      } else {
        this.log(
          'INFO',
          `loopTypeMode=auto → ${this.state.loopConfig.loopType}（${this.state.steps.length} steps）`,
        )
      }

      // P0: surface plan in chat bubble (visible parse result)
      try {
        const { useThreadStore } = await import('../store/threadStore')
        const thr = useThreadStore.getState()
        const tid =
          this.overrides.threadId || thr.runningThreadId || thr.activeId
        if (tid) {
          thr.pushBubble(
            tid,
            'system',
            formatPlanBubble(this.state.loopConfig, {
              mode: effectiveForce ? 'force' : 'auto',
              sourceKind: this.overrides.sourceKind,
              triggerSource: this.overrides.triggerSource,
              classificationReason: this.overrides.classificationReason,
              continueGoal: Boolean(this.overrides.continueGoal),
            }),
          )
        }
      } catch {
        /* UI bubble is best-effort */
      }

      this.state.status = 'running'
      this.state.currentIteration = 1
      this.state.minConfidence = this.minConfidence()
      this.state.metrics.vramLabel = this.useLlm() ? 'cloud' : 'local-sim 4.2 GB'
      this.emit()

      this.log('INFO', 'SubAgents AI Execution Kernel v2.5.0')
      this.log('INFO', `Sub Agent: ${this.subAgentsEnabled() ? 'ON' : 'OFF'}（${this.subAgentsEnabled() ? '套用角色模型' : '使用全域模型'}）`)
      this.log('INFO', `Session ID: ${this.state.id}`)
      this.log('INFO', `Loop Type: ${this.state.loopConfig.loopType}`)
      this.log('INFO', `LLM: ${this.useLlm() ? `ON (${this.settings.model})` : 'OFF (simulation)'}`)
      if (this.overrides.agentMode) {
        this.log('INFO', `OpenCode agent: ${this.overrides.agentMode}${this.overrides.subagentId ? ` + @${this.overrides.subagentId}` : ''}`)
      }
      if (this.overrides.blockedTools?.length) {
        this.log('INFO', `Blocked tools: ${this.overrides.blockedTools.join(', ')}`)
      }
      this.log(
        'INFO',
        `Tool rounds: ${this.settings.maxToolRounds || 4} · Min confidence: ${this.minConfidence().toFixed(2)}`,
      )
      this.log('INFO', `DoD: ${this.state.loopConfig.definitionOfDone}`)
      this.log('INFO', `Max Iterations: ${this.maxIterations()}`)
      this.log('PROCESS', 'Starting execution routine...')
      this.log('System', 'Hermes 學習層：記憶 / 技能 / Prompt 分層 已掛載')
      if (this.overrides.attachedSkills?.length) {
        this.log(
          'INFO',
          `掛載 Skills: ${this.overrides.attachedSkills.join(', ')}`,
        )
      }
      // Phase 4 / R7: onUserTurn is owned by the coordinator for user chat turns only.

      // Must use refined loop type (not the pre-LLM heuristic only)
      switch (this.state.loopConfig.loopType) {
        case 'Turn-based':
          await this.runTurnBased()
          break
        case 'Goal-based':
          await this.runGoalBased()
          break
        case 'Time-based':
          await this.runTimeBased()
          break
        case 'Proactive':
          await this.runProactive()
          break
      }

      // The controller may explicitly choose a post-state for an automation
      // or integration run; apply it after pattern finalization so Goal/Turn
      // success helpers cannot silently overwrite the requested outcome.
      if (this.overrides.nextState) {
        this.state.loopConfig = {
          ...this.state.loopConfig,
          nextState: this.overrides.nextState,
        }
      }

      if (this.aborted && (this.state.status === 'running' || this.state.status === 'manual_intervention')) {
        this.state.status = 'halted'
        this.state.haltReason = this.state.haltReason || 'Stopped by user'
        this.log('WARN', 'Execution aborted by user')
      }

      this.state.metrics.executionMs = Date.now() - t0
      this.state.metrics.apiCredits = this.state.tokensUsed
      this.state.finishedAt = new Date().toISOString()
      this.refreshKnowledge()
      this.emit()
      return this.getState()
    } catch (err) {
      this.state.status = 'failed'
      this.state.haltReason = err instanceof Error ? err.message : String(err)
      this.log('ERROR', this.state.haltReason)
      this.state.metrics.executionMs = Date.now() - t0
      this.state.finishedAt = new Date().toISOString()
      this.emit()
      return this.getState()
    } finally {
      /* Run identity is carried by the per-run engine/tool context. */
    }
  }

  private nodeForRole(
    id: string,
    name: string,
    role: SubAgentNode['role'],
  ): SubAgentNode {
    const r = this.executionModel(role)
    return {
      id,
      name,
      role,
      status: 'idle',
      model: r.model || undefined,
      modelSource: r.source,
    }
  }

  private spawnSubAgents(loopType: LoopType): SubAgentNode[] {
    if (!this.subAgentsEnabled()) return []
    if (loopType === 'Turn-based') {
      return [this.nodeForRole('ag-core', 'Core', 'executor')]
    }
    return [
      this.nodeForRole('ag-mgr', 'Manager', 'orchestrator'),
      this.nodeForRole('ag-an1', 'Analyzer-1', 'analyst'),
      this.nodeForRole('ag-wrt', 'Writer', 'synthesizer'),
    ]
  }

  private setSubAgent(
    name: string,
    status: SubAgentNode['status'],
    lastMessage?: string,
    modelMeta?: { model?: string; modelSource?: SubAgentNode['modelSource'] },
  ) {
    this.state.subAgents = this.state.subAgents.map((a) =>
      a.name === name || a.role === name
        ? {
            ...a,
            status,
            lastMessage: lastMessage ?? a.lastMessage,
            model: modelMeta?.model ?? a.model,
            modelSource: modelMeta?.modelSource ?? a.modelSource,
          }
        : a,
    )
    this.emit()
  }

  private async executeStepWithAgent(
    index: number,
    iteration: number,
  ): Promise<{ ok: boolean; output: string; durationMs: number }> {
    const agentName = pickAgentForStep(this.state, index, this.state.steps.length, this.settings)
    const result = await runStep(this.state, index, iteration, agentName, {
      publish: (s) => {
        this.state = s
        this.emit()
      },
      // ticket 02: engine still owns HITL timing (loopRunner takes it over in ticket 03) —
      // waitForIntervention already applies the unattended/interactive timeout policy.
      ask: () => this.waitForIntervention(),
      log: (level, message) => this.log(level, message),
      shouldAbort: () => this.aborted,
      settings: this.settings,
      overrides: this.overrides,
      projectGuidance: this.projectGuidance,
      sessionRecallBlock: this.sessionRecallBlock,
      attachedSkillContext: this.attachedSkillContext,
      userAttachments: this.userAttachments,
      stepOutputsSoFar: this.stepOutputs,
    })
    this.userAttachments = result.userAttachments
    if (result.contributesOutput) {
      this.stepOutputs.push(result.output)
      this.updateProgress()
      if (!result.ok) this.emit()
    }
    return { ok: result.ok, output: result.output, durationMs: result.durationMs }
  }

  // ── Pattern 1: Turn-based ─────────────────────────────────────

  private async runTurnBased() {
    this.log('INFO', 'Pattern: Turn-based — 1 Input = 1 Action')
    if (!this.state.steps[0]) return

    const { ok, output } = await this.executeStepWithAgent(0, 1)
    if (!ok || this.aborted) return

    this.state.confidence = Math.max(this.state.confidence, 0.92)
    this.state.result = output
    this.state.reportTitle = 'Turn Result'
    const configuredNextState = this.overrides.nextState || this.state.loopConfig.nextState
    // Chat-lite / composer / automation: do not block a run slot on ACK.
    // Explicit Turn on Execution page (no sourceKind) still waits for user validation.
    const chatLiteAck =
      this.overrides.unattended === true ||
      this.overrides.sourceKind === 'composer' ||
      this.overrides.sourceKind === 'slash' ||
      this.overrides.sourceKind === 'retry'
    if (chatLiteAck || configuredNextState === 'Dispatch Webhook') {
      this.log(
        'INFO',
        configuredNextState === 'Dispatch Webhook'
          ? 'Turn post-state：完成後 Dispatch Webhook'
          : this.overrides.unattended === true
          ? '無人值守 Turn-based：跳過人工 ACK，自動確認'
          : '對話 Turn/Chat-lite：自動確認，不等待 ACK',
      )
    } else {
      this.log('SUCCESS', 'Action completed. Awaiting user validation (ACK).')
      this.state.loopConfig = {
        ...this.state.loopConfig,
        nextState: 'Await User Input',
      }
      await this.waitForUser()
      if (this.aborted) return
    }

    this.state.status = 'success'
    this.state.progress = 100
    this.state.loopConfig = {
      ...this.state.loopConfig,
      nextState:
        this.overrides.nextState ||
        (configuredNextState === 'Dispatch Webhook' ? 'Dispatch Webhook' : 'Halt'),
    }
    this.setSubAgent('Core', 'done')
    this.log('SUCCESS', chatLiteAck ? 'Turn complete (auto-ACK).' : 'User ACK received. Turn complete.')
    this.noteLearningSuccess('Turn-based')
    this.emit()
  }

  // ── Pattern 2: Goal-based ─────────────────────────────────────

  private async runGoalBased() {
    const max = this.maxIterations()
    this.state.loopConfig.maxIterations = max
    this.log('INFO', 'Pattern: Goal-based — Autonomous iteration until DoD')
    this.log(
      'INFO',
      this.subAgentsEnabled()
        ? 'Spawning orchestrator agent...'
        : 'Sub Agent 關閉：由主代理直接執行。',
    )
    this.setSubAgent('Manager', 'active')
    await delay(300)
    this.log('INFO', 'Allocating resources for semantic processing.')
    this.setSubAgent('Analyzer-1', 'idle')
    this.setSubAgent('Writer', 'idle')

    for (let iteration = 1; iteration <= max; iteration++) {
      if (this.aborted) return
      this.state.currentIteration = iteration
      this.state.status = 'running'
      this.log('PROCESS', `── Iteration ${iteration}/${max} ──`)
      this.emit()

      let brokeEarly = false
      for (let i = 0; i < this.state.steps.length; i++) {
        if (this.aborted) return
        const step = this.state.steps[i]
        if (step.status === 'COMPLETED' && iteration > 1) continue

        const { ok } = await this.executeStepWithAgent(i, iteration)
        if (!ok) return

        // Soft retry path (simulation only, first mid step)
        if (
          !this.useLlm() &&
          iteration === 1 &&
          i === Math.floor(this.state.steps.length / 2) &&
          Math.random() < 0.12
        ) {
          this.log('WARN', `Validation low confidence (${this.state.confidence.toFixed(2)})`)
          this.setStep(i, { status: 'PENDING' })
          this.log('INFO', `Initiating correction loop (Attempt ${iteration}/${max})`)
          brokeEarly = true
          break
        }
      }

      if (brokeEarly) continue

      const allDone = this.state.steps.every((s) => s.status === 'COMPLETED')
      let dodMet = allDone && this.state.confidence >= this.minConfidence()
      let missing: string[] = []

      // 規格 02 Pattern 2：由 validator 對實際產出做語意驗收。
      // 模擬模式或模型輸出失效時維持既有 confidence fallback。
      if (allDone && this.useLlm()) {
        try {
          const verdict = await evaluateDoD(
            this.executionSettings('analyst'),
            this.state.objective,
            this.state.loopConfig.definitionOfDone,
            this.stepOutputs,
          )
          dodMet = verdict.met
          missing = verdict.missing
          this.lastDodMissing = missing
          this.state.confidence = verdict.confidence
          this.state.tokensUsed += verdict.tokensUsed
          this.state.metrics.apiCredits = this.state.tokensUsed
          this.log(
            'EVAL',
            `DoD 語意驗收：met=${verdict.met} confidence=${verdict.confidence.toFixed(2)}` +
              (missing.length ? ` · 缺口：${missing.join(' | ').slice(0, 300)}` : ''),
          )
        } catch (e) {
          this.log(
            'WARN',
            `DoD 語意驗收失敗，回退步驟/信心啟發式：${e instanceof Error ? e.message : e}`,
          )
        }
      }

      this.log(
        'EVAL',
        `DoD check: steps=${allDone}, confidence=${this.state.confidence.toFixed(2)} (≥${this.minConfidence().toFixed(2)}) → ${dodMet}`,
      )

      if (dodMet) {
        await this.finalizeSuccess()
        return
      }

      if (iteration >= max) {
        this.state.status = 'failed'
        this.state.haltReason = 'Max Iterations Reached'
        this.log('ERROR', `Max iterations (${max}) reached without meeting DoD.`)
        this.log('WARN', this.state.loopConfig.fallbackProtocol)
        this.setSubAgent('Manager', 'error')
        this.noteLearningFailure(this.state.loopConfig.loopType, this.state.haltReason)
        this.persistContinueGoal('failed', this.lastDodMissing)
        this.emit()
        return
      }

      if (allDone && !dodMet) {
        // 全完成但 DoD 未達：以缺口 replan，避免盲重跑同一計畫空轉。
        if (missing.length) {
          this.stepOutputs.push(
            `### 上一輪 DoD 缺口（本輪必須補齊）\n${missing.map((item) => `- ${item}`).join('\n')}`,
          )
          this.state.steps = replanCorrectiveSteps(missing, this.state.objective, {
            maxSteps: 3,
          })
          this.state.loopConfig = {
            ...this.state.loopConfig,
            executionSequence: this.state.steps.map((s) => s.description),
          }
          this.log(
            'PROCESS',
            `迭代 replan：${missing.length} 項缺口 → ${this.state.steps.length} 個修正步驟`,
          )
        } else {
          this.state.steps = this.state.steps.map((step) => ({
            ...step,
            status: 'PENDING' as const,
          }))
          this.log('PROCESS', 'DoD 未達且無 missing 明細：重跑全部步驟')
        }
      } else {
        this.state.steps = this.state.steps.map((step) =>
          step.status === 'COMPLETED' ? step : { ...step, status: 'PENDING' as const },
        )
      }
      this.emit()
    }
  }

  private async finalizeSuccess() {
    this.setSubAgent('Manager', 'done')
    this.setSubAgent('Analyzer-1', 'done')
    this.setSubAgent('Writer', 'active')

    let report = this.synthesizeResultLocal()
    if (this.useLlm()) {
      try {
        this.log('PROCESS', 'Writer synthesizing final report via LLM...')
        const writerResolved = this.executionModel('synthesizer')
        const writerSettings = this.executionSettings('synthesizer')
        this.log(
          'INFO',
          `Writer model=${writerSettings.model} (${this.subAgentsEnabled() ? (writerResolved.usedFallback ? 'fallback→global' : 'roleModels') : 'primary/global'})`,
        )
        this.setSubAgent('Writer', 'active', undefined, {
          model: writerResolved.model || undefined,
          modelSource: writerResolved.source,
        })
        const r = await synthesizeReport(
          writerSettings,
          this.state.objective,
          this.stepOutputs,
          this.state.loopConfig.definitionOfDone,
        )
        report = r.content
        this.state.tokensUsed += r.tokensUsed
        this.state.metrics.apiCredits = this.state.tokensUsed
        this.log('SUCCESS', `Report synthesized (+${r.tokensUsed} tokens)`)
      } catch (e) {
        this.log('WARN', `LLM synthesis failed; using local report. ${e instanceof Error ? e.message : e}`)
      }
    }

    this.setSubAgent('Writer', 'done')
    this.state.result = report
    this.state.reportTitle = this.deriveReportTitle()
    this.state.status = 'success'
    this.state.progress = 100
    // Goal-based stays autonomous (spec 02: no per-step ACK) — this does not block
    // completion. It only lets the UI surface a "reply to continue" hint when the
    // synthesized result itself poses a follow-up question. See L6/P1-4 in
    // docs/CONVERSATION_LOOP_HERMES_FLOW.md.
    this.state.loopConfig = {
      ...this.state.loopConfig,
      nextState:
        this.overrides.nextState ||
        (this.state.loopConfig.nextState === 'Dispatch Webhook'
          ? 'Dispatch Webhook'
          : this.resultAwaitsReply(report)
            ? 'Await User Input'
            : 'Halt'),
    }
    this.refreshKnowledge()
    this.log('SUCCESS', 'Definition of Done met. Terminating loop.')
    this.noteLearningSuccess(this.state.loopConfig.loopType)
    this.clearContinueGoal()
    this.emit()
  }

  /** Heuristic: does the synthesized result end by asking the user something? */
  private resultAwaitsReply(text: string): boolean {
    const trimmed = (text || '').trim()
    if (!trimmed) return false
    const tail = trimmed.slice(-240)
    if (/[?？]\s*$/.test(tail)) return true
    return /(是否|要不要|需要我|想要我|你希望|你想|would you like|do you want|should i|shall i|let me know)/i.test(tail)
  }

  /** Persist unfinished Goal so chat can resume same DoD. */
  private persistContinueGoal(
    lastStatus: 'failed' | 'halted',
    missing: string[],
  ) {
    try {
      const digest =
        this.state.result?.trim() ||
        this.stepOutputs.slice(-2).join('\n---\n').slice(0, 2000) ||
        ''
      const snap = buildContinueGoalSnapshot({
        objective: this.state.objective,
        definitionOfDone: this.state.loopConfig.definitionOfDone,
        loopType: this.state.loopConfig.loopType,
        steps: this.state.steps,
        missing,
        priorDigest: digest,
        lastStatus,
        runId: this.state.id,
      })
      void import('../store/threadStore').then(({ useThreadStore }) => {
        const thr = useThreadStore.getState()
        const tid =
          this.overrides.threadId || thr.runningThreadId || thr.activeId
        if (!tid) return
        thr.setContinueGoal(tid, snap)
        thr.pushBubble(tid, 'system', formatContinueGoalOffer(snap))
      })
      this.log('INFO', 'continueGoal 已保存 — 可「補齊缺口繼續」')
    } catch {
      /* non-fatal */
    }
  }

  private clearContinueGoal() {
    try {
      void import('../store/threadStore').then(({ useThreadStore }) => {
        const thr = useThreadStore.getState()
        const tid =
          this.overrides.threadId || thr.runningThreadId || thr.activeId
        if (tid) thr.setContinueGoal(tid, null)
      })
    } catch {
      /* ignore */
    }
  }

  private deriveReportTitle(): string {
    const obj = this.state.objective
    if (/market|landscape|orchestr|市場|競品/i.test(obj)) {
      return `市場／競品分析：${obj.slice(0, 40)}`
    }
    if (/security|log|資安|日誌|異常/i.test(obj)) {
      return `資安／日誌分析：${obj.slice(0, 40)}`
    }
    if (/price|competitor|價格|定價/i.test(obj)) {
      return `定價比較：${obj.slice(0, 40)}`
    }
    return `代理報告：${obj.slice(0, 48)}${obj.length > 48 ? '…' : ''}`
  }

  // ── Pattern 3: Time-based ─────────────────────────────────────

  private async runTimeBased() {
    this.log('INFO', 'Pattern: Time-based — Cron-job style execution')
    const trigger = this.state.scheduleTrigger
    this.log(
      'INFO',
      trigger
        ? `Trigger window validated：${trigger.jobId} @ ${trigger.triggeredAt}`
        : `Trigger window validated at ${nowTime()}`,
    )
    this.setSubAgent('Manager', 'active')

    for (let i = 0; i < this.state.steps.length; i++) {
      if (this.aborted) return
      const { ok } = await this.executeStepWithAgent(i, 1)
      if (!ok) return
    }

    this.finalizePatternRun({
      reportTitle: 'Scheduled Job Report',
      loopType: 'Time-based',
      successLog: 'Time-based execution validated and delivered.',
    })
  }

  /** Shared success/fail scoring for Time / Proactive (no fake 0.99 on total tool failure). */
  private finalizePatternRun(opts: {
    reportTitle: string
    loopType: string
    successLog: string
  }) {
    const tools = this.state.toolCalls || []
    const completed = this.state.steps.filter((s) => s.status === 'COMPLETED').length
    const stepRatio = this.state.steps.length
      ? completed / this.state.steps.length
      : 0
    const toolOkRatio = tools.length
      ? tools.filter((t) => t.ok).length / tools.length
      : 1

    if (tools.length > 0 && tools.every((t) => !t.ok)) {
      this.state.confidence = Math.min(0.35, toolOkRatio)
      this.state.status = 'failed'
      this.state.haltReason = 'All tool calls failed — cannot claim delivery success'
      this.state.progress = 100
      this.state.result = this.synthesizeResultLocal()
      this.state.reportTitle = opts.reportTitle
      this.setSubAgent('Manager', 'error')
      this.log('ERROR', this.state.haltReason)
      this.noteLearningFailure(opts.loopType, this.state.haltReason)
      this.emit()
      return
    }

    // 0.55 base + steps + tools (cap 0.99)
    this.state.confidence = Math.min(
      0.99,
      0.55 + 0.3 * stepRatio + 0.15 * toolOkRatio,
    )
    this.state.status = 'success'
    this.state.progress = 100
    this.state.result = this.synthesizeResultLocal()
    this.state.reportTitle = opts.reportTitle
    this.setSubAgent('Manager', 'done')
    this.log(
      'SUCCESS',
      `${opts.successLog} (confidence=${this.state.confidence.toFixed(2)} tools_ok=${(toolOkRatio * 100).toFixed(0)}%)`,
    )
    this.noteLearningSuccess(opts.loopType)
    this.emit()
  }

  // ── Pattern 4: Proactive ──────────────────────────────────────

  private async runProactive() {
    this.log('INFO', 'Pattern: Proactive — Event-driven execution')
    const trigger = this.state.eventTrigger
    this.log(
      'SUCCESS',
      trigger
        ? `Event matcher predicates verified：${trigger.eventName} · ${trigger.matchedAt}`
        : 'Event matcher evidence missing — no action taken.',
    )

    for (let i = 0; i < this.state.steps.length; i++) {
      if (this.aborted) return
      const { ok } = await this.executeStepWithAgent(i, 1)
      if (!ok) return
    }

    this.finalizePatternRun({
      reportTitle: 'Proactive Event Report',
      loopType: 'Proactive',
      successLog: 'Event action completed successfully.',
    })
  }

  /** Shared learning hook for Goal / Time / Proactive success */
  private noteLearningSuccess(loopType: string) {
    try {
      learningLoop.onGoalSuccess({
        objective: this.state.objective,
        steps: this.state.steps.map((s) => ({
          description: s.description,
          result: s.result,
        })),
        // P2: tool trajectory for higher-quality skill drafts
        toolCalls: (this.state.toolCalls || [])
          .filter((t) => t.ok)
          .slice(0, 16)
          .map((t) => ({
            tool: t.tool,
            summary: (t.output || '').slice(0, 120),
          })),
        loopType,
        memoryEnabled: this.settings.memoryEnabled,
        memoryWriteEnabled:
          this.settings.memoryWriteEnabled !== false &&
          this.overrides.temporary !== true &&
          this.settings.temporaryChatDefault !== true,
      })
      this.log('INFO', '學習迴圈：已產生技能草稿／記憶摘要（見學習中心）')
    } catch {
      /* non-fatal */
    }
  }

  /** Shared failure-lesson hook for max iterations and failed delivery runs. */
  private noteLearningFailure(loopType: string, haltReason: string) {
    try {
      learningLoop.onGoalFailure({
        objective: this.state.objective,
        haltReason,
        loopType,
        failedTools: [
          ...new Set((this.state.toolCalls || []).filter((tool) => !tool.ok).map((tool) => tool.tool)),
        ],
        memoryEnabled: this.settings.memoryEnabled,
        memoryWriteEnabled:
          this.settings.memoryWriteEnabled !== false &&
          this.overrides.temporary !== true &&
          this.settings.temporaryChatDefault !== true,
      })
      this.log('INFO', '學習迴圈：已記錄失敗教訓（見學習中心／記憶）')
    } catch {
      /* learning must never alter task termination */
    }
  }

  private synthesizeResultLocal(): string {
    const obj = this.state.objective
    const title = this.deriveReportTitle()
    const steps = this.state.steps
      .map(
        (s) =>
          `- ✓ **${s.description}**${s.assignedAgent ? ` _(${s.assignedAgent})_` : ''}${
            s.durationMs ? ` — ${(s.durationMs / 1000).toFixed(1)}s` : ''
          }`,
      )
      .join('\n')

    const findings = this.stepOutputs
      .slice(0, 3)
      .map((o, i) => `### Finding ${i + 1}\n${o.slice(0, 400)}`)
      .join('\n\n')

    return `# ${title}

This report synthesizes findings from ${this.subAgentsEnabled() ? `${this.state.subAgents.length} sub-agents` : 'the primary agent'} analyzing the objective.

## Executive Summary

${obj}

The multi-agent loop completed with confidence **${this.state.confidence.toFixed(2)}** after **${this.state.currentIteration}** iteration(s).

## Key Trends

- Sub-agent specialization improved step isolation and auditability.
- Validation against Definition of Done prevented premature halt.
- ${this.useLlm() ? 'Cloud LLM synthesis enabled for narrative quality.' : 'Simulation mode produced structured placeholder insights.'}

## Execution Steps
${steps}

## Definition of Done
${this.state.loopConfig.definitionOfDone}

## Data Insights

${findings || '_No intermediate findings captured._'}

## Payload Example

\`\`\`json
{
  "agent_id": "orchestrator_alpha",
  "task": "goal_execution",
  "session_id": "${this.state.id}",
  "sub_agents": ${JSON.stringify(this.state.subAgents.map((a) => a.name))}
}
\`\`\`
`
  }
}

/**
 * Engine factory/registry. Runtime state (abort flags, pauses, HITL
 * continuation promises and AgentState) belongs to each run instance; this
 * object only owns shared settings and targeted lifecycle helpers.
 */
class AgentEngineRegistry {
  private settings: LlmSettings = { ...DEFAULT_LLM_SETTINGS }
  private engines = new Map<string, { engine: AgentLoopEngine; unsubscribe: () => void }>()
  private listeners = new Set<Listener>()

  configure(settings: LlmSettings) {
    this.settings = { ...settings }
    for (const { engine } of this.engines.values()) engine.configure(this.settings)
  }

  create(runId?: string): AgentLoopEngine {
    const id = runId?.trim()
    if (id) {
      const existing = this.engines.get(id)
      if (existing) return existing.engine
    }
    const engine = new AgentLoopEngine()
    engine.configure(this.settings)
    if (id) {
      const unsubscribe = engine.subscribe((state) => {
        for (const listener of this.listeners) listener(state)
      })
      this.engines.set(id, { engine, unsubscribe })
    }
    return engine
  }

  get(runId: string): AgentLoopEngine | undefined {
    return this.engines.get(runId)?.engine
  }

  release(runId: string) {
    const entry = this.engines.get(runId)
    entry?.unsubscribe()
    this.engines.delete(runId)
  }

  getState(runId?: string): AgentState {
    return runId ? this.engines.get(runId)?.engine.getState() || new AgentLoopEngine().getState() : new AgentLoopEngine().getState()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start(rawInput: string, forceLoopType?: LoopType, overrides?: RuntimeOverrides): Promise<AgentState> {
    const runId = overrides?.runId?.trim() || `legacy_${uuid().slice(0, 12)}`
    const engine = this.create(runId)
    try {
      return await engine.start(rawInput, forceLoopType, { ...overrides, runId })
    } finally {
      this.release(runId)
    }
  }

  stop(runId?: string) {
    if (runId) this.engines.get(runId)?.engine.stop()
    else for (const { engine } of this.engines.values()) engine.stop()
  }

  continueTurn(runId?: string) {
    if (runId) this.engines.get(runId)?.engine.continueTurn()
    else for (const { engine } of this.engines.values()) engine.continueTurn()
  }

  resolveIntervention(decision: InterventionDecision, runId?: string) {
    if (runId) this.engines.get(runId)?.engine.resolveIntervention(decision)
    else for (const { engine } of this.engines.values()) engine.resolveIntervention(decision)
  }
}

export const agentEngine = new AgentEngineRegistry()
