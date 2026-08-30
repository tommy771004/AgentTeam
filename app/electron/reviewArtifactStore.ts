import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { canTransitionReviewSnapshot } from '../src/agent/reviewContract.ts'
import type {
  AttributionFidelity,
  ReviewAdmissionSnapshot,
  ReviewFileManifestEntry,
  ReviewSnapshotStatus,
  ReviewWorkspaceBaseline,
} from '../src/agent/reviewContract.ts'

const SCHEMA_VERSION = 1

export type ReviewArtifactStoreErrorCode = 'invalid_input' | 'not_found' | 'conflict' | 'corrupt' | 'closed' | 'unsupported_schema'

export class ReviewArtifactStoreError extends Error {
  readonly code: ReviewArtifactStoreErrorCode
  readonly cause?: unknown

  constructor(code: ReviewArtifactStoreErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'ReviewArtifactStoreError'
    this.code = code
    this.cause = cause
  }
}

export type ReviewArtifactProjection = {
  schemaVersion: 1
  snapshotId: string
  runId: string
  threadId: string
  status: ReviewSnapshotStatus
  admission: Extract<ReviewAdmissionSnapshot, { canonical: true }>
  settlement?: ReviewWorkspaceBaseline
  attributionFidelity: AttributionFidelity
  diagnostics: string[]
  manifest: ReviewFileManifestEntry[]
  manifestHash?: string
  payloadCount: number
  payloadBytes: number
  commentRefs: string[]
  reviewStateRefs: string[]
  finalizationDigest?: string
  tombstone?: { reason: string; deletedAt: string }
  /** Mutable lookup hint only; immutable admission remains display provenance. */
  workspaceRebind?: { projectRoot: string; reboundAt: string }
}

export type ReviewArtifactExportBundle = {
  schemaVersion: 1
  kind: 'agentstudio-review-artifact'
  exportedAt: string
  artifact: ReviewArtifactProjection
  payloads: Array<{ payloadId: string; contentBase64: string; sha256: string; bytes: number }>
  refs: { comments: string[]; reviewState: string[] }
  totalBytes: number
  bundleHash: string
}

export type ReviewArtifactImportPreview = {
  status: 'ready' | 'collision' | 'unsupported' | 'invalid' | 'missing'
  snapshotId?: string
  bundleHash?: string
  totalBytes?: number
  collisions: string[]
  diagnostics: string[]
}

export type ReviewArtifactRecoveryReport = { recovered: Array<{ snapshotId: string; from: 'pending' | 'capturing'; to: 'failed' }> }
export type ReviewArtifactRetentionReport = { retained: string[]; tombstoned: string[] }

export type ReviewArtifactFinalizeInput = {
  snapshotId: string
  status: 'ready' | 'partial' | 'failed'
  settlement: ReviewWorkspaceBaseline
  attributionFidelity: AttributionFidelity
  diagnostics?: string[]
  manifest: ReviewFileManifestEntry[]
  payloads: Array<{ payloadId: string; content: string | Uint8Array; sha256?: string }>
  commentRefs?: string[]
  reviewStateRefs?: string[]
}

export interface ReviewArtifactStore {
  beginRun(input: { admission: Extract<ReviewAdmissionSnapshot, { canonical: true }>; threadId: string }): Promise<ReviewArtifactProjection>
  finalizeRun(input: ReviewArtifactFinalizeInput): Promise<ReviewArtifactProjection>
  read(snapshotId: string): Promise<ReviewArtifactProjection>
  findByRunId(runId: string): Promise<ReviewArtifactProjection | undefined>
  /** Host-only payload read; protocol callers must page/bound it before projection. */
  readPayload(snapshotId: string, payloadId: string): Promise<Uint8Array>
  /** Bounded Host-side payload page; offsets and limits are bytes. */
  readPayloadPage(input: { snapshotId: string; payloadId: string; offset?: number; maxBytes?: number }): Promise<ReviewPayloadPage>
  deleteArtifact(snapshotId: string, reason: string, deletedAt?: string): Promise<ReviewArtifactProjection>
  exportArtifact(snapshotId: string): Promise<ReviewArtifactExportBundle>
  previewImport(bundle: unknown): Promise<ReviewArtifactImportPreview>
  importArtifact(bundle: unknown, expectedBundleHash: string): Promise<ReviewArtifactProjection>
  recoverInterrupted(): Promise<ReviewArtifactRecoveryReport>
  applyRetention(input: { retainedSnapshotIds: string[]; reason: string; olderThan?: string }): Promise<ReviewArtifactRetentionReport>
  hardDeleteArtifact(snapshotId: string): Promise<void>
  rebindWorkspace(snapshotId: string, projectRoot: string, reboundAt?: string): Promise<ReviewArtifactProjection>
  close(): Promise<void>
}

export type ReviewPayloadPage = {
  payloadId: string
  content: Uint8Array
  offset: number
  bytes: number
  nextOffset?: number
}

type StoredPayload = { content: Uint8Array; sha256: string }
type StoredRecord = ReviewArtifactProjection & { payloads: Map<string, StoredPayload> }

const MAX_REVIEW_PAYLOAD_PAGE_BYTES = 64 * 1024
const MAX_REVIEW_PAYLOAD_BYTES = 8 * 1024 * 1024
const MAX_REVIEW_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_REVIEW_MANIFEST_ENTRIES = 10_000

