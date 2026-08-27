import { realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, isAbsolute, resolve } from 'node:path'

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

export type DurableMemoryLimits = {
  maxTextLength: number
  maxLogicalKeyLength: number
  maxTags: number
  maxTagLength: number
  maxPageSize: number
  maxImportBatch: number
  maxEntriesPerScope: number
}

export const DEFAULT_DURABLE_MEMORY_LIMITS: DurableMemoryLimits = {
  maxTextLength: 32_768,
  maxLogicalKeyLength: 256,
  maxTags: 32,
  maxTagLength: 64,
  maxPageSize: 100,
  maxImportBatch: 1_000,
  maxEntriesPerScope: 1_000,
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

export type MemoryDeletionCapability = {
  mode: 'best-effort' | 'not-applicable'
  secureDelete: boolean
  walCheckpoint: 'truncated' | 'busy' | 'unavailable' | 'not-applicable'
  limitations: string[]
}

export type DurableMemoryProtocolResult = { version: 1; revision: number } & (
  | { operation: 'upsert'; entry: DurableMemoryEntry }
  | { operation: 'append'; entry: DurableMemoryEntry }
  | { operation: 'get'; entry?: DurableMemoryEntry }
  | { operation: 'list'; page: MemoryPage }
  | { operation: 'recall'; recall: MemoryRecallResult }
  | { operation: 'delete' | 'clear' | 'delete-entry' | 'clear-project' | 'clear-global' | 'clear-all'; mutation: MemoryMutationResult }
  | { operation: 'deletion-capability'; capability: MemoryDeletionCapability }
  | { operation: 'consolidate-dream'; consolidation: MemoryDreamConsolidationResult }
)

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

export function canonicalProjectId(value: string): CanonicalProjectId {
  if (typeof value !== 'string') throw new DurableMemoryStoreError('invalid_input', 'Canonical project must be a string')
  const trimmed = value.trim()
  if (!trimmed || hasControlCharacter(trimmed)) throw new DurableMemoryStoreError('invalid_input', 'Canonical project is required and must not contain control characters')
  const path = trimmed.replaceAll('\\', '/')
  // Resolve symlinks before lexical ".." normalization, including the nearest
  // existing ancestor of projects that have not yet been created.
  const normalized = resolveProjectPath(isAbsolute(path) ? path : `${process.cwd()}/${path}`).replaceAll('\\', '/')
  return (process.platform === 'win32' ? normalized.toLowerCase() : normalized) as CanonicalProjectId
}

function resolveProjectPath(path: string): string {
  const missing: string[] = []
  let current = path
  for (;;) {
    try { return resolve(realpathSync.native(current), ...missing) } catch (error) {
      const parent = dirname(current)
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === current) {
        throw new DurableMemoryStoreError('unavailable', 'Cannot resolve canonical memory project')
      }
      missing.unshift(basename(current))
      current = parent
    }
  }
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

export type MemoryAppendInput = MemoryUpsertInput

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
  kinds?: DurableMemoryKind[]
  cursor?: string
  limit?: number
}

export type MemoryDeleteInput = MemoryGetInput & {
  auditOperation?: 'delete' | 'delete-entry'
}

