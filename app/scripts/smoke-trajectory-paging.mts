import { strict as assert } from 'node:assert'
import { appendTurnRecord, pageTurnRecord, TURN_RECORD_PAGE_SIZE, type TurnRecordAppend } from '../src/agent/turnRecord.ts'
import { projectTrajectory } from '../src/agent/trajectoryProjection.ts'
import { mergeTrajectoryPages } from '../src/agent/trajectoryPaging.ts'

/**
 * Seam 2: a long run is read a page at a time, addressed by sequence.
 *
 * The earliest steps used to be the first thing the product forgot, because
 * the whole record travelled at once and memory decided what survived.
 */

// A run long enough that no single page holds it: 12 turns, 4 entries each.
const entries: TurnRecordAppend[] = []
for (let turn = 1; turn <= 12; turn += 1) {
  entries.push({ kind: 'step-start', source: 'host', turn, step: 1, at: turn * 10 })
  entries.push({ kind: 'user-text', source: 'user', content: `問題 ${turn}`, turn, step: 1, at: turn * 10 + 1 })
  entries.push({ kind: 'assistant-text', source: 'model', content: `回答 ${turn}`, turn, step: 1, at: turn * 10 + 2 })
  entries.push({
    kind: 'step-end',
    source: 'host',
    turn,
    step: 1,
    at: turn * 10 + 3,
    timing: { requestAt: turn * 1_000, firstTokenAt: turn * 1_000 + 100, completedAt: turn * 1_000 + 400 },
  })
}
const record = appendTurnRecord(undefined, entries)
assert.equal(record.entries.length, 48)

// The first read lands on the newest end.
const tail = pageTurnRecord(record, { limit: 10 })
assert.equal(tail.entries.length, 10)
assert.equal(tail.entries[tail.entries.length - 1].seq, 48, 'a first read opens at the tail')
assert.equal(tail.hasOlder, true)
assert.equal(tail.nextBefore, 39)
assert.equal(tail.total, 48)

// A middle page is addressed by the cursor the page before it handed back.
const middle = pageTurnRecord(record, { before: tail.nextBefore, limit: 10 })
assert.deepEqual(middle.entries.map((entry) => entry.seq), [29, 30, 31, 32, 33, 34, 35, 36, 37, 38])
assert.equal(middle.hasOlder, true)
assert.equal(middle.nextBefore, 29)

// Overlapping/retried pages merge by seq. The newer tail wins for a duplicate,
// rows stay sorted, and a stale older response cannot lower the Host total.
const overlap = mergeTrajectoryPages(
  { entries: middle.entries.slice(0, 5), hasOlder: true, nextBefore: 29, total: 40 },
  { entries: middle.entries.slice(4), hasOlder: true, nextBefore: 34, total: 48 },
)
assert.deepEqual(overlap.entries.map((entry) => entry.seq), middle.entries.map((entry) => entry.seq))
assert.equal(overlap.total, 48, 'the Host high-watermark is monotonic')
assert.equal(overlap.nextBefore, 29, 'the older page owns the next backward cursor')

// The oldest page reports that nothing remains ahead of it.
let cursor: number | undefined = middle.nextBefore
let oldest = pageTurnRecord(record, { before: cursor, limit: 10 })
while (oldest.hasOlder) oldest = pageTurnRecord(record, { before: oldest.nextBefore, limit: 10 })
assert.equal(oldest.entries[0].seq, 1, 'paging back reaches the first entry')
assert.equal(oldest.hasOlder, false)
assert.equal(oldest.nextBefore, undefined, 'no cursor is offered past the beginning')

// An empty record pages without inventing anything.
const empty = pageTurnRecord(undefined, { limit: 10 })
assert.deepEqual(empty, { entries: [], hasOlder: false, total: 0 })
// A cursor before the beginning yields an empty page, not an error.
assert.deepEqual(pageTurnRecord(record, { before: 1, limit: 10 }).entries, [])
// A page is bounded however large a caller asks.
assert.ok(pageTurnRecord(record, { limit: 10_000 }).entries.length <= TURN_RECORD_PAGE_SIZE)

// ── The view a page projects ───────────────────────────────────────────────
const view = projectTrajectory(middle)
assert.ok(view.rows.length > 0)
assert.ok(view.rows.every((row) => row.turn >= 1 && row.step >= 1), 'every row knows where it sits')
assert.equal(view.unloadedBefore, 38, 'the unloaded prefix is counted, not guessed at')
assert.equal(view.nextBefore, 29)
// A finished step carries the timing that was measured for it.
const answered = view.rows.find((row) => row.kind === 'assistant')
assert.ok(answered?.timing, 'a finished step lends its timing to its rows')
assert.equal(answered?.timing?.waitingMs, 100)
assert.equal(answered?.timing?.generatingMs, 300)