function payloadPage(payloadId: string, content: Uint8Array, offset = 0, maxBytes = 16 * 1024): ReviewPayloadPage {
  const start = Math.max(0, Math.min(content.byteLength, Math.floor(offset)))
  const limit = Math.max(1, Math.min(MAX_REVIEW_PAYLOAD_PAGE_BYTES, Math.floor(maxBytes)))
  const chunk = content.slice(start, start + limit)
  return {
    payloadId,
    content: chunk,
    offset: start,
    bytes: content.byteLength,
    ...(start + chunk.byteLength < content.byteLength ? { nextOffset: start + chunk.byteLength } : {}),
  }
}

function finalizationDigest(input: ReviewArtifactFinalizeInput, prepared: { manifest: ReviewFileManifestEntry[]; payloads: Map<string, StoredPayload> }): string {
  return sha256(JSON.stringify({
    status: input.status,
    settlement: input.settlement,
    attributionFidelity: input.attributionFidelity,
    diagnostics: input.diagnostics || [],
    manifest: prepared.manifest,
    payloads: [...prepared.payloads].map(([payloadId, payload]) => [payloadId, payload.sha256, payload.content.byteLength]),
  }))
}

function assertFinalizeTransition(current: ReviewSnapshotStatus, next: ReviewSnapshotStatus): void {
  if (canTransitionReviewSnapshot(current, next)) return
  // finalizeRun atomically crosses the transient capturing state; callers do
  // not observe a half-written capturing record.
  if (canTransitionReviewSnapshot(current, 'capturing') && canTransitionReviewSnapshot('capturing', next)) return
  throw new ReviewArtifactStoreError('conflict', `Illegal review snapshot transition: ${current} -> ${next}`)
}

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function manifestHash(manifest: ReviewFileManifestEntry[]): string {
  return sha256(JSON.stringify(manifest))
}

function sameAdmission(
  current: ReviewArtifactProjection,
  admission: Extract<ReviewAdmissionSnapshot, { canonical: true }>,
  threadId: string,
): boolean {
  return current.runId === admission.runId
    && current.threadId === threadId
    && JSON.stringify(current.admission) === JSON.stringify(admission)
}

function bytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? Buffer.from(content, 'utf8') : new Uint8Array(content)
}

function cloneProjection(record: StoredRecord): ReviewArtifactProjection {
  const { payloads: _payloads, ...projection } = record
  return structuredClone(projection)
}

function bundleHash(bundle: Omit<ReviewArtifactExportBundle, 'bundleHash'>): string {
  return sha256(JSON.stringify(bundle))
}

function parseImportBundle(value: unknown): ReviewArtifactExportBundle {
  if (!value || typeof value !== 'object') throw new ReviewArtifactStoreError('invalid_input', 'Review import bundle must be an object')
  const bundle = structuredClone(value) as Partial<ReviewArtifactExportBundle>
  if (bundle.schemaVersion !== 1 || bundle.kind !== 'agentstudio-review-artifact') throw new ReviewArtifactStoreError('unsupported_schema', 'Review import bundle schema is unsupported')
  if (!bundle.artifact?.snapshotId || bundle.artifact.schemaVersion !== 1 || !Array.isArray(bundle.payloads) || !bundle.refs || typeof bundle.bundleHash !== 'string') {
    throw new ReviewArtifactStoreError('invalid_input', 'Review import bundle is incomplete')
  }
  const { bundleHash: claimed, ...unsigned } = bundle as ReviewArtifactExportBundle
  if (bundleHash(unsigned) !== claimed) throw new ReviewArtifactStoreError('corrupt', 'Review import bundle hash mismatch')
  let totalBytes = 0
  for (const payload of bundle.payloads) {
    const content = Buffer.from(payload.contentBase64, 'base64')
    totalBytes += content.byteLength
    if (content.byteLength !== payload.bytes || sha256(content) !== payload.sha256) throw new ReviewArtifactStoreError('corrupt', `Review import payload integrity failed: ${payload.payloadId}`)
  }
  if (totalBytes !== bundle.totalBytes) throw new ReviewArtifactStoreError('corrupt', 'Review import byte total mismatch')
  return bundle as ReviewArtifactExportBundle
}

function importedRecord(bundle: ReviewArtifactExportBundle): StoredRecord {
  const input: ReviewArtifactFinalizeInput = {
    snapshotId: bundle.artifact.snapshotId,
    status: bundle.artifact.status === 'ready' ? 'ready' : bundle.artifact.status === 'partial' ? 'partial' : 'failed',
    settlement: bundle.artifact.settlement || bundle.artifact.admission.baseline!,
    attributionFidelity: bundle.artifact.attributionFidelity,
    diagnostics: bundle.artifact.diagnostics,
    manifest: bundle.artifact.manifest,
    payloads: bundle.payloads.map((payload) => ({ payloadId: payload.payloadId, content: Buffer.from(payload.contentBase64, 'base64'), sha256: payload.sha256 })),
    commentRefs: bundle.refs.comments,
    reviewStateRefs: bundle.refs.reviewState,
  }
  if (!input.settlement) throw new ReviewArtifactStoreError('invalid_input', 'Imported review artifact has no workspace baseline')
  const prepared = prepareFinalize(input)
  if (bundle.artifact.manifestHash !== prepared.manifestHash) throw new ReviewArtifactStoreError('corrupt', 'Imported review manifest hash mismatch')
  return {
    ...structuredClone(bundle.artifact), manifest: prepared.manifest, manifestHash: prepared.manifestHash,
    payloadCount: prepared.payloads.size, payloadBytes: prepared.payloadBytes, payloads: prepared.payloads,
    commentRefs: [...bundle.refs.comments], reviewStateRefs: [...bundle.refs.reviewState],
  }
}

