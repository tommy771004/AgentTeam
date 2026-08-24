/**
 * Auto-continue freshness window (hermes `auto_continue_freshness_window` 對應物).
 *
 * A continueGoal snapshot carries the DoD, gaps, and steps of a run that
 * already ended. Continuing from it replays corrective work against a world
 * that may have moved on — files changed, threads archived, the objective
 * superseded. Without a freshness rule, an old snapshot can be resumed forever,
 * zombie-style, long after it described anything real.
 *
 * This module owns only the arithmetic; admission (`taskRunCoordinator`)
 * applies it fail-closed: a snapshot with no parsable timestamp is NOT fresh.
 */

/** Default window: snapshots older than 30 minutes no longer auto-continue. */
export const DEFAULT_CONTINUE_FRESHNESS_MS = 30 * 60_000

export const MIN_CONTINUE_FRESHNESS_MS = 60_000
export const MAX_CONTINUE_FRESHNESS_MS = 24 * 60 * 60_000

export function clampContinueFreshnessMs(ms: unknown): number {
  const value = Math.floor(Number(ms))
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_CONTINUE_FRESHNESS_MS
  return Math.max(MIN_CONTINUE_FRESHNESS_MS, Math.min(MAX_CONTINUE_FRESHNESS_MS, value))
}

function parseTimestamp(at: string | number | undefined): number | undefined {
  if (typeof at === 'number' && Number.isFinite(at) && at > 0) return at
  if (typeof at !== 'string' || !at.trim()) return undefined
  const parsed = Date.parse(at)
  return Number.isFinite(parsed) ? parsed : undefined
}

export type ContinueFreshnessInput = {
  /** Snapshot creation time — ISO string or epoch ms (`buildContinueGoalSnapshot` stamps ISO). */
  at: string | number | undefined
}

/**
 * Whether a continueGoal snapshot may still drive an automatic continuation.
 *
 * Missing or unparseable timestamps fail closed: without evidence of age there
 * is no basis to claim freshness.
 */
export function isSnapshotFresh(
  input: ContinueFreshnessInput,
  nowMs: number = Date.now(),
  windowMs: number = DEFAULT_CONTINUE_FRESHNESS_MS,
): boolean {
  const at = parseTimestamp(input.at)
  if (at === undefined) return false
  const window = clampContinueFreshnessMs(windowMs)
  if (at > nowMs + MIN_CONTINUE_FRESHNESS_MS) return false
  return nowMs - at <= window
}
