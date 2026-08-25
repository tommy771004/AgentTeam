/**
 * Shared tool I/O primitives (Hermes-style libraries, not a dispatch switch).
 */

import type { LlmSettings, PermissionPolicy, PermissionProjection } from '../types.ts'

export interface ToolResult {
  ok: boolean
  output: string
  data?: unknown
}

export type ToolExecutionContext = {
  permissionPolicy?: PermissionPolicy
  permissionProjection?: PermissionProjection
  mcpAgentId?: string
  runId?: string
  threadId?: string
  projectRoot?: string
}

/** In-process scratch memory for memory_set / memory_get (session-local). */
export const memory = new Map<string, string>()

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

export function formatSearch(r: {
  query: string
  results: Array<{ title: string; snippet: string; url?: string }>
}): string {
  if (!r.results?.length) return `No results for: ${r.query}`
  return r.results
    .map(
      (item, i) =>
        `${i + 1}. ${item.title}\n   ${item.snippet}${item.url ? `\n   ${item.url}` : ''}`,
    )
    .join('\n\n')
}

export async function browserWebSearch(query: string): Promise<ToolResult> {
  // Wikipedia opensearch (CORS-friendly)
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&namespace=0&format=json&origin=*`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as [string, string[], string[], string[]]
    const titles = data[1] || []
    const snippets = data[2] || []
    const links = data[3] || []
    const results = titles.map((title, i) => ({
      title,
      snippet: snippets[i] || '',
      url: links[i],
    }))
    return {
      ok: true,
      output: formatSearch({ query, results }),
      data: { query, results },
    }
  } catch (e) {
    return {
      ok: false,
      output: `web_search failed: ${e instanceof Error ? e.message : e}`,
    }
  }
}

export async function browserHttpFetch(url: string, maxChars: number): Promise<ToolResult> {
  try {
    const res = await fetch(url)
    const text = (await res.text()).slice(0, maxChars)
    return { ok: res.ok, output: text || `(empty body, status ${res.status})` }
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) }
  }
}

