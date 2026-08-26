import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { reconcileReattach } from '../src/agent/reattachReconcile.ts'
import type { TurnRecordEntry } from '../src/agent/turnRecord.ts'

/**
 * Reattaching a renderer to a run that never stopped.
 *
 * Pi Core Host runs in the Electron utility process, so a renderer reload does
 * not kill the turn — the Host keeps thinking, calling tools and appending to
 * the Turn Record. But the renderer awaited that turn over an IPC invoke, and a
 * destroyed context abandons the promise: the Host finishes and the result
 * lands nowhere. The new renderer then shows an empty timeline, the journal
 * marks a still-running run `interrupted`, and a user who resubmits gets a
 * SECOND run against the same thread.
 *
 * This is the pure half of the fix: given a bounded snapshot, the events that
 * arrived while that snapshot was in flight, and what this renderer already
 * knows, decide the reconciled timeline and whether to settle. Every race is a
 * fixture here rather than a timing test — ordering comes from `seq` and from
 * nothing else, and the module may not read a clock, a store, or the DOM.
 */

// ── Fixtures ───────────────────────────────────────────────────────────────
const at = (seq: number) => ({ seq, turn: 1, step: 1, at: seq * 10 })

const user = (seq: number, content: string): TurnRecordEntry =>
  ({ kind: 'user-text', source: 'user', content, ...at(seq) })
const say = (seq: number, content: string): TurnRecordEntry =>
  ({ kind: 'assistant-text', source: 'model', content, ...at(seq) })
const call = (seq: number, callId: string): TurnRecordEntry =>
  ({ kind: 'tool-call', source: 'model', tool: 'bash', callId, ...at(seq) })
const done = (seq: number, settlement: 'answered' | 'cancelled' | 'failed' | 'interrupted' | 'empty' | 'truncated'): TurnRecordEntry =>
  ({ kind: 'turn-end', source: 'host', settlement, ...at(seq) })

const FRESH = { latestSeq: 0, total: 0 } as const

const snapshot = (entries: TurnRecordEntry[], extra: { total?: number; unloadedBefore?: number } = {}) => ({
  entries,
  latestSeq: entries.length ? entries[entries.length - 1].seq : 0,
  total: extra.total ?? entries.length,
  ...(extra.unloadedBefore === undefined ? {} : { unloadedBefore: extra.unloadedBefore }),
})

// ── The ordinary reattachment ──────────────────────────────────────────────
// A renderer comes back mid-run: it subscribes first, buffers what arrives,
// then installs the snapshot and merges the buffer on top.
const plain = reconcileReattach({
  snapshot: snapshot([user(1, '分析專案'), say(2, '我先讀說明。'), call(3, 'c1')], { total: 3 }),
  buffered: [say(4, '讀完了。')],
  generation: 1,
  currentGeneration: 1,
  observed: FRESH,
})
assert.equal(plain.stale, false)
assert.deepEqual(plain.entries.map((entry) => entry.seq), [1, 2, 3, 4], 'snapshot then buffer, in seq order')
assert.equal(plain.latestSeq, 4, 'the watermark follows the newest entry actually held')
assert.equal(plain.total, 4, 'total reflects what the record holds')
assert.equal(plain.settle, undefined, 'a run still executing settles nothing')
assert.equal(plain.gap, undefined, 'nothing is missing')

// ── Overlap: the buffer repeats what the snapshot already carried ──────────
// The snapshot is taken after the subscription, so the two ALWAYS overlap.
// Deduplication is by `seq`, and a repeated entry must not become a second row.
const overlapped = reconcileReattach({
  snapshot: snapshot([user(1, 'go'), say(2, 'a'), say(3, 'b')]),
  buffered: [say(2, 'a'), say(3, 'b'), say(4, 'c')],
  generation: 7,
  currentGeneration: 7,
  observed: FRESH,
})
assert.deepEqual(overlapped.entries.map((entry) => entry.seq), [1, 2, 3, 4], 'overlap collapses by seq')
assert.equal(overlapped.entries.filter((entry) => entry.seq === 2).length, 1)

// ── Arrival order is not truth; `seq` is ───────────────────────────────────
const shuffled = reconcileReattach({
  snapshot: snapshot([say(3, 'c'), user(1, 'a')], { total: 4 }),
  buffered: [say(4, 'd'), say(2, 'b')],
  generation: 1,
  currentGeneration: 1,
  observed: FRESH,
})
assert.deepEqual(shuffled.entries.map((entry) => entry.seq), [1, 2, 3, 4], 'ordered by seq, never by arrival')