function prepareFinalize(input: ReviewArtifactFinalizeInput): {
  manifest: ReviewFileManifestEntry[]
  payloads: Map<string, StoredPayload>
  manifestHash: string
  payloadBytes: number
} {
  if (!Array.isArray(input.manifest) || input.manifest.length > MAX_REVIEW_MANIFEST_ENTRIES || !Array.isArray(input.payloads)) {
    throw new ReviewArtifactStoreError('invalid_input', 'Review manifest or payloads exceed the bounded input contract')
  }
  const payloads = new Map<string, StoredPayload>()
  let payloadBytes = 0
  for (const payload of input.payloads) {
    if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(payload.payloadId) || payloads.has(payload.payloadId)) {
      throw new ReviewArtifactStoreError('invalid_input', 'Review payload ids must be unique and bounded')
    }
    const content = bytes(payload.content)
    if (content.byteLength > MAX_REVIEW_PAYLOAD_BYTES || payloadBytes + content.byteLength > MAX_REVIEW_TOTAL_BYTES) {
      throw new ReviewArtifactStoreError('invalid_input', 'Review payload exceeds the bounded artifact size')
    }
    payloadBytes += content.byteLength
    const hash = sha256(content)
    if (payload.sha256 && payload.sha256 !== hash) throw new ReviewArtifactStoreError('corrupt', `Review payload hash mismatch: ${payload.payloadId}`)
    payloads.set(payload.payloadId, { content, sha256: hash })
  }
  const paths = new Set<string>()
  const manifest = structuredClone(input.manifest).map((entry) => {
    if (!entry.path || entry.path.length > 4_096 || paths.has(entry.path) || /\u0000/.test(entry.path) || /^(?:[a-zA-Z]:[\\/]|[\\/]{1,2})/.test(entry.path)) {
      throw new ReviewArtifactStoreError('invalid_input', 'Review manifest paths must be relative, unique, and bounded')
    }
    if (entry.oldPath && (/\u0000/.test(entry.oldPath) || /^(?:[a-zA-Z]:[\\/]|[\\/]{1,2})/.test(entry.oldPath))) {
      throw new ReviewArtifactStoreError('invalid_input', 'Review old paths must be relative')
    }
    paths.add(entry.path)
    if (!entry.payloadRef) return entry
    const payload = payloads.get(entry.payloadRef)
    if (!payload) throw new ReviewArtifactStoreError('invalid_input', `Manifest references missing payload: ${entry.payloadRef}`)
    if (entry.contentHash && entry.contentHash !== payload.sha256) throw new ReviewArtifactStoreError('corrupt', `Manifest content hash mismatch: ${entry.path}`)
    return { ...entry, contentHash: payload.sha256 }
  })
  return {
    manifest,
    payloads,
    manifestHash: manifestHash(manifest),
    payloadBytes,
  }
}

function initialRecord(admission: Extract<ReviewAdmissionSnapshot, { canonical: true }>, threadId: string): StoredRecord {
  if (!admission.snapshotId || !threadId) throw new ReviewArtifactStoreError('invalid_input', 'snapshotId and threadId are required')
  return {
    schemaVersion: 1,
    snapshotId: admission.snapshotId,
    runId: admission.runId,
    threadId,
    status: admission.status,
    admission: structuredClone(admission),
    attributionFidelity: 'partial',
    diagnostics: admission.error ? [admission.error.message] : [],
    manifest: [],
    payloadCount: 0,
    payloadBytes: 0,
    commentRefs: [],
    reviewStateRefs: [],
    payloads: new Map(),
  }
}

export class InMemoryReviewArtifactStore implements ReviewArtifactStore {
  private records = new Map<string, StoredRecord>()
  private closed = false
  private ensureOpen() { if (this.closed) throw new ReviewArtifactStoreError('closed', 'Review Artifact Store is closed') }

  async beginRun(input: { admission: Extract<ReviewAdmissionSnapshot, { canonical: true }>; threadId: string }) {
    this.ensureOpen()
    const existing = this.records.get(input.admission.snapshotId)
    if (existing) {
      if (!sameAdmission(existing, input.admission, input.threadId)) throw new ReviewArtifactStoreError('conflict', 'Snapshot identity already belongs to another admission')
      return cloneProjection(existing)
    }
    const record = initialRecord(input.admission, input.threadId)
    this.records.set(record.snapshotId, record)
    return cloneProjection(record)
  }

  async finalizeRun(input: ReviewArtifactFinalizeInput) {
    this.ensureOpen()
    const current = this.records.get(input.snapshotId)
    if (!current) throw new ReviewArtifactStoreError('not_found', 'Review snapshot not found')
    if (current.status === 'deleted') throw new ReviewArtifactStoreError('conflict', 'Deleted review snapshot cannot be finalized')
    const prepared = prepareFinalize(input)
    const digest = finalizationDigest(input, prepared)
    if (current.status === 'ready') {
      if (current.finalizationDigest === digest) return cloneProjection(current)
      throw new ReviewArtifactStoreError('conflict', 'Ready review snapshot is immutable')
    }
    if (current.finalizationDigest === digest) return cloneProjection(current)
    assertFinalizeTransition(current.status, input.status)
    const next: StoredRecord = {
      ...current,
      status: input.status,
      settlement: structuredClone(input.settlement),
      attributionFidelity: input.attributionFidelity,
      diagnostics: [...(input.diagnostics || [])],
      manifest: prepared.manifest,
      manifestHash: prepared.manifestHash,
      payloadCount: prepared.payloads.size,
      payloadBytes: prepared.payloadBytes,
      commentRefs: [...(input.commentRefs || current.commentRefs)],
      reviewStateRefs: [...(input.reviewStateRefs || current.reviewStateRefs)],
      finalizationDigest: digest,
      payloads: prepared.payloads,
    }
    this.records.set(input.snapshotId, next)
    return cloneProjection(next)
  }

