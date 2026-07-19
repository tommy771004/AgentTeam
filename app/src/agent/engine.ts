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
  ToolCallRecord,
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
  runPrimaryAgentTask,
  runSubAgentTask,
  synthesizeReport,
  withRoleModel,
} from './llm'
import { buildPromptLayers, formatPacketDiagnostics } from './hermes/promptBuilder'
import { learningLoop } from './hermes/learning'
import { BUILTIN_RUNNER_CAPABILITIES } from './runners'
import { compressStepOutputs } from './hermes/sessionSearch'
import { skillsStore } from './hermes/skills'
import { buildToolInput, selectToolsForStep } from './tools/registry'
import { authorizeTool, guardAndExecuteTool } from './tools/toolGuard'
import {
  isClaimedScheduleTrigger,
  validateScheduleTriggerSnapshot,
  type ScheduleTriggerValidation,
} from './scheduler'
import { validateEventTriggerSnapshot } from './eventMatcher'
import {
  buildCustomToolInput,
  executeCustomTool,
  selectCustomToolsForStep,
} from './tools/customTools'
import { runFunctionCallingLoop } from './tools/toolLoop'
import {
  DEFAULT_SUPERVISOR_LIMITS,
  enforceToolPayload,
  SupervisorViolation,
  type SupervisorLimits,
} from './supervisor'
type Listener = (state: AgentState) => void