export type MemoryClearInput = {
  access: MemoryAccessContext
  scope: MemoryScope | { kind: 'all' }
  /** Typed clear-global preserves profile/document; clear-all sets this true. */
  includeSpecial?: boolean
  auditOperation?: 'clear' | 'clear-project' | 'clear-global' | 'clear-all'
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

export type MemoryDreamFaultPoint = 'after-source-read' | 'after-source-delete' | 'after-merged-write'

export type MemoryDreamConsolidateInput = {
  access: MemoryAccessContext
  scope: MemoryScope
  operationId: string
  force?: boolean
  /** Store-contract fault injection only; protocol callers cannot set this. */
  faultAt?: MemoryDreamFaultPoint
}

export type MemoryDreamConsolidationResult = MemoryMutationResult & {
  deduped: string[]
  merged: number
  alreadyApplied: boolean
  entry?: DurableMemoryEntry
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

export type MemoryMigrationInput = {
  access: MemoryAccessContext
  sourceHash: string
  sourceSchema: 1 | 2
  memories: unknown[]
}

export type MemoryMigrationReport = {
  version: 1
  sourceHash: string
  sourceSchema: 1 | 2
  imported: number
  rejected: Array<{ index: number; code: MemoryStoreErrorCode | 'duplicate_key' | 'existing_entry' }>
  revision: number
}

export type MemoryMigrationResult = { alreadyApplied: boolean; report: MemoryMigrationReport }

export interface DurableMemoryStore {
  upsert(input: MemoryUpsertInput): Promise<DurableMemoryEntry>
  append(input: MemoryAppendInput): Promise<DurableMemoryEntry>
  get(input: MemoryGetInput): Promise<DurableMemoryEntry | undefined>
  recall(input: MemoryRecallInput): Promise<MemoryRecallResult>
  list(input: MemoryListInput): Promise<MemoryPage>
  delete(input: MemoryDeleteInput): Promise<MemoryMutationResult>
  clear(input: MemoryClearInput): Promise<MemoryMutationResult>
  deletionCapability(): Promise<MemoryDeletionCapability>
  revision(): Promise<number>
  health(): Promise<MemoryHealth>
  consolidate(input: MemoryConsolidateInput): Promise<MemoryConsolidationResult>
  consolidateDream(input: MemoryDreamConsolidateInput): Promise<MemoryDreamConsolidationResult>
  exportBundle(input: MemoryExportInput): Promise<DurableMemoryBundle>
  importBundle(input: MemoryImportInput): Promise<MemoryMutationResult>
  migrateLegacy(input: MemoryMigrationInput): Promise<MemoryMigrationResult>
  migrationStatus(): Promise<MemoryMigrationReport | undefined>
  close(): Promise<void>
}

export type MemoryAuthorityAction =
  | 'get' | 'recall' | 'list' | 'upsert' | 'append' | 'delete' | 'clear'
  | 'consolidate' | 'export' | 'import' | 'migrate'

const READ_ACTIONS = new Set<MemoryAuthorityAction>(['get', 'recall', 'list', 'export'])
const WRITE_ACTIONS = new Set<MemoryAuthorityAction>(['upsert', 'append', 'delete', 'clear', 'consolidate', 'import'])
const RUNTIME_ACTIONS = new Set<MemoryAuthorityAction>(['get', 'recall', 'list', 'upsert', 'append', 'delete'])
const ADMIN_ACTIONS = new Set<MemoryAuthorityAction>(['get', 'recall', 'list', 'upsert', 'append', 'delete', 'clear', 'export', 'import'])

export function durableMemoryLimits(overrides?: Partial<DurableMemoryLimits>): DurableMemoryLimits {
  const limits = { ...DEFAULT_DURABLE_MEMORY_LIMITS, ...(overrides || {}) }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new DurableMemoryStoreError('invalid_input', `Invalid durable memory limit: ${name}`)
  }
  return limits
}

export function canonicalMemoryScope(scope: MemoryScope): MemoryScope {
  if (scope?.kind === 'global') return { kind: 'global' }
  if (scope?.kind === 'project') return { kind: 'project', project: canonicalProjectId(scope.project) }
  throw new DurableMemoryStoreError('invalid_input', 'Unknown durable memory scope')
}

function authorizeRuntimeMemoryAccess(
  action: MemoryAuthorityAction,
  access: MemoryAccessContext,
  scope?: MemoryScope | { kind: 'all' },
): void {
  if (!RUNTIME_ACTIONS.has(action)) throw new DurableMemoryStoreError('forbidden', `Runtime memory ${action} is not allowed`)
  if (access.temporary) throw new DurableMemoryStoreError('forbidden', 'Temporary runs cannot access durable memory')
  if (READ_ACTIONS.has(action) && !access.memoryReadEnabled) throw new DurableMemoryStoreError('forbidden', 'Memory reads are disabled')
  if (WRITE_ACTIONS.has(action) && !access.memoryWriteEnabled) throw new DurableMemoryStoreError('forbidden', 'Memory writes are disabled')
  if (scope?.kind === 'all') throw new DurableMemoryStoreError('forbidden', 'Runtime cannot enumerate or clear every memory scope')
  if (scope?.kind === 'project' && (!access.canonicalProject || canonicalProjectId(access.canonicalProject) !== canonicalProjectId(scope.project))) {
    throw new DurableMemoryStoreError('forbidden', 'Runtime cannot access another project memory scope')
  }
}

function authorizeSpecialMemoryAccess(
  action: MemoryAuthorityAction,
  access: MemoryAccessContext,
  scope?: MemoryScope | { kind: 'all' },
): void {
  if (access.origin === 'admin') {
    if (!ADMIN_ACTIONS.has(action)) throw new DurableMemoryStoreError('forbidden', `Admin memory ${action} is not allowed`)
    return
  }
  if (access.origin === 'migration') {
    if (action !== 'import' && action !== 'migrate') throw new DurableMemoryStoreError('forbidden', `Migration memory ${action} is not allowed`)
    return
  }
  if (action !== 'consolidate') throw new DurableMemoryStoreError('forbidden', `Consolidation memory ${action} is not allowed`)
  if (scope?.kind === 'project' && (!access.canonicalProject || canonicalProjectId(access.canonicalProject) !== canonicalProjectId(scope.project))) {
    throw new DurableMemoryStoreError('forbidden', 'Consolidation cannot access another project memory scope')
  }
}

export function authorizeMemoryAccess(
  action: MemoryAuthorityAction,
  access: MemoryAccessContext,
  scope?: MemoryScope | { kind: 'all' },
): void {
  if (!access || !['runtime', 'admin', 'migration', 'consolidation'].includes(access.origin)) {
    throw new DurableMemoryStoreError('forbidden', 'Unknown durable memory origin')
  }
  validateMemoryAccessShape(access)
  if (access.origin === 'runtime') {
    authorizeRuntimeMemoryAccess(action, access, scope)
    return
  }
  authorizeSpecialMemoryAccess(action, access, scope)
}

function validateMemoryAccessShape(access: MemoryAccessContext): void {
  if ([access.memoryReadEnabled, access.memoryWriteEnabled, access.temporary].some((flag) => typeof flag !== 'boolean')) {
    throw new DurableMemoryStoreError('invalid_input', 'Memory access flags must be booleans')
  }
  for (const value of [access.canonicalProject, access.runId, access.sessionId, access.callId]) {
    if (value !== undefined && (typeof value !== 'string' || !value.trim() || hasControlCharacter(value))) {
      throw new DurableMemoryStoreError('invalid_input', 'Memory access identities must be non-empty strings without control characters')
    }
  }
}

const PROTECTED_MEMORY_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk-(?:ant-|proj-|live-)?|gh[pousr]_)[A-Za-z0-9_-]{12,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bauthorization["']?\s*:\s*["']?bearer\s+\S+/i,
  /\b(?:api[_-]?key|access[_-]?token|password|passwd|secret[_-]?key)\b["']?\s*[:=]\s*["']?\S+/i,
  /\b(?:postgres|mysql|mongodb|redis):\/\/[^\s]+/i,
]

export function rejectProtectedMemoryData(values: string[]): void {
  if (values.some((value) => PROTECTED_MEMORY_PATTERNS.some((pattern) => pattern.test(value)))) {
    throw new DurableMemoryStoreError('forbidden', 'Protected credential data cannot be persisted as durable memory')
  }
}

export function validateMemoryPage(limit: number | undefined, limits: DurableMemoryLimits): number {
  const value = limit === undefined ? 50 : limit
  if (!Number.isSafeInteger(value) || value < 1 || value > limits.maxPageSize) {
    throw new DurableMemoryStoreError('invalid_input', `Memory page size must be between 1 and ${limits.maxPageSize}`)
  }
  return value
}

export function validateMemoryCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  if (typeof cursor !== 'string' || !/^(0|[1-9]\d*)$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) {
    throw new DurableMemoryStoreError('invalid_input', 'Memory cursor must be a non-negative safe integer')
  }
  return Number(cursor)
}

export function validateMemoryKinds(kinds: DurableMemoryKind[] | undefined): DurableMemoryKind[] | undefined {
  if (kinds === undefined) return undefined
  if (!Array.isArray(kinds) || !kinds.length || kinds.some((kind) => !['memory', 'profile', 'document'].includes(kind))) {
    throw new DurableMemoryStoreError('invalid_input', 'Memory kinds must be a non-empty supported list')
  }
  return [...new Set(kinds)]
}

export function validateMemoryImport(input: MemoryImportInput, limits: DurableMemoryLimits): void {
  if (input.mode !== 'merge' && input.mode !== 'replace') throw new DurableMemoryStoreError('invalid_input', 'Unknown memory import mode')
  if (!input.bundle || input.bundle.version !== 1 || !Array.isArray(input.bundle.entries)) {
    throw new DurableMemoryStoreError('invalid_bundle', 'Unsupported durable memory bundle')
  }
  if (input.bundle.entries.length > limits.maxImportBatch) throw new DurableMemoryStoreError('invalid_input', `Memory import exceeds ${limits.maxImportBatch} entries`)
}

export function canonicalMemoryLogicalKey(value: string, limits: DurableMemoryLimits): string {
  if (typeof value !== 'string') throw new DurableMemoryStoreError('invalid_input', 'Memory logical key must be a string')
  const logicalKey = value.trim()
  if (!logicalKey || logicalKey.length > limits.maxLogicalKeyLength || hasControlCharacter(logicalKey)) {
    throw new DurableMemoryStoreError('invalid_input', `Memory logical key must be 1-${limits.maxLogicalKeyLength} safe characters`)
  }
  return logicalKey
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) || 0
    return code < 32 || code === 127
  })
}

