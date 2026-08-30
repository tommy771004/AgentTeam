import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { ReviewVerificationRecord } from '../src/agent/reviewVerificationContract.ts'

const SCHEMA_VERSION = 1
const MAX_OUTPUT_BYTES = 1024 * 1024
const MAX_OUTPUT_PAGE_BYTES = 64 * 1024

export type ReviewVerificationWrite = Omit<ReviewVerificationRecord, 'id' | 'outputRef' | 'outputAvailability'> & {
  id?: string
  output?: string | Uint8Array
}

export type ReviewVerificationOutputPage = {
  outputRef: string
  content: Uint8Array
  bytes: number
  offset: number
  nextOffset?: number
}

export interface ReviewVerificationStore {
  record(input: ReviewVerificationWrite): Promise<ReviewVerificationRecord>
  list(snapshotId: string): Promise<ReviewVerificationRecord[]>
  readOutput(input: { outputRef: string; offset?: number; maxBytes?: number }): Promise<ReviewVerificationOutputPage>
  hardDeleteSnapshot(snapshotId: string): Promise<void>
  close(): Promise<void>
}

function boundedOutput(output?: string | Uint8Array): Uint8Array | undefined {
  if (output === undefined) return undefined
  const bytes = typeof output === 'string' ? Buffer.from(output) : Buffer.from(output)
  return bytes.subarray(0, MAX_OUTPUT_BYTES)
}

function outputPage(outputRef: string, content: Uint8Array, offset = 0, maxBytes = 16 * 1024): ReviewVerificationOutputPage {
  const start = Math.max(0, Math.min(content.byteLength, Math.floor(offset)))
  const limit = Math.max(1, Math.min(MAX_OUTPUT_PAGE_BYTES, Math.floor(maxBytes)))
  const chunk = content.slice(start, start + limit)
  return { outputRef, content: chunk, bytes: content.byteLength, offset: start, ...(start + chunk.byteLength < content.byteLength ? { nextOffset: start + chunk.byteLength } : {}) }
}

