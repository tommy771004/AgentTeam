import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { MemoryStorageLifecycleError, storageLifecycleError } from './memoryStorageLifecycle.ts'
import {
  planMemoryImport, checkedMemoryImportPlan, memoryImportOperationKey, memoryImportRequestHash, replayMemoryImport,
  type MemoryImportPreviewInput, type MemoryImportPreview, type MemoryImportApplyInput, type MemoryImportResult, type MemoryImportReceipt, type MemoryImportTestHooks,
} from './durableMemoryImport.ts'
import {
  appendMemoryDraft,
  assertMemoryQuota,
  authorizeMemoryAccess,
  canonicalMemoryDraft,
  canonicalMemoryLogicalKey,
  canonicalMemoryScope,
  canonicalMemorySourceKeys,
  durableMemoryBundle,
  durableMemoryLimits,
  durableMemoryProvenance,
  DurableMemoryStoreError,
  memoryOperationIdentity,
  memoryOperationPayload,
  memoryScopeKey,
  planDreamConsolidation,
  parseDurableMemoryProvenance,
  recallMemoryEntries,
  prepareLegacyMemoryMigration,
  replayMemoryMigration,
  selectVisibleMemoryEntries,
  validateMemoryCursor,
  validateMemoryExportBundle,
  validateMemoryImport,
  validateMemoryKinds,
  validateMemoryMigration,
  validateMemoryPage,
  type DurableMemoryBundle,
  type DurableMemoryEntry,
  type DurableMemoryExportEntry,
  type DurableMemoryLimits,
  type DurableMemoryProvenance,
  type DurableMemoryStore,
  type MemoryAccessContext,
  type MemoryAppendInput,
  type MemoryClearInput,
  type MemoryConsolidateInput,
  type MemoryConsolidationResult,
  type MemoryDeleteInput,
  type MemoryDeletionCapability,
  type MemoryDreamConsolidateInput,
  type MemoryDreamConsolidationResult,
  type MemoryEntryDraft,
  type MemoryExportInput,
  type MemoryGetInput,
  type MemoryHealth,
  type MemoryImportInput,
  type MemoryListInput,
  type MemoryMutationResult,
  type MemoryMigrationInput,
  type MemoryMigrationReport,
  type MemoryMigrationResult,
  type MemoryPage,
  type MemoryRecallInput,
  type MemoryRecallResult,
  type MemoryScope,
  type MemoryUpsertInput,
} from './durableMemoryStore.ts'

const SCHEMA_VERSION = 2
const BUSY_TIMEOUT_MS = 5_000
const SHUTDOWN_TIMEOUT_MS = 5_000
const REQUIRED_TABLES = ['memory_entries', 'memory_meta', 'memory_operations', 'memory_schema_migrations', 'memory_tags'] as const

export type SqliteDurableMemoryTestHooks = MemoryImportTestHooks & {
  afterExportEntriesRead?: () => void | Promise<void>
  beforeWrite?: () => void | Promise<void>
  /** Opens a deterministic contention window after mutation but before COMMIT. */
  beforeCommitWrite?: () => void | Promise<void>
  /** Test-only override; production always uses the five-second busy timeout. */
  busyTimeoutMs?: number
}

type EntryRow = {
  id: string
  scope_kind: 'global' | 'project'
  project_id: string
  logical_key: string
  kind: DurableMemoryEntry['kind']
  text: string
  created_at: string
  updated_at: string
  revision: number
}

type TagRow = { memory_id: string; tag: string; position: number }
type ProvenanceRow = { id: string; provenance_json: string; operation: string }

function scopeColumns(scope: MemoryScope): { kind: 'global' | 'project'; project: string } {
  return scope.kind === 'global'
    ? { kind: 'global', project: '' }
    : { kind: 'project', project: scope.project }
}

function contentHash(entry: Omit<DurableMemoryEntry, 'id' | 'revision'>): string {
  return createHash('sha256').update(JSON.stringify({
    scope: memoryScopeKey(entry.scope),
    logicalKey: entry.logicalKey,
    kind: entry.kind,
    text: entry.text,
    tags: entry.tags,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  })).digest('hex')
}

function provenance(access: MemoryAccessContext): string {
  const { operation: _operation, ...identity } = durableMemoryProvenance(access, 'stored-separately')
  return JSON.stringify({
    ...identity,
    temporary: access.temporary,
  })
}

/**
 * Host-only SQLite implementation of the DurableMemoryStore seam.
 *
 * Database handles never cross the protocol boundary. Synchronous node:sqlite
 * calls are wrapped in an async contract, and every mutation enters the same
 * BEGIN IMMEDIATE queue so acknowledgement cannot precede commit.
 */
