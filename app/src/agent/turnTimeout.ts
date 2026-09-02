/**
 * How long one turn is allowed to run before it is parked.
 *
 * Decided once, at admission, by the task run coordinator — the same place that
 * decides capacity and trigger admission — so every ingress inherits the same
 * patience budget instead of each caller inventing one.
 *
 * The budgets differ because the work differs: a chat turn that has not spoken
 * in three minutes is stuck, while a Goal-based run legitimately spends many
 * iterations, and an external CLI is a supervised child process whose own
 * policy owns its lifetime.
 */

export type TurnTimeoutRunner = 'builtin' | 'external'
export type TurnTimeoutPattern = 'Turn-based' | 'Goal-based' | 'Time-based' | 'Proactive'

/** Bounds shared with the Host so a setting cannot arm an absurd deadline. */
export const MIN_TURN_TIMEOUT_MS = 10_000
export const MAX_TURN_TIMEOUT_MS = 6 * 60 * 60 * 1_000

export const DEFAULT_TURN_TIMEOUT_MS: Record<TurnTimeoutPattern, number> = {
  'Turn-based': 10 * 60 * 1_000,
  'Goal-based': 45 * 60 * 1_000,
  'Time-based': 30 * 60 * 1_000,
  Proactive: 30 * 60 * 1_000,
}

export type ResolveTurnTimeoutInput = {
  runner?: TurnTimeoutRunner
  pattern?: TurnTimeoutPattern
  /** Global default from Settings; 0 or absent means "use the pattern default". */
  settingsTimeoutMs?: number
  /** Per-conversation override; wins over the setting when present. */
  threadTimeoutMs?: number
  /** Per-run override from an automation caller; wins over everything. */
  runTimeoutMs?: number
  /** Automation runs cannot be rescued by a human, so they stay bounded. */
  unattended?: boolean
}

export function clampTurnTimeout(ms: unknown): number | undefined {
  const value = Math.floor(Number(ms))
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.min(MAX_TURN_TIMEOUT_MS, Math.max(MIN_TURN_TIMEOUT_MS, value))
}

/**
 * Resolve the deadline for one turn.
 *
 * Returns undefined only for an external CLI run, whose supervision policy
 * already owns its lifetime — arming a second, competing deadline there would
 * give one run two ways to die.
 */
export function resolveTurnTimeout(input: ResolveTurnTimeoutInput): number | undefined {
  if (input.runner === 'external') return undefined
  const explicit =
    clampTurnTimeout(input.runTimeoutMs)
    ?? clampTurnTimeout(input.threadTimeoutMs)
    ?? clampTurnTimeout(input.settingsTimeoutMs)
  if (explicit) return explicit
  const pattern = input.pattern && DEFAULT_TURN_TIMEOUT_MS[input.pattern] ? input.pattern : 'Turn-based'
  const base = DEFAULT_TURN_TIMEOUT_MS[pattern]
  // Nobody is watching an automation run, so it gets the tighter half-budget.
  return clampTurnTimeout(input.unattended ? Math.round(base / 2) : base)
}

/** Human-readable budget for settings and status copy. */
