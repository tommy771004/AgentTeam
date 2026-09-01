export type ContinuationItemStatus = 'candidate' | 'running' | 'completed' | 'blocked' | 'discarded'

export type ContinuationItem = Readonly<{
  id: string
  title: string
  description: string
  acceptanceCriteria: readonly string[]
  priority: number
  dependencies: readonly string[]
  scope: 'original-objective' | 'expanded'
  requiresAdditionalAuthority: boolean
  status: ContinuationItemStatus
}>

function strings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 500))
    .slice(0, limit)
}

export function normalizeContinuationItems(value: unknown): ContinuationItem[] {
  if (!Array.isArray(value)) return []
  const items: ContinuationItem[] = []
  const ids = new Set<string>()
  for (const raw of value.slice(0, 24)) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const id = String(item.id || '').trim().slice(0, 120)
    const title = String(item.title || '').trim().slice(0, 300)
    const description = String(item.description || '').trim().slice(0, 1_000)
    const acceptanceCriteria = strings(item.acceptanceCriteria, 16)
    if (!id || ids.has(id) || !title || !description || acceptanceCriteria.length === 0) continue
    ids.add(id)
    const rawStatus = String(item.status || 'candidate') as ContinuationItemStatus
    const status: ContinuationItemStatus = ['candidate', 'running', 'completed', 'blocked', 'discarded'].includes(rawStatus)
      ? rawStatus
      : 'candidate'
    items.push(Object.freeze({
      id,
      title,
      description,
      acceptanceCriteria: Object.freeze(acceptanceCriteria),
      priority: Number.isFinite(Number(item.priority)) ? Math.max(0, Math.min(100, Math.floor(Number(item.priority)))) : 50,
      dependencies: Object.freeze(strings(item.dependencies, 16)),
      scope: item.scope === 'expanded' ? 'expanded' : 'original-objective',
      requiresAdditionalAuthority: item.requiresAdditionalAuthority === true,
      status,
    }))
  }
  return items
}

export function selectContinuationItem(items: readonly ContinuationItem[]): {
  item?: ContinuationItem
  blockedReason?: string
} {
  const completed = new Set(items.filter((item) => item.status === 'completed').map((item) => item.id))
  const candidates = items
    .filter((item) => item.status === 'candidate' || item.status === 'running')
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
  const expanded = candidates.find((item) => item.scope === 'expanded')
  if (expanded) return { blockedReason: `續行項目「${expanded.title}」超出原始 objective` }
  const authority = candidates.find((item) => item.requiresAdditionalAuthority)
  if (authority) return { blockedReason: `續行項目「${authority.title}」需要額外權限` }
  const ready = candidates.find((item) => item.dependencies.every((dependency) => completed.has(dependency)))
  if (ready) return { item: ready }
  if (candidates.length > 0) return { blockedReason: '續行項目的 dependencies 尚未完成' }
  return {}
}

export function continuationSignature(item: ContinuationItem): string {
  return JSON.stringify([item.id, item.title, item.description, item.acceptanceCriteria])
}

/** Model-authored continuation items are proposals; this only selects bounded hints for failed Host criteria. */
export function selectReadyContinuationItems(
  items: readonly ContinuationItem[],
  failedCriterionIds: readonly string[],
): { accepted: readonly ContinuationItem[]; rejectedIds: readonly string[] } {
  const completed = new Set(items.filter((item) => item.status === 'completed').map((item) => item.id))
  const failed = new Set(failedCriterionIds)
  const candidates = items.filter((item) => item.status === 'candidate' || item.status === 'running')
  const accepted = candidates.filter((item) => item.scope === 'original-objective'
    && !item.requiresAdditionalAuthority
    && item.dependencies.every((dependency) => completed.has(dependency))
    && item.acceptanceCriteria.some((criterion) => [...failed].some((id) => criterion.includes(id))))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .slice(0, 3)
  const acceptedIds = new Set(accepted.map((item) => item.id))
  return Object.freeze({
    accepted: Object.freeze(accepted),
    rejectedIds: Object.freeze(candidates.filter((item) => !acceptedIds.has(item.id)).map((item) => item.id).sort()),
  })
}
