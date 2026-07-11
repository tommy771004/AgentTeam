/**
 * projectContextResolver (W2 / P0-B) — load persistent project guidance
 * (AGENTS.md / CLAUDE.md hierarchy) for the selected project root.
 *
 * Layering contract (highest wins on conflict, all layers are injected):
 *   managed policy > project local (this module) > user profile (Hermes agentsDoc)
 *   > thread instruction > learned memory
 *
 * Read-only. Oversized files are truncated (flagged). Cache invalidates on
 * root change or TTL so file edits are picked up between runs.
 */

export type AppliedContext = {
  path: string
  scope: 'project' | 'project-parent' | 'project-subdir'
  bytes: number
  truncated: boolean
  /** djb2 content hash — run snapshot / drift detection */
  hash: string
  priority: number
  content: string
}

const TTL_MS = 30_000
const MAX_TOTAL_CHARS = 16_000

let cache: { key: string; at: number; docs: AppliedContext[] } | null = null

function djb2(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16)
}

/**
 * Resolve project guidance docs for a root.
 * Optional workPath (file or dir under root) loads subdirectory AGENTS.md layers.
 * Order: parent-most → project root → nearest work dir last (highest priority).
 */
export async function resolveProjectContext(
  root: string | undefined | null,
  workPath?: string | null,
): Promise<AppliedContext[]> {
  const key = `${(root || '').trim()}|${(workPath || '').trim()}`
  if (!key || key === '|') return []
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) {
    return cache.docs
  }
  const api = window.subagents?.project?.agentsDocs
  if (!api) return []
  try {
    const r = await api((root || '').trim(), workPath ? String(workPath).trim() : undefined)
    let budget = MAX_TOTAL_CHARS
    const docs: AppliedContext[] = (r?.docs || []).map((d, i) => {
      const content = d.content.slice(0, Math.max(0, budget))
      budget -= content.length
      const scope =
        d.scope === 'project-subdir' || d.scope === 'project-parent' || d.scope === 'project'
          ? d.scope
          : 'project'
      return {
        path: d.path,
        scope,
        bytes: d.bytes,
        truncated: d.truncated || content.length < d.content.length,
        hash: djb2(d.content),
        priority: i + 1,
        content,
      }
    })
    cache = { key, at: Date.now(), docs }
    return docs
  } catch {
    return []
  }
}

export function invalidateProjectContext() {
  cache = null
}

/** Prompt block with per-doc source attribution (auditable). */
export function formatProjectGuidance(docs: AppliedContext[]): string {
  if (!docs.length) return ''
  const parts = docs.map(
    (d) =>
      `### 專案指引：${d.path}${d.truncated ? '（已裁切）' : ''}\n${d.content.trim()}`,
  )
  return [
    '# 專案持久指引（AGENTS.md — 優先於使用者一般偏好，低於受管政策）',
    ...parts,
  ].join('\n\n')
}

/** One-line audit summary per doc for run logs / archive. */
export function summarizeProjectContext(docs: AppliedContext[]): string {
  if (!docs.length) return ''
  return docs
    .map((d) => `${d.path} (${d.bytes}B, #${d.hash}${d.truncated ? ', 裁切' : ''})`)
    .join(' · ')
}
