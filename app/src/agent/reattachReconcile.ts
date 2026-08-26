/**
 * Reattaching a renderer to a run that never stopped.
 *
 * Pi Core Host runs in the Electron utility process, so destroying a renderer
 * does not kill the turn — the Host keeps thinking, calling tools, and
 * appending to the Turn Record. But the renderer awaited that turn over an IPC
 * invoke, and a destroyed context abandons the promise: the Host finishes and
 * the result lands nowhere. The new renderer showed an empty timeline, the
 * journal marked a still-running run `interrupted`, and a user who resubmitted
 * got a SECOND run against the same thread while the first was still going.
 *
 * ADR-0039 already decided the shape of the fix — "the client obtains a
 * snapshot and resumes events after a cursor" — and CONTEXT.md already defines
 * the UI Projection that way. This module is that reconciliation, and nothing
 * else: given a bounded snapshot, the events that arrived while it was in
 * flight, and what this renderer already knows, decide the timeline and
 * whether to settle.
 *
 * Pure by contract — no I/O, no store reads, no clock, no randomness — because
 * a live reattachment and a replayed fixture must behave identically. Ordering
 * comes from `seq` and from nothing else. It reuses the Turn Record's own
 * sequence rather than inventing a parallel event vocabulary, so there is
 * still exactly one timeline.
 *
 * What it deliberately does NOT do: start anything. Reattachment is
 * observation and reconciliation. Execution and settlement stay with
 * `taskRunCoordinator`; this only reports which settlement is now owed.
 */
import type { PiTurnSettlement } from './piHostRun.ts'
import type { TurnRecordEntry } from './turnRecord.ts'

/** One bounded page of a run's record, as the retention hands it over. */
export type ReattachSnapshot = {
  /** The entries retention actually holds for this page. Any order. */
  entries: readonly TurnRecordEntry[]
  /** The highest `seq` the retention knows about. */
  latestSeq: number
  /** Entries in the whole record, so a bounded page can say what it is not. */
  total: number
  /**
   * Entries ahead of this page that retention could not send. Stated as a
   * field because a caller must never have to infer a gap by subtracting.
   */
  unloadedBefore?: number
}

/** What this renderer has already applied, so nothing is done twice. */
export type ReattachObserved = {
  /** Highest `seq` already applied; 0 for a renderer starting cold. */
  latestSeq: number
  /** Total already believed; 0 for a renderer starting cold. */
  total: number
  /**
   * The settlement this run has ALREADY been settled with, if any.
   *
   * Present means the run is finished as far as the app is concerned, and no
   * later entry may change that — which is what stops a provider success that
   * arrives after a cancellation from reviving a run the user stopped.
   */
  settled?: PiTurnSettlement
}

export type ReattachInput = {
  snapshot: ReattachSnapshot
  /**
   * Entries that arrived live while the snapshot was in flight.
   *
   * Subscribing happens BEFORE the snapshot is requested — otherwise appends
   * landing between the two would be lost — so the two always overlap, and
   * collapsing that overlap is this module's job rather than the caller's.
   */
  buffered: readonly TurnRecordEntry[]
  /** The generation this snapshot was requested under. */
  generation: number
  /** The generation currently in force. */
  currentGeneration: number
  observed: ReattachObserved
}

/** A prefix the caller does not hold, stated rather than implied. */
export type ReattachGap = {
  /** How many entries sit ahead of the earliest entry actually held. */
  missingBefore: number
  /** Where the held history starts, so a caller can page back from it. */
  earliestSeq: number
}

export type ReattachResult = {
  /**
   * True when this input belongs to a superseded generation.
   *
   * A stale result carries no entries and no settlement: an older reconnect
   * that resolves after a newer one must not overwrite the current view, and
   * must certainly not settle a run on the strength of an old session's record.
   */
  stale: boolean
  /** The reconciled page, ascending by `seq`, deduplicated. */
  entries: TurnRecordEntry[]
  /** Monotonic: never lower than what the caller had already observed. */
  latestSeq: number
  /** Monotonic, and taken from the record's own count — never accumulated. */
  total: number
  gap?: ReattachGap
  /**
   * The settlement to perform NOW, or nothing.
   *
   * Absent both when the run is still executing and when it has already been
   * settled, because in neither case is a settlement owed. The caller hands
   * this to the coordinator's existing single finalization; it is never a
   * second execution path.
   */
  settle?: PiTurnSettlement
}

/** A finite, non-negative count; anything else is not a measurement. */
function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * Merge the snapshot and the live buffer into one ascending, deduplicated page.
 *
 * `seq` is the identity. The Host assigns it once and a live entry carries the
 * same `seq` its committed twin will get, so the same entry arriving twice —
 * which it always does, because subscribe precedes snapshot — is one row.
 */
function mergeBySeq(
  snapshot: readonly TurnRecordEntry[],
  buffered: readonly TurnRecordEntry[],
): TurnRecordEntry[] {
  const bySeq = new Map<number, TurnRecordEntry>()
  for (const entry of snapshot) bySeq.set(entry.seq, entry)
  // The live buffer wins a tie: it is the same entry, and preferring the later
  // arrival keeps this from depending on which source was read first.
  for (const entry of buffered) bySeq.set(entry.seq, entry)
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq)
}

/**
 * The settlement a run is owed, if any.
 *
 * The FIRST terminal by `seq` decides, not the last. A run whose provider kept
 * talking after a cancellation has two `turn-end` entries, and only the first
 * is what actually happened to the run — taking the last would let a late
 * success quietly overwrite a cancellation or a failure.
 */
function firstTerminal(entries: readonly TurnRecordEntry[]): PiTurnSettlement | undefined {
  for (const entry of entries) {
    if (entry.kind === 'turn-end') return entry.settlement
  }
  return undefined
}

export function reconcileReattach(input: ReattachInput): ReattachResult {
  const { snapshot, buffered, generation, currentGeneration, observed } = input

  // A superseded generation is discarded whole. Reporting the observed state
  // unchanged — rather than an empty one — means a caller that installs this
  // result regardless cannot regress its own watermark.
  if (generation !== currentGeneration) {
    return {
      stale: true,
      entries: [],
      latestSeq: count(observed.latestSeq),
      total: count(observed.total),
    }
  }

  const entries = mergeBySeq(snapshot.entries, buffered)
  const newestHeld = entries.length > 0 ? entries[entries.length - 1].seq : 0

  // Monotonic by construction. Retention may backfill entries this renderer
  // already applied; those belong in the timeline but are not new activity, so
  // they must not drag the watermark back. `total` comes from the record's own
  // count rather than from adding what arrived, which is the other way a
  // backfill used to inflate it.
  const latestSeq = Math.max(count(observed.latestSeq), count(snapshot.latestSeq), newestHeld)
  const total = Math.max(count(observed.total), count(snapshot.total), entries.length)

  const missingBefore = count(snapshot.unloadedBefore)
  const gap = missingBefore > 0 && entries.length > 0
    ? { missingBefore, earliestSeq: entries[0].seq }
    : undefined

  // Already settled means nothing is owed — this is what makes reattachment
  // idempotent across any number of renderer restarts, and what keeps a late
  // success from reviving a run that was cancelled or failed.
  const settle = observed.settled === undefined ? firstTerminal(entries) : undefined

  return {
    stale: false,
    entries,
    latestSeq,
    total,
    ...(gap ? { gap } : {}),
    ...(settle === undefined ? {} : { settle }),
  }
}
