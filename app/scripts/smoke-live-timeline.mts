import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  LIVE_TIMELINE_LIMIT,
  liveTimelinePage,
  projectLiveTimeline,
  recordAppendFromEvent,
  runTimelineRows,
} from '../src/agent/liveTimeline.ts'
import { projectTrajectory } from '../src/agent/trajectoryProjection.ts'
import { appendTurnRecord, derivePiHistory, pageTurnRecord, type TurnRecordAppend } from '../src/agent/turnRecord.ts'

/**
 * Live and replay are the same reading of the same record.
 *
 * The defect this closes is not cosmetic: the running view was built from the
 * activity event stream (arrival order) while the finished view was built from
 * the Turn Record (recorded order), and nothing forced the two to agree. Here
 * one page goes through one projection twice, and the rows must match to the
 * column — anything less and «我剛剛看到的順序» and «我現在讀到的順序» are
 * allowed to differ.
 */

const entries: TurnRecordAppend[] = [
  { kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'step-start', source: 'host', turn: 1, step: 1, at: 2 },
  { kind: 'user-text', source: 'user', content: '誰擁有迴圈？', turn: 1, step: 1, at: 3 },
  { kind: 'reasoning', source: 'model', content: '先讀 CLAUDE.md，再決定 grep 什麼。', turn: 1, step: 1, at: 4 },
  { kind: 'assistant-text', source: 'model', content: '我先讀專案說明。', turn: 1, step: 1, at: 5 },
  { kind: 'tool-call', source: 'model', tool: 'read', callId: 'c1', path: 'CLAUDE.md', turn: 1, step: 1, at: 6 },
  { kind: 'tool-result', source: 'host', tool: 'read', callId: 'c1', settlement: 'success', turn: 1, step: 1, at: 7 },
  { kind: 'reasoning', source: 'model', content: '答案在 Architecture 段。', turn: 1, step: 1, at: 8 },
  {
    kind: 'step-end',
    source: 'host',
    turn: 1,
    step: 1,
    at: 9,
    timing: { requestAt: 1_000, firstTokenAt: 1_150, completedAt: 1_600 },
  },
]
const record = appendTurnRecord(undefined, entries)
const live = record.entries

// ── One page, one projection, two readings ─────────────────────────────────
const replayed = projectTrajectory(pageTurnRecord(record, { limit: LIVE_TIMELINE_LIMIT }))
const running = projectLiveTimeline(live, live.length)
assert.deepEqual(running, replayed, 'the live view and the replayed view are the same object, row for row')
assert.deepEqual(projectLiveTimeline(live, live.length), running, 'the projection is pure: same input, same output')

// Ordering is the record's, and the reasoning sits where it was thought.
assert.deepEqual(
  running.rows.map((row) => row.kind),
  ['user', 'reasoning', 'assistant', 'tool', 'tool', 'reasoning'],
)
assert.deepEqual(running.rows.map((row) => row.seq), [3, 4, 5, 6, 7, 8])
assert.ok(running.rows.every((row) => row.step === 1), 'every row knows the step it belongs to')
assert.equal(running.rows[1].timing?.totalMs, 600, 'a finished step lends its measured timing to its rows')

// ── The rows a reader actually sees ────────────────────────────────────────
const shown = runTimelineRows(running)
assert.deepEqual(
  shown.map((row) => row.kind),
  ['reasoning', 'assistant', 'tool', 'reasoning'],
  'one line per action: the call and its result are one tool row, and the prompt is the bubble above',
)
const firstRow = shown[0]
assert.equal(firstRow.kind === 'reasoning' ? firstRow.chars : 0, '先讀 CLAUDE.md，再決定 grep 什麼。'.length,
  'a collapsed reasoning row can say how much it is hiding')
assert.equal(firstRow.kind === 'reasoning' ? firstRow.content : '', '先讀 CLAUDE.md，再決定 grep 什麼。',
  'and still carries the whole thought behind the disclosure')
const toolRow = shown.find((row) => row.kind === 'tool')
assert.equal(toolRow?.kind === 'tool' ? toolRow.settlement : undefined, 'success',
  'the merged tool row carries the settlement its result reported')
assert.equal(toolRow?.kind === 'tool' ? toolRow.detail : undefined, 'CLAUDE.md',
  'and keeps the call’s own path rather than losing it to the result')
assert.ok(shown.findIndex((row) => row.kind === 'reasoning') < shown.findIndex((row) => row.kind === 'tool'),
  'the thought is readable before the action it explains')