// ── Reasoning inherits step attribution and timing from the same projection ──
// The trajectory does not learn about reasoning separately; it reuses the
// conversation projection, so a new row kind arrives already located in time.
const reasoned = projectTrajectory(pageTurnRecord(appendTurnRecord(undefined, [
  { kind: 'step-start', source: 'host', turn: 3, step: 2, at: 1 },
  { kind: 'reasoning', source: 'model', content: '先確認範圍再動手。', turn: 3, step: 2, at: 2 },
  { kind: 'tool-call', source: 'model', tool: 'bash', callId: 'b1', turn: 3, step: 2, at: 3 },
  { kind: 'tool-result', source: 'host', tool: 'bash', callId: 'b1', settlement: 'success', turn: 3, step: 2, at: 4 },
  {
    kind: 'step-end',
    source: 'host',
    turn: 3,
    step: 2,
    at: 5,
    timing: { requestAt: 500, firstTokenAt: 700, completedAt: 1_200 },
  },
]), {}))
const thought = reasoned.rows.find((row) => row.kind === 'reasoning')
assert.ok(thought, 'a reasoning entry becomes a trajectory row')
assert.equal(thought.turn, 3)
assert.equal(thought.step, 2, 'located in the step it was thought in')
assert.equal(thought.timing?.waitingMs, 200, 'and carries that step’s measured timing once it ended')
assert.ok(
  reasoned.rows.findIndex((row) => row.kind === 'reasoning') < reasoned.rows.findIndex((row) => row.kind === 'tool'),
  'the thought is ahead of the call it explains, as the record has it',
)

// A row inside a step that has not ended carries no duration at all.
const running = projectTrajectory(pageTurnRecord(appendTurnRecord(undefined, [
  { kind: 'step-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'user-text', source: 'user', content: '進行中', turn: 1, step: 1, at: 2 },
]), {}))
assert.equal(running.rows[0]?.timing, undefined, 'a running step never lends a duration')
assert.equal(running.steps[0]?.running, true)
assert.equal(running.unloadedBefore, 0)

// The cache and cost fields ride through the step view untouched, and their
// absence in an older record changes nothing this projection already produced.
const withUsage = (usage: Record<string, number>) => projectTrajectory(pageTurnRecord(appendTurnRecord(undefined, [
  { kind: 'step-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'assistant-text', source: 'model', content: '回答', turn: 1, step: 1, at: 2 },
  { kind: 'step-end', source: 'host', turn: 1, step: 1, at: 9, timing: { requestAt: 1, firstTokenAt: 3, completedAt: 9, usage } },
]), {}))
const priced = withUsage({ input: 900, output: 100, total: 1_000, cachedRead: 700, cachedWrite: 50, costUsd: 0.004 })
assert.equal(priced.steps[0]?.usage?.cachedRead, 700, 'the trajectory step view carries the cache split')
assert.equal(priced.steps[0]?.usage?.costUsd, 0.004, 'and the cost')
const legacyPriced = withUsage({ input: 900, output: 100, total: 1_000 })
assert.equal(legacyPriced.steps[0]?.usage?.cachedRead, undefined, 'an older record reports no cache, not zero cache')
assert.equal(legacyPriced.steps[0]?.usage?.costUsd, undefined)
// A row carries its step's timing, so the new fields reach the row too — which
// is the point: story «哪一步最貴» is answered on the row a reader selects.
assert.equal(priced.rows[0]?.timing?.usage?.costUsd, 0.004, 'a row surfaces its step’s cost')
assert.equal(legacyPriced.rows[0]?.timing?.usage?.costUsd, undefined)
// Everything the projection produced BEFORE these fields existed is unchanged.
const withoutUsage = (rows: typeof priced.rows) =>
  rows.map((row) => ({ ...row, timing: row.timing ? { ...row.timing, usage: undefined } : undefined }))
assert.deepEqual(withoutUsage(legacyPriced.rows), withoutUsage(priced.rows), 'usage fields change nothing else on a row')
assert.equal(legacyPriced.steps[0]?.totalMs, priced.steps[0]?.totalMs)
assert.equal(legacyPriced.steps[0]?.waitingMs, priced.steps[0]?.waitingMs)

console.log('A long run is read one page at a time, addressed by sequence')
