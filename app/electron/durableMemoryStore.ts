/**
 * Host-owned durable-memory seam.
 *
 * The renderer is a disposable UI Projection. Memory Extension consumers use
 * this async contract and never receive a mutable collection or adapter handle.
 */

export type MemoryOrigin = 'runtime' | 'admin' | 'migration' | 'consolidation'

declare const canonicalProjectIdBrand: unique symbol
export type CanonicalProjectId = string & { readonly [canonicalProjectIdBrand]: true }

export type MemoryScope =
  | { kind: 'global' }
  | { kind: 'project'; project: CanonicalProjectId }

export type MemoryAccessContext = {
  origin: MemoryOrigin
  canonicalProject?: CanonicalProjectId
  memoryReadEnabled: boolean
  memoryWriteEnabled: boolean
  temporary: boolean
  runId?: string
  sessionId?: string
  callId?: string
}

export type DurableMemoryKind = 'memory' | 'profile' | 'document'

export type DurableMemoryEntry = {
  id: string
  scope: MemoryScope
  logicalKey: string
  kind: DurableMemoryKind
  text: string
  tags: string[]
  createdAt: string
  updatedAt: string
  revision: number
}

export type MemoryRecallItem = DurableMemoryEntry & {
  decayFactor: number
  stalenessNote: string
}

export type MemoryRecallResult = {
  items: MemoryRecallItem[]
  revision: number
}

export type MemoryPage = {
  items: DurableMemoryEntry[]
  total: number
  revision: number
  nextCursor?: string
}

export type MemoryMutationResult = {
  changed: number
  revision: number
}

export type MemoryStoreErrorCode =
  | 'closed'
  | 'invalid_bundle'
  | 'invalid_input'
  | 'not_found'
  | 'forbidden'
  | 'quota_exceeded'
  | 'unavailable'

export class DurableMemoryStoreError extends Error {
  readonly code: MemoryStoreErrorCode

  constructor(
    code: MemoryStoreErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DurableMemoryStoreError'
    this.code = code
  }
}

/**
 * Lexically canonicalizes a project path for the contract boundary. Ticket 03
 * will add filesystem identity (realpath/case policy) before production use.
 */
export function canonicalProjectId(value: string): CanonicalProjectId {
  const trimmed = value.trim()
  if (!trimmed) throw new DurableMemoryStoreError('invalid_input', 'Canonical project is required')
  const normalized = trimmed.replaceAll('\\', '/').replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
  return normalized as CanonicalProjectId
}

export type MemoryHealth = {
  status: 'ready' | 'closed'
  revision: number
}

export type DurableMemoryBundle = {
  version: 1
  revision: number
  entries: DurableMemoryEntry[]
}

type MemoryEntryContent = {
  text: string
  tags: string[]
  createdAt: string
}

export type MemoryEntryDraft = MemoryEntryContent & (
  | { scope: MemoryScope; logicalKey: string; kind: 'memory' }
  | { scope: { kind: 'global' }; logicalKey: 'profile:user'; kind: 'profile' }
  | { scope: { kind: 'global' }; logicalKey: 'memory:document'; kind: 'document' }
)

export type MemoryUpsertInput = MemoryEntryDraft & {
  access: MemoryAccessContext
}

export type MemoryGetInput = {
  access: MemoryAccessContext
  scope: MemoryScope
  logicalKey: string
}

export type MemoryRecallInput = {
  access: MemoryAccessContext
  query: string
  limit?: number
  nowMs?: number
}

export type MemoryListInput = {
  access: MemoryAccessContext
  scope?: MemoryScope
  cursor?: string
  limit?: number
}

export type MemoryDeleteInput = MemoryGetInput

export type MemoryClearInput = {
  access: MemoryAccessContext
  scope: MemoryScope | { kind: 'all' }
}