function prepare(input: ReviewVerificationWrite): { record: ReviewVerificationRecord; output?: Uint8Array } {
  const id = input.id || `verify_${randomUUID().replaceAll('-', '')}`
  const output = boundedOutput(input.output)
  const outputRef = output ? `verification_output_${createHash('sha256').update(output).digest('hex').slice(0, 32)}` : undefined
  return {
    record: {
      id,
      snapshotId: input.snapshotId,
      runId: input.runId,
      workspaceId: input.workspaceId,
      verifiedRevision: input.verifiedRevision,
      kind: input.kind,
      command: input.command,
      args: [...input.args],
      cwd: input.cwd,
      runner: 'host',
      startedAt: input.startedAt,
      durationMs: Math.max(0, Math.floor(input.durationMs)),
      ...(Number.isInteger(input.exitCode) ? { exitCode: input.exitCode } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(outputRef ? { outputRef, outputAvailability: 'available' as const } : { outputAvailability: 'missing' as const }),
      ...(input.detail ? { detail: input.detail } : {}),
    },
    output,
  }
}

export class InMemoryReviewVerificationStore implements ReviewVerificationStore {
  private records = new Map<string, ReviewVerificationRecord>()
  private outputs = new Map<string, Uint8Array>()
  private closed = false

  async record(input: ReviewVerificationWrite) {
    if (this.closed) throw new Error('Review verification store is closed')
    const prepared = prepare(input)
    this.records.set(prepared.record.id, prepared.record)
    if (prepared.record.outputRef && prepared.output) this.outputs.set(prepared.record.outputRef, prepared.output)
    return structuredClone(prepared.record)
  }

  async list(snapshotId: string) {
    if (this.closed) throw new Error('Review verification store is closed')
    return [...this.records.values()].filter((record) => record.snapshotId === snapshotId).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((record) => structuredClone(
      record.outputRef && !this.outputs.has(record.outputRef) ? { ...record, outputAvailability: 'missing' as const } : record,
    ))
  }

  async readOutput(input: { outputRef: string; offset?: number; maxBytes?: number }) {
    if (this.closed) throw new Error('Review verification store is closed')
    const output = this.outputs.get(input.outputRef)
    if (!output) throw new Error('Review verification output is missing')
    return outputPage(input.outputRef, output, input.offset, input.maxBytes)
  }

  async hardDeleteSnapshot(snapshotId: string) {
    if (this.closed) throw new Error('Review verification store is closed')
    const outputRefs = [...this.records.values()].filter((record) => record.snapshotId === snapshotId).map((record) => record.outputRef).filter((value): value is string => Boolean(value))
    for (const [id, record] of this.records) if (record.snapshotId === snapshotId) this.records.delete(id)
    const retained = new Set([...this.records.values()].map((record) => record.outputRef).filter((value): value is string => Boolean(value)))
    for (const outputRef of outputRefs) if (!retained.has(outputRef)) this.outputs.delete(outputRef)
  }

  async close() { this.closed = true }
}

type VerificationRow = { record_json: string }

export class SqliteReviewVerificationStore implements ReviewVerificationStore {
  private db: DatabaseSync

  private constructor(db: DatabaseSync) { this.db = db }

  static async open(databasePath: string) {
    const db = new DatabaseSync(databasePath)
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;')
    const version = Number((db.prepare('PRAGMA user_version').get() as { user_version?: number }).user_version || 0)
    if (version > SCHEMA_VERSION) { db.close(); throw new Error(`Review verification schema v${version} is unsupported`) }
    db.exec(`
      CREATE TABLE IF NOT EXISTS review_verification_records (
        id TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS review_verification_snapshot ON review_verification_records(snapshot_id, started_at DESC);
      CREATE TABLE IF NOT EXISTS review_verification_outputs (
        output_ref TEXT PRIMARY KEY,
        content BLOB NOT NULL
      );
      PRAGMA user_version = 1;
    `)
    return new SqliteReviewVerificationStore(db)
  }

  async record(input: ReviewVerificationWrite) {
    const prepared = prepare(input)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (prepared.record.outputRef && prepared.output) this.db.prepare('INSERT OR IGNORE INTO review_verification_outputs(output_ref, content) VALUES (?, ?)').run(prepared.record.outputRef, prepared.output)
      this.db.prepare('INSERT OR REPLACE INTO review_verification_records(id, snapshot_id, started_at, record_json) VALUES (?, ?, ?, ?)').run(prepared.record.id, prepared.record.snapshotId, prepared.record.startedAt, JSON.stringify(prepared.record))
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    return structuredClone(prepared.record)
  }

  async list(snapshotId: string) {
    return (this.db.prepare('SELECT record_json FROM review_verification_records WHERE snapshot_id = ? ORDER BY started_at DESC').all(snapshotId) as VerificationRow[]).map((row) => {
      const record = JSON.parse(row.record_json) as ReviewVerificationRecord
      if (!record.outputRef) return record
      const output = this.db.prepare('SELECT 1 AS present FROM review_verification_outputs WHERE output_ref = ?').get(record.outputRef)
      return output ? record : { ...record, outputAvailability: 'missing' as const }
    })
  }

  async readOutput(input: { outputRef: string; offset?: number; maxBytes?: number }) {
    const row = this.db.prepare('SELECT content FROM review_verification_outputs WHERE output_ref = ?').get(input.outputRef) as { content?: Uint8Array } | undefined
    if (!row?.content) throw new Error('Review verification output is missing')
    return outputPage(input.outputRef, row.content, input.offset, input.maxBytes)
  }

  async hardDeleteSnapshot(snapshotId: string) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const refs = (this.db.prepare('SELECT record_json FROM review_verification_records WHERE snapshot_id = ?').all(snapshotId) as VerificationRow[])
        .map((row) => (JSON.parse(row.record_json) as ReviewVerificationRecord).outputRef)
        .filter((value): value is string => Boolean(value))
      this.db.prepare('DELETE FROM review_verification_records WHERE snapshot_id = ?').run(snapshotId)
      const stillReferenced = this.db.prepare("SELECT 1 AS present FROM review_verification_records WHERE json_extract(record_json, '$.outputRef') = ? LIMIT 1")
      const deleteOutput = this.db.prepare('DELETE FROM review_verification_outputs WHERE output_ref = ?')
      for (const outputRef of refs) if (!stillReferenced.get(outputRef)) deleteOutput.run(outputRef)
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* preserve original */ }
      throw error
    }
  }

  async close() { this.db.close() }
}
