import type { Thread } from '../store/threadStore'

/** Conversations shown per project before 「顯示更多」 is offered. */
export const COLLAPSED_PER_PROJECT = 4
/** Threads that never ran carry no project binding; they group under this key. */
const UNBOUND_KEY = '\u0000unbound'

export type ProjectGroup = {
  key: string
  /** Folder name shown in the header; '' for the unbound group. */
  root: string
  label: string
  threads: Thread[]
}

export type ThreadSidebarProjection = {
  groups: ProjectGroup[]
  searching: boolean
  truncated: boolean
  noResults: boolean
}

export type ProjectThreadSidebarInput = {
  threads: Thread[]
  activeRoot: string
  activeName?: string
  query: string
  expanded: boolean
}

function projectNameFromRoot(root: string): string {
  const parts = root.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] || root
}

/**
 * Group conversations by the project they ran against.
 *
 * The active project always gets a row even with no conversations yet — that
 * empty state is what 「沒有對話」 renders. Groups are ordered active-first,
 * then by most recent activity, with the unbound group last.
 */
export function buildProjectGroups(
  threads: Thread[],
  activeRoot: string,
  activeName?: string,
): ProjectGroup[] {
  const byKey = new Map<string, ProjectGroup>()
  const root = activeRoot.trim()
  if (root) {
    byKey.set(root, { key: root, root, label: activeName || projectNameFromRoot(root), threads: [] })
  }
  for (const thread of threads) {
    if (thread.hidden) continue
    const bound = thread.projectRoot?.trim() || ''
    const key = bound || UNBOUND_KEY
    let group = byKey.get(key)
    if (!group) {
      group = {
        key,
        root: bound,
        label: bound ? projectNameFromRoot(bound) : '未綁定專案',
        threads: [],
      }
      byKey.set(key, group)
    }
    group.threads.push(thread)
  }
  const recency = (group: ProjectGroup) =>
    group.threads.reduce((latest, thread) => (thread.updatedAt > latest ? thread.updatedAt : latest), '')
  return [...byKey.values()].sort((a, b) => {
    if (a.key === b.key) return 0
    if (a.key === UNBOUND_KEY) return 1
    if (b.key === UNBOUND_KEY) return -1
    if (a.key === root) return -1
    if (b.key === root) return 1
    return recency(b).localeCompare(recency(a))
  })
}

/**
 * Disposable UI projection for the conversation sidebar.
 *
 * Search deliberately stays title-only and presentation-only. Pi Host remains
 * the durable conversation authority; this projection only decides which of
 * the already-visible threads the renderer presents.
 */
export function projectThreadSidebar({
  threads,
  activeRoot,
  activeName,
  query,
  expanded,
}: ProjectThreadSidebarInput): ThreadSidebarProjection {
  const groups = buildProjectGroups(threads, activeRoot, activeName)
  const normalizedQuery = query.trim().toLowerCase()
  const searching = normalizedQuery.length > 0
  const truncated = groups.some((group) => group.threads.length > COLLAPSED_PER_PROJECT)

  if (searching) {
    const activeKey = activeRoot.trim()
    let matchCount = 0
    const matches = groups.flatMap((group) => {
      const matchingThreads = group.threads.filter((thread) =>
        thread.title.toLowerCase().includes(normalizedQuery),
      )
      matchCount += matchingThreads.length
      return matchingThreads.length > 0 || (activeKey && group.key === activeKey)
        ? [{ ...group, threads: matchingThreads }]
        : []
    })
    return {
      groups: matches,
      searching,
      truncated: false,
      noResults: matchCount === 0,
    }
  }

  return {
    groups: expanded
      ? groups
      : groups.map((group) => ({
          ...group,
          threads: group.threads.slice(0, COLLAPSED_PER_PROJECT),
        })),
    searching,
    truncated,
    noResults: false,
  }
}
