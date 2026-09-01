/**
 * Shared UI lifecycle contract for one task run.
 *
 * The runner owns execution; this module owns the presentation seam. Every
 * surface (process feed, side panel, composer, and terminal summary) should
 * derive its copy, tone, and affordances from this small vocabulary instead
 * of inventing a second `isRunning` boolean.
 */

import {
  deriveRunOutcome,
  type DeriveRunOutcomeInput,
  type GoalOutcomeProjection,
  type RunOutcomeProjection,
} from './goalOutcome.ts'

export type RunLifecyclePhase =
  | 'starting'
  | 'thinking'
  | 'planning'
  | 'executing'
  | 'awaiting_user'
  | 'manual_intervention'
  | 'responding'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  /**
   * A stop has been acknowledged and the runner is parking (hermes
   * `CANCEL_REQUESTED`). A request to cancel is not yet a cancellation: the
   * phase is formal vocabulary so every surface names the same state instead
   * of each inventing its own "stopping" flag.
   */
  | 'cancel_requested'

export type RunLifecycleStatus =
  | 'idle'
  | 'parsing'
  | 'running'
  | 'awaiting_user'
  | 'manual_intervention'
  | 'success'
  | 'failed'
  | 'halted'
  | string

/** Why a terminal run stopped short of its own settlement. */
export type RunInterruptReason = 'user' | 'timeout'

export type RunLifecycleTone =
  | 'muted'
  | 'active'
  | 'attention'
  | 'success'
  | 'danger'

/**
 * Optional orchestration evidence carried by a Pi Host settlement.
 *
 * Only the builtin loop claims a Definition of Done; an external CLI run never
 * does, so `executionKind: 'external'` can never reach the exhausted wording.
 */
export type RunOrchestrationSnapshot = {
  iterations?: number
  maxIterations?: number
  dodMet?: boolean
  executionKind?: 'loop' | 'external'
}

export type RunLifecycleInput = {
  /** Activity phase is the most precise signal while the run is live. */
  phase?: RunLifecyclePhase
  /** Agent status is the durable/terminal fallback and HITL override. */
  status?: RunLifecycleStatus
  statusLine?: string
  active?: boolean
  terminal?: boolean
  /** Pending permission asks are HITL even when the engine remains `running`. */
  approvalPending?: boolean
  /** Optional adapter hint for a question surface. */
  questionPending?: boolean
  objective?: string
  /** Iteration/DoD evidence; drives the honest exhausted terminal wording. */
  orchestration?: RunOrchestrationSnapshot
  /** Canonical outcome facts; legacy status/DoD are adapted at this seam. */
  outcome?: DeriveRunOutcomeInput
  /**
   * Set when the run was parked rather than allowed to settle. A stop the user
   * pressed and a spent time budget are different events and must not share
   * one word with each other or with a failure.
   */
  interruptReason?: RunInterruptReason
  /**
   * The user pressed stop and the runner has not settled yet. The press must
   * be answered on screen immediately, so the projection stops the spinner and
   * withdraws the stop affordance without waiting for the Host.
   */
  stopping?: boolean
}

export type RunLifecycleView = {
  phase: RunLifecyclePhase | 'idle'
  label: string
  tone: RunLifecycleTone
  icon: string
  /** Whether the run still owns work and should keep the live trace mounted. */
  live: boolean
  terminal: boolean
  needsAttention: boolean
  canStop: boolean
  /** Ran out of iteration budget with the DoD still unmet — not a plain success. */
  iterationExhausted: boolean
  /** Present when the run was parked; distinguishes a user stop from a timeout. */
  interruptReason?: RunInterruptReason
  /** A stop has been acknowledged and the runner is parking. */
  stopping: boolean
  /** Orthogonal execution, Goal, turn, and finalization facts. */
  outcome: RunOutcomeProjection
  /** The model settled an answer; this is not itself Goal success. */
  modelAnswered: boolean
  /** Execution completed and the Host Acceptance Gate has not settled yet. */
  goalChecking: boolean
  /** Terminal Goal truth exists, but app effects still need recovery. */
  finalizationRecovery: boolean
}

const LIVE_PHASES = new Set<RunLifecyclePhase>([
  'starting',
  'thinking',
  'planning',
  'executing',
  'awaiting_user',
  'manual_intervention',
  'responding',
  'finalizing',
  'cancel_requested',
])

const TERMINAL_PHASES = new Set<RunLifecyclePhase>([
  'completed',
  'failed',
  'cancelled',
])

function normalized(value: string | undefined) {
  return (value || '').trim().toLowerCase()
}