export type MemoryConsolidateInput = {
  access: MemoryAccessContext
  scope: MemoryScope
  sourceKeys: string[]
  merged: MemoryEntryContent & {
    logicalKey: string
    kind: 'memory'
  }
}

export type MemoryConsolidationResult = MemoryMutationResult & {
  entry: DurableMemoryEntry
}

export type MemoryExportInput = {
  access: MemoryAccessContext
  scope?: MemoryScope
}

export type MemoryImportInput = {
  access: MemoryAccessContext
  bundle: DurableMemoryBundle
  mode: 'merge' | 'replace'
}

export interface DurableMemoryStore {
  upsert(input: MemoryUpsertInput): Promise<DurableMemoryEntry>
  get(input: MemoryGetInput): Promise<DurableMemoryEntry | undefined>
  recall(input: MemoryRecallInput): Promise<MemoryRecallResult>
  list(input: MemoryListInput): Promise<MemoryPage>
  delete(input: MemoryDeleteInput): Promise<MemoryMutationResult>
  clear(input: MemoryClearInput): Promise<MemoryMutationResult>
  revision(): Promise<number>
  health(): Promise<MemoryHealth>
  consolidate(input: MemoryConsolidateInput): Promise<MemoryConsolidationResult>
  exportBundle(input: MemoryExportInput): Promise<DurableMemoryBundle>
  importBundle(input: MemoryImportInput): Promise<MemoryMutationResult>
  close(): Promise<void>
}

const DECAYING_TAGS = new Set(['auto', 'flush'])
const DAY_MS = 86_400_000
const HALF_LIFE_DAYS = 7
const STALE_AFTER_DAYS = 14

function normalized(value: string): string {
  // Deliberately matches the production PiMemoryExtension. Unicode
  // normalization is a future ranking change, not part of this migration.
  return value.toLowerCase()
}

function terms(value: string): string[] {
  return [...new Set(normalized(value).match(/[\p{L}\p{N}_-]+/gu) || [])]
}

function scopeKey(scope: MemoryScope): string {
  return scope.kind === 'global' ? 'global' : `project:${scope.project}`
}

function entryKey(scope: MemoryScope, logicalKey: string): string {
  return `${scopeKey(scope)}\u0000${logicalKey}`
}

function cloneScope(scope: MemoryScope): MemoryScope {
  return scope.kind === 'global' ? { kind: 'global' } : { kind: 'project', project: scope.project }
}

function cloneEntry(entry: DurableMemoryEntry): DurableMemoryEntry {
  return { ...entry, scope: cloneScope(entry.scope), tags: [...entry.tags] }
}

function visibleToAccess(entry: DurableMemoryEntry, access: MemoryAccessContext): boolean {
  return entry.scope.kind === 'global'
    || (access.canonicalProject !== undefined && entry.scope.project === access.canonicalProject)
}

function selectEntries(
  entries: Iterable<DurableMemoryEntry>,
  access: MemoryAccessContext,
  requestedScope?: MemoryScope,
): DurableMemoryEntry[] {
  return [...entries].filter((entry) => requestedScope
    ? scopeKey(entry.scope) === scopeKey(requestedScope)
    : visibleToAccess(entry, access))
}

function canonicalDraft(input: MemoryEntryDraft): MemoryEntryDraft {
  if (input.kind === 'memory') {
    if (input.scope.kind === 'global' && (input.logicalKey === 'profile:user' || input.logicalKey === 'memory:document')) {
      throw new DurableMemoryStoreError('invalid_input', `${input.logicalKey} is reserved for its global special memory kind`)
    }
    return { ...input, scope: cloneScope(input.scope), tags: [...input.tags] }
  }
  const expectedKey = input.kind === 'profile' ? 'profile:user' : 'memory:document'
  if (input.scope.kind !== 'global' || input.logicalKey !== expectedKey) {
    throw new DurableMemoryStoreError('invalid_input', `${input.kind} memory must use global scope and key ${expectedKey}`)
  }
  const tags = [...new Set([...input.tags, expectedKey, 'always-recall'])]
  return { ...input, scope: { kind: 'global' }, logicalKey: expectedKey, tags } as MemoryEntryDraft
}

