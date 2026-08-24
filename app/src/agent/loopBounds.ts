/**
 * Shared iteration bounds for the Pi orchestration turn contract.
 *
 * The renderer's run-config builder (`piHostRun.buildPiHostRunConfig`) and the
 * Host's turn admission (`electron/piHostProtocol.ts`) must clamp with the
 * SAME numbers, or a requested budget would silently differ between what the
 * UI offered and what the Host enforced. This module is deliberately dependency-
 * free so both bundles (renderer and the pi-host utility bundle) can share it.
 *
 * The ceiling exists to bound one turn's autonomous looping, not to cap the
 * total work a goal may take: a Goal run that exhausts its budget ends with an
 * honest "未達 DoD" settlement and can be continued via continueGoal, which
 * carries its own freshness window (`autoContinueFreshness.ts`). 32 rounds is
 * the agreed long-run ceiling — enough for multi-file goals, far short of
 * runaway autonomy.
 */

export const PI_MIN_ITERATIONS = 1
export const PI_MAX_ITERATIONS = 32

/** Clamp a requested iteration count into the shared bounded range. */
export function clampPiIterations(value: unknown): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return PI_MIN_ITERATIONS
  return Math.max(PI_MIN_ITERATIONS, Math.min(PI_MAX_ITERATIONS, parsed))
}
