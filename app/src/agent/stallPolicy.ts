/**
 * Stall notification policy — ported from hermes-agent `gateway/session_stall`.
 *
 * A long Goal-based run that stopped making progress is indistinguishable from
 * a crashed one as far as the spinner is concerned: both show a timer and no
 * new events. The user deserves one honest notice ("still working, no fresh
 * progress for N minutes"), and exactly one — a notice that repeats on every
 * tick trains people to ignore it.
 *
 * Boundaries (kept separate, mirroring the upstream split):
 * - Progress observation is NOT owned here. Callers pass an idle duration
 *   computed from whatever progress clock they trust (the run activity store's
 *   `updatedAt`, bumped by every event/thought/draft/status mutation).
 * - Timeout/kill/retry policy lives in turnTimeout / piTurnDeadline; this
 *   module never stops a run, it only decides when to speak once.
 *
 * Pure module — safe for Node strip-types smokes.
 */

/** Default patience before the first stall notice. */
export const DEFAULT_STALL_NOTIFY_MS = 3 * 60_000

export const MIN_STALL_NOTIFY_MS = 15_000
export const MAX_STALL_NOTIFY_MS = 30 * 60_000

export function clampStallNotifyMs(ms: unknown): number {
  const value = Math.floor(Number(ms))
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_STALL_NOTIFY_MS
  return Math.max(MIN_STALL_NOTIFY_MS, Math.min(MAX_STALL_NOTIFY_MS, value))
}

export type StallNoticeInput = {
  /** Patience budget; non-positive disables the notice entirely. */
  timeoutMs: number
  /** Time since the last real progress signal (event/thought/draft/status). */
  idleMs: number | undefined
  /** Only a live run can stall; terminal or idle runs have nothing to say. */
  runActive: boolean
  /** Notify-once: a second notice must not fire until progress resets this. */
  alreadyNotified: boolean
}

/**
 * Whether the single stall notice should be emitted now.
 *
 * Mirrors upstream's gate set: disabled budgets never notify, an unknown idle
 * time (no clock yet) stays silent rather than guessing, and the notice fires
 * only when a live run's silence crosses the budget.
 */
export function shouldEmitStallNotice(input: StallNoticeInput): boolean {
  const timeoutMs = clampStallNotifyMs(input.timeoutMs)
  if (input.timeoutMs <= 0) return false
  if (!input.runActive) return false
  if (input.alreadyNotified) return false
  if (input.idleMs === undefined || !Number.isFinite(input.idleMs)) return false
  return input.idleMs >= timeoutMs
}

/**
 * Whether a previously emitted notice should be withdrawn.
 *
 * Any real progress below half the budget means the run is moving again; the
 * UI clears the notice and re-arms notify-once for a future stall.
 */
export function shouldClearStallNotice(input: { timeoutMs: number; idleMs: number | undefined }): boolean {
  if (input.idleMs === undefined || !Number.isFinite(input.idleMs)) return true
  return input.idleMs < clampStallNotifyMs(input.timeoutMs) / 2
}

/** User-facing one-liner; counts in whole minutes from the observed idle time. */
export function stallNoticeLabel(idleMs: number): string {
  const safeIdle = Number.isFinite(idleMs) ? Math.max(0, idleMs) : 0
  const minutes = Math.max(1, Math.round(safeMinutes(safeIdle)))
  return minutes >= 1
    ? `仍在執行中，但已約 ${minutes} 分鐘沒有新進度 — 若持續卡住可停止或稍後再查看。`
    : '仍在執行中…'
}

function safeMinutes(ms: number): number {
  return ms / 60_000
}
