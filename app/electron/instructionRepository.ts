import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

export type InstructionRepositoryFailureCode =
  | 'conflict'
  | 'read_only'
  | 'busy'
  | 'io_error'
  | 'unsupported_schema'
  | 'closed'
  | 'corrupt'
  | 'integrity_failure'
  | 'migration_failed'
  | 'invalid_import'

export class InstructionRepositoryError extends Error {
  readonly code: InstructionRepositoryFailureCode
  readonly cause?: unknown

  constructor(
    code: InstructionRepositoryFailureCode,
    message: string,
    cause?: unknown,
  ) {
    super(message)
    this.name = 'InstructionRepositoryError'
    this.code = code
    this.cause = cause
  }
}

export type PersonalizationInstructionSnapshot = Readonly<{
  schemaVersion: 1
  revision: number
  globalCustomInstructions: string
  advancedPersonalityInstructions: string
  personality?: string
  aboutUser?: string
  responseStyle?: string
  /** Distinguishes an unset legacy source from an explicit empty source. */
  globalCustomInstructionsPresence?: InstructionPresence
  advancedPersonalityInstructionsPresence?: InstructionPresence
  hash: string
  updatedAt: string
}>

export type InstructionPresence = 'unset' | 'blank' | 'value'

export type SavePersonalizationInstructions = {
  expectedRevision: number
  globalCustomInstructions: string
  advancedPersonalityInstructions?: string
  personality?: string
  aboutUser?: string
  responseStyle?: string
  globalCustomInstructionsPresence?: InstructionPresence
  advancedPersonalityInstructionsPresence?: InstructionPresence
}

export type PersonalizationExportBundle = Readonly<{
  kind: 'agentstudio-personalization'
  schemaVersion: 1
  exportedAt: string
  bundleId: string
  snapshot: PersonalizationInstructionSnapshot
  integrityHash: string
  projectSources: never[]
  /** Audit metadata only; import never grants authority on another install. */
  authorizedIncludeTargets: readonly string[]
}>

export type PersonalizationImportPreview = Readonly<{
  status: 'add' | 'update' | 'unchanged' | 'conflict' | 'invalid'
  localRevision: number
  incomingRevision?: number
  bundle?: PersonalizationExportBundle
  message?: string
  errorCode?: 'invalid_import' | 'integrity_failure' | 'unsupported_schema'
}>

export type LegacyInstructionMigrationInput = Readonly<{
  personality?: string
  aboutUser?: string
  responseStyle?: string
  soul?: string
  agents?: string
}>

export type LegacyInstructionMigrationReport = Readonly<{
  status: 'migrated' | 'already_migrated' | 'skipped_existing'
  sourceHash: string
  appliedRevision: number
  backup: LegacyInstructionMigrationInput
  presence: Readonly<{ soul: InstructionPresence; agents: InstructionPresence }>
}>

export interface InstructionRepository {
  read(): Promise<PersonalizationInstructionSnapshot>
  save(input: SavePersonalizationInstructions): Promise<PersonalizationInstructionSnapshot>
  exportBundle(): Promise<PersonalizationExportBundle>
  previewImport(bundle: unknown): Promise<PersonalizationImportPreview>
  applyImport(preview: PersonalizationImportPreview, expectedRevision: number): Promise<PersonalizationInstructionSnapshot>
  migrateLegacy(input: LegacyInstructionMigrationInput): Promise<{ instructions: PersonalizationInstructionSnapshot; report: LegacyInstructionMigrationReport }>
  listAuthorizedIncludeTargets(): Promise<readonly string[]>
  authorizeIncludeTarget(target: string): Promise<readonly string[]>
  close(): Promise<void>
}

/** Keeps Pi Host alive while exposing a typed, non-empty storage failure. */
export class UnavailableInstructionRepository implements InstructionRepository {
  private readonly failure: InstructionRepositoryError
  constructor(failure: InstructionRepositoryError) { this.failure = failure }
  private reject<T>(): Promise<T> { return Promise.reject(this.failure) }
  read() { return this.reject<PersonalizationInstructionSnapshot>() }
  save() { return this.reject<PersonalizationInstructionSnapshot>() }
  exportBundle() { return this.reject<PersonalizationExportBundle>() }
  previewImport() { return this.reject<PersonalizationImportPreview>() }
  applyImport() { return this.reject<PersonalizationInstructionSnapshot>() }
  migrateLegacy() { return this.reject<{ instructions: PersonalizationInstructionSnapshot; report: LegacyInstructionMigrationReport }>() }
  listAuthorizedIncludeTargets() { return this.reject<readonly string[]>() }
  authorizeIncludeTarget() { return this.reject<readonly string[]>() }
  async close() {}
}