  async read(snapshotId: string) {
    this.ensureOpen()
    const record = this.records.get(snapshotId)
    if (!record) throw new ReviewArtifactStoreError('not_found', 'Review snapshot not found')
    verifyRecord(record)
    return cloneProjection(record)
  }

  async findByRunId(runId: string) {
    this.ensureOpen()
    const record = [...this.records.values()].find((candidate) => candidate.runId === runId)
    if (!record) return undefined
    verifyRecord(record)
    return cloneProjection(record)
  }

  async readPayload(snapshotId: string, payloadId: string) {
    this.ensureOpen()
    const record = this.records.get(snapshotId)
    if (!record) throw new ReviewArtifactStoreError('not_found', 'Review snapshot not found')
    verifyRecord(record)
    const payload = record.payloads.get(payloadId)
    if (!payload) throw new ReviewArtifactStoreError('not_found', 'Review payload not found')
    return new Uint8Array(payload.content)
  }

  async readPayloadPage(input: { snapshotId: string; payloadId: string; offset?: number; maxBytes?: number }) {
    return payloadPage(input.payloadId, await this.readPayload(input.snapshotId, input.payloadId), input.offset, input.maxBytes)
  }

  async deleteArtifact(snapshotId: string, reason: string, deletedAt = new Date().toISOString()) {
    this.ensureOpen()
    const current = this.records.get(snapshotId)
    if (!current) throw new ReviewArtifactStoreError('not_found', 'Review snapshot not found')
    const next: StoredRecord = { ...current, status: 'deleted', manifest: [], manifestHash: undefined, payloadCount: 0, payloadBytes: 0, payloads: new Map(), finalizationDigest: undefined, tombstone: { reason, deletedAt } }
    this.records.set(snapshotId, next)
    return cloneProjection(next)
  }

  async exportArtifact(snapshotId: string) {
    this.ensureOpen()
    const record = this.records.get(snapshotId)
    if (!record || record.status === 'deleted') throw new ReviewArtifactStoreError('not_found', 'Exportable review snapshot not found')
    verifyRecord(record)
    const payloads = [...record.payloads].map(([payloadId, payload]) => ({ payloadId, contentBase64: Buffer.from(payload.content).toString('base64'), sha256: payload.sha256, bytes: payload.content.byteLength }))
    const unsigned: Omit<ReviewArtifactExportBundle, 'bundleHash'> = {
      schemaVersion: 1, kind: 'agentstudio-review-artifact', exportedAt: new Date().toISOString(), artifact: cloneProjection(record), payloads,
      refs: { comments: [...record.commentRefs], reviewState: [...record.reviewStateRefs] }, totalBytes: record.payloadBytes,
    }
    return { ...unsigned, bundleHash: bundleHash(unsigned) }
  }

  async previewImport(value: unknown): Promise<ReviewArtifactImportPreview> {
    this.ensureOpen()
    try {
      const bundle = parseImportBundle(value)
      importedRecord(bundle)
      const collision = this.records.has(bundle.artifact.snapshotId)
      return { status: collision ? 'collision' : 'ready', snapshotId: bundle.artifact.snapshotId, bundleHash: bundle.bundleHash, totalBytes: bundle.totalBytes, collisions: collision ? [bundle.artifact.snapshotId] : [], diagnostics: [] }
    } catch (error) {
      const item = error as ReviewArtifactStoreError
      const missing = item.code === 'not_found' || /missing|no workspace baseline/i.test(item.message)
      return { status: item.code === 'unsupported_schema' ? 'unsupported' : missing ? 'missing' : 'invalid', collisions: [], diagnostics: [item.message] }
    }
  }

  async importArtifact(value: unknown, expectedBundleHash: string) {
    this.ensureOpen()
    const bundle = parseImportBundle(value)
    if (bundle.bundleHash !== expectedBundleHash) throw new ReviewArtifactStoreError('conflict', 'Review import changed after preview')
    if (this.records.has(bundle.artifact.snapshotId)) throw new ReviewArtifactStoreError('conflict', 'Review import snapshot identity already exists')
    const record = importedRecord(bundle)
    this.records.set(record.snapshotId, record)
    return cloneProjection(record)
  }

  async recoverInterrupted(): Promise<ReviewArtifactRecoveryReport> {
    this.ensureOpen()
    const recovered: ReviewArtifactRecoveryReport['recovered'] = []
    for (const [snapshotId, current] of this.records) {
      if (current.status !== 'pending' && current.status !== 'capturing') continue
      const from = current.status
      this.records.set(snapshotId, { ...current, status: 'failed', diagnostics: [...current.diagnostics, 'Host restarted before Review capture committed'], manifest: [], manifestHash: undefined, payloadCount: 0, payloadBytes: 0, payloads: new Map() })
      recovered.push({ snapshotId, from, to: 'failed' })
    }
    return { recovered }
  }

