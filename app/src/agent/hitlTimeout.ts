/**
 * HITL intervention timeout policy (pure — safe for Node strip-types smokes).
 * Engine waitForIntervention owns the timer; this module owns the arithmetic.
 */

/**
 * Unattended HITL auto-deny window (seconds).
 * Default 45s (cron/webhook/telegram). Always floor 15s / cap 120s —
 * product and smoke share the same hard bounds (no sub-floor bypass).
 */
export function unattendedInterventionTimeoutSec(hitlTimeoutMs?: number): number {
  const ms = hitlTimeoutMs ?? 45_000
  return Math.max(15, Math.min(120, Math.round(ms / 1000)))
}
