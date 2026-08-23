/**
 * Shared UI lifecycle contract for one task run.
 *
 * The runner owns execution; this module owns the presentation seam. Every
 * surface (process feed, side panel, composer, and terminal summary) should
 * derive its copy, tone, and affordances from this small vocabulary instead
 * of inventing a second `isRunning` boolean.
 */

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

function phaseLabel(phase: RunLifecyclePhase | 'idle', statusLine: string, objective: string) {
  if (phase === 'idle') return objective ? '準備執行' : '已待命'
  if (phase === 'starting') return statusLine || (objective ? '正在準備任務' : '正在啟動')
  if (phase === 'planning') return statusLine || '正在整理任務'
  if (phase === 'thinking') return statusLine || '正在推理'
  if (phase === 'executing') return statusLine || '正在執行任務'
  if (phase === 'awaiting_user') return '等待你的回覆'
  if (phase === 'manual_intervention') return '等待核准'
  if (phase === 'responding') return '正在撰寫回覆'
  if (phase === 'finalizing') return '正在整理執行摘要…'
  if (phase === 'completed') return statusLine || '已完成'
  if (phase === 'failed') return statusLine || '執行失敗'
  return statusLine || '已停止'
}

/**
 * Resolve one deterministic visual state from activity + agent signals.
 * HITL states always win. While activity is still active, its phase wins over
 * a terminal agent snapshot so the brief `finalizing` state remains visible.
 */
export function deriveRunLifecycle(input: RunLifecycleInput): RunLifecycleView {
  const status = normalized(input.status)
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
  const needsAttention = phase === 'awaiting_user' || phase === 'manual_intervention'
  // A truncated run still settles as `completed`; only its wording, tone and
  // icon change, so HITL and activity-phase precedence above stay untouched.
  const iterationExhausted = phase === 'completed' && isIterationExhausted(input.orchestration)

  const tone: RunLifecycleTone =
    phase === 'completed'
      ? iterationExhausted
        ? 'attention'
        : 'success'
      : phase === 'failed'
        ? 'danger'
        : phase === 'cancelled'
          ? 'muted'
          : needsAttention
            ? 'attention'
            : live
              ? 'active'
              : 'muted'

  const icon =
    phase === 'completed'
      ? iterationExhausted
        ? 'timer_off'
        : 'check_circle'
      : phase === 'failed'
        ? 'error'
        : phase === 'cancelled'
          ? 'stop_circle'
          : phase === 'manual_intervention'
            ? 'shield'
            : phase === 'awaiting_user'
              ? 'question_mark'
              : live
                ? 'progress_activity'
                : 'play_circle'

  return {
    phase,
    label: iterationExhausted
      ? iterationExhaustedLabel(input.orchestration?.iterations)
      : phaseLabel(phase, input.statusLine?.trim() || '', input.objective?.trim() || ''),
    tone,
    icon,
    live,
    terminal,
    needsAttention,
    iterationExhausted,
    // Once the runner has returned, finalization is an atomic hand-off; the
    // stop affordance must not suggest that archive/queue settlement is abortable.
    canStop: live && phase !== 'finalizing',
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