// A mutating call's merged line keeps the diff size its own declaration
// derived from the recorded args — live rows and replayed rows alike.
const mutating = appendTurnRecord(undefined, [
  { kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'step-start', source: 'host', turn: 1, step: 1, at: 2 },
  { kind: 'tool-call', source: 'model', tool: 'write', callId: 'w1', args: { path: 'out/x.ts', content: 'export {}\n' }, turn: 1, step: 1, at: 3 },
  { kind: 'tool-result', source: 'host', tool: 'write', callId: 'w1', settlement: 'success', turn: 1, step: 1, at: 4 },
])
const mutatingShown = runTimelineRows(projectLiveTimeline(mutating.entries, mutating.entries.length))
const mutatingRow = mutatingShown.find((row) => row.kind === 'tool')
assert.equal(mutatingRow?.kind === 'tool' ? mutatingRow.title : undefined, '已寫入 x.ts',
  'the row title is what the write tool declared')
assert.equal(mutatingRow?.kind === 'tool' ? mutatingRow.added : undefined, 1,
  'a one-line creation reads as +1')
assert.equal(mutatingRow?.kind === 'tool' ? mutatingRow.removed : undefined, 0,
  'a creation removes nothing')

// The text streaming in right now is the timeline's current assistant line.
const streaming = runTimelineRows(running, '結論：Pi Core 擁')
const last = streaming[streaming.length - 1]
assert.equal(last.kind, 'assistant')
assert.equal(last.kind === 'assistant' ? last.draft : undefined, true, 'the in-progress reply is marked as a draft')
assert.ok(last.seq > shown[shown.length - 1].seq, 'and sits at the end of the timeline, not beside it')
assert.deepEqual(runTimelineRows(running, '   '), shown, 'whitespace is not a draft')

// ── A bounded live buffer is honest about its own prefix ───────────────────
const long: TurnRecordAppend[] = []
for (let index = 0; index < 260; index += 1) {
  long.push({ kind: 'assistant-text', source: 'model', content: `第 ${index} 句`, turn: 1, step: 1, at: index })
}
const longRecord = appendTurnRecord(undefined, long)
const trimmed = longRecord.entries.slice(-120)
const page = liveTimelinePage(trimmed, longRecord.entries.length)
assert.equal(page.total, 260, 'the page counts what the run published, not what the buffer kept')
assert.equal(page.hasOlder, true, 'and says an older prefix exists rather than presenting a trimmed buffer as the whole run')
assert.equal(page.entries.length, LIVE_TIMELINE_LIMIT)
assert.equal(page.nextBefore, page.entries[0].seq, 'offering the cursor the Host needs to serve that prefix')
// Nothing was dropped → the live page is exactly the page the record yields.
assert.deepEqual(
  liveTimelinePage(record.entries, record.entries.length),
  pageTurnRecord(record, { limit: LIVE_TIMELINE_LIMIT }),
  'with the whole run in hand, the live page IS the record page',
)
assert.deepEqual(liveTimelinePage([], 0), { entries: [], hasOlder: false, total: 0 })

// ── The event that feeds it, checked before it is trusted ──────────────────
const good = recordAppendFromEvent({
  event: 'host/record-append',
  payload: { runId: 'r1', entries: [{ kind: 'reasoning', source: 'model', content: '嗯', seq: 9, turn: 1, step: 1, at: 9 }] },
})
assert.equal(good?.runId, 'r1')
assert.equal(good?.entries.length, 1)
for (const rejected of [
  null,
  { event: 'host/turn-item', payload: { runId: 'r1', entries: [] } },
  { event: 'host/record-append', payload: { entries: [{ kind: 'reasoning', seq: 1, turn: 1, step: 1 }] } },
  { event: 'host/record-append', payload: { runId: 'r1', entries: 'nope' } },
  { event: 'host/record-append', payload: { runId: 'r1', entries: [{ kind: 'reasoning' }] } },
  { event: 'host/record-append', payload: { runId: 'r1', entries: [] } },
]) {
  assert.equal(recordAppendFromEvent(rejected as never), null, `a malformed frame cannot renumber a timeline: ${JSON.stringify(rejected)}`)
}

// ── Reasoning is for the reader, never fed back to the model ───────────────
// Pi manages its own thinking; replaying it as history would hand the model a
// transcript of its own thoughts as if someone had said them out loud.
assert.deepEqual(
  derivePiHistory(record).map((message) => message.role),
  ['user', 'assistant', 'tool', 'tool'],
  'the derived history carries no reasoning message',
)

