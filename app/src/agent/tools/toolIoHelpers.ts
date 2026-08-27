/**
 * Shared tool I/O primitives (Hermes-style libraries, not a dispatch switch).
 */

import type { PermissionPolicy, PermissionProjection } from '../types.ts'

export type ToolExecutionContext = {
  permissionPolicy?: PermissionPolicy
  permissionProjection?: PermissionProjection
  mcpAgentId?: string
  runId?: string
  threadId?: string
  projectRoot?: string
}

/**
 * G5 rewind: 寫入類工具執行前把目標檔原始內容快照到 Electron main
 * (userData/rewind/<threadId>.jsonl)。best-effort — 快照失敗絕不
 * 阻擋工具本身;無 threadId(純瀏覽器/單元測試)時靜默跳過。
 */
export async function recordRewindSnapshot(opts: {
  threadId?: string
  runId?: string
  kind: 'write' | 'delete' | 'move'
  relPath: string
  toPath?: string
  after?: string | null
  projectRoot?: string
}): Promise<void> {
  const rewind = window.subagents?.rewind
  const read = window.subagents?.tools?.workspaceRead
  if (!rewind?.record || !read || !opts.threadId || !opts.relPath) return
  try {
    const prev = await read(opts.relPath, opts.projectRoot)
    await rewind.record({
      threadId: opts.threadId,
      runId: opts.runId,
      kind: opts.kind,
      relPath: opts.relPath,
      toPath: opts.toPath,
      before: prev.ok ? prev.content : null,
      after: opts.after,
    })
  } catch {
    /* best-effort */
  }
}