  async applyRetention(input: { retainedSnapshotIds: string[]; reason: string; olderThan?: string }): Promise<ReviewArtifactRetentionReport> {
    this.ensureOpen()
    const protectedIds = new Set(input.retainedSnapshotIds)
    const retained: string[] = []
    const tombstoned: string[] = []
    for (const record of [...this.records.values()]) {
      const capturedAt = record.admission.baseline?.capturedAt || ''
      const referenced = record.commentRefs.length > 0 || record.reviewStateRefs.length > 0
      if (protectedIds.has(record.snapshotId) || referenced || record.status === 'deleted' || (input.olderThan && capturedAt >= input.olderThan)) { retained.push(record.snapshotId); continue }
      await this.deleteArtifact(record.snapshotId, input.reason)
      tombstoned.push(record.snapshotId)
    }
    return { retained, tombstoned }
  }

  async hardDeleteArtifact(snapshotId: string) { this.ensureOpen(); this.records.delete(snapshotId) }

  async rebindWorkspace(snapshotId: string, projectRoot: string, reboundAt = new Date().toISOString()) {
    this.ensureOpen()
    if (!projectRoot.trim()) throw new ReviewArtifactStoreError('invalid_input', 'Rebind project root is required')
    const current = this.records.get(snapshotId)
    if (!current || current.status === 'deleted') throw new ReviewArtifactStoreError('not_found', 'Review snapshot not found')
    const next = { ...current, workspaceRebind: { projectRoot, reboundAt } }
    this.records.set(snapshotId, next)
    return cloneProjection(next)
  }

  async close() { this.closed = true }
}

function verifyRecord(record: StoredRecord): void {
  if (record.status === 'deleted') return
  if ((record.status === 'ready' || record.status === 'partial') && !record.manifestHash) {
    throw new ReviewArtifactStoreError('corrupt', 'Finalized review artifact has no manifest hash')
  }
  if (record.manifestHash && manifestHash(record.manifest) !== record.manifestHash) throw new ReviewArtifactStoreError('corrupt', 'Review manifest hash mismatch')
  if (record.payloads.size !== record.payloadCount) throw new ReviewArtifactStoreError('corrupt', 'Review payload count mismatch')
  const payloadBytes = [...record.payloads.values()].reduce((total, payload) => total + payload.content.byteLength, 0)
  if (payloadBytes !== record.payloadBytes) throw new ReviewArtifactStoreError('corrupt', 'Review payload byte count mismatch')
  for (const entry of record.manifest) {
    if (!entry.payloadRef) continue
    const payload = record.payloads.get(entry.payloadRef)
    if (!payload || sha256(payload.content) !== payload.sha256 || entry.contentHash !== payload.sha256) {
      throw new ReviewArtifactStoreError('corrupt', `Review payload integrity failed: ${entry.path}`)
    }
  }
}

type SnapshotRow = { metadata_json: string; status: ReviewSnapshotStatus; manifest_hash: string | null; payload_count: number; payload_bytes: number }

export class SqliteReviewArtifactStore implements ReviewArtifactStore {
  private db: DatabaseSync
  private closed = false

