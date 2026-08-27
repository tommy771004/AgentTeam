import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  appendMemoryDraft,
  assertMemoryQuota,
  authorizeMemoryAccess,
  canonicalMemoryDraft,
  canonicalMemoryLogicalKey,
  canonicalMemoryScope,
  canonicalMemorySourceKeys,
  durableMemoryLimits,
  DurableMemoryStoreError,
  memoryOperationIdentity,
  memoryOperationPayload,
  memoryScopeKey,
  planDreamConsolidation,
  recallMemoryEntries,
  prepareLegacyMemoryMigration,
  replayMemoryMigration,
  selectVisibleMemoryEntries,
  validateMemoryCursor,
  validateMemoryImport,
  validateMemoryKinds,
  validateMemoryMigration,
  validateMemoryPage,
  type DurableMemoryBundle,
  type DurableMemoryEntry,
  type DurableMemoryLimits,
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
  return JSON.stringify({
    origin: access.origin,
    ...(access.runId ? { runId: access.runId } : {}),
    ...(access.sessionId ? { sessionId: access.sessionId } : {}),
    ...(access.callId ? { callId: access.callId } : {}),
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
  private writeTail: Promise<void> = Promise.resolve()
  private closed = false
  private closedRevision = 0
  private walCheckpoint: MemoryDeletionCapability['walCheckpoint'] = 'unavailable'

  private constructor(databasePath: string, limits?: Partial<DurableMemoryLimits>) {
    this.db = new DatabaseSync(databasePath)
    this.limits = durableMemoryLimits(limits)
    this.migrate()
  }

  static async open(databasePath: string, limits?: Partial<DurableMemoryLimits>): Promise<SqliteDurableMemoryStore> {
    return new SqliteDurableMemoryStore(databasePath, limits)
  }

  private migrate(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};
      PRAGMA foreign_keys = ON;
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS memory_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'project')),
        project_id TEXT NOT NULL DEFAULT '',
        logical_key TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('memory', 'profile', 'document')),
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        operation TEXT NOT NULL,
        migration_version INTEGER NOT NULL,
        UNIQUE (scope_kind, project_id, logical_key)
      );
      CREATE TABLE IF NOT EXISTS memory_tags (
        memory_id TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        tag TEXT NOT NULL,
        normalized_tag TEXT NOT NULL,
        PRIMARY KEY (memory_id, position)
      );
      CREATE INDEX IF NOT EXISTS memory_tags_normalized_idx ON memory_tags(normalized_tag);
      CREATE TABLE IF NOT EXISTS memory_operations (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        revision INTEGER NOT NULL,
        operation TEXT NOT NULL,
        scope_kind TEXT,
        project_id TEXT,
        logical_key TEXT,
        content_hash TEXT,
        provenance_json TEXT NOT NULL,
        migration_version INTEGER NOT NULL,
        committed_at TEXT NOT NULL
      );
    `)
    const migrations = this.db.prepare('SELECT version FROM memory_schema_migrations ORDER BY version').all() as Array<{ version: number }>
    const latest = migrations.at(-1)?.version ?? 0
    if (latest > SCHEMA_VERSION) {
      throw new DurableMemoryStoreError('unavailable', `Unsupported durable memory schema version ${latest}`)
    }
    if (latest < 1) {
      this.db.exec('BEGIN IMMEDIATE')
      try {
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
  }

  private ensureOpen(): void {
    if (this.closed) throw new DurableMemoryStoreError('closed', 'Durable memory store is closed')
  }

  private async settleWrites(): Promise<void> {
    await this.writeTail
    this.ensureOpen()
  }

  private enqueueWrite<T>(operation: () => T, afterCommit?: (value: T) => void): Promise<T> {
    const result = this.writeTail.then(() => {
      this.ensureOpen()
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const value = operation()
        this.db.exec('COMMIT')
        afterCommit?.(value)
        return value
      } catch (error) {
        try { this.db.exec('ROLLBACK') } catch { /* preserve the original failure */ }
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
      updatedAt: draft.createdAt,
      revision,
    }
    const columns = scopeColumns(entry.scope)
    const hash = contentHash(entry)
    const origin = provenance(access)
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
    await this.settleWrites()
    const scope = canonicalMemoryScope(input.scope)
    authorizeMemoryAccess('get', input.access, scope)
    const found = this.findEntry(scope, canonicalMemoryLogicalKey(input.logicalKey, this.limits))
    return found ? { ...found, scope: found.scope.kind === 'global' ? { kind: 'global' } : { ...found.scope }, tags: [...found.tags] } : undefined
  }

  async recall(input: MemoryRecallInput): Promise<MemoryRecallResult> {
    await this.settleWrites()
    authorizeMemoryAccess('recall', input.access)
    if (typeof input.query !== 'string' || input.query.length > this.limits.maxTextLength) throw new DurableMemoryStoreError('invalid_input', 'Memory recall query is invalid')
    if (input.limit !== undefined) validateMemoryPage(input.limit, this.limits)
    return { items: recallMemoryEntries(this.readEntries(), input), revision: this.currentRevision() }
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
    if (this.closed) return { status: 'closed', revision: this.closedRevision }
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
    const entries = selectVisibleMemoryEntries(this.readEntries(), input.access, scope)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((entry) => ({ ...entry, scope: entry.scope.kind === 'global' ? { kind: 'global' as const } : { ...entry.scope }, tags: [...entry.tags] }))
    return { version: 1, revision: this.currentRevision(), entries }
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

  async close(): Promise<void> {
    if (this.closed) return
    await this.writeTail
    const revision = this.currentRevision()
    this.maintainDeletedPages()
    this.db.close()
    this.closed = true
    this.closedRevision = revision
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
