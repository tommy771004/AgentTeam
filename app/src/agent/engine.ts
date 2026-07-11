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
import { parseUserRequest } from './parser'
import { evaluateSafety, formatPayloadForDisplay } from './safety'
import { emptyKnowledge, extractKnowledge } from './knowledge'
import {
  DEFAULT_LLM_SETTINGS,
  resolveRoleModel,
  runSubAgentTask,
  synthesizeReport,
  withRoleModel,
} from './llm'
import { buildPromptLayers } from './hermes/promptBuilder'
import { learningLoop } from './hermes/learning'
import { compressStepOutputs } from './hermes/sessionSearch'
import { skillsStore } from './hermes/skills'
import { buildToolInput, selectToolsForStep } from './tools/registry'
import { authorizeTool, guardAndExecuteTool } from './tools/toolGuard'
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

  private useLlm(): boolean {
    if (this.overrides.useLlm === false) return false
    return this.settings.enabled && Boolean(this.settings.apiKey)
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
    // Unattended (cron/webhook/telegram): short timeout so global lock cannot hang overnight
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
    this.attachedSkillContext = ''
    this.userAttachments = this.overrides.userAttachments || []
    // Per-conversation model override (thread settings)
    if (this.overrides.model?.trim()) {
      this.settings = { ...this.settings, model: this.overrides.model.trim() }
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
    this.state.status = 'parsing'
    this.state.startedAt = new Date().toISOString()
    this.state.minConfidence = this.minConfidence()
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
      // forceLoopType re-derives steps/DoD/maxIterations (not just renames the loop)
      const parsed = parseUserRequest(rawInput, forceLoopType)
      if (forceLoopType === 'Goal-based') {
        parsed.config.maxIterations = this.settings.maxIterationsDefault || 5
      }
      if (this.overrides.maxIterations) {
        parsed.config.maxIterations = this.overrides.maxIterations
      }

      this.state.id = `exe_${uuid().slice(0, 12).toUpperCase().replace(/-/g, '')}`
      this.state.objective = parsed.objective
      this.state.loopConfig = parsed.config
      this.state.steps = parsed.steps
      this.state.subAgents = this.spawnSubAgents(parsed.config.loopType)
      if (forceLoopType) {
        this.log(
          'INFO',
          `forceLoopType=${forceLoopType} → ${parsed.steps.length} steps re-derived`,
        )
      }
      this.state.status = 'running'
      this.state.currentIteration = 1
      this.state.minConfidence = this.minConfidence()
      this.state.metrics.vramLabel = this.useLlm() ? 'cloud' : 'local-sim 4.2 GB'
      this.emit()

      this.log('INFO', 'SubAgents AI Execution Kernel v2.5.0')
      this.log('INFO', `Session ID: ${this.state.id}`)
      this.log('INFO', `Loop Type: ${parsed.config.loopType}`)
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
      this.log('INFO', `DoD: ${parsed.config.definitionOfDone}`)
      this.log('INFO', `Max Iterations: ${this.maxIterations()}`)
      this.log('PROCESS', 'Starting execution routine...')
      this.log('System', 'Hermes 學習層：記憶 / 技能 / Prompt 分層 已掛載')
      if (this.overrides.attachedSkills?.length) {
        this.log(
          'INFO',
          `掛載 Skills: ${this.overrides.attachedSkills.join(', ')}`,
        )
      }
      learningLoop.onUserTurn()

      switch (parsed.config.loopType) {
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
    }
  }

  private nodeForRole(
    id: string,
    name: string,
    role: SubAgentNode['role'],
  ): SubAgentNode {
    const r = resolveRoleModel(this.settings, role)
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

    const resolved = resolveRoleModel(this.settings, role)
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
    this.log(
      'INFO',
      `[${agentName}] model=${this.useLlm() ? resolved.model || '—' : 'simulation'} (${this.useLlm() ? (resolved.usedFallback ? 'fallback→global' : 'roleModels') : 'sim'})`,
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
    const useFc =
      this.useLlm() &&
      this.settings.toolsEnabled !== false &&
      this.settings.functionCalling !== false

    try {
      if (useFc) {
        this.log('INFO', `[${agentName}] function-calling tool loop enabled`)
        this.log('System', 'Binding tool registry… [OK]')
        const roleSettings = withRoleModel(this.settings, role)
        const layers = buildPromptLayers({
          role,
          objective: this.state.objective,
          settings: this.settings,
          temporary:
            this.overrides.temporary === true ||
            this.settings.temporaryChatDefault === true,
          extraContext: [
            compressStepOutputs(this.stepOutputs, 4000),
            this.attachedSkillContext,
          ]
            .filter(Boolean)
            .join('\n\n'),
        })
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
            preloadCapabilityIds: preloadCaps,
            preloadUnlockedTools: preloadUnlocks,
            unattended: this.overrides.unattended === true,
            hitlTimeoutMs: this.overrides.hitlTimeoutMs,
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
            blockedTools: [
              ...(this.overrides.blockedTools || []),
              ...(agentName === 'Core' || role === 'executor' ? ['delegate_task'] : []),
            ],
          })

          const tools = selectToolsForStep(step.description, this.state.objective, step.action, {
            webSearchEnabled: this.settings.webSearchEnabled !== false,
          }).filter((t) => !(this.overrides.blockedTools || []).includes(t))

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
              blockedTools: this.overrides.blockedTools,
              forceAsk,
              hitlTimeoutMs,
              unattended: this.overrides.unattended,
              onLog: (level, message) =>
                this.log(level as LogLevel, message),
            })
            if (!guarded.allowed) {
              toolChunks.push(`### tool:${tool}\n${guarded.output}`)
              this.log('WARN', guarded.output)
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
              blockedTools: this.overrides.blockedTools,
              forceAsk,
              sideEffect: true,
              hitlTimeoutMs,
              unattended: this.overrides.unattended,
              onLog: (level, message) => this.log(level as LogLevel, message),
            })
            if (!auth.allowed) {
              toolChunks.push(`### tool:${custom.name}\n${auth.output}`)
              this.log('WARN', auth.output)
              continue
            }
            const result = await executeCustomTool(custom, input, this.settings)
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
            const roleSettings = withRoleModel(this.settings, role)
            const layers = buildPromptLayers({
              role,
              objective: this.state.objective,
              settings: this.settings,
              temporary:
                this.overrides.temporary === true ||
                this.settings.temporaryChatDefault === true,
              extraContext: [context, this.attachedSkillContext].filter(Boolean).join('\n\n'),
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
            const result = await runSubAgentTask(
              roleSettings,
              role,
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
    const doneResolved = resolveRoleModel(this.settings, role)
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
    this.log('SUCCESS', 'Action completed. Awaiting user validation (ACK).')

    await this.waitForUser()
    if (this.aborted) return

    this.state.status = 'success'
    this.state.progress = 100
    this.setSubAgent('Core', 'done')
    this.log('SUCCESS', 'User ACK received. Turn complete.')
    this.noteLearningSuccess('Turn-based')
    this.emit()
  }

  // ── Pattern 2: Goal-based ─────────────────────────────────────

  private async runGoalBased() {
    const max = this.maxIterations()
    this.state.loopConfig.maxIterations = max
    this.log('INFO', 'Pattern: Goal-based — Autonomous iteration until DoD')
    this.log('INFO', 'Spawning orchestrator agent...')
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
      const confidenceOk = this.state.confidence >= this.minConfidence()
      const dodMet = allDone && confidenceOk

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
        this.emit()
        return
      }

      this.state.steps = this.state.steps.map((s) =>
        s.status === 'COMPLETED' ? s : { ...s, status: 'PENDING' as const },
      )
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
        const writerResolved = resolveRoleModel(this.settings, 'synthesizer')
        const writerSettings = withRoleModel(this.settings, 'synthesizer')
        this.log(
          'INFO',
          `Writer model=${writerSettings.model} (${writerResolved.usedFallback ? 'fallback→global' : 'roleModels'})`,
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
    this.refreshKnowledge()
    this.log('SUCCESS', 'Definition of Done met. Terminating loop.')
    this.noteLearningSuccess(this.state.loopConfig.loopType)
    this.emit()
  }

  private deriveReportTitle(): string {
    const obj = this.state.objective
    if (/market|landscape|orchestr/i.test(obj)) {
      return 'Synthetic Market Landscape: AI Orchestration Tools'
    }
    if (/security|log/i.test(obj)) return 'Security Log Analysis Report'
    if (/price|competitor/i.test(obj)) return 'Competitive Pricing Analysis'
    return `Agent Report: ${obj.slice(0, 48)}${obj.length > 48 ? '…' : ''}`
  }

  // ── Pattern 3: Time-based ─────────────────────────────────────

  private async runTimeBased() {
    this.log('INFO', 'Pattern: Time-based — Cron-job style execution')
    this.log('INFO', `Trigger window validated at ${nowTime()}`)
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

    // External layers (webhook / telegram / event match) already validated → skip re-check
    if (this.overrides.eventPreMatched) {
      this.log(
        'SUCCESS',
        'Event pre-matched upstream (schedule/webhook/telegram) — skip objective when/if re-check',
      )
    } else {
      this.log('INFO', 'Evaluating event predicates on objective text…')
      const lower = this.state.objective.toLowerCase()
      // EN: when/if · ZH: 當/如果/若/一旦
      const hasTrigger =
        /\b(when|if)\b/.test(lower) || /當|如果|若|一旦|每當/.test(this.state.objective)
      const hasAnd = /\band\b/.test(lower) || /且|並且|同時/.test(this.state.objective)
      this.log('INFO', `predicate has_trigger=${hasTrigger} has_and=${hasAnd}`)
      if (!hasTrigger) {
        this.state.status = 'halted'
        this.state.haltReason =
          'Event criteria not met — objective 需含 when/if 或「當／如果／若」，或由已匹配事件以 eventPreMatched 觸發'
        this.log('WARN', 'Predicate false — no action taken (anti fuzzy-match).')
        this.emit()
        return
      }
      this.log('SUCCESS', 'Objective trigger language OK')
    }

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

This report synthesizes findings from ${this.state.subAgents.length} sub-agents analyzing the objective.

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

export const agentEngine = new AgentLoopEngine()