  private constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath)
    this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
    const version = Number((this.db.prepare('PRAGMA user_version').get() as { user_version?: number }).user_version || 0)
    if (version > SCHEMA_VERSION) {
      this.db.close()
      throw new ReviewArtifactStoreError('unsupported_schema', `Review Artifact schema v${version} is unsupported`)
    }
    const tables = new Set((this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name?: string }>)
      .map((row) => row.name).filter((name): name is string => Boolean(name) && name !== 'sqlite_sequence'))
    const requiredTables = ['review_snapshots', 'review_manifest', 'review_payloads', 'review_tombstones', 'review_schema_migrations']
    if (version === SCHEMA_VERSION && requiredTables.some((table) => !tables.has(table))) {
      throw new ReviewArtifactStoreError('corrupt', 'Review Artifact schema is incomplete; existing authority was not replaced')
    }
    if (version === 0 && tables.size > 0) {
      throw new ReviewArtifactStoreError('corrupt', 'Review Artifact v0 contains unrecognized tables; refusing to overwrite them')
    }
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS review_snapshots(snapshot_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, thread_id TEXT NOT NULL, status TEXT NOT NULL, metadata_json TEXT NOT NULL, manifest_hash TEXT, payload_count INTEGER NOT NULL DEFAULT 0, payload_bytes INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS review_manifest(snapshot_id TEXT NOT NULL REFERENCES review_snapshots(snapshot_id) ON DELETE CASCADE, position INTEGER NOT NULL, entry_json TEXT NOT NULL, PRIMARY KEY(snapshot_id, position));
      CREATE TABLE IF NOT EXISTS review_payloads(snapshot_id TEXT NOT NULL REFERENCES review_snapshots(snapshot_id) ON DELETE CASCADE, payload_id TEXT NOT NULL, content BLOB NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY(snapshot_id, payload_id));
      CREATE TABLE IF NOT EXISTS review_tombstones(snapshot_id TEXT PRIMARY KEY REFERENCES review_snapshots(snapshot_id) ON DELETE CASCADE, reason TEXT NOT NULL, deleted_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS review_schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT OR IGNORE INTO review_schema_migrations(version, applied_at) VALUES (1, CURRENT_TIMESTAMP);
      PRAGMA user_version = 1;
      COMMIT;`)
  }

  static async open(databasePath: string) {
    const store = new SqliteReviewArtifactStore(databasePath)
    await store.recoverInterrupted()
    return store
  }
  private ensureOpen() { if (this.closed) throw new ReviewArtifactStoreError('closed', 'Review Artifact Store is closed') }

  async beginRun(input: { admission: Extract<ReviewAdmissionSnapshot, { canonical: true }>; threadId: string }) {
    this.ensureOpen()
    const existing = this.db.prepare('SELECT run_id, thread_id FROM review_snapshots WHERE snapshot_id = ?').get(input.admission.snapshotId) as { run_id: string; thread_id: string } | undefined
    if (existing) {
      const current = await this.read(input.admission.snapshotId)
      if (!sameAdmission(current, input.admission, input.threadId)) throw new ReviewArtifactStoreError('conflict', 'Snapshot identity already belongs to another admission')
      return current
    }
    const record = initialRecord(input.admission, input.threadId)
    this.db.prepare('INSERT INTO review_snapshots(snapshot_id, run_id, thread_id, status, metadata_json) VALUES (?, ?, ?, ?, ?)')
      .run(record.snapshotId, record.runId, record.threadId, record.status, JSON.stringify(cloneProjection(record)))
    return cloneProjection(record)
  }

  async finalizeRun(input: ReviewArtifactFinalizeInput) {
    this.ensureOpen()
    const current = await this.read(input.snapshotId)
    if (current.status === 'deleted') throw new ReviewArtifactStoreError('conflict', 'Deleted review snapshot cannot be finalized')
    const prepared = prepareFinalize(input)
    const digest = finalizationDigest(input, prepared)
    if (current.status === 'ready') {
      if (current.finalizationDigest === digest) return current
      throw new ReviewArtifactStoreError('conflict', 'Ready review snapshot is immutable')
    }
    if (current.finalizationDigest === digest) return current
    assertFinalizeTransition(current.status, input.status)
    const projection: ReviewArtifactProjection = {
      ...current,
      status: input.status,
      settlement: structuredClone(input.settlement),
      attributionFidelity: input.attributionFidelity,
      diagnostics: [...(input.diagnostics || [])],
      manifest: prepared.manifest,
      manifestHash: prepared.manifestHash,
      payloadCount: prepared.payloads.size,
      payloadBytes: prepared.payloadBytes,
      commentRefs: [...(input.commentRefs || current.commentRefs)],
      reviewStateRefs: [...(input.reviewStateRefs || current.reviewStateRefs)],
      finalizationDigest: digest,
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('DELETE FROM review_manifest WHERE snapshot_id = ?').run(input.snapshotId)
      this.db.prepare('DELETE FROM review_payloads WHERE snapshot_id = ?').run(input.snapshotId)
      const manifestInsert = this.db.prepare('INSERT INTO review_manifest(snapshot_id, position, entry_json) VALUES (?, ?, ?)')
      projection.manifest.forEach((entry, position) => manifestInsert.run(input.snapshotId, position, JSON.stringify(entry)))
      const payloadInsert = this.db.prepare('INSERT INTO review_payloads(snapshot_id, payload_id, content, sha256) VALUES (?, ?, ?, ?)')
      for (const [payloadId, payload] of prepared.payloads) payloadInsert.run(input.snapshotId, payloadId, payload.content, payload.sha256)
      const updated = this.db.prepare('UPDATE review_snapshots SET status = ?, metadata_json = ?, manifest_hash = ?, payload_count = ?, payload_bytes = ? WHERE snapshot_id = ? AND status = ?')
        .run(projection.status, JSON.stringify(projection), projection.manifestHash ?? null, projection.payloadCount, projection.payloadBytes, input.snapshotId, current.status)
      if (Number(updated.changes) !== 1) {
        this.db.exec('ROLLBACK')
        const latest = await this.read(input.snapshotId)
        if (latest.status === 'ready' && latest.finalizationDigest === digest) return latest
        throw new ReviewArtifactStoreError('conflict', 'Review snapshot changed during finalization')
      }
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* preserve original */ }
      throw error
    }
    return projection
  }

  async read(snapshotId: string) {
    this.ensureOpen()
    const row = this.db.prepare('SELECT metadata_json, status, manifest_hash, payload_count, payload_bytes FROM review_snapshots WHERE snapshot_id = ?').get(snapshotId) as SnapshotRow | undefined
    if (!row) throw new ReviewArtifactStoreError('not_found', 'Review snapshot not found')
    let projection: ReviewArtifactProjection
    let manifest: Array<{ entry_json: string }>
    try {
      projection = JSON.parse(row.metadata_json) as ReviewArtifactProjection
      manifest = this.db.prepare('SELECT entry_json FROM review_manifest WHERE snapshot_id = ? ORDER BY position').all(snapshotId) as Array<{ entry_json: string }>
      projection.manifest = manifest.map((item) => JSON.parse(item.entry_json) as ReviewFileManifestEntry)
    } catch (error) {
      throw new ReviewArtifactStoreError('corrupt', 'Review snapshot metadata is not valid JSON', error)
    }
    projection.status = row.status
    projection.manifestHash = row.manifest_hash || undefined
    projection.payloadCount = row.payload_count
    projection.payloadBytes = row.payload_bytes
    const payloadRows = this.db.prepare('SELECT payload_id, content, sha256 FROM review_payloads WHERE snapshot_id = ?').all(snapshotId) as Array<{ payload_id: string; content: Uint8Array; sha256: string }>
    const record: StoredRecord = { ...projection, payloads: new Map(payloadRows.map((item) => [item.payload_id, { content: item.content, sha256: item.sha256 }])) }
    const tombstone = this.db.prepare('SELECT reason, deleted_at FROM review_tombstones WHERE snapshot_id = ?').get(snapshotId) as { reason: string; deleted_at: string } | undefined
    if (tombstone) projection.tombstone = { reason: tombstone.reason, deletedAt: tombstone.deleted_at }
    verifyRecord(record)
    return projection
  }

  async findByRunId(runId: string) {
    this.ensureOpen()
    const row = this.db.prepare('SELECT snapshot_id FROM review_snapshots WHERE run_id = ? LIMIT 1').get(runId) as { snapshot_id: string } | undefined
    return row ? this.read(row.snapshot_id) : undefined
  }

  async readPayload(snapshotId: string, payloadId: string) {
    this.ensureOpen()
    // Validate the complete record before returning any bytes, so a corrupt
    // sibling manifest/payload cannot be projected as a coherent snapshot.
    await this.read(snapshotId)
    const row = this.db.prepare('SELECT content FROM review_payloads WHERE snapshot_id = ? AND payload_id = ?').get(snapshotId, payloadId) as { content: Uint8Array } | undefined
    if (!row) throw new ReviewArtifactStoreError('not_found', 'Review payload not found')
    return new Uint8Array(row.content)
  }

  async readPayloadPage(input: { snapshotId: string; payloadId: string; offset?: number; maxBytes?: number }) {
    this.ensureOpen()
    // Validate the complete snapshot before exposing a bounded page. A page
    // cannot make a corrupt sibling payload look like a coherent artifact.
    await this.read(input.snapshotId)
    const row = this.db.prepare('SELECT content FROM review_payloads WHERE snapshot_id = ? AND payload_id = ?').get(input.snapshotId, input.payloadId) as { content: Uint8Array } | undefined
    if (!row) throw new ReviewArtifactStoreError('not_found', 'Review payload not found')
    return payloadPage(input.payloadId, new Uint8Array(row.content), input.offset, input.maxBytes)
  }

  async deleteArtifact(snapshotId: string, reason: string, deletedAt = new Date().toISOString()) {
    this.ensureOpen()
    const current = await this.read(snapshotId)
    const projection: ReviewArtifactProjection = { ...current, status: 'deleted', manifest: [], manifestHash: undefined, payloadCount: 0, payloadBytes: 0, tombstone: { reason, deletedAt }, finalizationDigest: undefined }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('DELETE FROM review_manifest WHERE snapshot_id = ?').run(snapshotId)
      this.db.prepare('DELETE FROM review_payloads WHERE snapshot_id = ?').run(snapshotId)
      this.db.prepare('INSERT INTO review_tombstones(snapshot_id, reason, deleted_at) VALUES (?, ?, ?) ON CONFLICT(snapshot_id) DO UPDATE SET reason=excluded.reason, deleted_at=excluded.deleted_at').run(snapshotId, reason, deletedAt)
      this.db.prepare('UPDATE review_snapshots SET status = ?, metadata_json = ?, manifest_hash = NULL, payload_count = 0, payload_bytes = 0 WHERE snapshot_id = ?').run('deleted', JSON.stringify(projection), snapshotId)
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* preserve original */ }
      throw error
    }
    return projection
  }

  async exportArtifact(snapshotId: string) {
    this.ensureOpen()
    const artifact = await this.read(snapshotId)
    if (artifact.status === 'deleted') throw new ReviewArtifactStoreError('not_found', 'Exportable review snapshot not found')
    const rows = this.db.prepare('SELECT payload_id, content, sha256 FROM review_payloads WHERE snapshot_id = ? ORDER BY payload_id').all(snapshotId) as Array<{ payload_id: string; content: Uint8Array; sha256: string }>
    const payloads = rows.map((row) => ({ payloadId: row.payload_id, contentBase64: Buffer.from(row.content).toString('base64'), sha256: row.sha256, bytes: row.content.byteLength }))
    const unsigned: Omit<ReviewArtifactExportBundle, 'bundleHash'> = {
      schemaVersion: 1, kind: 'agentstudio-review-artifact', exportedAt: new Date().toISOString(), artifact, payloads,
      refs: { comments: [...artifact.commentRefs], reviewState: [...artifact.reviewStateRefs] }, totalBytes: artifact.payloadBytes,
    }
    return { ...unsigned, bundleHash: bundleHash(unsigned) }
  }

  async previewImport(value: unknown): Promise<ReviewArtifactImportPreview> {
    this.ensureOpen()
    try {
      const bundle = parseImportBundle(value)
      importedRecord(bundle)
      const collision = Boolean(this.db.prepare('SELECT 1 AS present FROM review_snapshots WHERE snapshot_id = ?').get(bundle.artifact.snapshotId))
      return { status: collision ? 'collision' : 'ready', snapshotId: bundle.artifact.snapshotId, bundleHash: bundle.bundleHash, totalBytes: bundle.totalBytes, collisions: collision ? [bundle.artifact.snapshotId] : [], diagnostics: [] }
    } catch (error) {
      const item = error as ReviewArtifactStoreError
      const missing = item.code === 'not_found' || /missing|no workspace baseline/i.test(item.message)
      return { status: item.code === 'unsupported_schema' ? 'unsupported' : missing ? 'missing' : 'invalid', collisions: [], diagnostics: [item.message] }
    }
  }

  async importArtifact(value: unknown, expectedBundleHash: string) {
    this.ensureOpen()
    const bundle = parseImportBundle(value)
    if (bundle.bundleHash !== expectedBundleHash) throw new ReviewArtifactStoreError('conflict', 'Review import changed after preview')
    const record = importedRecord(bundle)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO review_snapshots(snapshot_id,run_id,thread_id,status,metadata_json,manifest_hash,payload_count,payload_bytes) VALUES(?,?,?,?,?,?,?,?)')
        .run(record.snapshotId, record.runId, record.threadId, record.status, JSON.stringify(cloneProjection(record)), record.manifestHash || null, record.payloadCount, record.payloadBytes)
      const manifestInsert = this.db.prepare('INSERT INTO review_manifest(snapshot_id,position,entry_json) VALUES(?,?,?)')
      record.manifest.forEach((entry, position) => manifestInsert.run(record.snapshotId, position, JSON.stringify(entry)))
      const payloadInsert = this.db.prepare('INSERT INTO review_payloads(snapshot_id,payload_id,content,sha256) VALUES(?,?,?,?)')
      for (const [payloadId, payload] of record.payloads) payloadInsert.run(record.snapshotId, payloadId, payload.content, payload.sha256)
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* preserve original */ }
      if (String(error).includes('UNIQUE constraint')) throw new ReviewArtifactStoreError('conflict', 'Review import snapshot identity already exists', error)
      throw error
    }
    return cloneProjection(record)
  }

  async recoverInterrupted(): Promise<ReviewArtifactRecoveryReport> {
    this.ensureOpen()
    const rows = this.db.prepare("SELECT snapshot_id,status,metadata_json FROM review_snapshots WHERE status IN ('pending','capturing')").all() as Array<{ snapshot_id: string; status: 'pending' | 'capturing'; metadata_json: string }>
    const recovered: ReviewArtifactRecoveryReport['recovered'] = []
    for (const row of rows) {
      let projection: ReviewArtifactProjection
      try { projection = JSON.parse(row.metadata_json) as ReviewArtifactProjection } catch { projection = { schemaVersion: 1, snapshotId: row.snapshot_id, runId: 'unknown', threadId: 'unknown', status: 'failed', admission: { snapshotId: row.snapshot_id, runId: 'unknown', status: 'failed', canonical: true, runnerKind: 'builtin', error: { code: 'snapshot-corrupt', message: 'Interrupted metadata was corrupt', retryable: false } }, attributionFidelity: 'partial', diagnostics: [], manifest: [], payloadCount: 0, payloadBytes: 0, commentRefs: [], reviewStateRefs: [] } }
      projection = { ...projection, status: 'failed', diagnostics: [...projection.diagnostics, 'Host restarted before Review capture committed'], manifest: [], manifestHash: undefined, payloadCount: 0, payloadBytes: 0, finalizationDigest: undefined }
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.prepare('DELETE FROM review_manifest WHERE snapshot_id = ?').run(row.snapshot_id)
        this.db.prepare('DELETE FROM review_payloads WHERE snapshot_id = ?').run(row.snapshot_id)
        this.db.prepare('UPDATE review_snapshots SET status=?,metadata_json=?,manifest_hash=NULL,payload_count=0,payload_bytes=0 WHERE snapshot_id=?').run('failed', JSON.stringify(projection), row.snapshot_id)
        this.db.exec('COMMIT')
      } catch (error) { try { this.db.exec('ROLLBACK') } catch {} throw error }
      recovered.push({ snapshotId: row.snapshot_id, from: row.status, to: 'failed' })
    }
    return { recovered }
  }

  async applyRetention(input: { retainedSnapshotIds: string[]; reason: string; olderThan?: string }): Promise<ReviewArtifactRetentionReport> {
    this.ensureOpen()
    const protectedIds = new Set(input.retainedSnapshotIds)
    const rows = this.db.prepare('SELECT snapshot_id,metadata_json,status FROM review_snapshots').all() as Array<{ snapshot_id: string; metadata_json: string; status: ReviewSnapshotStatus }>
    const retained: string[] = []
    const tombstoned: string[] = []
    for (const row of rows) {
      const projection = JSON.parse(row.metadata_json) as ReviewArtifactProjection
      const capturedAt = projection.admission.baseline?.capturedAt || ''
      const referenced = projection.commentRefs.length > 0 || projection.reviewStateRefs.length > 0
      if (protectedIds.has(row.snapshot_id) || referenced || row.status === 'deleted' || (input.olderThan && capturedAt >= input.olderThan)) { retained.push(row.snapshot_id); continue }
      await this.deleteArtifact(row.snapshot_id, input.reason)
      tombstoned.push(row.snapshot_id)
    }
    return { retained, tombstoned }
  }

  async hardDeleteArtifact(snapshotId: string) {
    this.ensureOpen()
    this.db.prepare('DELETE FROM review_snapshots WHERE snapshot_id = ?').run(snapshotId)
  }

  async rebindWorkspace(snapshotId: string, projectRoot: string, reboundAt = new Date().toISOString()) {
    this.ensureOpen()
    if (!projectRoot.trim()) throw new ReviewArtifactStoreError('invalid_input', 'Rebind project root is required')
    const current = await this.read(snapshotId)
    if (current.status === 'deleted') throw new ReviewArtifactStoreError('not_found', 'Review snapshot not found')
    const projection = { ...current, workspaceRebind: { projectRoot, reboundAt } }
    this.db.prepare('UPDATE review_snapshots SET metadata_json=? WHERE snapshot_id=?').run(JSON.stringify(projection), snapshotId)
    return projection
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }
}