const EMPTY_UPDATED_AT = '1970-01-01T00:00:00.000Z'

function instructionHash(value: Omit<PersonalizationInstructionSnapshot, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify({
    schemaVersion: value.schemaVersion,
    revision: value.revision,
    globalCustomInstructions: value.globalCustomInstructions,
    advancedPersonalityInstructions: value.advancedPersonalityInstructions,
    personality: value.personality ?? null,
    aboutUser: value.aboutUser ?? null,
    responseStyle: value.responseStyle ?? null,
    ...(value.globalCustomInstructionsPresence !== undefined ? { globalCustomInstructionsPresence: value.globalCustomInstructionsPresence } : {}),
    ...(value.advancedPersonalityInstructionsPresence !== undefined ? { advancedPersonalityInstructionsPresence: value.advancedPersonalityInstructionsPresence } : {}),
    updatedAt: value.updatedAt,
  })).digest('hex')
}

function snapshot(input: Omit<PersonalizationInstructionSnapshot, 'hash'>): PersonalizationInstructionSnapshot {
  return Object.freeze({ ...input, hash: instructionHash(input) })
}

function emptySnapshot(): PersonalizationInstructionSnapshot {
  return snapshot({
    schemaVersion: 1,
    revision: 0,
    globalCustomInstructions: '',
    advancedPersonalityInstructions: '',
    globalCustomInstructionsPresence: 'unset',
    advancedPersonalityInstructionsPresence: 'unset',
    updatedAt: EMPTY_UPDATED_AT,
  })
}

function presenceOf(value: string | undefined): InstructionPresence {
  if (value === undefined) return 'unset'
  return value.trim() ? 'value' : 'blank'
}

function normalizeSave(
  input: SavePersonalizationInstructions,
  revision: number,
  presence?: Partial<Pick<PersonalizationInstructionSnapshot, 'globalCustomInstructionsPresence' | 'advancedPersonalityInstructionsPresence'>>,
): PersonalizationInstructionSnapshot {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new InstructionRepositoryError('conflict', 'expectedRevision 必須是非負整數。')
  }
  const limited = (value: unknown, field: string, max = 512_000): string => {
    if (value == null) return ''
    if (typeof value !== 'string') throw new InstructionRepositoryError('io_error', `${field} 必須是文字。`)
    const bytes = Buffer.byteLength(value)
    if (bytes > max) throw new InstructionRepositoryError('io_error', `${field} 超過 ${max} bytes。`)
    return value.replace(/\r\n/g, '\n')
  }
  const base = {
    schemaVersion: 1 as const,
    revision,
    globalCustomInstructions: limited(input.globalCustomInstructions, 'globalCustomInstructions'),
    advancedPersonalityInstructions: limited(input.advancedPersonalityInstructions, 'advancedPersonalityInstructions'),
    globalCustomInstructionsPresence: presence?.globalCustomInstructionsPresence || input.globalCustomInstructionsPresence || presenceOf(input.globalCustomInstructions),
    advancedPersonalityInstructionsPresence: presence?.advancedPersonalityInstructionsPresence || input.advancedPersonalityInstructionsPresence || presenceOf(input.advancedPersonalityInstructions),
    ...(input.personality !== undefined ? { personality: limited(input.personality, 'personality', 2_000) } : {}),
    ...(input.aboutUser !== undefined ? { aboutUser: limited(input.aboutUser, 'aboutUser', 32_000) } : {}),
    ...(input.responseStyle !== undefined ? { responseStyle: limited(input.responseStyle, 'responseStyle', 32_000) } : {}),
    updatedAt: new Date().toISOString(),
  }
  return snapshot(base)
}

function exportBundle(current: PersonalizationInstructionSnapshot, authorizedIncludeTargets: readonly string[] = []): PersonalizationExportBundle {
  const base = {
    kind: 'agentstudio-personalization' as const,
    schemaVersion: 1 as const,
    exportedAt: new Date().toISOString(),
    bundleId: randomUUID(),
    snapshot: current,
    projectSources: [] as never[],
    authorizedIncludeTargets: [...authorizedIncludeTargets].sort(),
  }
  return Object.freeze({
    ...base,
    integrityHash: createHash('sha256').update(JSON.stringify(base)).digest('hex'),
  })
}

