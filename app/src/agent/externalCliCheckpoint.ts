import type {
  ExternalCliAdapter,
  ExternalCliRunPhase,
  ExternalCliRunPolicy,
  ExternalCliSessionSnapshot,
  ExternalCliTerminal,
} from './externalCliRunSession.ts'

export type ExternalCliCheckpointRecord = {
  schemaVersion: 1
  runId: string
  conversationId: string
  adapter: ExternalCliAdapter
  phase: ExternalCliRunPhase
  active: boolean
  startedAt: number
  firstValidLifecycleAt?: number
  lastMeaningfulActivityAt?: number
  processId?: string
  providerSessionId?: string
  eventCursor: number
  policy: ExternalCliRunPolicy
  unattended: boolean
  waitingDetail?: string
  /** Bounded, already-redacted output evidence. No event body or prompt. */
  output: ExternalCliSessionSnapshot['output']
  terminal: ExternalCliTerminal | null
  checkpointedAt: number
  adapterSupportsResume: boolean
  replaySafeCheckpoint: boolean
  recovery?: {
    interruptedAt: number
    reason: string
    resumable: boolean
    automaticRetry: boolean
  }
}
export type ExternalCliCheckpointStore = {
  save(record: ExternalCliCheckpointRecord): void
  list(): ExternalCliCheckpointRecord[]
  markInterrupted(
    runId: string,
    input: {
      at: number
      reason: string
      resumable: boolean
      automaticRetry: boolean
    },
  ): ExternalCliCheckpointRecord | undefined
}

export function checkpointFromSnapshot(
  snapshot: ExternalCliSessionSnapshot,
  capabilities: { adapterSupportsResume?: boolean; replaySafeCheckpoint?: boolean } = {},
): ExternalCliCheckpointRecord {
  // Events are deliberately excluded.  They can contain provider output or
  // user input and are not required to establish recovery identity.
  return {
    schemaVersion: 1,
    runId: snapshot.runId,
    conversationId: snapshot.conversationId,
    adapter: snapshot.adapter,
    phase: snapshot.phase,
    active: snapshot.active,
    startedAt: snapshot.startedAt,
    firstValidLifecycleAt: snapshot.firstValidLifecycleAt,
    lastMeaningfulActivityAt: snapshot.lastMeaningfulActivityAt,
    processId: snapshot.processId,
    providerSessionId: snapshot.providerSessionId,
    eventCursor: snapshot.eventCursor,
    policy: { ...snapshot.policy },
    unattended: snapshot.unattended,
    waitingDetail: snapshot.waitingDetail,
    output: {
      head: snapshot.output.head,
      tail: snapshot.output.tail,
      omitted: snapshot.output.omitted,
      omittedBytes: snapshot.output.omittedBytes,
      totalBytes: snapshot.output.totalBytes,
    },
    terminal: snapshot.terminal ? { ...snapshot.terminal } : null,
    checkpointedAt: Date.now(),
    adapterSupportsResume: capabilities.adapterSupportsResume === true,
    replaySafeCheckpoint: capabilities.replaySafeCheckpoint === true,
  }
}

export class MemoryExternalCliCheckpointStore implements ExternalCliCheckpointStore {
  private readonly records = new Map<string, ExternalCliCheckpointRecord>()

  save(record: ExternalCliCheckpointRecord): void {
    this.records.set(record.runId, structuredClone(record))
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
    return structuredClone(record)
  }
}