// ── A superseded generation produces nothing ───────────────────────────────
// An older reconnect that resolves after a newer one must not overwrite the
// current view — the classic stale-response race.
const stale = reconcileReattach({
  snapshot: snapshot([user(1, 'old session'), say(2, 'old text'), done(3, 'answered')]),
  buffered: [say(4, 'more old text')],
  generation: 1,
  currentGeneration: 2,
  observed: { latestSeq: 9, total: 9 },
})
assert.equal(stale.stale, true)
assert.deepEqual(stale.entries, [], 'a stale response installs no entries')
assert.equal(stale.latestSeq, 9, 'and cannot move the watermark backwards')
assert.equal(stale.total, 9)
assert.equal(stale.settle, undefined, 'least of all may it settle the run')

// ── The watermark is monotonic ─────────────────────────────────────────────
// Retention may backfill entries this renderer already applied. They belong in
// the timeline, but they are not new activity: they must not advance the
// watermark, and `total` must never be computed by adding what arrived.
const backfilled = reconcileReattach({
  snapshot: snapshot([user(1, 'a'), say(2, 'b'), say(3, 'c')], { total: 12 }),
  buffered: [],
  generation: 1,
  currentGeneration: 1,
  observed: { latestSeq: 12, total: 12 },
})
assert.equal(backfilled.latestSeq, 12, 'an older page does not drag the watermark back')
assert.equal(backfilled.total, 12, 'and does not inflate the total')
assert.deepEqual(backfilled.entries.map((entry) => entry.seq), [1, 2, 3], 'the backfilled entries are still returned')

// A snapshot that genuinely knows more than this renderer does moves it forward.
const advanced = reconcileReattach({
  snapshot: snapshot([say(20, 'newer')], { total: 20 }),
  buffered: [],
  generation: 1,
  currentGeneration: 1,
  observed: { latestSeq: 12, total: 12 },
})
assert.equal(advanced.latestSeq, 20)
assert.equal(advanced.total, 20)

// ── A gap is stated, never hidden ──────────────────────────────────────────
// Retention is bounded. A shortened history must not be presented as a whole
// one, and the caller must not have to subtract two numbers to discover it.
const gapped = reconcileReattach({
  snapshot: snapshot([say(41, 'x'), say(42, 'y')], { total: 42, unloadedBefore: 40 }),
  buffered: [],
  generation: 1,
  currentGeneration: 1,
  observed: FRESH,
})
assert.ok(gapped.gap, 'a bounded snapshot reports its gap as a field')
assert.equal(gapped.gap?.missingBefore, 40)
assert.equal(gapped.gap?.earliestSeq, 41, 'and says where the held history starts, so a caller can page back')

// ── Settlement: the FIRST terminal decides, once ───────────────────────────
// A run that ended while nobody was watching still has to settle exactly once.
const settled = reconcileReattach({
  snapshot: snapshot([user(1, 'go'), say(2, 'done'), done(3, 'answered')]),
  buffered: [],
  generation: 1,
  currentGeneration: 1,
  observed: FRESH,
})
assert.equal(settled.settle, 'answered', 'a terminal nobody has acted on is the settlement to perform')

// Re-running the same reconciliation must not settle twice. This is the case
// that produces duplicate summaries, metrics and archived transcripts.
const alreadySettled = reconcileReattach({
  snapshot: snapshot([user(1, 'go'), say(2, 'done'), done(3, 'answered')]),
  buffered: [],
  generation: 1,
  currentGeneration: 1,
  observed: { latestSeq: 3, total: 3, settled: 'answered' },
})
assert.equal(alreadySettled.settle, undefined, 'a settlement already performed is never handed out again')
assert.deepEqual(alreadySettled.entries.map((entry) => entry.seq), [1, 2, 3], 'the timeline still reconciles')

// A late success cannot revive a run the user cancelled — across calls…
const lateAcrossCalls = reconcileReattach({
  snapshot: snapshot([user(1, 'go'), done(2, 'cancelled'), say(3, 'provider was still talking'), done(4, 'answered')]),
  buffered: [],
  generation: 1,
  currentGeneration: 1,
  observed: { latestSeq: 2, total: 2, settled: 'cancelled' },
})
assert.equal(lateAcrossCalls.settle, undefined, 'a cancelled run stays cancelled')