/** Map renderer/agent status words to the shared presentation vocabulary. */
export function phaseFromStatusLine(
  statusLine: string | undefined,
  fallback: RunLifecyclePhase = 'starting',
): RunLifecyclePhase {
  const value = normalized(statusLine)
  if (!value) return fallback
  if (/等待核准|需要核准|核准你的|approval|manual.?intervention/.test(value)) {
    return 'manual_intervention'
  }
  if (/等待回覆|等待你的選擇|需要你的選擇|awaiting.?user|question/.test(value)) {
    return 'awaiting_user'
  }
  if (/已停止|取消|cancel|interrupt|halt/.test(value)) return 'cancelled'
  if (/失敗|錯誤|error|fail/.test(value)) return 'failed'
  // Activity status is live-facing: terminalization itself is performed by
  // end(), so a "完成" line still belongs to the finalizing hand-off.
  if (/完成|成功|success/.test(value)) return 'finalizing'
  if (/整理.*摘要|finaliz|settle/.test(value)) return 'finalizing'
  if (/回覆|回答|撰寫|產生回答|respond|answer/.test(value)) return 'responding'
  if (/任務清單|計畫|plan|todo/.test(value)) return 'planning'
  if (/思考|推理|reason|think/.test(value)) return 'thinking'
  if (/執行|工具|搜尋|蒐集|讀取|編輯|host|cli|tool|run/.test(value)) return 'executing'
  if (/啟動|準備|loading|start|initial/.test(value)) return 'starting'
  return fallback
}

function phaseFromAgentStatus(status: RunLifecycleStatus | undefined): RunLifecyclePhase | null {
  switch (status) {
    case 'awaiting_user':
      return 'awaiting_user'
    case 'manual_intervention':
      return 'manual_intervention'
    case 'success':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'halted':
      return 'cancelled'
    case 'parsing':
      return 'starting'
    case 'running':
      return 'executing'
    default:
      return null
  }
}

/**
 * The one place that decides a `success` run was actually truncated.
 *
 * Every surface (process feed, run summary card, SubDesign header, startup
 * redelivery copy) asks this instead of re-reading iteration counters, so the
 * user cannot see "已完成" on one screen and a truncation notice on another.
 */
export function isIterationExhausted(orchestration?: RunOrchestrationSnapshot): boolean {
  if (!orchestration) return false
  // External CLI never claims a DoD, so it can never fail one (ADR-0045).
  if (orchestration.executionKind === 'external') return false
  if (orchestration.dodMet !== false) return false
  const { iterations, maxIterations } = orchestration
  if (!Number.isFinite(iterations) || !Number.isFinite(maxIterations)) return false
  if ((maxIterations as number) < 1 || (iterations as number) < 1) return false
  return (iterations as number) >= (maxIterations as number)
}

/**
 * Lift the iteration evidence off an agent snapshot in one place.
 *
 * Structural on purpose: `AgentState` must not have to import this
 * presentation module, and the settlement fields are the same three
 * everywhere they travel (Pi Host turn, archive record, run summary).
 */
export function orchestrationFromAgent(agent: {
  executionKind?: 'loop' | 'external'
  currentIteration?: number
  loopConfig?: { maxIterations?: number }
  orchestration?: { iterations?: number; maxIterations?: number; dodMet?: boolean }
} | null | undefined): RunOrchestrationSnapshot | undefined {
  if (!agent) return undefined
  const iterations = agent.orchestration?.iterations ?? agent.currentIteration
  const maxIterations = agent.orchestration?.maxIterations ?? agent.loopConfig?.maxIterations
  const dodMet = agent.orchestration?.dodMet
  if (iterations === undefined && maxIterations === undefined && dodMet === undefined) return undefined
  return { iterations, maxIterations, dodMet, executionKind: agent.executionKind }
}

/** Honest terminal wording for a run that spent its whole iteration budget. */
export function iterationExhaustedLabel(iterations?: number): string {
  const rounds = Number.isFinite(iterations) && (iterations as number) > 0 ? (iterations as number) : 0
  return rounds ? `已完成（未達 DoD · 用盡 ${rounds} 輪）` : '已完成（未達 DoD）'
}

function phaseLabel(
  phase: RunLifecyclePhase | 'idle',
  statusLine: string,
  objective: string,
  interruptReason?: RunInterruptReason,
) {
  if (phase === 'idle') return objective ? '準備執行' : '已待命'
  if (phase === 'starting') return statusLine || (objective ? '正在準備任務' : '正在啟動')
  if (phase === 'planning') return statusLine || '正在整理任務'
  if (phase === 'thinking') return statusLine || '正在推理'
  if (phase === 'executing') return statusLine || '正在執行任務'
  if (phase === 'awaiting_user') return '等待你的回覆'
  if (phase === 'manual_intervention') return '等待核准'
  if (phase === 'responding') return statusLine || '正在撰寫回覆'
  if (phase === 'finalizing') return '正在整理執行摘要…'
  if (phase === 'cancel_requested') return '正在安全停車…'
  if (phase === 'completed') return statusLine || '已完成'
  if (phase === 'failed') return statusLine || '執行失敗'
  if (interruptReason === 'timeout') return '已逾時中止'
  if (interruptReason === 'user') return '已中止'
  return statusLine || '已停止'
}

