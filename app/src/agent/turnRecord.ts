/**
 * The Turn Record（回合記錄）— the Pi Core Host's append-only account of what
 * happened inside one turn.
 *
 * It exists because the answer, the model's own history, and the UI Projection
 * were each assembled separately and could disagree without anything noticing:
 * a turn published its opening narration as the answer, wrote that same wrong
 * text into its history, and every surface agreed the run had succeeded. One
 * ordered record they all derive from is what makes that disagreement
 * impossible rather than merely unlikely.
 *
 * This module is the shared vocabulary: the Host appends, the renderer reads.
 * Nothing here executes anything, so both halves can import it.
 */
import type { PiTurnInterruptReason, PiTurnSettlement } from './piHostRun.ts'

/**
 * On-disk format of the record. It rides the Pi Host Protocol version (ADR-0038):
 * a record this build cannot read is refused loudly, never treated as empty.
 */
export const TURN_RECORD_FORMAT_VERSION = 1

/** Who is accountable for an entry's content (ADR-0048). */
export type TurnRecordSource =
  /** The person driving the conversation. */
  | 'user'
  /** The model said or asked for it; it is a claim, not evidence. */
  | 'model'
  /** The Host performed it; this is the trusted adapter's own account. */
  | 'host'

/** Where an entry sits in the turn, independent of its position in the array. */
export type TurnRecordCoordinates = {
  /** Monotonic within one session; ordering is decided by this and nothing else. */
  seq: number
  /** 1-based turn number within the session. */
  turn: number
  /** 1-based step (one model request plus the tools it called) within the turn. */
  step: number
  /** Epoch milliseconds. */
  at: number
}

export type TurnRecordEntry = TurnRecordCoordinates &
  (
    | { kind: 'turn-start'; source: 'host' }
    | {
        kind: 'turn-end'
        source: 'host'
        settlement: PiTurnSettlement
        interruptReason?: PiTurnInterruptReason
      }
    | { kind: 'step-start'; source: 'host' }
    | { kind: 'step-end'; source: 'host' }
    | { kind: 'user-text'; source: 'user'; content: string }
    | { kind: 'assistant-text'; source: 'model'; content: string }
    | {
        kind: 'tool-call'
        source: 'model'
        tool: string
        callId: string
        /** The arguments as recorded, so a replay re-presents identically (ADR-0050). */
        args?: unknown
        path?: string
      }
    | {
        kind: 'tool-result'
        source: 'host'
        tool: string
        callId: string
        settlement: 'success' | 'failed' | 'cancelled' | 'denied'
        detail?: string
      }
    | { kind: 'approval'; source: 'host'; tool: string; callId: string; decision: string; reason?: string }
    | { kind: 'compaction'; source: 'host'; replaced: number; tokens?: number }
  )

/**
 * `Omit` over a union keeps only the keys every member shares, which would
 * erase every entry kind's own fields. Distributing it preserves the union.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** One entry before the record assigns its sequence number. */
export type TurnRecordAppend = DistributiveOmit<TurnRecordEntry, 'seq'>

/** One entry before the recorder fills in where and when it happened. */
export type TurnRecordDraft = DistributiveOmit<TurnRecordEntry, 'seq' | 'turn' | 'step' | 'at'>

export type TurnRecord = {
  version: number
  entries: TurnRecordEntry[]
}

export const EMPTY_TURN_RECORD: TurnRecord = { version: TURN_RECORD_FORMAT_VERSION, entries: [] }

/** A record written by a build this one cannot read. */
export class TurnRecordVersionError extends Error {
  readonly found: unknown

  constructor(found: unknown) {
    super(`Unreadable Turn Record format version: ${String(found)}`)
    this.name = 'TurnRecordVersionError'
    this.found = found
  }
}

/** A record whose middle is damaged — not a torn tail, and not recoverable. */
export class TurnRecordCorruptError extends Error {
  readonly index: number

  constructor(index: number) {
    super(`Turn Record entry ${index} is unreadable and is not the final entry`)
    this.name = 'TurnRecordCorruptError'
    this.index = index
  }
}

const KINDS = new Set([
  'turn-start',
  'turn-end',
  'step-start',
  'step-end',
  'user-text',
  'assistant-text',
  'tool-call',
  'tool-result',
  'approval',
  'compaction',
])

