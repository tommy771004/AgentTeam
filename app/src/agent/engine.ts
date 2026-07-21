/**
 * AI Agent Loop Engine v2
 * Receive → Process → Execute → Validate → Terminate/Iterate
 * + Multi-agent roles, safety HITL, LLM steps, knowledge graph
 */

import { v4 as uuid } from 'uuid'
import type {
  AgentState,
  InterventionState,
  LlmSettings,
  LogEntry,
  LogLevel,
  LoopType,
  RuntimeOverrides,
  SubAgentNode,
} from './types'
import { buildParseResult, formatPlanBubble, parseUserRequest } from './parser'
import { parseWithLlm } from './llmParser'
import { replanCorrectiveSteps } from './replan'
import { formatContinueGoalOffer } from './continueGoal'
import { emptyKnowledge } from './knowledge'
import { DEFAULT_LLM_SETTINGS, resolveRoleModel, withRoleModel } from './llm'
import { BUILTIN_RUNNER_CAPABILITIES } from './runners'
import { skillsStore } from './hermes/skills'
import {
  isClaimedScheduleTrigger,
  validateScheduleTriggerSnapshot,
  type ScheduleTriggerValidation,
} from './scheduler'
import { validateEventTriggerSnapshot } from './eventMatcher'
import { runLoop, type LoopDeps, type LoopRequest } from './loop/index.ts'
import { snapshot } from './loop/state.ts'
import type { AskDecision } from './loop/stepRun.ts'
import { unattendedInterventionTimeoutSec } from './hitlTimeout.ts'
export { unattendedInterventionTimeoutSec } from './hitlTimeout.ts'
type Listener = (state: AgentState) => void

/** @deprecated Alias kept so resolveIntervention's external signature is untouched — use AskDecision. */
type InterventionDecision = AskDecision

function nowTime(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false })
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
  /** continueGoal restore buffer — seeded into LoopDeps.initialStepOutputs */
  private stepOutputs: string[] = []
  private attachedSkillContext = ''
  /** Phase 4: session recall kept separate for ContextPacket (not mashed into skills blob). */
  private sessionRecallBlock = ''
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
    // Unattended (cron/webhook/telegram): short timeout so a run cannot hang overnight.
    // Pure helper keeps the policy testable without sleeping 15s in smokes.
    const timeoutSec = unattended
      ? unattendedInterventionTimeoutSec(this.overrides.hitlTimeoutMs)
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

      // Must use refined loop type (not the pre-LLM heuristic only) — Loop Runner
      // owns pattern dispatch + DoD/replan/continueGoal iteration (ticket 03);
      // this engine remains its sole production adapter (registry, store wiring,
      // HITL bridging). Typed trigger evidence is required per pattern at the
      // type level — see CONTEXT.md「Loop Runner（迴圈執行器）」.
      const loopType = this.state.loopConfig.loopType
      const req: LoopRequest =
        loopType === 'Turn-based'
          ? { pattern: 'turn' }
          : loopType === 'Goal-based'
            ? { pattern: 'goal' }
            : loopType === 'Time-based'
              ? { pattern: 'time', claim: this.state.scheduleTrigger! }
              : { pattern: 'proactive', evidence: this.state.eventTrigger! }
      const deps: LoopDeps = {
        publish: (s) => {
          // Clone so UI/store never observes in-flight loop mutations (review #4).
          this.state = snapshot(s)
          this.emit()
        },
        ask: () => this.waitForIntervention(),
        waitForUserAck: () => this.waitForUser(),
        log: (level, message) => this.log(level, message),
        shouldAbort: () => this.aborted,
        // Live getters so configure() mid-run is visible to the next settings read.
        getSettings: () => this.settings,
        getOverrides: () => this.overrides,
        // continueGoal restore seeds digests into this.stepOutputs before runLoop.
        initialStepOutputs: this.stepOutputs.slice(),
        projectGuidance: this.projectGuidance,
        sessionRecallBlock: this.sessionRecallBlock,
        attachedSkillContext: this.attachedSkillContext,
        userAttachments: this.userAttachments,
        onGoalIncomplete: (snapshot) => {
          void import('../store/threadStore').then(({ useThreadStore }) => {
            const thr = useThreadStore.getState()
            const tid = this.overrides.threadId || thr.runningThreadId || thr.activeId
            if (!tid) return
            thr.setContinueGoal(tid, snapshot)
            thr.pushBubble(tid, 'system', formatContinueGoalOffer(snapshot))
          })
        },
        onGoalCleared: () => {
          void import('../store/threadStore').then(({ useThreadStore }) => {
            const thr = useThreadStore.getState()
            const tid = this.overrides.threadId || thr.runningThreadId || thr.activeId
            if (tid) thr.setContinueGoal(tid, null)
          })
        },
      }
      const { state: loopState } = await runLoop(req, this.state, deps)
      // Final rebind also clones — do not reattach the live loop mutator after
      // the publish seam has been cloning throughout the run (review residual).
      this.state = snapshot(loopState)

      // The controller may explicitly choose a post-state for an automation
      // or integration run; apply it after pattern finalization so Goal/Turn
      // success helpers cannot silently overwrite the requested outcome.
      if (this.overrides.nextState) {
        this.state.loopConfig = {
          ...this.state.loopConfig,
          nextState: this.overrides.nextState,
        }
      }

      this.state.metrics.executionMs = Date.now() - t0
      this.state.metrics.apiCredits = this.state.tokensUsed
      this.state.finishedAt = new Date().toISOString()
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