export function memoryOperationIdentity(input: MemoryUpsertInput, mode: 'set' | 'append'): string | undefined {
  if (input.access.origin !== 'runtime') return input.access.callId ? JSON.stringify([input.access.origin, input.access.callId, mode, memoryScopeKey(input.scope), input.logicalKey]) : undefined
  const runId = input.access.runId?.trim()
  const callId = input.access.callId?.trim()
  if (!runId || !callId) throw new DurableMemoryStoreError('invalid_input', 'Runtime memory writes require runId and callId for idempotency')
  return JSON.stringify(['runtime', runId, callId, mode, memoryScopeKey(input.scope), input.logicalKey])
}

export function canonicalMemorySourceKeys(keys: string[], limits: DurableMemoryLimits): string[] {
  if (!Array.isArray(keys) || !keys.length || keys.length > limits.maxEntriesPerScope) {
    throw new DurableMemoryStoreError('invalid_input', 'Consolidation requires a bounded non-empty source list')
  }
  return [...new Set(keys.map((key) => canonicalMemoryLogicalKey(key, limits)))]
}

export function memoryOperationPayload(input: MemoryEntryDraft): string {
  return JSON.stringify({
    scope: memoryScopeKey(input.scope), logicalKey: input.logicalKey, kind: input.kind,
    text: input.text, tags: input.tags, createdAt: input.createdAt,
  })
}

