import fs from 'node:fs'
import path from 'node:path'
import type {
  ExternalCliCheckpointRecord,
  ExternalCliCheckpointStore,
} from '../src/agent/externalCliCheckpoint'

const MAX_RECORDS = 128

/** Small atomic JSON store; prompt/event bodies never enter this file. */
export class JsonExternalCliCheckpointStore implements ExternalCliCheckpointStore {
  private readonly filePath: string
  private records = new Map<string, ExternalCliCheckpointRecord>()

  constructor(filePath: string) {
    this.filePath = filePath
    this.load()
  }

  save(record: ExternalCliCheckpointRecord): void {
    this.records.set(record.runId, record)
    this.trim()
    this.flush()
  }

  list(): ExternalCliCheckpointRecord[] {
    return [...this.records.values()].map((record) => structuredClone(record))
  }

  markInterrupted(runId: string, input: {
    at: number
    reason: string
    resumable: boolean
    automaticRetry: boolean
  }): ExternalCliCheckpointRecord | undefined {
    const current = this.records.get(runId)
    if (!current || !current.active) return current ? structuredClone(current) : undefined
    const record: ExternalCliCheckpointRecord = {
      ...current,
      active: false,
      phase: 'interrupted',
      checkpointedAt: input.at,
      terminal: {
        classification: 'interrupted',
        phase: 'interrupted',
        at: input.at,
        reason: input.reason,
        terminationConfirmed: false,
        providerSessionId: current.providerSessionId,
      },
      recovery: {
        interruptedAt: input.at,
        reason: input.reason,
        resumable: input.resumable,
        automaticRetry: input.automaticRetry,
      },
    }
    this.records.set(runId, record)
    this.flush()
    return structuredClone(record)
  }

  private load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown
      const rows = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { records?: unknown }).records)
          ? (parsed as { records: unknown[] }).records
          : []
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        const record = row as ExternalCliCheckpointRecord
        if (record.schemaVersion === 1 && typeof record.runId === 'string' && typeof record.conversationId === 'string') {
          this.records.set(record.runId, record)
        }
      }
      this.trim()
    } catch {
      /* First launch or corrupt checkpoint file: fail closed with no records. */
    }
  }

  private trim() {
    const rows = [...this.records.values()].sort((a, b) => b.checkpointedAt - a.checkpointedAt)
    this.records = new Map(rows.slice(0, MAX_RECORDS).map((record) => [record.runId, record]))
  }

  private flush() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      const tempPath = `${this.filePath}.${process.pid}.tmp`
      fs.writeFileSync(tempPath, JSON.stringify([...this.records.values()]), { mode: 0o600 })
      fs.renameSync(tempPath, this.filePath)
    } catch {
      /* Persistence is best effort; live session remains Host-owned. */
    }
  }
}