const GOAL_ATTENTION = new Set<GoalOutcomeProjection>([
  'failed',
  'blocked',
  'unverifiable',
  'exhausted',
  'legacy-unverified',
])

function goalOutcomeLabel(goal: GoalOutcomeProjection | undefined): string | undefined {
  switch (goal) {
    case 'passed': return '執行已完成，Goal 已通過'
    case 'failed': return '執行已完成，Goal 未通過'
    case 'blocked': return '執行已完成，Goal 被阻擋'
    case 'unverifiable': return '執行已完成，Goal 無法驗證'
    case 'exhausted': return '執行已完成，Goal 用盡 budget'
    case 'legacy-unverified': return '執行已完成，Goal 未經新驗收'
    default: return undefined
  }
}

function outcomeFromLifecycle(input: RunLifecycleInput): RunOutcomeProjection {
  return deriveRunOutcome({
    ...input.outcome,
    executionKind: input.outcome?.executionKind ?? input.orchestration?.executionKind,
    legacyStatus: input.outcome?.legacyStatus ?? input.status,
    legacyDodMet: input.outcome?.legacyDodMet ?? input.orchestration?.dodMet,
    iterations: input.outcome?.iterations ?? input.orchestration?.iterations,
    maxIterations: input.outcome?.maxIterations ?? input.orchestration?.maxIterations,
  })
}

function lifecycleOutcomeFlags(
  outcome: RunOutcomeProjection,
  phase: RunLifecyclePhase | 'idle',
  terminal: boolean,
  explicitlyTerminal: boolean,
) {
  return {
    modelAnswered: outcome.turnSettlement === 'answered',
    goalChecking: outcome.executionSettlement === 'completed'
      && outcome.goalProjection === undefined && !explicitlyTerminal && phase === 'finalizing',
    finalizationRecovery: terminal && outcome.appFinalization === 'pending',
  }
}

function lifecycleTone(input: {
  phase: RunLifecyclePhase | 'idle'
  iterationExhausted: boolean
  goalNeedsAttention: boolean
  interruptReason?: RunInterruptReason
  needsAttention: boolean
  live: boolean
}): RunLifecycleTone {
  if (input.phase === 'completed') return input.iterationExhausted || input.goalNeedsAttention ? 'attention' : 'success'
  if (input.phase === 'failed') return 'danger'
  if (input.phase === 'cancelled') return input.interruptReason === 'timeout' ? 'attention' : 'muted'
  if (input.needsAttention) return 'attention'
  return input.live ? 'active' : 'muted'
}

function lifecycleIcon(input: {
  phase: RunLifecyclePhase | 'idle'
  iterationExhausted: boolean
  goalNeedsAttention: boolean
  interruptReason?: RunInterruptReason
  stopping: boolean
  live: boolean
}): string {
  if (input.phase === 'completed') {
    if (input.iterationExhausted) return 'timer_off'
    return input.goalNeedsAttention ? 'warning' : 'check_circle'
  }
  if (input.phase === 'failed') return 'error'
  if (input.phase === 'cancelled') return input.interruptReason === 'timeout' ? 'hourglass_disabled' : 'stop_circle'
  if (input.phase === 'manual_intervention') return 'shield'
  if (input.phase === 'awaiting_user') return 'question_mark'
  if (input.stopping) return 'pause_circle'
  return input.live ? 'progress_activity' : 'play_circle'
}

function lifecycleLabel(input: {
  phase: RunLifecyclePhase | 'idle'
  iterationExhausted: boolean
  iterations?: number
  terminalGoalLabel?: string
  stopping: boolean
  statusLine?: string
  objective?: string
  interruptReason?: RunInterruptReason
  modelAnswered: boolean
  goalChecking: boolean
  finalizationRecovery: boolean
}): string {
  if (input.finalizationRecovery) return `${input.terminalGoalLabel || '執行已完成'}；App finalization 待恢復`
  if (input.goalChecking) return '執行已完成，Goal 驗收中…'
  if (input.modelAnswered && input.phase === 'responding') return '模型已回答，整理回覆中…'
  if (input.iterationExhausted) return iterationExhaustedLabel(input.iterations)
  if (input.terminalGoalLabel) return input.terminalGoalLabel
  if (input.stopping) return '正在安全停車…'
  return phaseLabel(
    input.phase,
    input.statusLine?.trim() || '',
    input.objective?.trim() || '',
    input.interruptReason,
  )
}

/**
 * Resolve one deterministic visual state from activity + agent signals.
 * HITL states always win. While activity is still active, its phase wins over
 * a terminal agent snapshot so the brief `finalizing` state remains visible.
 */