// ── The live buffer, as the store accumulates it ───────────────────────────
const { useRunActivityStore } = await import('../src/store/runActivityStore.ts')
const store = useRunActivityStore.getState()
store.clear()
store.begin('timeline_run', 'timeline_thread')
for (const entry of live) store.appendRecordEntries([entry], 'timeline_run')
// A reconnect replays frames the view already has; the timeline must not
// double up because the transport did.
store.appendRecordEntries(live, 'timeline_run')
const buffered = useRunActivityStore.getState().getPresentation('timeline_run')
assert.equal(buffered?.recordEntries.length, live.length, 'entries are deduped by seq, not by arrival')
assert.equal(buffered?.recordTotal, live.length)
assert.deepEqual(
  projectLiveTimeline(buffered?.recordEntries || [], buffered?.recordTotal),
  replayed,
  'what the store accumulated projects to the same rows as the finished record',
)
// The draft is what has NOT been recorded yet. Once the Host writes the
// message the draft was accumulating, keeping it would show the same sentence
// twice — as the recorded row and as the line still being written.
store.clear()
store.begin('draft_run')
store.appendText('我先讀專案說明。', 'draft_run')
assert.equal(useRunActivityStore.getState().getPresentation('draft_run')?.draftText, '我先讀專案說明。')
store.appendRecordEntries(
  [{ kind: 'assistant-text', source: 'model', content: '我先讀專案說明。', seq: 1, turn: 1, step: 1, at: 1 }],
  'draft_run',
)
assert.equal(useRunActivityStore.getState().getPresentation('draft_run')?.draftText, '',
  'the recorded message retires the draft that produced it')
const drafted = useRunActivityStore.getState().getPresentation('draft_run')
assert.deepEqual(
  runTimelineRows(projectLiveTimeline(drafted?.recordEntries || [], drafted?.recordTotal), drafted?.draftText)
    .map((row) => (row.kind === 'assistant' ? row.content : row.kind)),
  ['我先讀專案說明。'],
  'the timeline shows it once',
)

// Out-of-order arrival is reordered by seq, never by arrival.
store.clear()
store.begin('shuffled_run')
store.appendRecordEntries([live[3], live[1]], 'shuffled_run')
store.appendRecordEntries([live[0], live[2]], 'shuffled_run')
assert.deepEqual(
  (useRunActivityStore.getState().getPresentation('shuffled_run')?.recordEntries || []).map((entry) => entry.seq),
  [1, 2, 3, 4],
  'the buffer is ordered by seq whatever order the frames took',
)

// ── Usage rides through live and replay identically ────────────────────────
// The whole point of one projection is that the live panel and the replayed
// one cannot disagree. That has to hold for the new usage fields too: a
// step-end carrying tokens, cache and cost must read the same in both, and a
// record without them must read exactly as it always did.
const usedEntries: TurnRecordAppend[] = [
  ...entries.slice(0, -1),
  {
    kind: 'step-end',
    source: 'host',
    turn: 1,
    step: 1,
    at: 9,
    timing: {
      requestAt: 1_000,
      firstTokenAt: 1_150,
      completedAt: 1_600,
      usage: { input: 900, output: 100, total: 1_000, cachedRead: 700, cachedWrite: 50, costUsd: 0.004 },
    },
  },
]
const usedRecord = appendTurnRecord(undefined, usedEntries)
assert.deepEqual(
  projectLiveTimeline(usedRecord.entries, usedRecord.entries.length),
  projectTrajectory(pageTurnRecord(usedRecord, { limit: LIVE_TIMELINE_LIMIT })),
  'live and replay agree about usage as they agree about everything else',
)
const usedLive = projectLiveTimeline(usedRecord.entries, usedRecord.entries.length)
assert.equal(usedLive.steps[0]?.usage?.cachedRead, 700)
assert.equal(usedLive.steps[0]?.usage?.costUsd, 0.004)
// And the record without them is unchanged, row for row.
assert.deepEqual(
  usedLive.rows.map((row) => ({ ...row, timing: undefined })),
  running.rows.map((row) => ({ ...row, timing: undefined })),
  'usage changes no row the timeline already produced',
)
assert.equal(running.steps[0]?.usage, undefined, 'a step that reported no usage reports none')

// ── Purity is a contract, not a hope ───────────────────────────────────────
const source = await readFile(resolve(import.meta.dirname, '../src/agent/liveTimeline.ts'), 'utf8')
for (const forbidden of [/Date\.now/, /Math\.random/, /useState|useStore|zustand/, /require\(|await import\(/, /window\./]) {
  assert.doesNotMatch(source, forbidden, `the live projection must stay pure: ${forbidden}`)
}

console.log('The live timeline and the replayed one are the same projection of the same record')
