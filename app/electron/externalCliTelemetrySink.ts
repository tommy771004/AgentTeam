import fs from 'node:fs'
import path from 'node:path'
import type {
  ExternalCliTelemetryRecord,
  ExternalCliTelemetrySink,
} from '../src/agent/externalCliTelemetry'

const MAX_RECORDS = 256

/**
 * Main-process telemetry sink. The allow-list copy is deliberate: even if a
 * future caller hands this sink an accidental wider object, prompt/output
 * fields cannot be written to the durable telemetry file.
 */
export class JsonExternalCliTelemetrySink implements ExternalCliTelemetrySink {
  private readonly filePath: string
  private records: ExternalCliTelemetryRecord[] = []

  constructor(filePath: string) {
    this.filePath = filePath
    this.load()
  }

  record(record: ExternalCliTelemetryRecord): void {
    const safe: ExternalCliTelemetryRecord = {
      schemaVersion: 1,
      runId: String(record.runId).slice(0, 160),
      adapter: String(record.adapter).slice(0, 40),
      startedAt: Number.isFinite(record.startedAt) ? record.startedAt : 0,
      firstValidLifecycleAt: Number.isFinite(record.firstValidLifecycleAt) ? record.firstValidLifecycleAt : undefined,
      finishedAt: Number.isFinite(record.finishedAt) ? record.finishedAt : 0,
      durationMs: Math.max(0, Number(record.durationMs) || 0),
      eventCount: Math.max(0, Math.min(100_000, Number(record.eventCount) || 0)),
      phaseChanges: record.phaseChanges.slice(-256).map((change) => ({
        phase: change.phase,
        at: Number.isFinite(change.at) ? change.at : 0,
      })),
      timeoutClass: record.timeoutClass,
      settlement: record.settlement,
    }
    this.records = [...this.records, safe].slice(-MAX_RECORDS)
    this.flush()
  }

  list(): ExternalCliTelemetryRecord[] {
    return this.records.map((record) => structuredClone(record))
  }

  private load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown
      if (!Array.isArray(parsed)) return
      this.records = parsed.filter((record): record is ExternalCliTelemetryRecord => Boolean(
        record && typeof record === 'object' &&
        (record as ExternalCliTelemetryRecord).schemaVersion === 1 &&
        typeof (record as ExternalCliTelemetryRecord).runId === 'string' &&
        typeof (record as ExternalCliTelemetryRecord).adapter === 'string',
      )).slice(-MAX_RECORDS)
    } catch {
      /* First launch or corrupt telemetry is non-fatal. */
    }
  }

  private flush() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      const tempPath = `${this.filePath}.${process.pid}.tmp`
      fs.writeFileSync(tempPath, JSON.stringify(this.records), { mode: 0o600 })
      fs.renameSync(tempPath, this.filePath)
    } catch {
      /* Telemetry must never block a run. */
    }
  }
}
