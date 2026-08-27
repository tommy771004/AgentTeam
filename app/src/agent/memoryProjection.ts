export type MemoryProjectionScope =
  | { kind: 'global' }
  | { kind: 'project'; project: string }

export type MemoryProjectionEntry = {
  id: string
  scope: MemoryProjectionScope
  logicalKey: string
  kind: 'memory' | 'profile' | 'document'
  text: string
  tags: string[]
  createdAt: string
  updatedAt: string
  revision: number
}

export type MemoryProjectionPage = {
  items: MemoryProjectionEntry[]
  total: number
  revision: number
  nextCursor?: string
}

export type MemoryProjectionResult = { version: 1; revision: number } & (
  | { operation: 'list'; page: MemoryProjectionPage }
  | { operation: 'get'; entry?: MemoryProjectionEntry }
  | { operation: 'upsert'; entry: MemoryProjectionEntry }
  | { operation: 'delete' | 'clear' | 'delete-entry' | 'clear-project' | 'clear-global' | 'clear-all'; mutation: { changed: number; revision: number } }
  | { operation: 'deletion-capability'; capability: MemoryDeletionCapability }
  | { operation: 'consolidate-dream'; consolidation: {
      changed: number
      revision: number
      deduped: string[]
      merged: number
      alreadyApplied: boolean
      entry?: MemoryProjectionEntry
    } }
)

export type MemoryDeletionCapability = {
  mode: 'best-effort' | 'not-applicable'
  secureDelete: boolean
  walCheckpoint: 'truncated' | 'busy' | 'unavailable' | 'not-applicable'
  limitations: string[]
}

export type MemoryProjectionSnapshot = {
  generation: number
  revision: number
  invalidatedRevision: number
}

export function memoryProjectionBridgeAvailable(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const bridge = value as Record<string, unknown>
  return [
    'list', 'countAll', 'get', 'upsert', 'deleteEntry',
    'clearProject', 'clearGlobal', 'clearAll', 'deletionCapability',
    'consolidateDream',
  ].every((name) => typeof bridge[name] === 'function')
}

export function invalidateMemoryProjection(
  snapshot: MemoryProjectionSnapshot,
  revision: number,
): MemoryProjectionSnapshot {
  if (!Number.isFinite(revision) || revision <= snapshot.revision || revision <= snapshot.invalidatedRevision) {
    return snapshot
  }
  return { ...snapshot, invalidatedRevision: revision }
}

export function acceptsMemoryProjectionResponse(
  snapshot: MemoryProjectionSnapshot,
  request: { generation: number; minimumRevision: number },
  responseRevision: number,
): boolean {
  return request.generation === snapshot.generation
    && responseRevision >= snapshot.revision
    && responseRevision >= request.minimumRevision
}

export function memoryProjectionBundle(page: MemoryProjectionPage, special: {
  profile?: MemoryProjectionEntry
  document?: MemoryProjectionEntry
}) {
  return {
    userProfile: special.profile?.text || '',
    memory: special.document?.text || '',
    updatedAt: new Date().toISOString(),
    entries: page.items
      .filter((entry) => entry.kind === 'memory')
      .map((entry) => ({
        id: entry.id,
        kind: 'memory' as const,
        text: entry.text,
        createdAt: entry.createdAt,
        tags: entry.tags,
      })),
  }
}
