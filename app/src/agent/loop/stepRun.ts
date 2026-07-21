/**
 * Step Run — the Loop Runner's step-execution seam.
 *
 * Extracted from ../engine.ts `executeStepWithAgent` (Loop Runner deepening,
 * ticket 02). Behavior-preserving: safety gate → model-profile degrade →
 * FC / heuristic / simulation dispatch with fallback → outcome shaping, now
 * over an explicit (state, deps) shape instead of engine's `this`.
 *
 * @internal — not a product-facing seam. loopRunner.ts is the only caller;
 * smokes may true-import this module directly (see spec.md merge bar).
 */
import type {
  ChatAttachment,
  ExecutionStep,
  LlmSettings,
  LogLevel,
  RuntimeOverrides,
  SafetyCheck,
  SubAgentNode,
} from '../types'
import { evaluateSafety, formatPayloadForDisplay } from '../safety.ts'
import { resolveRoleModel, withRoleModel } from '../llm.ts'
import {
  DEFAULT_SUPERVISOR_LIMITS,
  SupervisorViolation,
  type SupervisorLimits,
} from '../supervisor.ts'
import type { LoopRunState } from './state.ts'
import { resolveHeuristicStepOutcome } from './stepIO.ts'
import {
  createStepStrategies,
  HeuristicLlmFailedError,
  withToolContext,
  type StrategyStepInput,
} from './strategies.ts'

/** HITL prompt raised by the safety gate. Mirrors legacy InterventionState's shape. */
export type AskRequest = {
  reason: string
  payloadJson: string
  safety: SafetyCheck
}

export type AskDecision =
  | { action: 'approve'; payloadJson?: string }
  | { action: 'reject' }
  | { action: 'abort' }

export type StepRunDeps = {
  /** Sole side-effect outlet — called after every state mutation. */
  publish: (state: LoopRunState) => void
  /** HITL port. Timeout policy lives on engine.waitForIntervention (unattended 45s / safety 900s). */
  ask: (req: AskRequest) => Promise<AskDecision>
  log: (level: LogLevel, message: string) => void
  shouldAbort: () => boolean
  settings: LlmSettings
  overrides: RuntimeOverrides
  projectGuidance: string
  sessionRecallBlock: string
  attachedSkillContext: string
  userAttachments: ChatAttachment[]
  /** Prior steps' outputs so far this run — read-only context for the strategies. */
  stepOutputsSoFar: string[]
}

export type StepRunResult = {
  ok: boolean
  output: string
  durationMs: number
  /**
   * True iff this step's output should be appended to the loop's running
   * stepOutputs list — mirrors the legacy unconditional push that happened
   * right before the FAILED/COMPLETED branch (i.e. false for the early
   * safety-reject and SupervisorViolation exits, which never reached it).
   */
  contributesOutput: boolean
  /** Mutated attachments (vision gate may strip image data — see legacy behavior). */
  userAttachments: ChatAttachment[]
}

function llmEnabledFor(settings: LlmSettings, overrides: RuntimeOverrides): boolean {
  if (overrides.useLlm === false) return false
  return settings.enabled && Boolean(settings.apiKey)
}

function subAgentsEnabledFor(settings: LlmSettings): boolean {
  return settings.subAgentsEnabled === true
}

function executionSettingsFor(settings: LlmSettings, role: string): LlmSettings {
  return subAgentsEnabledFor(settings) ? withRoleModel(settings, role) : settings
}

function executionModelFor(
  settings: LlmSettings,
  role: string,
): ReturnType<typeof resolveRoleModel> {
  if (subAgentsEnabledFor(settings)) return resolveRoleModel(settings, role)
  return {
    model: settings.model || '',
    source: settings.model ? 'primary' : 'none',
    roleKey: null,
    usedFallback: true,
  }
}

function supervisorLimitsFor(settings: LlmSettings): SupervisorLimits {
  const kb = settings.maxToolPayloadKb || 50
  return {
    ...DEFAULT_SUPERVISOR_LIMITS,
    maxToolPayloadBytes: Math.max(4, kb) * 1024,
    maxToolRounds: settings.maxToolRounds || 4,
  }
}