function validateBundle(value: unknown): PersonalizationExportBundle {
  if (!value || typeof value !== 'object') throw new InstructionRepositoryError('invalid_import', '匯入檔不是物件。')
  const candidate = value as Partial<PersonalizationExportBundle>
  if (candidate.kind !== 'agentstudio-personalization') throw new InstructionRepositoryError('invalid_import', '個人化匯入 kind 無效。')
  if (candidate.schemaVersion !== 1) throw new InstructionRepositoryError('unsupported_schema', `不支援的個人化匯入 schema：${String(candidate.schemaVersion)}`)
  if (!candidate.snapshot) throw new InstructionRepositoryError('invalid_import', '匯入 snapshot 缺失。')
  if (typeof candidate.bundleId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(candidate.bundleId)) throw new InstructionRepositoryError('invalid_import', '匯入 bundleId 無效。')
  if (typeof candidate.exportedAt !== 'string' || !Number.isFinite(Date.parse(candidate.exportedAt))) throw new InstructionRepositoryError('invalid_import', '匯入 exportedAt 無效。')
  if (!Array.isArray(candidate.projectSources)) throw new InstructionRepositoryError('invalid_import', '匯入 projectSources schema 無效。')
  if (!Array.isArray(candidate.authorizedIncludeTargets) || candidate.authorizedIncludeTargets.length > 64
    || candidate.authorizedIncludeTargets.some((target) => typeof target !== 'string' || !target.startsWith('/') || Buffer.byteLength(target) > 4_096)) {
    throw new InstructionRepositoryError('invalid_import', '匯入 include authorization metadata 無效。')
  }
  const { integrityHash, ...base } = candidate
  const actual = createHash('sha256').update(JSON.stringify(base)).digest('hex')
  if (integrityHash !== actual) throw new InstructionRepositoryError('integrity_failure', '個人化匯入 integrity 驗證失敗。')
  if (candidate.projectSources?.length) throw new InstructionRepositoryError('invalid_import', '匯入不得包含 project instruction bodies。')
  validateImportedSnapshot(candidate.snapshot)
  return candidate as PersonalizationExportBundle
}

function validateImportedSnapshot(value: unknown): asserts value is PersonalizationInstructionSnapshot {
  if (!value || typeof value !== 'object') throw new InstructionRepositoryError('invalid_import', '匯入 snapshot 缺失。')
  const candidate = value as Record<string, unknown>
  if (candidate.schemaVersion !== 1 || !Number.isSafeInteger(candidate.revision) || Number(candidate.revision) < 0
    || typeof candidate.globalCustomInstructions !== 'string' || typeof candidate.advancedPersonalityInstructions !== 'string'
    || typeof candidate.updatedAt !== 'string' || typeof candidate.hash !== 'string') {
    throw new InstructionRepositoryError('invalid_import', '匯入 snapshot schema 無效。')
  }
  for (const field of ['personality', 'aboutUser', 'responseStyle'] as const) {
    if (candidate[field] !== undefined && typeof candidate[field] !== 'string') throw new InstructionRepositoryError('invalid_import', `匯入 ${field} 無效。`)
  }
  for (const field of ['globalCustomInstructionsPresence', 'advancedPersonalityInstructionsPresence'] as const) {
    if (candidate[field] !== undefined && !['unset', 'blank', 'value'].includes(String(candidate[field]))) {
      throw new InstructionRepositoryError('invalid_import', `匯入 ${field} 無效。`)
    }
  }
  const limits: Record<string, number> = {
    globalCustomInstructions: 512_000,
    advancedPersonalityInstructions: 512_000,
    personality: 2_000,
    aboutUser: 32_000,
    responseStyle: 32_000,
  }
  for (const [field, limit] of Object.entries(limits)) {
    const text = candidate[field]
    if (typeof text === 'string' && Buffer.byteLength(text) > limit) throw new InstructionRepositoryError('invalid_import', `匯入 ${field} 超過 ${limit} bytes。`)
  }
  if (!Number.isFinite(Date.parse(candidate.updatedAt as string))) throw new InstructionRepositoryError('invalid_import', '匯入 snapshot updatedAt 無效。')
  const expected = instructionHash(candidate as Omit<PersonalizationInstructionSnapshot, 'hash'>)
  if (candidate.hash !== expected) throw new InstructionRepositoryError('integrity_failure', '匯入 snapshot hash 驗證失敗。')
}