type InterventionDecision =
  | { action: 'approve'; payloadJson?: string }
  | { action: 'reject' }
  | { action: 'abort' }

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

  private pickAgentForStep(index: number, total: number): string {
    if (!this.subAgentsEnabled()) return 'Primary'
    if (this.state.subAgents.length === 1) return this.state.subAgents[0].name
    if (index === 0) return 'Manager'
    if (index >= total - 1) return 'Writer'
    return 'Analyzer-1'
  }

  private async executeStepWithAgent(
    index: number,
    iteration: number,
  ): Promise<{ ok: boolean; output: string; durationMs: number }> {
    const step = this.state.steps[index]
    const agentName = this.pickAgentForStep(index, this.state.steps.length)
    const role =
      this.state.subAgents.find((a) => a.name === agentName)?.role || 'executor'

    const resolved = this.executionModel(role)
    this.setStep(index, {
      status: 'IN_PROGRESS',
      assignedAgent: agentName,
      modelUsed: this.useLlm()
        ? resolved.model || '(no model)'
        : '(simulation)',
      modelSource: this.useLlm() ? resolved.source : 'sim',
    })
    this.setSubAgent(agentName, 'active', undefined, {
      model: resolved.model || undefined,
      modelSource: this.useLlm() ? resolved.source : 'sim',
    })
    this.log('EXEC', `[${agentName}] step ${step.step}: ${step.description}`)
    const modelSourceLabel = this.subAgentsEnabled()
      ? (resolved.usedFallback ? 'fallback→global' : 'roleModels')
      : 'primary/global'
    this.log(
      'INFO',
      `[${agentName}] model=${this.useLlm() ? resolved.model || '—' : 'simulation'} (${this.useLlm() ? modelSourceLabel : 'sim'})`,
    )

    // Safety gate
    if (this.settings.safetyEnabled) {
      const safety = evaluateSafety(
        this.state.objective,
        step.description,
        step.action,
        this.settings.authLevel,
      )
      if (
        !safety.ok &&
        this.settings.approvalMode === 'full' &&
        this.overrides.unattended !== true
      ) {
        // 完整存取權（僅互動 run）：不停等人工，記錄後直接續跑（deny 規則仍生效）
        this.log('WARN', 'Proposed action targets sensitive resources')
        this.log('INFO', '完整存取權模式：safety intervention 自動核准並續跑')
      } else if (!safety.ok) {
        this.log('WARN', `Proposed action targets sensitive resources`)
        this.log('HALT', 'Safety constraint triggered. Awaiting human validation.')
        this.state.intervention = {
          active: true,
          reason: safety.reason,
          payloadJson: formatPayloadForDisplay(safety.payload),
          safety,
          timeoutSec: 900,
        }
        this.emit()

        const decision = await this.waitForIntervention()
        if (this.aborted || decision.action === 'abort' || decision.action === 'reject') {
          this.state.intervention = emptyIntervention()
          this.state.status = 'halted'
          this.state.haltReason =
            decision.action === 'reject'
              ? 'User rejected unsafe payload'
              : 'Session aborted during manual intervention'
          this.setStep(index, { status: 'FAILED', result: this.state.haltReason })
          this.setSubAgent(agentName, 'error')
          this.log('ERROR', this.state.haltReason)
          this.emit()
          return { ok: false, output: '', durationMs: 0 }
        }

        // approved — optionally with edited payload
        if (decision.payloadJson) {
          this.state.intervention.payloadJson = decision.payloadJson
        }
        this.log('SUCCESS', 'Human approved payload. Resuming execution.')
        this.state.intervention = emptyIntervention()
        this.state.status = 'running'
        this.emit()
      }
    }

    const t0 = Date.now()
    let output = ''

    // ── Tools + LLM phase ───────────────────────────────────────
    let toolContext = ''
    // P1-B: model capability profile — degrade BEFORE the call fails mid-run
    const { modelSupports } = await import('./modelProfile')
    const stepModel = this.useLlm() ? resolved.model : ''
    const fcCapable = modelSupports(this.settings, stepModel, 'tools')
    if (fcCapable === false && this.settings.functionCalling !== false) {
      this.log(
        'WARN',
        `模型 ${stepModel} 標記不支援 tool calls（profile）— 本步降級 heuristic 路徑`,
      )
    }
    const useFc =
      this.useLlm() &&
      this.settings.toolsEnabled !== false &&
      this.settings.functionCalling !== false &&
      fcCapable !== false
    // Vision gate: strip image payloads when profile says unsupported
    if (
      this.userAttachments.some((a) => a.kind === 'image') &&
      modelSupports(this.settings, stepModel, 'vision') === false
    ) {
      this.log(
        'WARN',
        `模型 ${stepModel} 標記不支援 vision（profile）— 圖片改以路徑註記傳遞`,
      )
      this.userAttachments = this.userAttachments.map((a) =>
        a.kind === 'image' ? { ...a, dataUrl: undefined } : a,
      )
    }

    try {
      if (useFc) {
        this.log('INFO', `[${agentName}] function-calling tool loop enabled`)
        this.log('System', 'Binding tool registry… [OK]')
        const roleSettings = this.executionSettings(role)
        const layers = buildPromptLayers({
          role,
          objective: this.state.objective,
          settings: this.settings,
          projectGuidance: this.projectGuidance || undefined,
          temporary:
            this.overrides.temporary === true ||
            this.settings.temporaryChatDefault === true,
          stepEvidence: compressStepOutputs(this.stepOutputs, 4000),
          sessionRecall: this.sessionRecallBlock || undefined,
          skillsContext: this.attachedSkillContext || undefined,
        })
        if (layers.packetDiagnostics) {
          this.log('INFO', formatPacketDiagnostics(layers.packet!))
        }
        // Cross-step + cross-run resume: skills + loaded caps + tool_search unlocks
        const preloadCaps = [
          ...(this.overrides.attachedSkills || []).map((n) => `skill:${n}`),
          ...(this.overrides.preloadCapabilityIds || []),
          ...(this.state.loadedCapabilityIds || []),
        ]
        const preloadUnlocks = [
          ...(this.overrides.preloadUnlockedTools || []),
          ...(this.state.unlockedToolNames || []),
        ]
        if (this.userAttachments.some((a) => a.kind === 'image' && a.dataUrl)) {
          this.log('INFO', `Multimodal: ${this.userAttachments.filter((a) => a.kind === 'image').length} image(s) in user message`)
        }
        const loop = await runFunctionCallingLoop(
          roleSettings,
          {
            role,
            objective: this.state.objective,
            step: step.description,
            context: layers.full.slice(0, 12_000),
            userAttachments: this.userAttachments,
          },
          {
            limits: this.supervisorLimits(),
            haltOnPayloadOverflow: this.settings.haltOnPayloadOverflow === true,
            includeMcpTools: this.settings.mcpEnabled,
            permissionPolicy: this.overrides.permissionPolicy,
            permissionProjection: this.overrides.permissionProjection,
            mcpAgentId: this.overrides.mcpAgentId || this.overrides.agentMode || 'build',
            preloadCapabilityIds: preloadCaps,
            preloadUnlockedTools: preloadUnlocks,
            unattended: this.overrides.unattended === true,
            hitlTimeoutMs: this.overrides.hitlTimeoutMs,
            sourceKind: this.overrides.sourceKind,
            objective: this.state.objective,
            projectRoot: this.overrides.projectRoot,
            runId: this.overrides.runId,
            threadId: this.overrides.threadId,
            // OpenCode policy deny + role isolation
            blockedTools: [
              ...(this.overrides.blockedTools || []),
              ...(agentName === 'Core' || role === 'executor' ? ['delegate_task'] : []),
            ],
            callbacks: {
              shouldAbort: () => this.aborted,
              onLog: (level, message) => {
                const map: Record<string, LogLevel> = {
                  THOUGHT: 'THOUGHT',
                  ACTION: 'ACTION',
                  INFO: 'INFO',
                  EXEC: 'EXEC',
                  SUCCESS: 'SUCCESS',
                  WARN: 'WARN',
                  ERROR: 'ERROR',
                  PROCESS: 'PROCESS',
                }
                this.log(map[level] || 'INFO', message)
              },
              onToolCall: (record) => {
                this.state.toolCalls = [
                  ...this.state.toolCalls,
                  { ...record, step: step.step },
                ]
                this.emit()
              },
              onCapabilityLoad: (ids) => {
                // Union across steps within a run
                const set = new Set([...(this.state.loadedCapabilityIds || []), ...ids])
                this.state.loadedCapabilityIds = [...set].sort()
                this.emit()
              },
              onQuestionAsked: () => {
                this.state.status = 'awaiting_user'
                this.emit()
              },
              onQuestionResolved: () => {
                if (this.state.status === 'awaiting_user') this.state.status = 'running'
                this.emit()
              },
            },
          },
        )
        output = loop.content
        toolContext = loop.toolContext
        this.state.tokensUsed += loop.tokensUsed
        this.state.metrics.apiCredits = this.state.tokensUsed
        if (loop.loadedCapabilityIds?.length) {
          const set = new Set([
            ...(this.state.loadedCapabilityIds || []),
            ...loop.loadedCapabilityIds,
          ])
          this.state.loadedCapabilityIds = [...set].sort()
        }
        if (loop.unlockedToolNames?.length) {
          const set = new Set([
            ...(this.state.unlockedToolNames || []),
            ...loop.unlockedToolNames,
          ])
          this.state.unlockedToolNames = [...set].sort()
        }
        this.setSubAgent(agentName, 'active', output.slice(0, 120))
        this.log(
          'INFO',
          `[${agentName}] FC rounds=${loop.rounds} tokens +${loop.tokensUsed}` +
            (this.state.loadedCapabilityIds.length
              ? ` caps=[${this.state.loadedCapabilityIds.join(', ')}]`
              : '') +
            (this.state.unlockedToolNames.length
              ? ` unlock=${this.state.unlockedToolNames.length}`
              : ''),
        )
      } else {
        // Heuristic tools (no FC) then optional plain LLM —
        // still honor capability approvalTools + progressive preload (no silent bypass)
        if (this.settings.toolsEnabled !== false) {
          const {
            assembleCapabilities,
            loadCapability,
            capabilityOwnsTool,
            approvalRequiredFor,
            formatAlwaysOnInstructions,
          } = await import('./capabilities')
          let projectRoot = ''
          try {
            const { useProjectStore } = await import('../store/projectStore')
            projectRoot =
              (this.overrides.projectRoot || '').trim() ||
              useProjectStore.getState().root ||
              ''
          } catch {
            projectRoot = (this.overrides.projectRoot || '').trim()
          }
          const capState = assembleCapabilities(this.settings, {
            progressive: this.settings.capabilitiesEnabled !== false,
            preloadIds: [
              ...(this.overrides.attachedSkills || []).map((n) => `skill:${n}`),
              ...(this.overrides.preloadCapabilityIds || []),
              ...(this.state.loadedCapabilityIds || []),
            ],
            preloadUnlockedTools: [
              ...(this.overrides.preloadUnlockedTools || []),
              ...(this.state.unlockedToolNames || []),
            ],
            webSearchEnabled: this.settings.webSearchEnabled !== false,
            projectRoot,
            agentId: this.overrides.mcpAgentId || this.overrides.agentMode || 'build',
            blockedTools: [
              ...(this.overrides.blockedTools || []),
              ...(agentName === 'Core' || role === 'executor' ? ['delegate_task'] : []),
            ],
            entitlement: (await import('../store/subscriptionStore')).useSubscriptionStore.getState().entitlement,
          })

          const tools = selectToolsForStep(step.description, this.state.objective, step.action, {
            webSearchEnabled: this.settings.webSearchEnabled !== false,
          }).filter((t) =>
            (this.settings.subAgentsEnabled === true || !t.startsWith('delegate_')) &&
            !(this.overrides.blockedTools || []).includes(t),
          )

          // Auto-load owning capabilities so heuristic path gets runbooks + approvalTools
          for (const tool of tools) {
            for (const c of capState.all) {
              if (capabilityOwnsTool(c, tool) && !capState.loadedIds.has(c.id)) {
                loadCapability(capState, c.id)
                this.log('INFO', `heuristic auto-load capability «${c.id}» for tool ${tool}`)
              }
            }
          }
          {
            const set = new Set([
              ...(this.state.loadedCapabilityIds || []),
              ...[...capState.loadedIds],
            ])
            this.state.loadedCapabilityIds = [...set].sort()
            this.emit()
          }

          const runbook = formatAlwaysOnInstructions(capState)
          if (runbook) {
            this.log('INFO', `heuristic capability runbooks active (${this.state.loadedCapabilityIds.length})`)
          }

          // Plugin / connector custom tools (same capability gate as FC)
          const customTools = selectCustomToolsForStep(
            step.description,
            this.state.objective,
            this.settings,
            { blockedTools: this.overrides.blockedTools },
          )
          for (const custom of customTools) {
            const ownerCap = `user:${custom.ownerId}`
            if (!capState.loadedIds.has(ownerCap)) {
              loadCapability(capState, ownerCap)
              this.log('INFO', `heuristic auto-load capability «${ownerCap}» for ${custom.name}`)
            }
          }
          {
            const set = new Set([
              ...(this.state.loadedCapabilityIds || []),
              ...[...capState.loadedIds],
            ])
            this.state.loadedCapabilityIds = [...set].sort()
            this.emit()
          }

          if (tools.length || customTools.length) {
            this.log(
              'PROCESS',
              `[${agentName}] tools: ${[...tools, ...customTools.map((c) => c.name)].join(', ')}`,
            )
          }
          const toolChunks: string[] = []
          if (runbook) toolChunks.push(`### capability runbooks\n${runbook.slice(0, 2000)}`)
          const hitlTimeoutMs =
            this.overrides.hitlTimeoutMs ??
            (this.overrides.unattended ? 45_000 : undefined)
          for (const tool of tools) {
            if (this.aborted) break
            const input = buildToolInput(
              tool,
              this.state.objective,
              step.description,
              this.stepOutputs,
            )
            const started = Date.now()
            const forceAsk = approvalRequiredFor(capState, tool)
            const guarded = await guardAndExecuteTool({
              tool,
              input,
              settings: this.settings,
              permissionPolicy: this.overrides.permissionPolicy,
              permissionProjection: this.overrides.permissionProjection,
              mcpAgentId: this.overrides.mcpAgentId || this.overrides.agentMode || 'build',
              blockedTools: this.overrides.blockedTools,
              forceAsk,
              hitlTimeoutMs,
              unattended: this.overrides.unattended,
              runId: this.overrides.runId,
              threadId: this.overrides.threadId,
              projectRoot: this.overrides.projectRoot,
              sourceKind: this.overrides.sourceKind,
              objective: this.state.objective,
              onLog: (level, message) =>
                this.log(level as LogLevel, message),
            })
            if (!guarded.allowed) {
              toolChunks.push(`### tool:${tool}\n${guarded.output}`)
              this.log('WARN', guarded.output)
              // P0: record denied tools so step completion / DoD can see failures
              this.state.toolCalls = [
                ...this.state.toolCalls,
                {
                  id: `deny_${Date.now().toString(36)}`,
                  tool,
                  input,
                  output: guarded.output,
                  ok: false,
                  durationMs: Date.now() - started,
                  timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
                  step: step.step,
                },
              ]
              this.emit()
              continue
            }
            const result = guarded.result
            let out = result.output
            try {
              const enforced = enforceToolPayload(
                tool,
                out,
                this.supervisorLimits(),
                this.settings.haltOnPayloadOverflow ? 'halt' : 'truncate',
              )
              out = enforced.output
              if (enforced.truncated) {
                this.log('WARN', `Supervisor truncated '${tool}' (${enforced.bytes} bytes)`)
              }
            } catch (e) {
              if (e instanceof SupervisorViolation) throw e
              throw e
            }
            const durationMs = Date.now() - started
            const record: ToolCallRecord = {
              id: uuid(),
              tool,
              input,
              output: out.slice(0, 4000),
              ok: result.ok,
              durationMs,
              timestamp: nowTime(),
              step: step.step,
            }
            this.state.toolCalls = [...this.state.toolCalls, record]
            this.emit()
            this.log(
              result.ok ? 'SUCCESS' : 'WARN',
              `tool:${tool} ${result.ok ? 'ok' : 'fail'} (${durationMs}ms)`,
            )
            toolChunks.push(`### tool:${tool}\n${out.slice(0, 2000)}`)
            // P1: afterTool hooks also on heuristic path (parity with FC)
            try {
              const { collectHookRules, evaluateHooks } = await import('./hooks')
              const ev = evaluateHooks(collectHookRules(this.settings), {
                point: 'afterTool',
                tool,
                toolOk: result.ok,
                sourceKind: this.overrides.sourceKind as import('./hooks').HookContext['sourceKind'],
                objective: this.state.objective,
              })
              for (const line of ev.audits) this.log('INFO', line)
              for (const n of ev.notifications) {
                void window.subagents?.notify?.('SubAgents AI · Hook', n.slice(0, 160))
              }
            } catch {
              /* non-fatal */
            }
          }

          // Connector / plugin custom tools (heuristic path)
          for (const custom of customTools) {
            if (this.aborted) break
            const input = buildCustomToolInput(custom, this.state.objective, step.description)
            const started = Date.now()
            const forceAsk = approvalRequiredFor(capState, custom.name)
            const auth = await authorizeTool({
              tool: custom.name,
              input,
              settings: this.settings,
              permissionPolicy: this.overrides.permissionPolicy,
              permissionProjection: this.overrides.permissionProjection,
              blockedTools: this.overrides.blockedTools,
              forceAsk,
              sideEffect: true,
              hitlTimeoutMs,
              unattended: this.overrides.unattended,
              runId: this.overrides.runId,
              threadId: this.overrides.threadId,
              sourceKind: this.overrides.sourceKind,
              objective: this.state.objective,
              onLog: (level, message) => this.log(level as LogLevel, message),
            })
            if (!auth.allowed) {
              toolChunks.push(`### tool:${custom.name}\n${auth.output}`)
              this.log('WARN', auth.output)
              this.state.toolCalls = [
                ...this.state.toolCalls,
                {
                  id: `deny_${Date.now().toString(36)}`,
                  tool: custom.name,
                  input,
                  output: auth.output,
                  ok: false,
                  durationMs: Date.now() - started,
                  timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
                  step: step.step,
                },
              ]
              this.emit()
              continue
            }
            const result = await executeCustomTool(custom, input, this.settings, {
              runId: this.overrides.runId,
              projectRoot: this.overrides.projectRoot,
            })
            let out = result.output
            try {
              const enforced = enforceToolPayload(
                custom.name,
                out,
                this.supervisorLimits(),
                this.settings.haltOnPayloadOverflow ? 'halt' : 'truncate',
              )
              out = enforced.output
            } catch (e) {
              if (e instanceof SupervisorViolation) throw e
              throw e
            }
            const durationMs = Date.now() - started
            const record: ToolCallRecord = {
              id: uuid(),
              tool: custom.name,
              input,
              output: out.slice(0, 4000),
              ok: result.ok,
              durationMs,
              timestamp: nowTime(),
              step: step.step,
            }
            this.state.toolCalls = [...this.state.toolCalls, record]
            this.emit()
            this.log(
              result.ok ? 'SUCCESS' : 'WARN',
              `tool:${custom.name} ${result.ok ? 'ok' : 'fail'} (${durationMs}ms)`,
            )
            toolChunks.push(`### tool:${custom.name}\n${out.slice(0, 2000)}`)
          }
          toolContext = toolChunks.join('\n\n')
        }

        if (this.useLlm()) {
          try {
            const context = this.stepOutputs.slice(-3).join('\n---\n')
            const roleSettings = this.executionSettings(role)
            const layers = buildPromptLayers({
              role,
              objective: this.state.objective,
              settings: this.settings,
              projectGuidance: this.projectGuidance || undefined,
              temporary:
                this.overrides.temporary === true ||
                this.settings.temporaryChatDefault === true,
              stepEvidence: context,
              sessionRecall: this.sessionRecallBlock || undefined,
              skillsContext: this.attachedSkillContext || undefined,
            })
            // Heuristic path: still support vision when attachments present
            let userContent: import('./llm').ChatMessageContent | undefined
            if (this.userAttachments.some((a) => a.kind === 'image')) {
              try {
                const {
                  buildMultimodalUserContent,
                  hydrateAttachmentsFromDisk,
                  attachmentsPathAppendix,
                } = await import('../lib/chatAttachments')
                const hydrated = await hydrateAttachmentsFromDisk(this.userAttachments)
                const body = `Objective: ${this.state.objective}\n\nYour step: ${step.description}\n\nTool results:\n${toolContext || '(no tools ran)'}\n\nContext so far:\n${layers.full.slice(0, 10_000)}\n\n${attachmentsPathAppendix(hydrated)}\n\nProduce the step output only.`
                userContent = buildMultimodalUserContent(body, hydrated)
                if (Array.isArray(userContent)) {
                  this.log('INFO', 'Heuristic multimodal: sending image(s) to LLM')
                } else if (hydrated.some((a) => a.kind === 'image' && !a.dataUrl)) {
                  this.log(
                    'WARN',
                    'Heuristic: images lack dataUrl — path appendix only (open FC for full vision path)',
                  )
                }
              } catch {
                /* fall through to plain text */
              }
            }
            const result = this.subAgentsEnabled()
              ? await runSubAgentTask(
                  roleSettings,
                  role,
                  this.state.objective,
                  step.description,
                  layers.full.slice(0, 10_000),
                  toolContext,
                  userContent ? { userContent } : undefined,
                )
              : await runPrimaryAgentTask(
                  roleSettings,
                  this.state.objective,
                  step.description,
                  layers.full.slice(0, 10_000),
                  toolContext,
                  userContent ? { userContent } : undefined,
                )
            output = result.content
            this.state.tokensUsed += result.tokensUsed
            this.state.metrics.apiCredits = this.state.tokensUsed
            this.setSubAgent(agentName, 'active', output.slice(0, 120))
            this.log('INFO', `[${agentName}] LLM tokens +${result.tokensUsed}`)
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            this.log('WARN', `LLM step failed (${msg}). Falling back to simulation.`)
            output = this.simulateStepOutput(step, iteration, toolContext)
          }
        } else {
          const workMs = 400 + Math.random() * 500
          await delay(workMs)
          output = this.simulateStepOutput(step, iteration, toolContext)
        }
      }
    } catch (e) {
      if (e instanceof SupervisorViolation) {
        this.state.violation = {
          code: e.code,
          detail: e.detail,
          exitCode: e.exitCode,
          tool: undefined,
          stackTrace: [
            'at SubAgents.Runtime.ToolExecutor.stream_response (ToolExecutor:214)',
            'at SubAgents.Runtime.Supervisor.enforce_limits (Supervisor:88)',
            'at SubAgents.Core.AgentLoop.step (AgentLoop:105)',
          ],
        }
        this.state.status = 'halted'
        this.state.haltReason = e.message
        this.log('FATAL', e.message)
        this.log('INFO', 'Initiating safe shutdown sequence.')
        this.log('System', 'Agent Loop Halted forcefully.')
        this.setStep(index, { status: 'FAILED', result: e.message })
        this.setSubAgent(agentName, 'error')
        this.emit()
        return { ok: false, output: '', durationMs: Date.now() - t0 }
      }
      throw e
    }

    if (this.aborted) return { ok: false, output: '', durationMs: Date.now() - t0 }

    const durationMs = Date.now() - t0
    const confBase =
      0.55 + iteration * 0.08 + (index / Math.max(1, this.state.steps.length)) * 0.18
    this.state.confidence = Math.min(0.98, confBase + Math.random() * 0.04)
    this.log('EVAL', `Confidence… [Current: ${this.state.confidence.toFixed(2)}]`)

    this.stepOutputs.push(output)
    const doneResolved = this.executionModel(role)
    // P0: if every tool in this step failed, do not mark COMPLETED as success path
    const stepTools = (this.state.toolCalls || []).filter((t) => t.step === step.step)
    const allToolsFailed =
      stepTools.length > 0 && stepTools.every((t) => t.ok === false)
    if (allToolsFailed) {
      this.state.confidence = Math.min(this.state.confidence, 0.35)
      this.log(
        'WARN',
        `步驟 ${step.step} 全部工具失敗（${stepTools.length}）— 標記 FAILED，不計入 DoD 成功`,
      )
      this.setStep(index, {
        status: 'FAILED',
        durationMs,
        result: (output || stepTools.map((t) => t.output).join('\n')).slice(0, 280),
        assignedAgent: agentName,
        modelUsed: this.useLlm()
          ? doneResolved.model || '(no model)'
          : '(simulation)',
        modelSource: this.useLlm() ? doneResolved.source : 'sim',
      })
      this.setSubAgent(agentName, 'error', output.slice(0, 120))
      this.updateProgress()
      this.emit()
      return { ok: false, output, durationMs }
    }
    this.setStep(index, {
      status: 'COMPLETED',
      durationMs,
      result: output.slice(0, 280),
      assignedAgent: agentName,
      modelUsed: this.useLlm()
        ? doneResolved.model || '(no model)'
        : '(simulation)',
      modelSource: this.useLlm() ? doneResolved.source : 'sim',
    })
    this.setSubAgent(
      agentName,
      index >= this.state.steps.length - 1 ? 'done' : 'idle',
      output.slice(0, 120),
      {
        model: doneResolved.model || undefined,
        modelSource: this.useLlm() ? doneResolved.source : 'sim',
      },
    )
    this.updateProgress()
    this.log(
      'SUCCESS',
      `Step ${step.step} completed by ${agentName} · model=${this.state.steps[index]?.modelUsed || '—'} · ${(durationMs / 1000).toFixed(1)}s`,
    )

    return { ok: true, output, durationMs }
  }

  private simulateStepOutput(step: ExecutionStep, iteration: number, toolContext = ''): string {
    const toolSection = toolContext
      ? `\n## Tool Evidence\n${toolContext.slice(0, 1500)}\n`
      : ''
    return [
      `### ${step.description}`,
      ``,
      `Assigned under iteration ${iteration}.`,
      `Objective alignment: high.`,
      `Key findings: structured notes for "${this.state.objective.slice(0, 80)}".`,
      `- Action \`${step.action}\` executed${toolContext ? ' with tools' : ' in simulation mode'}.`,
      `- Artifacts staged for downstream synthesis.`,
      toolSection,
    ].join('\n')
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
