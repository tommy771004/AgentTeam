/**
 * HITL intervention timeout policy (pure — safe for Node strip-types smokes).
 * Engine waitForIntervention owns the timer; this module owns the arithmetic.
 */

/**
 * Unattended HITL auto-deny window (seconds).
 * Default 45s (cron/webhook/telegram). Floor 15s / cap 120s in production.
 * Values under 15s are honored only when an explicit hitlTimeoutMs is set below
 * the floor (smoke parity — product defaults never pass sub-floor values).
 */
export function unattendedInterventionTimeoutSec(hitlTimeoutMs?: number): number {
  const ms = hitlTimeoutMs ?? 45_000
  if (ms > 0 && ms < 15_000) return Math.max(1, Math.round(ms / 1000))
  return Math.max(15, Math.min(120, Math.round(ms / 1000)))
}
