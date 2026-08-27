/**
 * Per-run workspace / project context for tools.
 * Scheduler may pin project A while the UI shows B — tools must not silently
 * read the UI store; they consult this run-scoped root first.
 *
 * Every interactive run-starting entry point (composer, slash, continueGoal ACK,
 * SubDesign) now snapshots the active project at dispatch time into
 * RuntimeOverrides.projectRoot. The surviving workspace compatibility handlers
 * consume it as context.projectRoot — see docs/adr/0003-concurrent-run-lock-removal.md.
 * The UI-store fallback below should therefore be unreachable during a real run;
 * it only exists for the frozen compatibility handlers and diagnostic smokes.
 *
 * Ticket 18: Restricted Project View root is a single resolution order:
 * main viewRoot(runId) → local pin → explicit → UI store. Bound view always
 * wins over the original project so tools cannot fall through under protection.
 */

/**
 * Pure root resolution (seam for smoke). Bound Restricted Project View wins.
 */
export function resolveProtectedProjectRoot(opts: {
  boundViewRoot?: string | null
  explicitRoot?: string | null
  uiStoreRoot?: string | null
}): string | undefined {
  const view = (opts.boundViewRoot || '').trim()
  if (view) return view
  const explicit = (opts.explicitRoot || '').trim()
  if (explicit) return explicit
  const ui = (opts.uiStoreRoot || '').trim()
  return ui || undefined
}

/**
 * Resolve effective cwd/project for tools.
 * When a Restricted Project View is pinned for `runId` (main IPC or local pin),
 * that view wins so builtin file tools cannot read the original project.
 * Otherwise: explicit root → UI store (legacy).
 */
export async function resolveEffectiveProjectRoot(
  explicitRoot?: string,
  runId?: string,
): Promise<string | undefined> {
  let boundViewRoot: string | undefined

  if (runId) {
    // 1) Electron main — authoritative filesystem owner of the view
    try {
      const w = globalThis as typeof globalThis & {
        window?: {
          subagents?: { outbound?: { viewRoot?: (id: string) => Promise<string | null> } }
        }
      }
      const fn = w.window?.subagents?.outbound?.viewRoot
      if (typeof fn === 'function') {
        const fromMain = await fn(runId)
        if (fromMain && String(fromMain).trim()) {
          boundViewRoot = String(fromMain).trim()
        }
      }
    } catch {
      /* no IPC */
    }

    // 2) Local pin (coordinator after prepare, or Node smoke bind)
    if (!boundViewRoot) {
      try {
        const { getRestrictedViewRootForRun, getSanitizedViewForRun } = await import(
          '../outbound/sanitizedWorkspace.ts'
        )
        boundViewRoot =
          getRestrictedViewRootForRun(runId) || getSanitizedViewForRun(runId)?.viewRoot
      } catch {
        /* module unavailable */
      }
    }
  }

  let uiStoreRoot: string | undefined
  if (!boundViewRoot && !(explicitRoot || '').trim()) {
    try {
      const { useProjectStore } = await import('../../store/projectStore.ts')
      uiStoreRoot = useProjectStore.getState().root || undefined
    } catch {
      uiStoreRoot = undefined
    }
  }

  return resolveProtectedProjectRoot({
    boundViewRoot,
    explicitRoot,
    uiStoreRoot,
  })
}