const DREAM_DUP_THRESHOLD = 0.85
const DREAM_MIN_CANDIDATES = 3
const DREAM_MERGE_WHEN_OVER = 24
const DREAM_MERGE_BATCH = 12
const DREAM_MAX_CANDIDATES = 64

function dreamSimilarity(left: string, right: string): number {
  const terms = (value: string) => new Set(value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [])
  const a = terms(left)
  const b = terms(right)
  if (!a.size && !b.size) return 1
  let overlap = 0
  for (const term of a) if (b.has(term)) overlap += 1
  return overlap / Math.max(1, a.size + b.size - overlap)
}

export type MemoryDreamPlan = {
  duplicateKeys: string[]
  mergeKeys: string[]
  merged?: MemoryEntryDraft
}

export function planDreamConsolidation(
  entries: Iterable<DurableMemoryEntry>,
  scope: MemoryScope,
  operationId: string,
  force = false,
): MemoryDreamPlan {
  const candidates = [...entries]
    .filter((entry) => memoryScopeKey(entry.scope) === memoryScopeKey(scope))
    .filter((entry) => entry.kind === 'memory' && entry.tags.some((tag) => tag === 'auto' || tag === 'flush') && !entry.tags.includes('dream'))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.logicalKey.localeCompare(right.logicalKey))
    .slice(0, DREAM_MAX_CANDIDATES)
  if (!force && candidates.length < DREAM_MIN_CANDIDATES) return { duplicateKeys: [], mergeKeys: [] }
  const duplicateKeys: string[] = []
  for (let left = 0; left < candidates.length; left += 1) {
    if (duplicateKeys.includes(candidates[left].logicalKey)) continue
    for (let right = left + 1; right < candidates.length; right += 1) {
      if (duplicateKeys.includes(candidates[right].logicalKey)) continue
      if (dreamSimilarity(candidates[left].text, candidates[right].text) >= DREAM_DUP_THRESHOLD) {
        duplicateKeys.push(candidates[right].logicalKey)
      }
    }
  }
  const remaining = candidates.filter((entry) => !duplicateKeys.includes(entry.logicalKey))
  const mergeEntries = remaining.length > DREAM_MERGE_WHEN_OVER ? remaining.slice(0, DREAM_MERGE_BATCH) : []
  if (!mergeEntries.length) return { duplicateKeys, mergeKeys: [] }
  const digest = createHash('sha256').update(operationId).digest('hex').slice(0, 20)
  const createdAt = mergeEntries.at(-1)?.createdAt || new Date(0).toISOString()
  return {
    duplicateKeys,
    mergeKeys: mergeEntries.map((entry) => entry.logicalKey),
    merged: {
      scope,
      logicalKey: `dream:${digest}`,
      kind: 'memory',
      text: `記憶整併（dream）：\n${mergeEntries.map((entry) => `- ${entry.text}`).join('\n').slice(0, 30_000)}`,
      tags: ['auto', 'dream'],
      createdAt,
    },
  }
}

export function appendMemoryDraft(existing: DurableMemoryEntry | undefined, input: MemoryEntryDraft): MemoryEntryDraft {
  if (!existing) return input
  if (existing.kind !== input.kind) throw new DurableMemoryStoreError('invalid_input', 'Append kind must match the existing memory')
  return {
    ...input,
    text: `${existing.text}\n${input.text}`,
    tags: [...new Set([...existing.tags, ...input.tags])],
    createdAt: input.createdAt,
  } as MemoryEntryDraft
}

export function assertMemoryQuota(
  entries: Iterable<DurableMemoryEntry>,
  scope: MemoryScope,
  logicalKey: string,
  limits: DurableMemoryLimits,
): void {
  const inScope = [...entries].filter((entry) => memoryScopeKey(entry.scope) === memoryScopeKey(scope))
  if (!inScope.some((entry) => entry.logicalKey === logicalKey) && inScope.length >= limits.maxEntriesPerScope) {
    throw new DurableMemoryStoreError('quota_exceeded', `Memory scope quota of ${limits.maxEntriesPerScope} entries exceeded`)
  }
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

export function memoryScopeKey(scope: MemoryScope): string {
  return scope.kind === 'global' ? 'global' : `project:${scope.project}`
}

function entryKey(scope: MemoryScope, logicalKey: string): string {
  return `${memoryScopeKey(scope)}\u0000${logicalKey}`
}

export function validateMemoryMigration(input: MemoryMigrationInput, limits: DurableMemoryLimits): void {
  authorizeMemoryAccess('migrate', input.access)
  if (typeof input.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.sourceHash) || ![1, 2].includes(input.sourceSchema)) {
    throw new DurableMemoryStoreError('invalid_input', 'Memory migration requires a SHA-256 source hash and supported source schema')
  }
  if (!Array.isArray(input.memories) || input.memories.length > limits.maxImportBatch) {
    throw new DurableMemoryStoreError('invalid_input', 'Legacy memory migration exceeds the import batch limit')
  }
}

