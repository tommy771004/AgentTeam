import type { Thread } from '../store/threadStore'

/** Conversations shown per project before 「顯示更多」 is offered. */
export const COLLAPSED_PER_PROJECT = 4
/** Threads that never ran carry no project binding; they group under this key. */
const UNBOUND_KEY = '\u0000unbound'
export const THREAD_PROJECT_ORDER_STORAGE_KEY = 'agentstudio:thread-project-order:v1'
export const THREAD_ORDER_STORAGE_KEY = 'agentstudio:thread-order:v1'
const MAX_DURABLE_ORDER_KEYS = 512

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
  /** Durable user-defined folder order. Selection/activity never mutate it. */
  projectOrder?: readonly string[]
  /** Durable conversation order. Pi Host enumeration never mutates it. */
  threadOrder?: readonly string[]
}

function boundDurableOrder(order: readonly string[], liveKeys: readonly string[]): string[] {
  const live = new Set(liveKeys)
  const seen = new Set<string>()
  const unique: string[] = []
  for (const key of order) {
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(key)
  }
  if (unique.length <= MAX_DURABLE_ORDER_KEYS) return unique
  const dormantBudget = Math.max(0, MAX_DURABLE_ORDER_KEYS - live.size)
  const retainedDormant = new Set(
    unique.filter((key) => !live.has(key)).slice(0, dormantBudget),
  )
  return unique.filter((key) => live.has(key) || retainedDormant.has(key))
}

/**
 * Keep only live folder keys, preserve the user's surviving order, then append
 * folders discovered later. This is the lifecycle boundary for reload, archive,
 * delete, and first-seen projects.
 */
export function reconcileProjectOrder(
  order: readonly string[],
  liveKeys: readonly string[],
): string[] {
  const live = new Set(liveKeys)
  const seen = new Set<string>()
  const next: string[] = []
  for (const key of [...order, ...liveKeys]) {
    if (!live.has(key) || seen.has(key)) continue
    seen.add(key)
    next.push(key)
  }
  return next
}

/**
 * Extend the durable preference without deleting temporarily absent folders.
 * Pi Host hydration is asynchronous, so an empty/intermediate renderer frame
 * must not erase order entries that will become live moments later.
 */
export function mergeProjectOrder(
  order: readonly string[],
  liveKeys: readonly string[],
): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const key of [...order, ...liveKeys]) {
    if (!key || seen.has(key)) continue
    seen.add(key)
    next.push(key)
  }
  return boundDurableOrder(next, liveKeys)
}

/**
 * Preserve known conversation positions, put genuinely new conversations at
 * the front, and retain temporarily absent Host sessions across hydration.
 */
export function mergeThreadOrder(
  order: readonly string[],
  liveKeys: readonly string[],
): string[] {
  const known = new Set(order)
  const newlyDiscovered = liveKeys.filter((key) => !known.has(key))
  return boundDurableOrder([...newlyDiscovered, ...order], liveKeys)
}

/** Move one folder immediately before or after another folder. */
export function reorderProject(
  order: readonly string[],
  draggedKey: string,
  targetKey: string,
  position: 'before' | 'after' = 'before',
): string[] {
  if (draggedKey === targetKey || !order.includes(draggedKey) || !order.includes(targetKey)) {
    return [...order]
  }
  const next = order.filter((key) => key !== draggedKey)
  const targetIndex = next.indexOf(targetKey)
  next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, draggedKey)
  return next
}

export function moveProjectByOffset(
  order: readonly string[],
  projectKey: string,
  offset: -1 | 1,
): string[] {
  const index = order.indexOf(projectKey)
  const target = index + offset
  if (index < 0 || target < 0 || target >= order.length) return [...order]
  const next = [...order]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/** Pick the next visible row, falling back to the previous row at the end. */
export function nextThreadAfterDelete(order: readonly string[], deletedId: string): string | null {
  const index = order.indexOf(deletedId)
  if (index < 0) return order[0] || null
  return order[index + 1] || order[index - 1] || null
}

export function parseProjectOrder(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === 'string' && key.length > 0)
      : []
  } catch {
    return []
  }
}

function projectNameFromRoot(root: string): string {
  const parts = root.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] || root
}

/**
 * Group conversations by the project they ran against.
 *
 * The active project always gets a row even with no conversations yet — that
 * empty state is what 「沒有對話」 renders. A supplied user order is stable;
 * only the first-time fallback uses active-first and recent activity.
 */
export function buildProjectGroups(
  threads: Thread[],
  activeRoot: string,
  activeName?: string,
  projectOrder?: readonly string[],
  threadOrder?: readonly string[],
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
  if (threadOrder) {
    const threadRank = new Map(threadOrder.map((key, index) => [key, index] as const))
    for (const group of byKey.values()) {
      group.threads.sort((a, b) => {
        const aRank = threadRank.get(a.id) ?? Number.MAX_SAFE_INTEGER
        const bRank = threadRank.get(b.id) ?? Number.MAX_SAFE_INTEGER
        return aRank - bRank
      })
    }
  }
  const recency = (group: ProjectGroup) =>
    group.threads.reduce((latest, thread) => (thread.updatedAt > latest ? thread.updatedAt : latest), '')
  const orderRank = projectOrder
    ? new Map(projectOrder.map((key, index) => [key, index] as const))
    : null
  return [...byKey.values()].sort((a, b) => {
    if (a.key === b.key) return 0
    if (orderRank) {
      const aRank = orderRank.get(a.key) ?? Number.MAX_SAFE_INTEGER
      const bRank = orderRank.get(b.key) ?? Number.MAX_SAFE_INTEGER
      if (aRank !== bRank) return aRank - bRank
    }
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
  projectOrder,
  threadOrder,
}: ProjectThreadSidebarInput): ThreadSidebarProjection {
  const groups = buildProjectGroups(threads, activeRoot, activeName, projectOrder, threadOrder)
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
