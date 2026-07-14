/**
 * Per-run workspace / project context for tools.
 * Scheduler may pin project A while the UI shows B — tools must not silently
 * read the UI store; they consult this run-scoped root first.
 *
 * Every interactive run-starting entry point (composer, slash, continueGoal ACK,
 * SubDesign) now snapshots the active project at dispatch time into
 * RuntimeOverrides.projectRoot, which engine.ts/toolLoop.ts thread through as
 * context.projectRoot on every tool call — see docs/adr/0003-concurrent-run-lock-removal.md.
 * The UI-store fallback below should therefore be unreachable during a real run;
 * it only exists for genuinely legacy direct callers outside the engine.
 */

/** Resolve effective cwd/project for legacy direct calls: explicit root → UI store. */
export async function resolveEffectiveProjectRoot(explicitRoot?: string): Promise<string | undefined> {
  const explicit = (explicitRoot || '').trim()
  if (explicit) return explicit
  try {
    const { useProjectStore } = await import('../../store/projectStore')
    return useProjectStore.getState().root || undefined
  } catch {
    return undefined
  }
}