function legacyMemoryDraft(value: unknown, limits: DurableMemoryLimits): MemoryEntryDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DurableMemoryStoreError('invalid_input', 'Invalid legacy memory row')
  const row = value as Record<string, unknown>
  const logicalKey = canonicalMemoryLogicalKey(row.id as string, limits)
  const scope: MemoryScope = row.project === undefined || row.project === ''
    ? { kind: 'global' }
    : { kind: 'project', project: canonicalProjectId(row.project as string) }
  const kind = scope.kind === 'global' && logicalKey === 'profile:user' ? 'profile'
    : scope.kind === 'global' && logicalKey === 'memory:document' ? 'document' : 'memory'
  return canonicalMemoryDraft({ scope, logicalKey, kind, text: row.text, tags: row.tags, createdAt: row.createdAt } as MemoryEntryDraft, limits)
}

/** Stage rows before any mutation. Reports identify source indexes, never copy private content. */
export function prepareLegacyMemoryMigration(
  input: MemoryMigrationInput,
  existing: Iterable<DurableMemoryEntry>,
  limits: DurableMemoryLimits,
): { drafts: MemoryEntryDraft[]; rejected: MemoryMigrationReport['rejected'] } {
  validateMemoryMigration(input, limits)
  const rejected: MemoryMigrationReport['rejected'] = []
  const candidates = new Map<string, { draft: MemoryEntryDraft; index: number }>()
  input.memories.forEach((row, index) => {
    try {
      const draft = legacyMemoryDraft(row, limits)
      const key = entryKey(draft.scope, draft.logicalKey)
      const prior = candidates.get(key)
      if (prior) rejected.push({ index: prior.index, code: 'duplicate_key' })
      candidates.delete(key)
      candidates.set(key, { draft, index })
    } catch (error) {
      if (!(error instanceof DurableMemoryStoreError)) throw error
      rejected.push({ index, code: error.code })
    }
  })
  const projected = new Map([...existing].map((entry) => [entryKey(entry.scope, entry.logicalKey), entry]))
  const drafts: MemoryEntryDraft[] = []
  for (const [key, { draft, index }] of candidates) {
    if (projected.has(key)) { rejected.push({ index, code: 'existing_entry' }); continue }
    try {
      assertMemoryQuota(projected.values(), draft.scope, draft.logicalKey, limits)
      projected.set(key, { ...draft, id: 'migration-preview', updatedAt: draft.createdAt, revision: 0 })
      drafts.push(draft)
    } catch (error) {
      if (!(error instanceof DurableMemoryStoreError)) throw error
      rejected.push({ index, code: error.code })
    }
  }
  return { drafts, rejected: rejected.sort((left, right) => left.index - right.index) }
}

export function replayMemoryMigration(report: MemoryMigrationReport, sourceHash: string): MemoryMigrationResult {
  if (report.sourceHash !== sourceHash) throw new DurableMemoryStoreError('invalid_input', 'Legacy memory source changed after migration; restore the matching backup before retrying')
  return { alreadyApplied: true, report: structuredClone(report) }
}

function cloneScope(scope: MemoryScope): MemoryScope {
  return scope.kind === 'global' ? { kind: 'global' } : { kind: 'project', project: scope.project }
}

function cloneEntry(entry: DurableMemoryEntry): DurableMemoryEntry {
  return { ...entry, scope: cloneScope(entry.scope), tags: [...entry.tags] }
}

function visibleToAccess(entry: DurableMemoryEntry, access: MemoryAccessContext): boolean {
  if (access.origin === 'admin') return true
  return entry.scope.kind === 'global'
    || (access.canonicalProject !== undefined && entry.scope.project === canonicalProjectId(access.canonicalProject))
}

export function selectVisibleMemoryEntries(
  entries: Iterable<DurableMemoryEntry>,
  access: MemoryAccessContext,
  requestedScope?: MemoryScope,
): DurableMemoryEntry[] {
  return [...entries].filter((entry) => requestedScope
    ? memoryScopeKey(entry.scope) === memoryScopeKey(requestedScope)
    : visibleToAccess(entry, access))
}