/** Round-robin step→agent assignment. Pure given state.subAgents + settings. */
export function pickAgentForStep(
  state: LoopRunState,
  index: number,
  total: number,
  settings: LlmSettings,
): string {
  if (!subAgentsEnabledFor(settings)) return 'Primary'
  if (state.subAgents.length === 1) return state.subAgents[0].name
  if (index === 0) return 'Manager'
  if (index >= total - 1) return 'Writer'
  return 'Analyzer-1'
}

function setStep(
  state: LoopRunState,
  index: number,
  patch: Partial<ExecutionStep>,
  publish: (s: LoopRunState) => void,
) {
  state.steps = state.steps.map((s, i) => (i === index ? { ...s, ...patch } : s))
  publish(state)
}

function setSubAgent(
  state: LoopRunState,
  name: string,
  status: SubAgentNode['status'],
  lastMessage: string | undefined,
  modelMeta: { model?: string; modelSource?: SubAgentNode['modelSource'] } | undefined,
  publish: (s: LoopRunState) => void,
) {
  state.subAgents = state.subAgents.map((a) =>
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
  publish(state)
}

/** Run one step. Mutates `state` in place (same reassignment style as the legacy engine). */
export async function runStep(
  state: LoopRunState,
  index: number,
  iteration: number,
  agentName: string,
  deps: StepRunDeps,
): Promise<StepRunResult> {
  const step = state.steps[index]
  const role = state.subAgents.find((a) => a.name === agentName)?.role || 'executor'
  const publish = deps.publish

  const resolved = executionModelFor(deps.settings, role)
  const useLlm = llmEnabledFor(deps.settings, deps.overrides)
  setStep(
    state,
    index,
    {
      status: 'IN_PROGRESS',
      assignedAgent: agentName,
      modelUsed: useLlm ? resolved.model || '(no model)' : '(simulation)',
      modelSource: useLlm ? resolved.source : 'sim',
    },
    publish,
  )
  setSubAgent(
    state,
    agentName,
    'active',
    undefined,
    { model: resolved.model || undefined, modelSource: useLlm ? resolved.source : 'sim' },
    publish,
  )
  deps.log('EXEC', `[${agentName}] step ${step.step}: ${step.description}`)
  const modelSourceLabel = subAgentsEnabledFor(deps.settings)
    ? resolved.usedFallback
      ? 'fallback→global'
      : 'roleModels'
    : 'primary/global'
  deps.log(
    'INFO',
    `[${agentName}] model=${useLlm ? resolved.model || '—' : 'simulation'} (${useLlm ? modelSourceLabel : 'sim'})`,
  )

  // Safety gate
  if (deps.settings.safetyEnabled) {
    const safety = evaluateSafety(
      state.objective,
      step.description,
      step.action,
      deps.settings.authLevel,
    )
    if (
      !safety.ok &&
      deps.settings.approvalMode === 'full' &&
      deps.overrides.unattended !== true
    ) {
      // 完整存取權（僅互動 run）：不停等人工，記錄後直接續跑（deny 規則仍生效）
      deps.log('WARN', 'Proposed action targets sensitive resources')
      deps.log('INFO', '完整存取權模式：safety intervention 自動核准並續跑')
    } else if (!safety.ok) {
      deps.log('WARN', `Proposed action targets sensitive resources`)
      deps.log('HALT', 'Safety constraint triggered. Awaiting human validation.')
      state.intervention = {
        active: true,
        reason: safety.reason,
        payloadJson: formatPayloadForDisplay(safety.payload),
        safety,
        timeoutSec: state.intervention.timeoutSec || 900,
      }
      publish(state)

      const decision = await deps.ask({
        reason: safety.reason,
        payloadJson: state.intervention.payloadJson,
        safety,
      })
      if (deps.shouldAbort() || decision.action === 'abort' || decision.action === 'reject') {
        state.intervention = { active: false, reason: '', payloadJson: '', safety: null, timeoutSec: 900 }
        state.status = 'halted'
        state.haltReason =
          decision.action === 'reject'
            ? 'User rejected unsafe payload'
            : 'Session aborted during manual intervention'
        setStep(state, index, { status: 'FAILED', result: state.haltReason }, publish)
        setSubAgent(state, agentName, 'error', undefined, undefined, publish)
        deps.log('ERROR', state.haltReason)
        publish(state)
        return { ok: false, output: '', durationMs: 0, contributesOutput: false, userAttachments: deps.userAttachments }
      }

      // approved — optionally with edited payload
      if (decision.payloadJson) {
        state.intervention.payloadJson = decision.payloadJson
      }
      deps.log('SUCCESS', 'Human approved payload. Resuming execution.')
      state.intervention = { active: false, reason: '', payloadJson: '', safety: null, timeoutSec: 900 }
      state.status = 'running'
      publish(state)
    }
  }

  const t0 = Date.now()
  let output = ''
  let toolContext = ''
  let userAttachments = deps.userAttachments

  // P1-B: model capability profile — degrade BEFORE the call fails mid-run
  const { modelSupports } = await import('../modelProfile.ts')
  const stepModel = useLlm ? resolved.model : ''
  const fcCapable = modelSupports(deps.settings, stepModel, 'tools')
  if (fcCapable === false && deps.settings.functionCalling !== false) {
    deps.log(
      'WARN',
      `模型 ${stepModel} 標記不支援 tool calls（profile）— 本步降級 heuristic 路徑`,
    )
  }
  const useFc =
    useLlm &&
    deps.settings.toolsEnabled !== false &&
    deps.settings.functionCalling !== false &&
    fcCapable !== false
  // Vision gate: strip image payloads when profile says unsupported
  if (
    userAttachments.some((a) => a.kind === 'image') &&
    modelSupports(deps.settings, stepModel, 'vision') === false
  ) {
    deps.log(
      'WARN',
      `模型 ${stepModel} 標記不支援 vision（profile）— 圖片改以路徑註記傳遞`,
    )
    userAttachments = userAttachments.map((a) =>
      a.kind === 'image' ? { ...a, dataUrl: undefined } : a,
    )
  }

  // Thin strategies — only "obtain step output"; pre/post stay on the orchestrator.
  const strategies = createStepStrategies({
    log: (level, message) => deps.log(level as LogLevel, message),
    shouldAbort: () => deps.shouldAbort(),
    executionSettings: (r) => executionSettingsFor(deps.settings, r),
    supervisorLimits: () => supervisorLimitsFor(deps.settings),
    subAgentsEnabled: () => subAgentsEnabledFor(deps.settings),
    onToolCall: (record) => {
      state.toolCalls = [...state.toolCalls, record]
      publish(state)
    },
    onCapabilityUnion: (ids) => {
      const set = new Set([...(state.loadedCapabilityIds || []), ...ids])
      state.loadedCapabilityIds = [...set].sort()
      publish(state)
    },
    onUnlockedUnion: (names) => {
      const set = new Set([...(state.unlockedToolNames || []), ...names])
      state.unlockedToolNames = [...set].sort()
      publish(state)
    },
    onQuestionAsked: () => {
      state.status = 'awaiting_user'
      publish(state)
    },
    onQuestionResolved: () => {
      if (state.status === 'awaiting_user') state.status = 'running'
      publish(state)
    },
    onSubAgentSnippet: (snippet) => {
      setSubAgent(state, agentName, 'active', snippet, undefined, publish)
    },
  })

  const strategyInput: StrategyStepInput = {
    role,
    agentName,
    objective: state.objective,
    step: step.description,
    stepAction: step.action,
    stepNumber: step.step,
    iteration,
    stepOutputs: deps.stepOutputsSoFar,
    userAttachments,
    settings: deps.settings,
    overrides: {
      ...deps.overrides,
      useLlm: deps.overrides.useLlm,
    },
    loadedCapabilityIds: state.loadedCapabilityIds,
    unlockedToolNames: state.unlockedToolNames,
    temporaryChatDefault: deps.settings.temporaryChatDefault === true,
    projectGuidance: deps.projectGuidance,
    sessionRecallBlock: deps.sessionRecallBlock,
    attachedSkillContext: deps.attachedSkillContext,
    subAgentsEnabled: subAgentsEnabledFor(deps.settings),
  }

  try {
    if (useFc) {
      const result = await strategies.functionCalling.execute(strategyInput)
      output = result.output
      toolContext = result.toolContext
      state.tokensUsed += result.tokensUsed
      state.metrics.apiCredits = state.tokensUsed
    } else {
      // Heuristic first; orchestrator owns simulation fallback (no strategy knows siblings).
      // Decision is pure resolveHeuristicStepOutcome — never gate on empty output alone.
      try {
        const result = await strategies.heuristic.execute(strategyInput)
        toolContext = result.toolContext
        state.tokensUsed += result.tokensUsed
        state.metrics.apiCredits = state.tokensUsed
        if (resolveHeuristicStepOutcome(result) === 'simulate') {
          // tools-only / no LLM — keep prior artificial delay
          const sim = await strategies.simulation.execute(
            withToolContext(strategyInput, toolContext),
          )
          output = sim.output
        } else {
          // LLM completed (content may be ""); keep it
          output = result.output
        }
      } catch (e) {
        if (e instanceof HeuristicLlmFailedError) {
          deps.log('WARN', `LLM step failed (${e.message}). Falling back to simulation.`)
          toolContext = e.toolContext
          // Pre-refactor failure path had no delay — skip artificial wait
          const sim = await strategies.simulation.execute(
            withToolContext(strategyInput, toolContext, { skipDelay: true }),
          )
          output = sim.output
        } else {
          throw e
        }
      }
    }
  } catch (e) {
    if (e instanceof SupervisorViolation) {
      state.violation = {
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
      state.status = 'halted'
      state.haltReason = e.message
      deps.log('FATAL', e.message)
      deps.log('INFO', 'Initiating safe shutdown sequence.')
      deps.log('System', 'Agent Loop Halted forcefully.')
      setStep(state, index, { status: 'FAILED', result: e.message }, publish)
      setSubAgent(state, agentName, 'error', undefined, undefined, publish)
      publish(state)
      return {
        ok: false,
        output: '',
        durationMs: Date.now() - t0,
        contributesOutput: false,
        userAttachments,
      }
    }
    throw e
  }

  if (deps.shouldAbort()) {
    return { ok: false, output: '', durationMs: Date.now() - t0, contributesOutput: false, userAttachments }
  }

  const durationMs = Date.now() - t0
  const confBase = 0.55 + iteration * 0.08 + (index / Math.max(1, state.steps.length)) * 0.18
  state.confidence = Math.min(0.98, confBase + Math.random() * 0.04)
  deps.log('EVAL', `Confidence… [Current: ${state.confidence.toFixed(2)}]`)

  const doneResolved = executionModelFor(deps.settings, role)
  // P0: if every tool in this step failed, do not mark COMPLETED as success path
  const stepTools = (state.toolCalls || []).filter((t) => t.step === step.step)
  const allToolsFailed = stepTools.length > 0 && stepTools.every((t) => t.ok === false)
  if (allToolsFailed) {
    state.confidence = Math.min(state.confidence, 0.35)
    deps.log(
      'WARN',
      `步驟 ${step.step} 全部工具失敗（${stepTools.length}）— 標記 FAILED，不計入 DoD 成功`,
    )
    setStep(
      state,
      index,
      {
        status: 'FAILED',
        durationMs,
        result: (output || stepTools.map((t) => t.output).join('\n')).slice(0, 280),
        assignedAgent: agentName,
        modelUsed: useLlm ? doneResolved.model || '(no model)' : '(simulation)',
        modelSource: useLlm ? doneResolved.source : 'sim',
      },
      publish,
    )
    setSubAgent(state, agentName, 'error', output.slice(0, 120), undefined, publish)
    return { ok: false, output, durationMs, contributesOutput: true, userAttachments }
  }
  setStep(
    state,
    index,
    {
      status: 'COMPLETED',
      durationMs,
      result: output.slice(0, 280),
      assignedAgent: agentName,
      modelUsed: useLlm ? doneResolved.model || '(no model)' : '(simulation)',
      modelSource: useLlm ? doneResolved.source : 'sim',
    },
    publish,
  )
  setSubAgent(
    state,
    agentName,
    index >= state.steps.length - 1 ? 'done' : 'idle',
    output.slice(0, 120),
    { model: doneResolved.model || undefined, modelSource: useLlm ? doneResolved.source : 'sim' },
    publish,
  )
  deps.log(
    'SUCCESS',
    `Step ${step.step} completed by ${agentName} · model=${state.steps[index]?.modelUsed || '—'} · ${(durationMs / 1000).toFixed(1)}s`,
  )

  return { ok: true, output, durationMs, contributesOutput: true, userAttachments }
}
