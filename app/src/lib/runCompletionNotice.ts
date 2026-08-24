/**
 * Shell-level reachability for a run that just finished.
 *
 * A long task is worth waiting for only if the user learns when it is done.
 * This module owns that judgement as pure data: given one terminal run and
 * what the user currently has on screen, decide whether to raise an in-app
 * toast, whether to raise an OS notification, and what both should say.
 *
 * It deliberately holds no state. The run registry
 * (`runActivityStore.presentations`) remains the only record of which runs are
 * live and which have settled; the shell reads the falling edge from there and
 * asks this module what to do about it.
 */

import {
  isIterationExhausted,
  iterationExhaustedLabel,
  type RunOrchestrationSnapshot,
} from '../agent/runLifecycle.ts'

export type RunCompletionEvent = {
  runId: string
  /** Conversation that owns the run; absent for unbound/background work. */
  threadId?: string
  objective?: string
  status: 'success' | 'failed' | 'halted'
  finishedAt: number
  orchestration?: RunOrchestrationSnapshot
}

/** What the user can actually see at the moment the run settles. */
export type RunCompletionSurface = {
  /** Conversation currently open in the composer, if any. */
  activeThreadId?: string | null
  /** Run whose process feed is mounted and on screen, if any. */
  visibleRunId?: string | null
  /**
   * Whether the conversation surface itself is on screen. Sitting in a thread
   * while reading Settings is not the same as watching that thread, so this
   * gates the active-thread suppression. Defaults to true.
   */
  chatSurfaceVisible?: boolean
  /** OS notifications enabled in Settings (`notifyOnComplete`). */
  osNotifyEnabled?: boolean
}

export type RunCompletionTone = 'success' | 'attention' | 'danger' | 'muted'

export type RunCompletionNotice = {
  runId: string
  threadId?: string
  /** In-app toast; suppressed when the outcome is already on screen. */
  toast: boolean
  /** OS notification; independent of the toast, gated only by the setting. */
  osNotify: boolean
  title: string
  body: string
  tone: RunCompletionTone
  icon: string
  at: number
}

/** Visible toasts before the stack collapses into a single counted row. */
export const MAX_VISIBLE_COMPLETION_TOASTS = 3

/**
 * Terminal wording for the shell.
 *
 * A truncated run reuses the shared lifecycle copy so the toast, the process
 * feed and the run summary card cannot disagree about what happened; an
 * external CLI only ever says it ended, because it never claimed a DoD.
 */
export function runCompletionCopy(event: RunCompletionEvent): {
  title: string
  tone: RunCompletionTone
  icon: string
} {
  if (event.status === 'failed') {
    return { title: '任務失敗', tone: 'danger', icon: 'error' }
  }
  if (event.status === 'halted') {
    return { title: '任務已中止', tone: 'muted', icon: 'stop_circle' }
  }
  if (isIterationExhausted(event.orchestration)) {
    return {
      title: iterationExhaustedLabel(event.orchestration?.iterations),
      tone: 'attention',
      icon: 'timer_off',
    }
  }
  if (event.orchestration?.executionKind === 'external') {
    return { title: '外部 CLI 已結束', tone: 'success', icon: 'terminal' }
  }
  return { title: '任務完成', tone: 'success', icon: 'check_circle' }
}

/**
 * Decide what one finished run should raise.
 *
 * The toast is suppressed when the user is already looking at the answer —
 * watching that run's process feed, or sitting in the thread that owns it —
 * because a card sliding in to report news already on screen is noise. The OS
 * notification is a different channel with a different job (reaching someone
 * who left the app), so it follows only the Settings switch.
 */
export function decideRunCompletionNotice(
  event: RunCompletionEvent,
  surface: RunCompletionSurface,
): RunCompletionNotice {
  const onChatSurface = surface.chatSurfaceVisible !== false
  const watchingThisRun =
    onChatSurface && Boolean(surface.visibleRunId) && surface.visibleRunId === event.runId
  const insideOwningThread =
    onChatSurface && Boolean(event.threadId) && surface.activeThreadId === event.threadId
  const copy = runCompletionCopy(event)
  const objective = (event.objective || '').trim().replace(/\s+/g, ' ')
  return {
    runId: event.runId,
    threadId: event.threadId,
    toast: !watchingThisRun && !insideOwningThread,
    osNotify: surface.osNotifyEnabled !== false,
    title: copy.title,
    body: objective ? objective.slice(0, 120) : '（沒有目標描述）',
    tone: copy.tone,
    icon: copy.icon,
    at: event.finishedAt,
  }
}

/**
 * Collapse a burst of completions into a readable stack.
 *
 * Newest first, at most three cards, and anything past that becomes one honest
 * counted row rather than a column of toasts covering the app.
 */
export function stackCompletionToasts(notices: RunCompletionNotice[]): {
  visible: RunCompletionNotice[]
  overflow: number
  overflowLabel: string
} {
  const ordered = [...notices].sort((left, right) => right.at - left.at)
  const visible = ordered.slice(0, MAX_VISIBLE_COMPLETION_TOASTS)
  const overflow = Math.max(0, ordered.length - visible.length)
  return {
    visible,
    overflow,
    overflowLabel: overflow ? `另有 ${overflow} 個任務已結束` : '',
  }
}