function decayMetadata(entry: DurableMemoryEntry, nowMs: number): Pick<MemoryRecallItem, 'decayFactor' | 'stalenessNote'> {
  if (!entry.tags.some((tag) => DECAYING_TAGS.has(tag))) {
    return { decayFactor: 1, stalenessNote: '' }
  }
  const createdMs = Date.parse(entry.createdAt)
  if (!Number.isFinite(createdMs) || nowMs <= createdMs) {
    return { decayFactor: 1, stalenessNote: '' }
  }
  const ageMs = nowMs - createdMs
  const days = Math.floor(ageMs / DAY_MS)
  return {
    decayFactor: 0.5 ** (ageMs / (HALF_LIFE_DAYS * DAY_MS)),
    stalenessNote: days < STALE_AFTER_DAYS ? '' : `（${days} 天前的自動記憶，使用前請先驗證現況）`,
  }
}

export class InMemoryDurableMemoryStore implements DurableMemoryStore {
  private readonly entries = new Map<string, DurableMemoryEntry>()
  private nextIdentity = 1
  private currentRevision = 0
  private closed = false

  private ensureOpen(): void {
    if (this.closed) throw new DurableMemoryStoreError('closed', 'Durable memory store is closed')
  }

  private nextEntry(input: MemoryEntryDraft, revision: number): DurableMemoryEntry {
    const draft = canonicalDraft(input)
    const key = entryKey(draft.scope, draft.logicalKey)
    const existing = this.entries.get(key)
    return {
      id: existing?.id || `memory-${this.nextIdentity++}`,
      scope: cloneScope(draft.scope),
      logicalKey: draft.logicalKey,
      kind: draft.kind,
      text: draft.text,
      tags: [...draft.tags],
      createdAt: existing?.createdAt || draft.createdAt,
      updatedAt: draft.createdAt,
      revision,
    }
  }

  async upsert(input: MemoryUpsertInput): Promise<DurableMemoryEntry> {
    this.ensureOpen()
    const draft = canonicalDraft(input)
    const key = entryKey(draft.scope, draft.logicalKey)
    const revision = ++this.currentRevision
    const entry = this.nextEntry(draft, revision)
    this.entries.set(key, entry)
    return cloneEntry(entry)
  }

  async get(input: MemoryGetInput): Promise<DurableMemoryEntry | undefined> {
    this.ensureOpen()
    const found = this.entries.get(entryKey(input.scope, input.logicalKey))
    return found ? cloneEntry(found) : undefined
  }