export function canonicalMemoryDraft(
  input: MemoryEntryDraft,
  limits: DurableMemoryLimits = DEFAULT_DURABLE_MEMORY_LIMITS,
): MemoryEntryDraft {
  validateMemoryDraftShape(input)
  const scope = canonicalMemoryScope(input.scope)
  const logicalKey = canonicalMemoryLogicalKey(input.logicalKey, limits)
  const text = input.text
  const specialTags = input.kind === 'memory' ? [] : [input.kind === 'profile' ? 'profile:user' : 'memory:document', 'always-recall']
  const tags = [...new Set([...input.tags.map((tag) => tag.trim()).filter(Boolean), ...specialTags])]
  if (!text.trim() || text.length > limits.maxTextLength) throw new DurableMemoryStoreError('invalid_input', `Memory text must be 1-${limits.maxTextLength} characters`)
  if (tags.length > limits.maxTags || tags.some((tag) => tag.length > limits.maxTagLength || hasControlCharacter(tag))) {
    throw new DurableMemoryStoreError('invalid_input', `Memory tags exceed the ${limits.maxTags} × ${limits.maxTagLength} limit`)
  }
  if (!Number.isFinite(Date.parse(input.createdAt)) || new Date(input.createdAt).toISOString() !== input.createdAt) {
    throw new DurableMemoryStoreError('invalid_input', 'Memory createdAt must be a canonical ISO timestamp')
  }
  rejectProtectedMemoryData([logicalKey, text, ...tags])
  if (input.kind === 'memory') {
    if (scope.kind === 'global' && (logicalKey === 'profile:user' || logicalKey === 'memory:document')) {
      throw new DurableMemoryStoreError('invalid_input', `${logicalKey} is reserved for its global special memory kind`)
    }
    return { ...input, scope, logicalKey, text, tags }
  }
  const expectedKey = input.kind === 'profile' ? 'profile:user' : 'memory:document'
  if (scope.kind !== 'global' || logicalKey !== expectedKey) {
    throw new DurableMemoryStoreError('invalid_input', `${input.kind} memory must use global scope and key ${expectedKey}`)
  }
  return { ...input, scope: { kind: 'global' }, logicalKey: expectedKey, text, tags } as MemoryEntryDraft
}

function validateMemoryDraftShape(input: MemoryEntryDraft): void {
  if (!input || typeof input !== 'object' || !['memory', 'profile', 'document'].includes(input.kind)) {
    throw new DurableMemoryStoreError('invalid_input', 'Unknown memory entry kind')
  }
  if (typeof input.text !== 'string' || typeof input.createdAt !== 'string') {
    throw new DurableMemoryStoreError('invalid_input', 'Memory text and timestamp must be strings')
  }
  if (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== 'string')) {
    throw new DurableMemoryStoreError('invalid_input', 'Memory tags must be an array of strings')
  }
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

export function recallMemoryEntries(
  entries: Iterable<DurableMemoryEntry>,
  input: MemoryRecallInput,
): MemoryRecallItem[] {
  const queryTerms = terms(input.query)
  return selectVisibleMemoryEntries(entries, input.access)
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
}

export class InMemoryDurableMemoryStore implements DurableMemoryStore {
  private readonly entries = new Map<string, DurableMemoryEntry>()
  private readonly operations = new Map<string, { hash: string; entryId: string }>()
  private readonly dreamOperations = new Map<string, { payload: string; result: MemoryDreamConsolidationResult }>()
  private readonly limits: DurableMemoryLimits
  private nextIdentity = 1
  private currentRevision = 0
  private migrationReport?: MemoryMigrationReport
  private closed = false

  constructor(limits?: Partial<DurableMemoryLimits>) {
    this.limits = durableMemoryLimits(limits)
  }

  private ensureOpen(): void {
    if (this.closed) throw new DurableMemoryStoreError('closed', 'Durable memory store is closed')
  }

  private idempotentResult(operationId: string | undefined, payload: string): DurableMemoryEntry | undefined {
    const prior = operationId ? this.operations.get(operationId) : undefined
    if (!prior) return undefined
    if (prior.hash !== createHash('sha256').update(payload).digest('hex')) {
      throw new DurableMemoryStoreError('invalid_input', 'Idempotency operation was retried with different memory content')
    }
    const entry = [...this.entries.values()].find((candidate) => candidate.id === prior.entryId)
    if (!entry) throw new DurableMemoryStoreError('not_found', 'Idempotent memory result no longer exists')
    return cloneEntry(entry)
  }

  private nextEntry(input: MemoryEntryDraft, revision: number, replacingSource = false): DurableMemoryEntry {
    const draft = canonicalMemoryDraft(input, this.limits)
    const key = entryKey(draft.scope, draft.logicalKey)
    const existing = replacingSource ? undefined : this.entries.get(key)
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
    const draft = canonicalMemoryDraft(input, this.limits)
    authorizeMemoryAccess('upsert', input.access, draft.scope)
    const operationId = memoryOperationIdentity({ ...input, ...draft }, 'set')
    const payload = memoryOperationPayload(draft)
    const prior = this.idempotentResult(operationId, payload)
    if (prior) return prior
    assertMemoryQuota(this.entries.values(), draft.scope, draft.logicalKey, this.limits)
    const key = entryKey(draft.scope, draft.logicalKey)
    const revision = ++this.currentRevision
    const entry = this.nextEntry(draft, revision)
    this.entries.set(key, entry)
    if (operationId) this.operations.set(operationId, { hash: createHash('sha256').update(payload).digest('hex'), entryId: entry.id })
    return cloneEntry(entry)
  }

