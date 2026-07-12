/**
 * Per-run workspace / project context for tools.
 * Scheduler may pin project A while the UI shows B — tools must not silently
 * read the UI store; they consult this run-scoped root first.
 */

let runProjectRoot: string | undefined
let runId: string | undefined
let runThreadId: string | undefined

export function setRunProjectRoot(root: string | undefined | null) {
  const r = (root || '').trim()
  runProjectRoot = r || undefined
}

export function getRunProjectRoot(): string | undefined {
  return runProjectRoot
}

export function setRunId(id: string | undefined | null) {
  runId = (id || '').trim() || undefined
}

export function getRunId(): string | undefined {
  return runId
}

export function setRunThreadId(id: string | undefined | null) {
  runThreadId = (id || '').trim() || undefined
}

export function getRunThreadId(): string | undefined {
  return runThreadId
}

/** Resolve effective cwd/project for tools: run pin → UI store → undefined */
export async function resolveEffectiveProjectRoot(): Promise<string | undefined> {
  if (runProjectRoot) return runProjectRoot
  try {
    const { useProjectStore } = await import('../../store/projectStore')
    return useProjectStore.getState().root || undefined
  } catch {
    return undefined
  }
}

export function clearRunContext() {
  runProjectRoot = undefined
  runId = undefined
  runThreadId = undefined
}
