import type { TurnRecordEntry, TurnRecordPage } from './turnRecord.ts'

/**
 * Merge an older Host page ahead of the tail already on screen.
 *
 * Sequence is the record's identity. A retry or overlapping cursor may return
 * an entry the renderer already has, so page concatenation must never be the
 * merge rule. `total` is the Host high-watermark and is monotonic across the
 * two observations; it is not recomputed from the bounded rows in memory.
 */
export function mergeTrajectoryPages(
  older: TurnRecordPage,
  current: TurnRecordPage,
): TurnRecordPage {
  const bySeq = new Map<number, TurnRecordEntry>()
  for (const entry of older.entries) bySeq.set(entry.seq, entry)
  // The newer observation wins if an overlapping page contains the same seq.
  for (const entry of current.entries) bySeq.set(entry.seq, entry)
  const entries = [...bySeq.values()].sort((left, right) => left.seq - right.seq)
  return {
    entries,
    hasOlder: older.hasOlder,
    total: Math.max(older.total, current.total, entries.length),
    ...(older.nextBefore === undefined ? {} : { nextBefore: older.nextBefore }),
  }
}