export class SqliteDurableMemoryStore implements DurableMemoryStore {
  private readonly db: DatabaseSync
  private readonly limits: DurableMemoryLimits
  private readonly afterExportEntriesRead?: () => void | Promise<void>
  private readonly importTestHooks?: MemoryImportTestHooks
  private readonly beforeWrite?: () => void | Promise<void>
  private readonly beforeCommitWrite?: () => void | Promise<void>
  private readonly busyTimeoutMs: number
  private writeTail: Promise<void> = Promise.resolve()
  private lifecycle: 'open' | 'closing' | 'closed' = 'open'
  private closedRevision = 0
  private walCheckpoint: MemoryDeletionCapability['walCheckpoint'] = 'unavailable'

  private constructor(
    databasePath: string,
    limits?: Partial<DurableMemoryLimits>,
    testHooks?: SqliteDurableMemoryTestHooks,
  ) {
    try {
      this.db = new DatabaseSync(databasePath)
    } catch (error) {
      throw storageLifecycleError(error, 'storage_unavailable', '無法開啟長期記憶資料庫；未建立替代 authority。')
    }
    this.limits = durableMemoryLimits(limits)
    this.afterExportEntriesRead = testHooks?.afterExportEntriesRead
    this.importTestHooks = testHooks
    this.beforeWrite = testHooks?.beforeWrite
    this.beforeCommitWrite = testHooks?.beforeCommitWrite
    this.busyTimeoutMs = Number.isSafeInteger(testHooks?.busyTimeoutMs) && Number(testHooks?.busyTimeoutMs) >= 1
      ? Number(testHooks?.busyTimeoutMs)
      : BUSY_TIMEOUT_MS
    try {
      // Contention policy must exist before integrity/schema reads; two Host
      // processes can legitimately overlap startup against the same WAL DB.
      this.db.exec(`PRAGMA busy_timeout = ${this.busyTimeoutMs}`)
      this.preflight()
      this.migrate()
      this.validateSchema()
    } catch (error) {
      try { this.db.close() } catch { /* preserve validation failure */ }
      throw storageLifecycleError(error, 'migration_failure', '長期記憶 schema migration 失敗；未覆寫原資料。')
    }
  }

  static async open(
    databasePath: string,
    limits?: Partial<DurableMemoryLimits>,
    testHooks?: SqliteDurableMemoryTestHooks,
  ): Promise<SqliteDurableMemoryStore> {
    return new SqliteDurableMemoryStore(databasePath, limits, testHooks)
  }