function legacySourceHash(input: LegacyInstructionMigrationInput): string {
  return createHash('sha256').update(JSON.stringify({
    personality: input.personality,
    aboutUser: input.aboutUser,
    responseStyle: input.responseStyle,
    soul: input.soul,
    agents: input.agents,
  })).digest('hex')
}

function migrationReport(
  status: LegacyInstructionMigrationReport['status'],
  input: LegacyInstructionMigrationInput,
  revision: number,
): LegacyInstructionMigrationReport {
  return Object.freeze({
    status,
    sourceHash: legacySourceHash(input),
    appliedRevision: revision,
    backup: Object.freeze({ ...input }),
    presence: Object.freeze({ soul: presenceOf(input.soul), agents: presenceOf(input.agents) }),
  })
}

function importPreview(
  local: PersonalizationInstructionSnapshot,
  value: unknown,
  alreadyApplied = false,
): PersonalizationImportPreview {
  try {
    const bundle = validateBundle(value)
    const incoming = bundle.snapshot
    const same = incoming.hash === local.hash
    return Object.freeze({
      status: alreadyApplied || same ? 'unchanged' : incoming.revision < local.revision ? 'conflict' : local.revision === 0 ? 'add' : 'update',
      localRevision: local.revision,
      incomingRevision: incoming.revision,
      bundle,
    })
  } catch (error) {
    return Object.freeze({
      status: 'invalid',
      localRevision: local.revision,
      message: error instanceof Error ? error.message : '匯入資料無效。',
      errorCode: error instanceof InstructionRepositoryError
        && (error.code === 'unsupported_schema' || error.code === 'integrity_failure')
        ? error.code
        : 'invalid_import',
    })
  }
}

export class InMemoryInstructionRepository implements InstructionRepository {
  private current = emptySnapshot()
  private closed = false
  private readonly appliedBundles = new Set<string>()
  private legacyMigration?: LegacyInstructionMigrationReport
  private readonly authorizedIncludeTargets = new Set<string>()

  private ensureOpen() {
    if (this.closed) throw new InstructionRepositoryError('closed', 'Instruction Repository 已關閉。')
  }

  async read() { this.ensureOpen(); return this.current }
  async save(input: SavePersonalizationInstructions) {
    this.ensureOpen()
    if (input.expectedRevision !== this.current.revision) throw new InstructionRepositoryError('conflict', '已有較新的個人化 revision。')
    this.current = normalizeSave(input, this.current.revision + 1)
    return this.current
  }
  async exportBundle() { this.ensureOpen(); return exportBundle(this.current, await this.listAuthorizedIncludeTargets()) }
  async previewImport(bundle: unknown) {
    this.ensureOpen()
    const bundleId = bundle && typeof bundle === 'object' && 'bundleId' in bundle ? String(bundle.bundleId) : ''
    return importPreview(this.current, bundle, this.appliedBundles.has(bundleId))
  }
  async applyImport(preview: PersonalizationImportPreview, expectedRevision: number) {
    this.ensureOpen()
    if (!preview.bundle || preview.status === 'invalid' || preview.status === 'conflict') {
      throw new InstructionRepositoryError('invalid_import', '匯入 preview 不可套用。')
    }
    if (this.appliedBundles.has(preview.bundle.bundleId) || preview.status === 'unchanged') return this.current
    const incoming = preview.bundle.snapshot
    const saved = await this.save({
      expectedRevision,
      globalCustomInstructions: incoming.globalCustomInstructions,
      advancedPersonalityInstructions: incoming.advancedPersonalityInstructions,
      personality: incoming.personality,
      aboutUser: incoming.aboutUser,
      responseStyle: incoming.responseStyle,
      globalCustomInstructionsPresence: incoming.globalCustomInstructionsPresence,
      advancedPersonalityInstructionsPresence: incoming.advancedPersonalityInstructionsPresence,
    })
    this.appliedBundles.add(preview.bundle.bundleId)
    return saved
  }
  async migrateLegacy(input: LegacyInstructionMigrationInput) {
    this.ensureOpen()
    if (this.legacyMigration) return { instructions: this.current, report: { ...this.legacyMigration, status: 'already_migrated' as const } }
    if (this.current.revision !== 0) {
      this.legacyMigration = migrationReport('skipped_existing', input, this.current.revision)
      return { instructions: this.current, report: this.legacyMigration }
    }
    this.current = normalizeSave({
      expectedRevision: 0,
      globalCustomInstructions: input.agents ?? '',
      advancedPersonalityInstructions: input.soul ?? '',
      ...(input.personality !== undefined ? { personality: input.personality } : {}),
      ...(input.aboutUser !== undefined ? { aboutUser: input.aboutUser } : {}),
      ...(input.responseStyle !== undefined ? { responseStyle: input.responseStyle } : {}),
    }, 1, {
      globalCustomInstructionsPresence: presenceOf(input.agents),
      advancedPersonalityInstructionsPresence: presenceOf(input.soul),
    })
    this.legacyMigration = migrationReport('migrated', input, this.current.revision)
    return { instructions: this.current, report: this.legacyMigration }
  }
  async listAuthorizedIncludeTargets() { this.ensureOpen(); return Object.freeze([...this.authorizedIncludeTargets].sort()) }
  async authorizeIncludeTarget(target: string) {
    this.ensureOpen()
    if (!target) throw new InstructionRepositoryError('io_error', 'include authorization target 不可為空。')
    this.authorizedIncludeTargets.add(target)
    return this.listAuthorizedIncludeTargets()
  }
  async close() { this.closed = true }
}