function isEntry(value: unknown): value is TurnRecordEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  if (typeof entry.kind !== 'string' || !KINDS.has(entry.kind)) return false
  if (entry.source !== 'user' && entry.source !== 'model' && entry.source !== 'host') return false
  for (const field of ['seq', 'turn', 'step', 'at'] as const) {
    const number = entry[field]
    if (typeof number !== 'number' || !Number.isFinite(number)) return false
  }
  if ((entry.kind === 'user-text' || entry.kind === 'assistant-text') && typeof entry.content !== 'string') return false
  if ((entry.kind === 'tool-call' || entry.kind === 'tool-result' || entry.kind === 'approval')
    && (typeof entry.tool !== 'string' || typeof entry.callId !== 'string')) return false
  return true
}

/**
 * Read a persisted record.
 *
 * Three outcomes, and the difference between them is the point:
 * a version this build does not know THROWS, because silently starting from an
 * empty record is data loss performed rather than reported; a damaged entry in
 * the middle THROWS for the same reason; a damaged FINAL entry is a torn write
 * (the process died mid-append), so the good prefix is kept and the loss is
 * reported to the caller instead of being swallowed.
 */
export function parseTurnRecord(value: unknown): { record: TurnRecord; tornTail: boolean } {
  if (value === undefined || value === null) return { record: { ...EMPTY_TURN_RECORD, entries: [] }, tornTail: false }
  if (typeof value !== 'object') throw new TurnRecordVersionError(value)
  const raw = value as { version?: unknown; entries?: unknown }
  if (raw.version !== TURN_RECORD_FORMAT_VERSION) throw new TurnRecordVersionError(raw.version)
  const entries = Array.isArray(raw.entries) ? raw.entries : []
  const kept: TurnRecordEntry[] = []
  let tornTail = false
  for (let index = 0; index < entries.length; index += 1) {
    if (isEntry(entries[index])) {
      kept.push(entries[index] as TurnRecordEntry)
      continue
    }
    if (index === entries.length - 1) {
      tornTail = true
      break
    }
    throw new TurnRecordCorruptError(index)
  }
  return { record: { version: TURN_RECORD_FORMAT_VERSION, entries: kept }, tornTail }
}

/**
 * Append entries, assigning the next sequence numbers.
 *
 * Sequence is owned here so no caller can invent one, and so a reader never
 * has to fall back on array position to know what happened first.
 */
export function appendTurnRecord(
  record: TurnRecord | undefined,
  entries: TurnRecordAppend[],
): TurnRecord {
  const base = record?.version === TURN_RECORD_FORMAT_VERSION ? record.entries : []
  let seq = base.length > 0 ? base[base.length - 1].seq : 0
  const appended = entries.map((entry) => {
    seq += 1
    return { ...entry, seq } as TurnRecordEntry
  })
  return { version: TURN_RECORD_FORMAT_VERSION, entries: [...base, ...appended] }
}

/** One message as the model's own history carries it. */
export type PiRecordedMessage = { role: 'user' | 'assistant' | 'tool'; content: string }

/**
 * The model's history, derived from the record rather than accumulated beside it.
 *
 * Tool calls and their results are part of it: a follow-up turn needs to know
 * what the agent DID, not only what it said, and a history of prose alone made
 * the model re-explain work it had already done. A compaction entry replays as
 * the drop it performed, so a shortened context is reproduced rather than
 * re-grown on the next derivation.
 */
export function derivePiHistory(record: TurnRecord | undefined): PiRecordedMessage[] {
  const messages: PiRecordedMessage[] = []
  for (const entry of turnRecordEntries(record)) {
    switch (entry.kind) {
      case 'user-text':
        messages.push({ role: 'user', content: entry.content })
        break
      case 'assistant-text':
        messages.push({ role: 'assistant', content: entry.content })
        break
      case 'tool-call':
        messages.push({ role: 'tool', content: `→ ${entry.tool}(${entry.callId})${entry.path ? ` ${entry.path}` : ''}` })
        break
      case 'tool-result':
        messages.push({ role: 'tool', content: `← ${entry.tool}(${entry.callId}) ${entry.settlement}${entry.detail ? `: ${entry.detail}` : ''}` })
        break
      case 'compaction':
        messages.splice(0, Math.max(0, Math.min(entry.replaced, messages.length)))
        break
      default:
        break
    }
  }
  return messages
}

/** Entries in the order they happened, decided by `seq` and never by position. */
export function turnRecordEntries(record: TurnRecord | undefined): TurnRecordEntry[] {
  if (!record?.entries?.length) return []
  return [...record.entries].sort((left, right) => left.seq - right.seq)
}