  private migrate(): void {
    const latest = this.latestSchemaVersion()
    if (latest > SCHEMA_VERSION) {
      throw new MemoryStorageLifecycleError(
        'unsupported_schema',
        `長期記憶 schema v${latest} 高於此版本支援的 v${SCHEMA_VERSION}；請使用相容版本或先由相容版本明確匯出。`,
        { recovery: 'use-compatible-version' },
      )
    }
    if (latest > 0) {
      this.assertRequiredTables()
      this.assertSchemaColumns(latest)
    }
    this.db.exec(`PRAGMA busy_timeout = ${this.busyTimeoutMs}; PRAGMA foreign_keys = ON;`)
    if (latest < 1) {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.exec(`
          CREATE TABLE memory_schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
          CREATE TABLE memory_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE memory_entries(
            id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'project')),
            project_id TEXT NOT NULL DEFAULT '', logical_key TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('memory', 'profile', 'document')), text TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
            content_hash TEXT NOT NULL, provenance_json TEXT NOT NULL, operation TEXT NOT NULL,
            migration_version INTEGER NOT NULL, UNIQUE (scope_kind, project_id, logical_key)
          );
          CREATE TABLE memory_tags(
            memory_id TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
            position INTEGER NOT NULL, tag TEXT NOT NULL, normalized_tag TEXT NOT NULL,
            PRIMARY KEY (memory_id, position)
          );
          CREATE INDEX memory_tags_normalized_idx ON memory_tags(normalized_tag);
          CREATE TABLE memory_operations(
            sequence INTEGER PRIMARY KEY AUTOINCREMENT, revision INTEGER NOT NULL, operation TEXT NOT NULL,
            scope_kind TEXT, project_id TEXT, logical_key TEXT, content_hash TEXT,
            provenance_json TEXT NOT NULL, migration_version INTEGER NOT NULL, committed_at TEXT NOT NULL
          );
        `)
        this.db.prepare('INSERT INTO memory_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
          .run(1, 'initial-durable-memory-schema', new Date().toISOString())
        this.db.prepare("INSERT OR IGNORE INTO memory_meta(key, value) VALUES ('revision', '0'), ('next_identity', '1')").run()
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
    if (latest < 2) {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.exec(`
          ALTER TABLE memory_operations ADD COLUMN operation_id TEXT;
          ALTER TABLE memory_operations ADD COLUMN operation_hash TEXT;
          ALTER TABLE memory_operations ADD COLUMN result_entry_id TEXT;
          ALTER TABLE memory_operations ADD COLUMN result_revision INTEGER;
          CREATE UNIQUE INDEX memory_operations_operation_id_idx
            ON memory_operations(operation_id) WHERE operation_id IS NOT NULL;
        `)
        this.db.prepare('INSERT INTO memory_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
          .run(2, 'authority-policy-and-idempotency', new Date().toISOString())
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA secure_delete = ON;')
  }

  private assertSchemaColumns(version: number): void {
    const columns = (table: string) => new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name))
    const entries = columns('memory_entries')
    const operations = columns('memory_operations')
    const requiredEntries = ['id', 'scope_kind', 'project_id', 'logical_key', 'kind', 'text', 'created_at', 'updated_at', 'revision', 'content_hash', 'provenance_json', 'operation', 'migration_version']
    const requiredOperations = ['sequence', 'revision', 'operation', 'scope_kind', 'project_id', 'logical_key', 'content_hash', 'provenance_json', 'migration_version', 'committed_at']
    const missing = [...requiredEntries.filter((name) => !entries.has(name)), ...requiredOperations.filter((name) => !operations.has(name))]
    const v2Columns = ['operation_id', 'operation_hash', 'result_entry_id', 'result_revision']
    if (version >= 2) missing.push(...v2Columns.filter((name) => !operations.has(name)))
    if (version === 1 && v2Columns.some((name) => operations.has(name))) missing.push('inconsistent-v1-operation-columns')
    if (missing.length) throw new MemoryStorageLifecycleError('migration_failure', `長期記憶 schema columns 不一致：${missing.join(', ')}`)
  }

  private preflight(): void {
    let row: { integrity_check?: string } | undefined
    try {
      row = this.db.prepare('PRAGMA integrity_check(1)').get() as { integrity_check?: string } | undefined
    } catch (error) {
      throw new MemoryStorageLifecycleError(
        'sqlite_integrity_failure',
        '長期記憶 SQLite integrity check 無法完成；未清空或取代原資料。',
        { cause: error },
      )
    }
    if (row?.integrity_check !== 'ok') {
      throw new MemoryStorageLifecycleError(
        'sqlite_integrity_failure',
        `長期記憶 SQLite integrity check 失敗：${String(row?.integrity_check || 'unknown')}`,
      )
    }
    const latest = this.latestSchemaVersion()
    if (latest > SCHEMA_VERSION) {
      throw new MemoryStorageLifecycleError(
        'unsupported_schema',
        `長期記憶 schema v${latest} 高於此版本支援的 v${SCHEMA_VERSION}；請使用相容版本或先由相容版本明確匯出。`,
        { recovery: 'use-compatible-version' },
      )
    }
  }

  private latestSchemaVersion(): number {
    const table = this.db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'memory_schema_migrations'").get() as { present?: number } | undefined
    if (!table) return 0
    const row = this.db.prepare('SELECT MAX(version) AS version FROM memory_schema_migrations').get() as { version?: number | null } | undefined
    return Number(row?.version || 0)
  }

  private validateSchema(): void {
    this.assertRequiredTables()
    if (this.db.prepare('PRAGMA foreign_key_check').all().length) {
      throw new MemoryStorageLifecycleError('sqlite_integrity_failure', '長期記憶 SQLite foreign key integrity check 失敗。')
    }
  }

  private assertRequiredTables(): void {
    const rows = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    const present = new Set(rows.map((row) => row.name))
    const missing = REQUIRED_TABLES.filter((name) => !present.has(name))
    if (missing.length) {
      throw new MemoryStorageLifecycleError('migration_failure', `長期記憶 schema 不完整：缺少 ${missing.join(', ')}`)
    }
  }

  private ensureOpen(): void {
    if (this.lifecycle !== 'open') throw new DurableMemoryStoreError('closed', `Durable memory store is ${this.lifecycle}`)
  }

  private async settleWrites(): Promise<void> {
    await this.writeTail
    this.ensureOpen()
  }

  private enqueueWrite<T>(operation: () => T, afterCommit?: (value: T) => void): Promise<T> {
    if (this.lifecycle !== 'open') return Promise.reject(new DurableMemoryStoreError('closed', `Durable memory store is ${this.lifecycle}`))
    const result = this.writeTail.then(async () => {
      await this.beforeWrite?.()
      if (this.lifecycle === 'closed') throw new DurableMemoryStoreError('closed', 'Durable memory store is closed')
      let began = false
      try {
        this.db.exec('BEGIN IMMEDIATE')
        began = true
        const value = operation()
        await this.beforeCommitWrite?.()
        this.db.exec('COMMIT')
        afterCommit?.(value)
        return value
      } catch (error) {
        if (began) try { this.db.exec('ROLLBACK') } catch { /* preserve the original failure */ }
        if (error instanceof DurableMemoryStoreError) throw error
        throw new DurableMemoryStoreError('unavailable', error instanceof Error ? error.message : 'SQLite memory mutation failed')
      }
    })
    this.writeTail = result.then(() => undefined, () => undefined)
    return result
  }

  private maintainDeletedPages(): void {
    try {
      const row = this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy?: number } | undefined
      this.walCheckpoint = Number(row?.busy || 0) === 0 ? 'truncated' : 'busy'
    } catch {
      this.walCheckpoint = 'unavailable'
    }
  }

  private currentRevision(): number {
    const row = this.db.prepare("SELECT value FROM memory_meta WHERE key = 'revision'").get() as { value?: string } | undefined
    return Number.parseInt(row?.value || '0', 10) || 0
  }

  private setRevision(revision: number): void {
    this.db.prepare("INSERT INTO memory_meta(key, value) VALUES ('revision', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(String(revision))
  }

  private nextId(): string {
    const row = this.db.prepare("SELECT value FROM memory_meta WHERE key = 'next_identity'").get() as { value?: string } | undefined
    const next = Math.max(1, Number.parseInt(row?.value || '1', 10) || 1)
    this.db.prepare("INSERT INTO memory_meta(key, value) VALUES ('next_identity', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(String(next + 1))
    return `memory-${next}`
  }

  private readEntries(): DurableMemoryEntry[] {
    const rows = this.db.prepare(`
      SELECT id, scope_kind, project_id, logical_key, kind, text, created_at, updated_at, revision
      FROM memory_entries
    `).all() as EntryRow[]
    const tagRows = this.db.prepare('SELECT memory_id, tag, position FROM memory_tags ORDER BY memory_id, position').all() as TagRow[]
    const tagsById = new Map<string, string[]>()
    for (const tag of tagRows) tagsById.set(tag.memory_id, [...(tagsById.get(tag.memory_id) || []), tag.tag])
    return rows.map((row) => ({
      id: row.id,
      scope: row.scope_kind === 'global'
        ? { kind: 'global' }
        : { kind: 'project', project: row.project_id as Extract<MemoryScope, { kind: 'project' }>['project'] },
      logicalKey: row.logical_key,
      kind: row.kind,
      text: row.text,
      tags: [...(tagsById.get(row.id) || [])],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: Number(row.revision),
    }))
  }

  private readExportEntries(): DurableMemoryExportEntry[] {
    const provenanceRows = this.db.prepare('SELECT id, provenance_json, operation FROM memory_entries').all() as ProvenanceRow[]
    const provenanceById = new Map(provenanceRows.map((row) => [
      row.id,
      parseDurableMemoryProvenance(row.provenance_json, row.operation),
    ] as const))
    return this.readEntries().map((entry) => ({
      ...entry,
      provenance: provenanceById.get(entry.id) || { origin: 'migration', operation: 'migration' },
    }))
  }

  private findEntry(scope: MemoryScope, logicalKey: string): DurableMemoryEntry | undefined {
    const columns = scopeColumns(scope)
    return this.readEntries().find((entry) => {
      const candidate = scopeColumns(entry.scope)
      return candidate.kind === columns.kind && candidate.project === columns.project && entry.logicalKey === logicalKey
    })
  }

  private writeEntry(
    draftInput: MemoryEntryDraft,
    access: MemoryAccessContext,
    revision: number,
    operation: string,
    operationId?: string,
    operationPayload?: string,
    restore?: { source?: DurableMemoryProvenance; updatedAt: string },
  ): DurableMemoryEntry {
    const draft = canonicalMemoryDraft(draftInput, this.limits)
    const existing = this.findEntry(draft.scope, draft.logicalKey)
    const entry: DurableMemoryEntry = {
      id: existing?.id || this.nextId(),
      scope: draft.scope.kind === 'global' ? { kind: 'global' } : { kind: 'project', project: draft.scope.project },
      logicalKey: draft.logicalKey,
      kind: draft.kind,
      text: draft.text,
      tags: [...draft.tags],
      createdAt: existing?.createdAt || draft.createdAt,
      updatedAt: restore?.updatedAt ?? draft.createdAt,
      revision,
    }
    const columns = scopeColumns(entry.scope)
    const hash = contentHash(entry)
    const origin = restore?.source ? JSON.stringify({ ...JSON.parse(provenance(access)), importedFrom: restore.source }) : provenance(access)
    this.db.prepare(`
      INSERT INTO memory_entries(
        id, scope_kind, project_id, logical_key, kind, text, created_at, updated_at,
        revision, content_hash, provenance_json, operation, migration_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_kind, project_id, logical_key) DO UPDATE SET
        kind = excluded.kind, text = excluded.text, updated_at = excluded.updated_at,
        revision = excluded.revision, content_hash = excluded.content_hash,
        provenance_json = excluded.provenance_json, operation = excluded.operation,
        migration_version = excluded.migration_version
    `).run(
      entry.id, columns.kind, columns.project, entry.logicalKey, entry.kind, entry.text,
      entry.createdAt, entry.updatedAt, entry.revision, hash, origin, operation, SCHEMA_VERSION,
    )
    this.db.prepare('DELETE FROM memory_tags WHERE memory_id = ?').run(entry.id)
    const insertTag = this.db.prepare('INSERT INTO memory_tags(memory_id, position, tag, normalized_tag) VALUES (?, ?, ?, ?)')
    entry.tags.forEach((tag, position) => insertTag.run(entry.id, position, tag, tag.toLowerCase()))
    this.recordOperation(revision, operation, entry.scope, entry.logicalKey, hash, origin, operationId, operationPayload, entry)
    return { ...entry, scope: entry.scope.kind === 'global' ? { kind: 'global' } : { ...entry.scope }, tags: [...entry.tags] }
  }

  private recordOperation(
    revision: number,
    operation: string,
    scope: MemoryScope | undefined,
    logicalKey: string | undefined,
    hash: string | undefined,
    origin: string,
    operationId?: string,
    payload?: string,
    result?: DurableMemoryEntry,
  ): void {
    const columns = scope ? scopeColumns(scope) : undefined
    this.db.prepare(`
      INSERT INTO memory_operations(
        revision, operation, scope_kind, project_id, logical_key, content_hash,
        provenance_json, migration_version, committed_at, operation_id, operation_hash,
        result_entry_id, result_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revision, operation, columns?.kind ?? null, columns?.project ?? null,
      logicalKey ?? null, hash ?? null, origin, SCHEMA_VERSION, new Date().toISOString(),
      operationId ?? null, payload ? createHash('sha256').update(payload).digest('hex') : null,
      result?.id ?? null, result?.revision ?? null,
    )
  }

  private idempotentResult(operationId: string | undefined, payload: string): DurableMemoryEntry | undefined {
    if (!operationId) return undefined
    const row = this.db.prepare('SELECT operation_hash, result_entry_id FROM memory_operations WHERE operation_id = ?').get(operationId) as { operation_hash?: string; result_entry_id?: string } | undefined
    if (!row) return undefined
    if (row.operation_hash !== createHash('sha256').update(payload).digest('hex') || !row.result_entry_id) {
      throw new DurableMemoryStoreError('invalid_input', 'Idempotency operation was retried with different memory content')
    }
    const entry = this.readEntries().find((candidate) => candidate.id === row.result_entry_id)
    if (!entry) throw new DurableMemoryStoreError('not_found', 'Idempotent memory result no longer exists')
    return entry
  }

  async upsert(input: MemoryUpsertInput): Promise<DurableMemoryEntry> {
    const draft = canonicalMemoryDraft(input, this.limits)
    authorizeMemoryAccess('upsert', input.access, draft.scope)
    const operationId = memoryOperationIdentity({ ...input, ...draft }, 'set')
    const payload = memoryOperationPayload(draft)
    return this.enqueueWrite(() => {
      const prior = this.idempotentResult(operationId, payload)
      if (prior) return prior
      assertMemoryQuota(this.readEntries(), draft.scope, draft.logicalKey, this.limits)
      const revision = this.currentRevision() + 1
      const entry = this.writeEntry(draft, input.access, revision, 'upsert', operationId, payload)
      this.setRevision(revision)
      return entry
    })
  }

  async append(input: MemoryAppendInput): Promise<DurableMemoryEntry> {
    const fragment = canonicalMemoryDraft(input, this.limits)
    authorizeMemoryAccess('append', input.access, fragment.scope)
    const operationId = memoryOperationIdentity({ ...input, ...fragment }, 'append')
    const payload = memoryOperationPayload(fragment)
    return this.enqueueWrite(() => {
      const prior = this.idempotentResult(operationId, payload)
      if (prior) return prior
      assertMemoryQuota(this.readEntries(), fragment.scope, fragment.logicalKey, this.limits)
      const draft = canonicalMemoryDraft(appendMemoryDraft(this.findEntry(fragment.scope, fragment.logicalKey), fragment), this.limits)
      const revision = this.currentRevision() + 1
      const entry = this.writeEntry(draft, input.access, revision, 'append', operationId, payload)
      this.setRevision(revision)
      return entry
    })
  }

  async get(input: MemoryGetInput): Promise<DurableMemoryEntry | undefined> {
    return (await this.getSnapshot(input)).entry
  }

  async getSnapshot(input: MemoryGetInput): Promise<{ entry?: DurableMemoryEntry; revision: number }> {
    await this.settleWrites()
    const scope = canonicalMemoryScope(input.scope)
    authorizeMemoryAccess('get', input.access, scope)
    return this.readSnapshot(() => ({
      entry: this.findEntry(scope, canonicalMemoryLogicalKey(input.logicalKey, this.limits)),
      revision: this.currentRevision(),
    }))
  }

  /** Body, tags and provenance revision must observe the same SQLite snapshot. */
  private readSnapshot<T>(read: () => T): T {
    this.db.exec('BEGIN DEFERRED')
    try {
      const result = read()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* preserve read failure */ }
      throw error
    }
  }

  async recall(input: MemoryRecallInput): Promise<MemoryRecallResult> {
    await this.settleWrites()
    authorizeMemoryAccess('recall', input.access)
    if (typeof input.query !== 'string' || input.query.length > this.limits.maxTextLength) throw new DurableMemoryStoreError('invalid_input', 'Memory recall query is invalid')
    if (input.limit !== undefined) validateMemoryPage(input.limit, this.limits)
    return this.readSnapshot(() => ({ items: recallMemoryEntries(this.readEntries(), input), revision: this.currentRevision() }))
  }

  async list(input: MemoryListInput): Promise<MemoryPage> {
    await this.settleWrites()
    const scope = input.scope ? canonicalMemoryScope(input.scope) : undefined
    authorizeMemoryAccess('list', input.access, scope)
    const kinds = validateMemoryKinds(input.kinds)
    const all = selectVisibleMemoryEntries(this.readEntries(), input.access, scope)
      .filter((entry) => !kinds || kinds.includes(entry.kind))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    const offset = validateMemoryCursor(input.cursor)
    const limit = validateMemoryPage(input.limit, this.limits)
    const items = all.slice(offset, offset + limit).map((entry) => ({
      ...entry,
      scope: entry.scope.kind === 'global' ? { kind: 'global' as const } : { ...entry.scope },
      tags: [...entry.tags],
    }))
    const nextOffset = offset + items.length
    return {
      items,
      total: all.length,
      revision: this.currentRevision(),
      ...(nextOffset < all.length ? { nextCursor: String(nextOffset) } : {}),
    }
  }

  async delete(input: MemoryDeleteInput): Promise<MemoryMutationResult> {
    const scope = canonicalMemoryScope(input.scope)
    authorizeMemoryAccess('delete', input.access, scope)
    const logicalKey = canonicalMemoryLogicalKey(input.logicalKey, this.limits)
    return this.enqueueWrite(() => {
      const found = this.findEntry(scope, logicalKey)
      if (!found) return { changed: 0, revision: this.currentRevision() }
      const revision = this.currentRevision() + 1
      this.db.prepare('DELETE FROM memory_entries WHERE id = ?').run(found.id)
      this.recordOperation(revision, input.auditOperation || 'delete', found.scope, found.logicalKey, undefined, provenance(input.access))
      this.setRevision(revision)
      return { changed: 1, revision }
    }, (mutation) => { if (mutation.changed) this.maintainDeletedPages() })
  }

  async clear(input: MemoryClearInput): Promise<MemoryMutationResult> {
    const requestedScope = input.scope.kind === 'all' ? input.scope : canonicalMemoryScope(input.scope)
    authorizeMemoryAccess('clear', input.access, requestedScope)
    return this.enqueueWrite(() => {
      const all = this.readEntries()
      const selected = requestedScope.kind === 'all'
        ? all
        : all.filter((entry) => memoryScopeKey(entry.scope) === memoryScopeKey(requestedScope))
      const removable = input.includeSpecial === false
        ? selected.filter((entry) => entry.kind === 'memory')
        : selected
      if (!removable.length) return { changed: 0, revision: this.currentRevision() }
      const revision = this.currentRevision() + 1
      const remove = this.db.prepare('DELETE FROM memory_entries WHERE id = ?')
      removable.forEach((entry) => remove.run(entry.id))
      this.recordOperation(revision, input.auditOperation || 'clear', requestedScope.kind === 'all' ? undefined : requestedScope, undefined, undefined, provenance(input.access))
      this.setRevision(revision)
      return { changed: removable.length, revision }
    }, (mutation) => { if (mutation.changed) this.maintainDeletedPages() })
  }

  async deletionCapability(): Promise<MemoryDeletionCapability> {
    await this.settleWrites()
    const row = this.db.prepare('PRAGMA secure_delete').get() as { secure_delete?: number } | undefined
    return {
      mode: 'best-effort',
      secureDelete: Number(row?.secure_delete || 0) === 1,
      walCheckpoint: this.walCheckpoint,
      limitations: [
        'SQLite secure_delete and WAL truncation only cover pages controlled by this live database connection.',
        'They cannot guarantee erasure from SSD wear-leveling, filesystem snapshots, backups, or copied database files.',
      ],
    }
  }

  async revision(): Promise<number> {
    await this.settleWrites()
    return this.currentRevision()
  }

  async health(): Promise<MemoryHealth> {
    if (this.lifecycle === 'closed') return { status: 'closed', revision: this.closedRevision }
    if (this.lifecycle === 'closing') return { status: 'closing', revision: this.currentRevision() }
    await this.writeTail
    return { status: 'ready', revision: this.currentRevision() }
  }

  async consolidate(input: MemoryConsolidateInput): Promise<MemoryConsolidationResult> {
    const scope = canonicalMemoryScope(input.scope)
    authorizeMemoryAccess('consolidate', input.access, scope)
    const sourceKeys = canonicalMemorySourceKeys(input.sourceKeys, this.limits)
    const merged = canonicalMemoryDraft({ ...input.merged, scope }, this.limits)
    return this.enqueueWrite(() => {
      const sources = sourceKeys.map((logicalKey) => this.findEntry(scope, logicalKey))
      const missingAt = sources.findIndex((entry) => !entry)
      if (missingAt >= 0) throw new DurableMemoryStoreError('not_found', `Memory source not found: ${sourceKeys[missingAt]}`)
      const revision = this.currentRevision() + 1
      const remove = this.db.prepare('DELETE FROM memory_entries WHERE id = ?')
      sources.forEach((entry) => remove.run(entry!.id))
      const entry = this.writeEntry(merged, input.access, revision, 'consolidate')
      this.setRevision(revision)
      return { changed: sources.length + 1, revision, entry }
    })
  }

  async consolidateDream(input: MemoryDreamConsolidateInput): Promise<MemoryDreamConsolidationResult> {
    const scope = canonicalMemoryScope(input.scope)
    authorizeMemoryAccess('consolidate', input.access, scope)
    const operationId = canonicalMemoryLogicalKey(input.operationId, this.limits)
    const payload = JSON.stringify(['dream-v1', memoryScopeKey(scope), operationId, Boolean(input.force)])
    return this.enqueueWrite(() => {
      const prior = this.db.prepare(`
        SELECT operation_hash, result_entry_id, result_revision
        FROM memory_operations WHERE operation_id = ?
      `).get(operationId) as { operation_hash?: string; result_entry_id?: string; result_revision?: number } | undefined
      if (prior) {
        const expected = createHash('sha256').update(payload).digest('hex')
        if (prior.operation_hash !== expected) throw new DurableMemoryStoreError('invalid_input', 'Dream operation identity was retried with different scope or policy')
        const entry = prior.result_entry_id ? this.readEntries().find((candidate) => candidate.id === prior.result_entry_id) : undefined
        return {
          changed: 0, revision: Number(prior.result_revision ?? this.currentRevision()),
          deduped: [], merged: 0, alreadyApplied: true, ...(entry ? { entry } : {}),
        }
      }
      const plan = planDreamConsolidation(this.readEntries(), scope, operationId, input.force)
      if (input.faultAt === 'after-source-read') throw new DurableMemoryStoreError('unavailable', 'Injected dream fault after source read')
      const sourceKeys = [...new Set([...plan.duplicateKeys, ...plan.mergeKeys])]
      const remove = this.db.prepare('DELETE FROM memory_entries WHERE scope_kind = ? AND project_id = ? AND logical_key = ?')
      const columns = scopeColumns(scope)
      sourceKeys.forEach((logicalKey) => remove.run(columns.kind, columns.project, logicalKey))
      if (input.faultAt === 'after-source-delete') throw new DurableMemoryStoreError('unavailable', 'Injected dream fault after source delete')
      const revision = sourceKeys.length || plan.merged ? this.currentRevision() + 1 : this.currentRevision()
      const entry = plan.merged
        ? this.writeEntry(plan.merged, input.access, revision, 'dream-consolidate', operationId, payload)
        : undefined
      if (input.faultAt === 'after-merged-write') throw new DurableMemoryStoreError('unavailable', 'Injected dream fault after merged write')
      if (!entry) this.recordOperation(revision, 'dream-consolidate', scope, undefined, undefined, provenance(input.access), operationId, payload)
      this.db.prepare('UPDATE memory_operations SET result_revision = ? WHERE operation_id = ?').run(revision, operationId)
      if (revision !== this.currentRevision()) this.setRevision(revision)
      return {
        changed: sourceKeys.length + Number(Boolean(entry)), revision,
        deduped: [...plan.duplicateKeys], merged: plan.mergeKeys.length,
        alreadyApplied: false, ...(entry ? { entry } : {}),
      }
    })
  }

  async exportBundle(input: MemoryExportInput): Promise<DurableMemoryBundle> {
    await this.settleWrites()
    const scope = input.scope ? canonicalMemoryScope(input.scope) : undefined
    authorizeMemoryAccess('export', input.access, scope)
    this.db.exec('BEGIN DEFERRED')
    try {
      const exportEntries = this.readExportEntries()
      if (this.afterExportEntriesRead) await this.afterExportEntriesRead()
      const visibleIds = new Set(selectVisibleMemoryEntries(exportEntries, input.access, scope).map((entry) => entry.id))
      const entries = exportEntries
        .filter((entry) => visibleIds.has(entry.id))
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((entry) => ({ ...entry, scope: entry.scope.kind === 'global' ? { kind: 'global' as const } : { ...entry.scope }, tags: [...entry.tags], provenance: { ...entry.provenance } }))
      const bundle = validateMemoryExportBundle(durableMemoryBundle(this.currentRevision(), entries), this.limits)
      this.db.exec('COMMIT')
      return bundle
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* preserve export failure */ }
      if (error instanceof DurableMemoryStoreError) throw error
      throw new DurableMemoryStoreError('unavailable', error instanceof Error ? error.message : 'SQLite memory export failed')
    }
  }

  async previewImport(input: MemoryImportPreviewInput): Promise<MemoryImportPreview> {
    authorizeMemoryAccess('import', input.access)
    await this.settleWrites()
    this.db.exec('BEGIN DEFERRED')
    try {
      const preview = planMemoryImport(input.bundle, input.mode, this.readEntries(), this.currentRevision(), this.limits).preview
      this.db.exec('COMMIT')
      return preview
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async applyImport(input: MemoryImportApplyInput): Promise<MemoryImportResult> {
    authorizeMemoryAccess('import', input.access)
    const key = memoryImportOperationKey(input, this.limits)
    return this.enqueueWrite(() => {
      const existing = this.readEntries()
      const prior = this.db.prepare('SELECT value FROM memory_meta WHERE key = ?').get(key) as { value: string } | undefined
      if (prior) return replayMemoryImport(JSON.parse(prior.value) as MemoryImportReceipt, input, existing)
      const plan = checkedMemoryImportPlan(input, existing, this.currentRevision(), this.limits)
      const revision = this.currentRevision() + Number(plan.drafts.length > 0)
      const entryIds = plan.drafts.map((draft, index) => {
        const entry = this.writeEntry(draft, { ...input.access, callId: input.operationId }, revision, 'import', undefined, undefined, draft)
        this.importTestHooks?.afterImportEntryWrite?.(index)
        return entry.id
      })
      if (plan.drafts.length) this.setRevision(revision)
      const result = { changed: entryIds.length, revision, alreadyApplied: false, counts: plan.preview.counts }
      const receipt: MemoryImportReceipt = { hash: memoryImportRequestHash(input), entryIds, result }
      this.db.prepare('INSERT INTO memory_meta(key, value) VALUES (?, ?)').run(key, JSON.stringify(receipt))
      return result
    })
  }

  async importBundle(input: MemoryImportInput): Promise<MemoryMutationResult> {
    authorizeMemoryAccess('import', input.access)
    validateMemoryImport(input, this.limits)
    const drafts = input.bundle.entries.map((candidate) => canonicalMemoryDraft(candidate as MemoryEntryDraft, this.limits))
    return this.enqueueWrite(() => {
      let changed = 0
      const projected = new Map((input.mode === 'replace' ? [] : this.readEntries()).map((entry) => [`${memoryScopeKey(entry.scope)}\u0000${entry.logicalKey}`, entry]))
      for (const draft of drafts) {
        assertMemoryQuota(projected.values(), draft.scope, draft.logicalKey, this.limits)
        projected.set(`${memoryScopeKey(draft.scope)}\u0000${draft.logicalKey}`, { ...draft, id: 'quota-preview', updatedAt: draft.createdAt, revision: 0 })
      }
      if (input.mode === 'replace') {
        changed += this.readEntries().length
        this.db.prepare('DELETE FROM memory_entries').run()
      }
      const revision = drafts.length || changed ? this.currentRevision() + 1 : this.currentRevision()
      drafts.forEach((draft) => {
        this.writeEntry(draft, input.access, revision, 'import')
        changed += 1
      })
      if (revision !== this.currentRevision()) this.setRevision(revision)
      return { changed, revision }
    })
  }

  async close(timeoutMs = SHUTDOWN_TIMEOUT_MS): Promise<void> {
    if (this.lifecycle === 'closed') return
    if (this.lifecycle === 'closing') throw new DurableMemoryStoreError('closed', 'Durable memory store shutdown is already in progress')
    this.lifecycle = 'closing'
    const drain = this.writeTail.then(() => {
      const revision = this.currentRevision()
      const row = this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy?: number; log?: number; checkpointed?: number } | undefined
      if (Number(row?.busy || 0) !== 0 || Number(row?.log || 0) !== Number(row?.checkpointed || 0)) {
        throw new MemoryStorageLifecycleError('checkpoint_failure', '長期記憶 WAL checkpoint 未完成；關閉狀態不宣稱成功。')
      }
      this.db.close()
      this.lifecycle = 'closed'
      this.closedRevision = revision
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        drain,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new MemoryStorageLifecycleError(
            'shutdown_timeout',
            `長期記憶關閉超過 ${timeoutMs}ms；已拒絕新 writes，但仍在等待已接受 transaction。`,
          )), Math.max(1, timeoutMs))
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private readMigrationReport(): MemoryMigrationReport | undefined {
    const row = this.db.prepare("SELECT value FROM memory_meta WHERE key = 'legacy_json_migration'").get() as { value: string } | undefined
    return row ? JSON.parse(row.value) as MemoryMigrationReport : undefined
  }

  async migrationStatus(): Promise<MemoryMigrationReport | undefined> {
    await this.settleWrites()
    return this.readMigrationReport()
  }

  async migrateLegacy(input: MemoryMigrationInput): Promise<MemoryMigrationResult> {
    validateMemoryMigration(input, this.limits)
    return this.enqueueWrite(() => {
      const prior = this.readMigrationReport()
      if (prior) return replayMemoryMigration(prior, input.sourceHash)
      const { drafts, rejected } = prepareLegacyMemoryMigration(input, this.readEntries(), this.limits)
      const revision = this.currentRevision() + (drafts.length ? 1 : 0)
      for (const draft of drafts) this.writeEntry(draft, input.access, revision, 'legacy-migration')
      const report: MemoryMigrationReport = { version: 1, sourceHash: input.sourceHash, sourceSchema: input.sourceSchema, imported: drafts.length, rejected, revision }
      this.db.prepare("INSERT INTO memory_meta(key, value) VALUES ('legacy_json_migration', ?)").run(JSON.stringify(report))
      this.setRevision(revision)
      return { alreadyApplied: false, report }
    })
  }
}