  async append(input: MemoryAppendInput): Promise<DurableMemoryEntry> {
    this.ensureOpen()
    const fragment = canonicalMemoryDraft(input, this.limits)
    authorizeMemoryAccess('append', input.access, fragment.scope)
    const operationId = memoryOperationIdentity({ ...input, ...fragment }, 'append')
    const payload = memoryOperationPayload(fragment)
    const prior = this.idempotentResult(operationId, payload)
    if (prior) return prior
    assertMemoryQuota(this.entries.values(), fragment.scope, fragment.logicalKey, this.limits)
    const draft = canonicalMemoryDraft(appendMemoryDraft(this.entries.get(entryKey(fragment.scope, fragment.logicalKey)), fragment), this.limits)
    const revision = ++this.currentRevision
    const entry = this.nextEntry(draft, revision)
    this.entries.set(entryKey(draft.scope, draft.logicalKey), entry)
    if (operationId) this.operations.set(operationId, { hash: createHash('sha256').update(payload).digest('hex'), entryId: entry.id })
    return cloneEntry(entry)
  }

  async get(input: MemoryGetInput): Promise<DurableMemoryEntry | undefined> {
    this.ensureOpen()
    const scope = canonicalMemoryScope(input.scope)
    authorizeMemoryAccess('get', input.access, scope)
    const found = this.entries.get(entryKey(scope, canonicalMemoryLogicalKey(input.logicalKey, this.limits)))
    return found ? cloneEntry(found) : undefined
  }

  async recall(input: MemoryRecallInput): Promise<MemoryRecallResult> {
    this.ensureOpen()
    authorizeMemoryAccess('recall', input.access)
    if (typeof input.query !== 'string' || input.query.length > this.limits.maxTextLength) throw new DurableMemoryStoreError('invalid_input', 'Memory recall query is invalid')
    if (input.limit !== undefined) validateMemoryPage(input.limit, this.limits)
    return { items: recallMemoryEntries(this.entries.values(), input), revision: this.currentRevision }
  }

  async list(input: MemoryListInput): Promise<MemoryPage> {
    this.ensureOpen()
    const scope = input.scope ? canonicalMemoryScope(input.scope) : undefined
    authorizeMemoryAccess('list', input.access, scope)
    const kinds = validateMemoryKinds(input.kinds)
    const all = selectVisibleMemoryEntries(this.entries.values(), input.access, scope)
      .filter((entry) => !kinds || kinds.includes(entry.kind))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    const offset = validateMemoryCursor(input.cursor)
    const limit = validateMemoryPage(input.limit, this.limits)
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
    const scope = canonicalMemoryScope(input.scope)
    authorizeMemoryAccess('delete', input.access, scope)
    const changed = this.entries.delete(entryKey(scope, canonicalMemoryLogicalKey(input.logicalKey, this.limits))) ? 1 : 0
    if (changed) this.currentRevision += 1
    return { changed, revision: this.currentRevision }
  }

