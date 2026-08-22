import type {
  ExternalCliAdapter,
  ExternalCliRunPhase,
  ExternalCliTerminalClassification,
} from './externalCliRunSession.ts'

/**
 * Secret-free production evidence for one supervised external CLI run.
 *
 * This record intentionally contains timing/counter metadata only. Provider
 * output, prompts, URLs, credentials, and operation arguments stay outside
 * the telemetry contract.
 */
export type ExternalCliTelemetryRecord = {
  schemaVersion: 1
  runId: string
  adapter: ExternalCliAdapter
  startedAt: number
  firstValidLifecycleAt?: number
  finishedAt: number
  durationMs: number
  eventCount: number
  phaseChanges: Array<{ phase: ExternalCliRunPhase; at: number }>
  timeoutClass?: Extract<
    ExternalCliTerminalClassification,
    'startup-timeout' | 'idle-timeout' | 'absolute-timeout' | 'operation-timeout'
  >
  settlement: ExternalCliTerminalClassification
}

/** Host-owned sink; implementations must preserve the secret-free shape. */
export type ExternalCliTelemetrySink = {
  record: (record: ExternalCliTelemetryRecord) => void | Promise<void>
}