  async recall(input: MemoryRecallInput): Promise<MemoryRecallResult> {
    this.ensureOpen()
    const queryTerms = terms(input.query)
    const items = selectEntries(this.entries.values(), input.access)
      .map((entry) => {
        const text = normalized(entry.text)
        const tags = entry.tags.map(normalized)
        const matched = queryTerms.filter((term) => text.includes(term) || tags.some((tag) => tag.includes(term)))
        const exactTagMatches = queryTerms.filter((term) => tags.includes(term)).length
        const relevance = queryTerms.length ? matched.length / queryTerms.length + exactTagMatches * 0.25 : 0
        const score = tags.includes('always-recall') ? 2 + relevance : relevance
        return { entry, score }
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || right.entry.createdAt.localeCompare(left.entry.createdAt))
      .slice(0, Math.max(1, Math.floor(input.limit ?? 5)))
      .map(({ entry }): MemoryRecallItem => ({
        ...cloneEntry(entry),
        ...decayMetadata(entry, input.nowMs ?? Date.now()),
      }))
    return { items, revision: this.currentRevision }
  }

  async list(input: MemoryListInput): Promise<MemoryPage> {
    this.ensureOpen()
    const all = selectEntries(this.entries.values(), input.access, input.scope)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    const offset = Math.max(0, Number.parseInt(input.cursor || '0', 10) || 0)
    const limit = Math.max(1, Math.floor(input.limit ?? 50))
    const items = all.slice(offset, offset + limit).map(cloneEntry)
    const nextOffset = offset + items.length
    return {
      items,
      total: all.length,
      revision: this.currentRevision,
      ...(nextOffset < all.length ? { nextCursor: String(nextOffset) } : {}),
    }
  }

  async delete(input: MemoryDeleteInput): Promise<MemoryMutationResult> {
    this.ensureOpen()
    const changed = this.entries.delete(entryKey(input.scope, input.logicalKey)) ? 1 : 0
    if (changed) this.currentRevision += 1
    return { changed, revision: this.currentRevision }
  }

  async clear(input: MemoryClearInput): Promise<MemoryMutationResult> {
    this.ensureOpen()
    let changed = 0
    for (const [key, entry] of this.entries) {
      if (input.scope.kind !== 'all' && scopeKey(entry.scope) !== scopeKey(input.scope)) continue
      this.entries.delete(key)
      changed += 1
    }
    if (changed) this.currentRevision += 1
    return { changed, revision: this.currentRevision }
  }

  async revision(): Promise<number> {
    this.ensureOpen()
    return this.currentRevision
  }

  async health(): Promise<MemoryHealth> {
    return { status: this.closed ? 'closed' : 'ready', revision: this.currentRevision }
  }

  async consolidate(input: MemoryConsolidateInput): Promise<MemoryConsolidationResult> {
    this.ensureOpen()
    const sourceKeys = [...new Set(input.sourceKeys)]
    const missing = sourceKeys.find((logicalKey) => !this.entries.has(entryKey(input.scope, logicalKey)))
    if (missing) throw new DurableMemoryStoreError('not_found', `Memory source not found: ${missing}`)
    const revision = this.currentRevision + 1
    const entry = this.nextEntry({ scope: input.scope, ...input.merged }, revision)
    let changed = 0
    for (const logicalKey of sourceKeys) {
      if (this.entries.delete(entryKey(input.scope, logicalKey))) changed += 1
    }
    this.entries.set(entryKey(input.scope, input.merged.logicalKey), entry)
    this.currentRevision = revision
    return { changed: changed + 1, revision, entry: cloneEntry(entry) }
  }

  async exportBundle(input: MemoryExportInput): Promise<DurableMemoryBundle> {
    this.ensureOpen()
    const entries = selectEntries(this.entries.values(), input.access, input.scope)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(cloneEntry)
    return { version: 1, revision: this.currentRevision, entries }
  }

  async importBundle(input: MemoryImportInput): Promise<MemoryMutationResult> {
    this.ensureOpen()
    if (!input.bundle || input.bundle.version !== 1 || !Array.isArray(input.bundle.entries)) {
      throw new DurableMemoryStoreError('invalid_bundle', 'Unsupported durable memory bundle')
    }
    const drafts = input.bundle.entries.map((candidate) => canonicalDraft({
      scope: candidate.scope,
      logicalKey: candidate.logicalKey,
      kind: candidate.kind,
      text: candidate.text,
      tags: candidate.tags,
      createdAt: candidate.createdAt,
    } as MemoryEntryDraft))
    let changed = 0
    if (input.mode === 'replace') {
      changed += this.entries.size
      this.entries.clear()
    }
    const revision = drafts.length || changed ? this.currentRevision + 1 : this.currentRevision
    for (const draft of drafts) {
      const entry = this.nextEntry(draft, revision)
      this.entries.set(entryKey(entry.scope, entry.logicalKey), entry)
      changed += 1
    }
    this.currentRevision = revision
    return { changed, revision }
  }

  async close(): Promise<void> {
    this.closed = true
  }
}