  async clear(input: MemoryClearInput): Promise<MemoryMutationResult> {
    this.ensureOpen()
    const scope = input.scope.kind === 'all' ? input.scope : canonicalMemoryScope(input.scope)
    authorizeMemoryAccess('clear', input.access, scope)
    let changed = 0
    for (const [key, entry] of this.entries) {
      if (scope.kind !== 'all' && memoryScopeKey(entry.scope) !== memoryScopeKey(scope)) continue
      if (input.includeSpecial === false && entry.kind !== 'memory') continue
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

  async deletionCapability(): Promise<MemoryDeletionCapability> {
    this.ensureOpen()
    return {
      mode: 'not-applicable',
      secureDelete: false,
      walCheckpoint: 'not-applicable',
      limitations: ['In-memory storage has no SQLite pages, WAL, backups, or filesystem snapshots.'],
    }
  }

  async consolidate(input: MemoryConsolidateInput): Promise<MemoryConsolidationResult> {
    this.ensureOpen()
    const scope = canonicalMemoryScope(input.scope)
    authorizeMemoryAccess('consolidate', input.access, scope)
    const sourceKeys = canonicalMemorySourceKeys(input.sourceKeys, this.limits)
    const missing = sourceKeys.find((logicalKey) => !this.entries.has(entryKey(scope, logicalKey)))
    if (missing) throw new DurableMemoryStoreError('not_found', `Memory source not found: ${missing}`)
    const revision = this.currentRevision + 1
    const draft = canonicalMemoryDraft({ ...input.merged, scope }, this.limits)
    const entry = this.nextEntry(draft, revision, sourceKeys.includes(draft.logicalKey))
    let changed = 0
    for (const logicalKey of sourceKeys) {
      if (this.entries.delete(entryKey(scope, logicalKey))) changed += 1
    }
    this.entries.set(entryKey(entry.scope, entry.logicalKey), entry)
    this.currentRevision = revision
    return { changed: changed + 1, revision, entry: cloneEntry(entry) }
  }

  async consolidateDream(input: MemoryDreamConsolidateInput): Promise<MemoryDreamConsolidationResult> {
    this.ensureOpen()
    const scope = canonicalMemoryScope(input.scope)
    authorizeMemoryAccess('consolidate', input.access, scope)
    const operationId = canonicalMemoryLogicalKey(input.operationId, this.limits)
    const payload = JSON.stringify(['dream-v1', memoryScopeKey(scope), operationId, Boolean(input.force)])
    const prior = this.dreamOperations.get(operationId)
    if (prior) {
      if (prior.payload !== payload) throw new DurableMemoryStoreError('invalid_input', 'Dream operation identity was retried with different scope or policy')
      return { ...structuredClone(prior.result), changed: 0, alreadyApplied: true }
    }
    const plan = planDreamConsolidation(this.entries.values(), scope, operationId, input.force)
    if (input.faultAt === 'after-source-read') throw new DurableMemoryStoreError('unavailable', 'Injected dream fault after source read')
    const draftEntries = new Map(this.entries)
    for (const logicalKey of [...plan.duplicateKeys, ...plan.mergeKeys]) draftEntries.delete(entryKey(scope, logicalKey))
    if (input.faultAt === 'after-source-delete') throw new DurableMemoryStoreError('unavailable', 'Injected dream fault after source delete')
    const changedSources = new Set([...plan.duplicateKeys, ...plan.mergeKeys]).size
    const revision = changedSources || plan.merged ? this.currentRevision + 1 : this.currentRevision
    let entry: DurableMemoryEntry | undefined
    const nextIdentityBefore = this.nextIdentity
    if (plan.merged) {
      entry = this.nextEntry(plan.merged, revision)
      draftEntries.set(entryKey(scope, entry.logicalKey), entry)
    }
    if (input.faultAt === 'after-merged-write') {
      this.nextIdentity = nextIdentityBefore
      throw new DurableMemoryStoreError('unavailable', 'Injected dream fault after merged write')
    }
    this.entries.clear()
    for (const [key, value] of draftEntries) this.entries.set(key, value)
    this.currentRevision = revision
    const result: MemoryDreamConsolidationResult = {
      changed: changedSources + Number(Boolean(entry)), revision,
      deduped: [...plan.duplicateKeys], merged: plan.mergeKeys.length,
      alreadyApplied: false, ...(entry ? { entry: cloneEntry(entry) } : {}),
    }
    this.dreamOperations.set(operationId, { payload, result: structuredClone(result) })
    return result
  }

  async exportBundle(input: MemoryExportInput): Promise<DurableMemoryBundle> {
    this.ensureOpen()
    const scope = input.scope ? canonicalMemoryScope(input.scope) : undefined
    authorizeMemoryAccess('export', input.access, scope)
    const entries = selectVisibleMemoryEntries(this.entries.values(), input.access, scope)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(cloneEntry)
    return { version: 1, revision: this.currentRevision, entries }
  }

  async importBundle(input: MemoryImportInput): Promise<MemoryMutationResult> {
    this.ensureOpen()
    authorizeMemoryAccess('import', input.access)
    validateMemoryImport(input, this.limits)
    const drafts = input.bundle.entries.map((candidate) => canonicalMemoryDraft(candidate as MemoryEntryDraft, this.limits))
    const projected = new Map(input.mode === 'replace' ? [] : this.entries)
    for (const draft of drafts) {
      assertMemoryQuota(projected.values(), draft.scope, draft.logicalKey, this.limits)
      projected.set(entryKey(draft.scope, draft.logicalKey), { ...draft, id: 'quota-preview', updatedAt: draft.createdAt, revision: 0 })
    }
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

  async migrationStatus(): Promise<MemoryMigrationReport | undefined> {
    this.ensureOpen()
    return this.migrationReport ? structuredClone(this.migrationReport) : undefined
  }

  async migrateLegacy(input: MemoryMigrationInput): Promise<MemoryMigrationResult> {
    this.ensureOpen()
    validateMemoryMigration(input, this.limits)
    if (this.migrationReport) return replayMemoryMigration(this.migrationReport, input.sourceHash)
    const { drafts, rejected } = prepareLegacyMemoryMigration(input, this.entries.values(), this.limits)
    const revision = this.currentRevision + (drafts.length ? 1 : 0)
    for (const draft of drafts) {
      const entry = this.nextEntry(draft, revision)
      this.entries.set(entryKey(entry.scope, entry.logicalKey), entry)
    }
    this.currentRevision = revision
    this.migrationReport = { version: 1, sourceHash: input.sourceHash, sourceSchema: input.sourceSchema, imported: drafts.length, rejected, revision }
    return { alreadyApplied: false, report: structuredClone(this.migrationReport) }
  }
}