// …and within one reconciliation, where both terminals arrive together.
const lateSameMerge = reconcileReattach({
  snapshot: snapshot([user(1, 'go'), done(2, 'cancelled')]),
  buffered: [say(3, 'provider was still talking'), done(4, 'answered')],
  generation: 1,
  currentGeneration: 1,
  observed: FRESH,
})
assert.equal(lateSameMerge.settle, 'cancelled', 'the FIRST terminal by seq decides, not the last')

// The same holds for a failure overtaken by a late success.
const failedThenSuccess = reconcileReattach({
  snapshot: snapshot([user(1, 'go'), done(2, 'failed'), done(3, 'answered')]),
  buffered: [],
  generation: 1,
  currentGeneration: 1,
  observed: FRESH,
})
assert.equal(failedThenSuccess.settle, 'failed', 'a failed run is not rewritten by what arrived after it')

// Every settlement in the closed union round-trips, so a new one cannot be
// added without deciding what reattachment does with it.
for (const settlement of ['answered', 'empty', 'truncated', 'interrupted', 'failed', 'cancelled'] as const) {
  const result = reconcileReattach({
    snapshot: snapshot([user(1, 'go'), done(2, settlement)]),
    buffered: [],
    generation: 1,
    currentGeneration: 1,
    observed: FRESH,
  })
  assert.equal(result.settle, settlement, `${settlement} reaches the caller as itself`)
}

// ── Nothing to reattach to is not an error ─────────────────────────────────
const empty = reconcileReattach({
  snapshot: snapshot([]),
  buffered: [],
  generation: 1,
  currentGeneration: 1,
  observed: FRESH,
})
assert.deepEqual(empty.entries, [])
assert.equal(empty.latestSeq, 0)
assert.equal(empty.settle, undefined)
assert.equal(empty.gap, undefined)

// The Host accepted the run but has not appended anything yet — the earliest
// moment a renderer can restart, and it must read as "active", not "finished".
const acceptedNotStarted = reconcileReattach({
  snapshot: snapshot([], { total: 0 }),
  buffered: [user(1, 'go')],
  generation: 1,
  currentGeneration: 1,
  observed: FRESH,
})
assert.deepEqual(acceptedNotStarted.entries.map((entry) => entry.seq), [1])
assert.equal(acceptedNotStarted.settle, undefined)

// ── Purity: same input, same output ────────────────────────────────────────
const twice = () => reconcileReattach({
  snapshot: snapshot([user(1, 'a'), say(2, 'b'), done(3, 'answered')], { total: 9, unloadedBefore: 6 }),
  buffered: [say(2, 'b')],
  generation: 3,
  currentGeneration: 3,
  observed: { latestSeq: 1, total: 1 },
})
assert.deepEqual(twice(), twice(), 'the reconciliation is pure: same input, same output')

// The input is not mutated — a caller's buffer must survive the call intact.
const buffer = [say(5, 'x'), say(4, 'w')]
const snapshotEntries = [user(1, 'a')]
reconcileReattach({
  snapshot: snapshot(snapshotEntries),
  buffered: buffer,
  generation: 1,
  currentGeneration: 1,
  observed: FRESH,
})
assert.deepEqual(buffer.map((entry) => entry.seq), [5, 4], 'the caller’s buffer is left as it was')
assert.deepEqual(snapshotEntries.map((entry) => entry.seq), [1], 'and so are the snapshot’s entries')

// ── Purity is a contract, not a hope ───────────────────────────────────────
// It runs on a live reattachment and on a replayed fixture alike, so it may
// not reach for the clock, randomness, a store, the DOM, or a dynamic import.
const source = await readFile(resolve(import.meta.dirname, '../src/agent/reattachReconcile.ts'), 'utf8')
for (const forbidden of [/Date\.now/, /Math\.random/, /useState|useStore|zustand/, /require\(|await import\(/, /window\./, /localStorage/]) {
  assert.doesNotMatch(source, forbidden, `the reattach reconciliation must stay pure: ${forbidden}`)
}

console.log('A renderer reattaches by seq: overlap collapses, stale generations install nothing, the first terminal settles once')