export function deriveRunLifecycle(input: RunLifecycleInput): RunLifecycleView {
  const status = normalized(input.status)
  const outcome = outcomeFromLifecycle(input)
  const statusPhase = phaseFromAgentStatus(input.status)
  const activityPhase = input.phase
  const activityIsLive = Boolean(input.active) && Boolean(activityPhase)

  let phase: RunLifecyclePhase | 'idle'
  if (input.approvalPending || statusPhase === 'manual_intervention' || activityPhase === 'manual_intervention') {
    phase = 'manual_intervention'
  } else if (input.questionPending || statusPhase === 'awaiting_user' || activityPhase === 'awaiting_user') {
    phase = 'awaiting_user'
  } else if (activityIsLive && activityPhase && LIVE_PHASES.has(activityPhase)) {
    phase = activityPhase
  } else if (input.terminal && statusPhase) {
    phase = statusPhase
  } else if (statusPhase && (status === 'failed' || status === 'halted' || status === 'success')) {
    phase = statusPhase
  } else {
    phase = activityPhase || statusPhase || (input.active ? 'starting' : 'idle')
  }

  const hasLiveSignal =
    input.active === true ||
    status === 'running' ||
    status === 'parsing' ||
    status === 'awaiting_user' ||
    status === 'manual_intervention' ||
    input.approvalPending === true ||
    input.questionPending === true
  const live = phase !== 'idle' && hasLiveSignal && !input.terminal
  const terminalPhase = phase !== 'idle' && TERMINAL_PHASES.has(phase)
  const terminal = Boolean(input.terminal) || (terminalPhase && !live)
  const interactionNeedsAttention = phase === 'awaiting_user' || phase === 'manual_intervention'
  // A truncated run still settles as `completed`; only its wording, tone and
  // icon change, so HITL and activity-phase precedence above stay untouched.
  const iterationExhausted = phase === 'completed' && isIterationExhausted(input.orchestration)
  const goalNeedsAttention = phase === 'completed'
    && Boolean(outcome.goalProjection && GOAL_ATTENTION.has(outcome.goalProjection))
  const terminalGoalLabel = phase === 'completed' ? goalOutcomeLabel(outcome.goalProjection) : undefined
  const { modelAnswered, goalChecking, finalizationRecovery } = lifecycleOutcomeFlags(
    outcome, phase, terminal, Boolean(input.terminal),
  )
  const needsAttention = interactionNeedsAttention || goalNeedsAttention
  // Only a parked run carries a reason; a plain stop keeps the neutral wording.
  const interruptReason = phase === 'cancelled' ? input.interruptReason : undefined

  // A park is named either by the explicit flag or by the phase itself — a
  // surface that only sees `cancel_requested` must get the same view.
  const stopping =
    (Boolean(input.stopping) || phase === 'cancel_requested')
    && !input.terminal
    && phase !== 'idle'
    && !TERMINAL_PHASES.has(phase)
  // Formalize the park: once acknowledged, the phase itself becomes
  // `cancel_requested`, so every surface derives the same state from one field.
  if (stopping && LIVE_PHASES.has(phase as RunLifecyclePhase)) {
    phase = 'cancel_requested'
  }

  const tone = lifecycleTone({ phase, iterationExhausted, goalNeedsAttention, interruptReason, needsAttention, live })
  const icon = lifecycleIcon({ phase, iterationExhausted, goalNeedsAttention, interruptReason, stopping, live })

  return {
    phase,
    label: lifecycleLabel({
      phase,
      iterationExhausted,
      iterations: input.orchestration?.iterations,
      terminalGoalLabel,
      stopping,
      statusLine: input.statusLine,
      objective: input.objective,
      interruptReason,
      modelAnswered,
      goalChecking,
      finalizationRecovery,
    }),
    tone,
    icon,
    live,
    terminal,
    needsAttention,
    iterationExhausted,
    interruptReason,
    stopping,
    outcome,
    modelAnswered,
    goalChecking,
    finalizationRecovery,
    // Once the runner has returned, finalization is an atomic hand-off; the
    // stop affordance must not suggest that archive/queue settlement is abortable.
    canStop: live && phase !== 'finalizing' && phase !== 'cancel_requested' && !stopping,
  }
}

export function isRunLive(input: RunLifecycleInput) {
  return deriveRunLifecycle(input).live
}

/** Tailwind class hook shared by the compact status surfaces. */
export function lifecycleToneClass(tone: RunLifecycleTone) {
  switch (tone) {
    case 'success':
      return 'text-green'
    case 'danger':
      return 'text-red'
    case 'attention':
      return 'text-orange'
    case 'active':
      return 'text-accent-ink'
    default:
      return 'text-ink-2'
  }
}
