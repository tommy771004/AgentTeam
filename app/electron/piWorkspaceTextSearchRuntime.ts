import { realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

export const WORKSPACE_TEXT_SEARCH_CAPABILITY_ID = 'workspace-text-search' as const
export const WORKSPACE_TEXT_SEARCH_TOOL_NAMES = ['workspace_grep', 'workspace_glob'] as const

export const WORKSPACE_TEXT_SEARCH_DISABLED_REASON =
  '工作區文字檢索未啟用。請到「設定 > 一般 > 工作區文字檢索」開啟；設定變更只會套用到下一個 run。'

export const WORKSPACE_TEXT_SEARCH_WORKSPACE_REQUIRED_REASON =
  '工作區文字檢索需要明確且有效的工作區根目錄；不允許使用 process.cwd() 作為 fallback。'

type WorkspaceTextSearchToolName = (typeof WORKSPACE_TEXT_SEARCH_TOOL_NAMES)[number]

export type WorkspaceTextSearchAvailability = {
  available: boolean
  workspaceRoot?: string
  reason?: string
  frozen: boolean
}

type FrozenWorkspaceTextSearchRun = WorkspaceTextSearchAvailability & {
  runId: string
}

const bySession = new Map<string, FrozenWorkspaceTextSearchRun>()

function normalizeWorkspaceRoot(value: string | undefined): { ok: true; root: string } | { ok: false; reason: string } {
  const raw = value?.trim()
  if (!raw) return { ok: false, reason: WORKSPACE_TEXT_SEARCH_WORKSPACE_REQUIRED_REASON }
  try {
    const lexical = resolve(raw)
    if (!statSync(lexical).isDirectory()) {
      return { ok: false, reason: WORKSPACE_TEXT_SEARCH_WORKSPACE_REQUIRED_REASON }
    }
    return { ok: true, root: realpathSync.native(lexical) }
  } catch {
    return { ok: false, reason: WORKSPACE_TEXT_SEARCH_WORKSPACE_REQUIRED_REASON }
  }
}

export function isWorkspaceTextSearchTool(name: string): name is WorkspaceTextSearchToolName {
  return (WORKSPACE_TEXT_SEARCH_TOOL_NAMES as readonly string[]).includes(name)
}

export function isWorkspaceTextSearchCapability(id: string): boolean {
  return id === WORKSPACE_TEXT_SEARCH_CAPABILITY_ID
}

export function resolveWorkspaceTextSearchAvailability(input: {
  enabled: boolean
  workspaceRoot?: string
}): WorkspaceTextSearchAvailability {
  if (!input.enabled) {
    return { available: false, reason: WORKSPACE_TEXT_SEARCH_DISABLED_REASON, frozen: false }
  }
  const root = normalizeWorkspaceRoot(input.workspaceRoot)
  if (!root.ok) return { available: false, reason: root.reason, frozen: false }
  return { available: true, workspaceRoot: root.root, frozen: false }
}

/**
 * Freeze the capability at turn admission. A Settings mutation after this call
 * must not change what the already-running model can discover or execute.
 */
export function bindWorkspaceTextSearchRun(
  sessionId: string,
  input: { runId: string; enabled: boolean; workspaceRoot?: string },
): WorkspaceTextSearchAvailability {
  const resolved = resolveWorkspaceTextSearchAvailability(input)
  const frozen: FrozenWorkspaceTextSearchRun = {
    ...resolved,
    frozen: true,
    runId: input.runId,
  }
  bySession.set(sessionId, frozen)
  return { ...frozen }
}

export function unbindWorkspaceTextSearchRun(sessionId: string, runId?: string): void {
  const current = bySession.get(sessionId)
  if (!current) return
  if (runId && current.runId !== runId) return
  bySession.delete(sessionId)
}

/**
 * Resolve the gate for catalog/direct/nested paths.
 *
 * When a session has an admitted run, its frozen decision wins over current
 * Settings. If an explicit cwd is supplied to a frozen run it must resolve to
 * exactly the admitted workspace root, preventing a nested/direct caller from
 * swapping roots.
 */
export function workspaceTextSearchAvailability(input: {
  sessionId?: string
  enabled: boolean
  workspaceRoot?: string
}): WorkspaceTextSearchAvailability {
  const frozen = input.sessionId ? bySession.get(input.sessionId) : undefined
  if (!frozen) return resolveWorkspaceTextSearchAvailability(input)

  if (!frozen.available) return { ...frozen }
  if (input.workspaceRoot?.trim()) {
    const requested = normalizeWorkspaceRoot(input.workspaceRoot)
    if (!requested.ok || requested.root !== frozen.workspaceRoot) {
      return {
        available: false,
        reason: '工作區文字檢索拒絕切換到本 run 已凍結工作區以外的路徑。',
        frozen: true,
      }
    }
  }
  return { ...frozen }
}
