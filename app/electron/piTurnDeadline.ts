/**
 * Per-turn deadlines for Pi Host.
 *
 * A stuck turn holds a conversation hostage until someone kills the process, so
 * every submitted turn carries a time budget. Expiry does not introduce a
 * second way to stop: it walks the same safe-park path a user's stop does, so a
 * tool that already started still finishes and reports its evidence, and the
 * settlement reads `interrupted(timeout)` rather than a failure.
 *
 * The clock is injected so the behaviour is driven by tests rather than by real
 * waiting.
 */

export type TurnDeadlineClock = {
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

export const systemTurnDeadlineClock: TurnDeadlineClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** Hard bounds: a turn budget is never absent, never absurd. */
export const MIN_TURN_TIMEOUT_MS = 10_000
export const MAX_TURN_TIMEOUT_MS = 6 * 60 * 60 * 1_000
export const TOOL_SETTLEMENT_GRACE_MS = 30_000

export function clampTurnTimeout(ms: unknown): number | undefined {
  const value = Math.floor(Number(ms))
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.min(MAX_TURN_TIMEOUT_MS, Math.max(MIN_TURN_TIMEOUT_MS, value))
}

export type TurnDeadlineHandle = {
  /** Push the deadline out; called whenever the turn shows real progress. */
  extend: () => void
  /**
   * Temporarily honour a longer bounded operation deadline. The next ordinary
   * progress event restores the admitted turn-idle budget.
   */
  extendFor: (timeoutMs?: number) => void
  cancel: () => void
  expired: () => boolean
  deadlineAt: () => number
}

/**
 * Arm a deadline that fires once.
 *
 * The budget is measured from the last sign of progress, not from submission: a
 * turn that is still emitting tool calls after an hour is working, not stuck,
 * and killing it would punish exactly the long tasks this feature exists for.
 */
export function armTurnDeadline(
  timeoutMs: number,
  onExpire: () => void,
  clock: TurnDeadlineClock = systemTurnDeadlineClock,
): TurnDeadlineHandle {
  const budget = clampTurnTimeout(timeoutMs) ?? MIN_TURN_TIMEOUT_MS
  let handle: unknown
  let fired = false
  let cancelled = false
  let deadlineAt = clock.now() + budget

  const arm = (delayMs = budget) => {
    handle = clock.setTimer(() => {
      if (cancelled || fired) return
      fired = true
      onExpire()
    }, delayMs)
  }
  arm()

  return {
    extend: () => {
      if (cancelled || fired) return
      clock.clearTimer(handle)
      deadlineAt = clock.now() + budget
      arm()
    },
    extendFor: (timeoutMs) => {
      if (cancelled || fired) return
      const lease = Math.max(budget, clampTurnTimeout(timeoutMs) ?? budget)
      clock.clearTimer(handle)
      deadlineAt = clock.now() + lease
      arm(lease)
    },
    cancel: () => {
      if (cancelled) return
      cancelled = true
      clock.clearTimer(handle)
    },
    expired: () => fired,
    deadlineAt: () => deadlineAt,
  }
}

/**
 * Convert a model tool's bounded execution timeout into a temporary idle
 * lease. Bash declares seconds; app-owned tools conventionally declare ms.
 * Missing/unbounded timeouts deliberately keep the ordinary turn budget.
 */
export function toolExecutionDeadlineLeaseMs(
  tool: string,
  args: unknown,
): number | undefined {
  if (!args || typeof args !== 'object') return undefined
  const values = args as Record<string, unknown>
  const raw = tool === 'bash' ? Number(values.timeout) * 1_000 : Number(values.timeoutMs)
  if (!Number.isFinite(raw) || raw <= 0) return undefined
  return clampTurnTimeout(raw + TOOL_SETTLEMENT_GRACE_MS)
}