type InstructionRow = {
  revision: number
  global_custom: string
  advanced_personality: string
  personality: string | null
  about_user: string | null
  response_style: string | null
  global_custom_presence: InstructionPresence | null
  advanced_personality_presence: InstructionPresence | null
  hash: string
  updated_at: string
}

function mapSqliteError(error: unknown): InstructionRepositoryError {
  const message = error instanceof Error ? error.message : String(error)
  if (/readonly/i.test(message)) return new InstructionRepositoryError('read_only', 'Instruction Repository 為唯讀。', error)
  if (/busy|locked/i.test(message)) return new InstructionRepositoryError('busy', 'Instruction Repository 忙碌中。', error)
  if (/malformed|corrupt/i.test(message)) return new InstructionRepositoryError('corrupt', 'Instruction Repository 已損毀。', error)
  return new InstructionRepositoryError('io_error', `Instruction Repository I/O 失敗：${message}`, error)
}

export class SqliteInstructionRepository implements InstructionRepository {
  private readonly db: DatabaseSync
  private readonly readOnly: boolean
  private closed = false
  private writeTail: Promise<void> = Promise.resolve()

  private constructor(path: string, readOnly = false) {
    try {
      this.readOnly = readOnly
      this.db = new DatabaseSync(path, readOnly ? { readOnly: true } : {})
      this.db.exec('PRAGMA busy_timeout = 5000;')
      const version = Number((this.db.prepare('PRAGMA user_version').get() as { user_version?: number })?.user_version || 0)
      if (version > 1) throw new InstructionRepositoryError('unsupported_schema', `Instruction schema v${version} 尚未支援。`)
      const tableNames = new Set((this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name?: string }>)
        .map((row) => row.name)
        .filter((name): name is string => Boolean(name) && name !== 'sqlite_sequence'))
      const requiredTables = ['instruction_state', 'instruction_imports', 'instruction_migrations', 'instruction_include_grants']
      if (version === 1) {
        const missing = requiredTables.filter((table) => !tableNames.has(table))
        if (missing.length) {
          throw new InstructionRepositoryError('corrupt', `Instruction Repository schema 缺少資料表：${missing.join(', ')}。已保留原始檔案，不會自動建立空白 authority。`)
        }
      } else if (tableNames.size > 0) {
        throw new InstructionRepositoryError('migration_failed', 'Instruction Repository schema migration 失敗：發現未識別的 v0 資料表。已保留原始檔案。')
      }
      if (readOnly) return
      this.db.exec('PRAGMA journal_mode = WAL;')
      this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS instruction_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          revision INTEGER NOT NULL,
          global_custom TEXT NOT NULL,
          advanced_personality TEXT NOT NULL,
          personality TEXT,
          about_user TEXT,
          response_style TEXT,
          global_custom_presence TEXT,
          advanced_personality_presence TEXT,
          hash TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS instruction_imports (
          bundle_id TEXT PRIMARY KEY,
          applied_revision INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS instruction_migrations (
          migration_id TEXT PRIMARY KEY,
          source_hash TEXT NOT NULL,
          backup_json TEXT NOT NULL,
          report_json TEXT NOT NULL,
          applied_revision INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS instruction_include_grants (
          target TEXT PRIMARY KEY,
          authorized_at TEXT NOT NULL
        );
        PRAGMA user_version = 1;
        COMMIT;
      `)
      const columns = this.db.prepare('PRAGMA table_info(instruction_state)').all() as Array<{ name?: string }>
      const names = new Set(columns.map((column) => column.name))
      // Existing v1 databases predate presence metadata. Nullable columns keep
      // their old hashes valid; the next Host-owned save/migration materializes
      // explicit unset/blank/value semantics.
      if (!names.has('global_custom_presence')) this.db.exec('ALTER TABLE instruction_state ADD COLUMN global_custom_presence TEXT')
      if (!names.has('advanced_personality_presence')) this.db.exec('ALTER TABLE instruction_state ADD COLUMN advanced_personality_presence TEXT')
    } catch (error) {
      if (error instanceof InstructionRepositoryError) throw error
      throw mapSqliteError(error)
    }
  }

  static async open(path: string) { return new SqliteInstructionRepository(path) }
  static async openReadOnly(path: string) { return new SqliteInstructionRepository(path, true) }
  private ensureOpen() { if (this.closed) throw new InstructionRepositoryError('closed', 'Instruction Repository 已關閉。') }

  async read(): Promise<PersonalizationInstructionSnapshot> {
    this.ensureOpen()
    try {
      const columns = this.db.prepare('PRAGMA table_info(instruction_state)').all() as Array<{ name?: string }>
      const names = new Set(columns.map((column) => column.name))
      const presenceColumns = names.has('global_custom_presence') && names.has('advanced_personality_presence')
        ? ', global_custom_presence, advanced_personality_presence'
        : ''
      const row = this.db.prepare(`SELECT revision, global_custom, advanced_personality, personality, about_user, response_style${presenceColumns}, hash, updated_at FROM instruction_state WHERE singleton = 1`).get() as InstructionRow | undefined
      if (!row) return emptySnapshot()
      const current = snapshot({
        schemaVersion: 1,
        revision: row.revision,
        globalCustomInstructions: row.global_custom,
        advancedPersonalityInstructions: row.advanced_personality,
        ...(row.personality !== null ? { personality: row.personality } : {}),
        ...(row.about_user !== null ? { aboutUser: row.about_user } : {}),
        ...(row.response_style !== null ? { responseStyle: row.response_style } : {}),
        ...(typeof row.global_custom_presence === 'string' ? { globalCustomInstructionsPresence: row.global_custom_presence } : {}),
        ...(typeof row.advanced_personality_presence === 'string' ? { advancedPersonalityInstructionsPresence: row.advanced_personality_presence } : {}),
        updatedAt: row.updated_at,
      })
      if (current.hash !== row.hash) throw new InstructionRepositoryError('corrupt', 'Instruction Repository row hash 不一致。')
      return current
    } catch (error) {
      if (error instanceof InstructionRepositoryError) throw error
      throw mapSqliteError(error)
    }
  }

  async save(input: SavePersonalizationInstructions): Promise<PersonalizationInstructionSnapshot> {
    this.ensureOpen()
    if (this.readOnly) throw new InstructionRepositoryError('read_only', 'Instruction Repository recovery mode 為唯讀。')
    let release!: () => void
    const previous = this.writeTail
    this.writeTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      this.db.exec('BEGIN IMMEDIATE')
      const current = await this.read()
      if (input.expectedRevision !== current.revision) throw new InstructionRepositoryError('conflict', '已有較新的個人化 revision。')
      const next = normalizeSave(input, current.revision + 1)
      this.db.prepare(`INSERT INTO instruction_state
        (singleton, revision, global_custom, advanced_personality, personality, about_user, response_style, global_custom_presence, advanced_personality_presence, hash, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision, global_custom=excluded.global_custom,
          advanced_personality=excluded.advanced_personality, personality=excluded.personality,
          about_user=excluded.about_user, response_style=excluded.response_style,
          global_custom_presence=excluded.global_custom_presence, advanced_personality_presence=excluded.advanced_personality_presence,
          hash=excluded.hash, updated_at=excluded.updated_at
      `).run(next.revision, next.globalCustomInstructions, next.advancedPersonalityInstructions, next.personality ?? null, next.aboutUser ?? null, next.responseStyle ?? null, next.globalCustomInstructionsPresence ?? null, next.advancedPersonalityInstructionsPresence ?? null, next.hash, next.updatedAt)
      this.db.exec('COMMIT')
      return next
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* preserve original */ }
      // Another Host client may have committed while this client was waiting
      // for BEGIN IMMEDIATE. Re-read after releasing the lock so a stale CAS
      // request reports the same public conflict as the serialized path,
      // rather than leaking SQLite's transient busy state to the renderer.
      const mapped = error instanceof InstructionRepositoryError ? error : mapSqliteError(error)
      if (mapped.code === 'busy') {
        // SQLite can report the lock release and the WAL commit on adjacent
        // turns. Give the other client a short, bounded observation window so
        // a concurrent stale CAS is normalized to conflict deterministically.
        for (let attempt = 0; attempt < 8; attempt += 1) {
          try {
            const latest = await this.read()
            if (latest.revision !== input.expectedRevision) {
              throw new InstructionRepositoryError('conflict', '已有較新的個人化 revision。')
            }
          } catch (latestError) {
            if (latestError instanceof InstructionRepositoryError && latestError.code === 'conflict') throw latestError
          }
          await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 10))
        }
      }
      throw mapped
    } finally { release() }
  }

  async exportBundle() { return exportBundle(await this.read(), await this.listAuthorizedIncludeTargets()) }
  async previewImport(bundle: unknown) {
    const local = await this.read()
    const bundleId = bundle && typeof bundle === 'object' && 'bundleId' in bundle ? String(bundle.bundleId) : ''
    const applied = Boolean(bundleId && this.db.prepare('SELECT 1 FROM instruction_imports WHERE bundle_id = ?').get(bundleId))
    return importPreview(local, bundle, applied)
  }
  async applyImport(preview: PersonalizationImportPreview, expectedRevision: number) {
    if (!preview.bundle || preview.status === 'invalid' || preview.status === 'conflict') throw new InstructionRepositoryError('invalid_import', '匯入 preview 不可套用。')
    this.ensureOpen()
    if (this.readOnly) throw new InstructionRepositoryError('read_only', 'Instruction Repository recovery mode 為唯讀。')
    if (preview.status === 'unchanged') return this.read()
    const incoming = preview.bundle.snapshot
    let release!: () => void
    const previous = this.writeTail
    this.writeTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      this.db.exec('BEGIN IMMEDIATE')
      const alreadyApplied = this.db.prepare('SELECT 1 FROM instruction_imports WHERE bundle_id = ?').get(preview.bundle.bundleId)
      const current = await this.read()
      if (alreadyApplied) {
        this.db.exec('COMMIT')
        return current
      }
      if (expectedRevision !== current.revision) throw new InstructionRepositoryError('conflict', '已有較新的個人化 revision。')
      const next = normalizeSave({
        expectedRevision,
        globalCustomInstructions: incoming.globalCustomInstructions,
        advancedPersonalityInstructions: incoming.advancedPersonalityInstructions,
        personality: incoming.personality,
        aboutUser: incoming.aboutUser,
        responseStyle: incoming.responseStyle,
      }, current.revision + 1, {
        globalCustomInstructionsPresence: incoming.globalCustomInstructionsPresence,
        advancedPersonalityInstructionsPresence: incoming.advancedPersonalityInstructionsPresence,
      })
      this.db.prepare(`INSERT INTO instruction_state
        (singleton, revision, global_custom, advanced_personality, personality, about_user, response_style, global_custom_presence, advanced_personality_presence, hash, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision, global_custom=excluded.global_custom,
          advanced_personality=excluded.advanced_personality, personality=excluded.personality,
          about_user=excluded.about_user, response_style=excluded.response_style,
          global_custom_presence=excluded.global_custom_presence, advanced_personality_presence=excluded.advanced_personality_presence,
          hash=excluded.hash, updated_at=excluded.updated_at
      `).run(next.revision, next.globalCustomInstructions, next.advancedPersonalityInstructions, next.personality ?? null, next.aboutUser ?? null, next.responseStyle ?? null, next.globalCustomInstructionsPresence ?? null, next.advancedPersonalityInstructionsPresence ?? null, next.hash, next.updatedAt)
      this.db.prepare('INSERT INTO instruction_imports (bundle_id, applied_revision) VALUES (?, ?)').run(preview.bundle.bundleId, next.revision)
      this.db.exec('COMMIT')
      return next
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* preserve original */ }
      if (error instanceof InstructionRepositoryError) throw error
      throw mapSqliteError(error)
    } finally { release() }
  }
  async migrateLegacy(input: LegacyInstructionMigrationInput) {
    this.ensureOpen()
    if (this.readOnly) throw new InstructionRepositoryError('read_only', 'Instruction Repository recovery mode 為唯讀。')
    let release!: () => void
    const previous = this.writeTail
    this.writeTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      this.db.exec('BEGIN IMMEDIATE')
      const existing = this.db.prepare('SELECT report_json FROM instruction_migrations WHERE migration_id = ?').get('legacy-personalization-v1') as { report_json: string } | undefined
      const current = await this.read()
      if (existing) {
        this.db.exec('COMMIT')
        const report = JSON.parse(existing.report_json) as LegacyInstructionMigrationReport
        return { instructions: current, report: Object.freeze({ ...report, status: 'already_migrated' as const }) }
      }
      const status = current.revision === 0 ? 'migrated' as const : 'skipped_existing' as const
      const next = status === 'migrated' ? normalizeSave({
        expectedRevision: 0,
        globalCustomInstructions: input.agents ?? '',
        advancedPersonalityInstructions: input.soul ?? '',
        ...(input.personality !== undefined ? { personality: input.personality } : {}),
        ...(input.aboutUser !== undefined ? { aboutUser: input.aboutUser } : {}),
        ...(input.responseStyle !== undefined ? { responseStyle: input.responseStyle } : {}),
      }, 1, {
        globalCustomInstructionsPresence: presenceOf(input.agents),
        advancedPersonalityInstructionsPresence: presenceOf(input.soul),
      }) : current
      if (status === 'migrated') {
        this.db.prepare(`INSERT INTO instruction_state
          (singleton, revision, global_custom, advanced_personality, personality, about_user, response_style, global_custom_presence, advanced_personality_presence, hash, updated_at)
          VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(next.revision, next.globalCustomInstructions, next.advancedPersonalityInstructions, next.personality ?? null, next.aboutUser ?? null, next.responseStyle ?? null, next.globalCustomInstructionsPresence ?? null, next.advancedPersonalityInstructionsPresence ?? null, next.hash, next.updatedAt)
      }
      const report = migrationReport(status, input, next.revision)
      this.db.prepare('INSERT INTO instruction_migrations (migration_id, source_hash, backup_json, report_json, applied_revision) VALUES (?, ?, ?, ?, ?)')
        .run('legacy-personalization-v1', report.sourceHash, JSON.stringify(report.backup), JSON.stringify(report), report.appliedRevision)
      this.db.exec('COMMIT')
      return { instructions: next, report }
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* preserve original */ }
      if (error instanceof InstructionRepositoryError) throw error
      const mapped = mapSqliteError(error)
      if (mapped.code === 'corrupt' || mapped.code === 'read_only' || mapped.code === 'busy') throw mapped
      throw new InstructionRepositoryError('migration_failed', `Legacy personalization migration 失敗：${mapped.message}`, error)
    } finally { release() }
  }
  async listAuthorizedIncludeTargets(): Promise<readonly string[]> {
    this.ensureOpen()
    try {
      return Object.freeze((this.db.prepare('SELECT target FROM instruction_include_grants ORDER BY target').all() as Array<{ target: string }>).map((row) => row.target))
    } catch (error) {
      if (this.readOnly && /no such table/i.test(error instanceof Error ? error.message : String(error))) return Object.freeze([])
      if (error instanceof InstructionRepositoryError) throw error
      throw mapSqliteError(error)
    }
  }
  async authorizeIncludeTarget(target: string): Promise<readonly string[]> {
    this.ensureOpen()
    if (this.readOnly) throw new InstructionRepositoryError('read_only', 'Instruction Repository recovery mode 為唯讀。')
    if (!target) throw new InstructionRepositoryError('io_error', 'include authorization target 不可為空。')
    try {
      this.db.prepare('INSERT OR IGNORE INTO instruction_include_grants (target, authorized_at) VALUES (?, ?)').run(target, new Date().toISOString())
      return this.listAuthorizedIncludeTargets()
    } catch (error) {
      if (error instanceof InstructionRepositoryError) throw error
      throw mapSqliteError(error)
    }
  }
  async close() {
    if (this.closed) return
    await this.writeTail
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); this.db.close(); this.closed = true } catch (error) { throw mapSqliteError(error) }
  }
}
