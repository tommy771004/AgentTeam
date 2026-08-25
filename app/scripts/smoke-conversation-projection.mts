import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { conversationAnswer, projectConversationRows } from '../src/agent/conversationProjection.ts'
import { appendTurnRecord } from '../src/agent/turnRecord.ts'

/**
 * Seam 2: the conversation is a pure projection of the Turn Record.
 *
 * Fixtures only — no Electron, no store, no DOM — because the projection runs
 * on live turns and on replayed records alike and must behave identically on
 * both.
 */

const record = appendTurnRecord(undefined, [
  { kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'step-start', source: 'host', turn: 1, step: 1, at: 2 },
  { kind: 'user-text', source: 'user', content: '分析這個專案', turn: 1, step: 1, at: 3 },
  { kind: 'assistant-text', source: 'model', content: '我先探索本地專案結構。', turn: 1, step: 1, at: 4 },
  { kind: 'tool-call', source: 'model', tool: 'grep', callId: 'c1', path: 'src/', turn: 1, step: 1, at: 5 },
  { kind: 'tool-result', source: 'host', tool: 'grep', callId: 'c1', settlement: 'success', turn: 1, step: 1, at: 6 },
  { kind: 'assistant-text', source: 'model', content: '結論：Host 擁有迴圈。', turn: 1, step: 1, at: 7 },
  { kind: 'step-end', source: 'host', turn: 1, step: 1, at: 8 },
  { kind: 'turn-end', source: 'host', settlement: 'answered', turn: 1, step: 1, at: 9 },
])

const rows = projectConversationRows(record)
assert.deepEqual(rows.map((row) => row.kind), ['user', 'assistant', 'tool', 'tool', 'assistant'])
// Turn boundaries are structure, not content — they never become rows.
assert.ok(!rows.some((row) => row.kind === 'notice'))
assert.deepEqual(rows.map((row) => row.seq), [3, 4, 5, 6, 7], 'rows keep the record’s own order')

// The answer is the LAST assistant row. The opening narration is a row of its
// own, never the answer — the defect this whole effort exists to close.
assert.equal(conversationAnswer(record), '結論：Host 擁有迴圈。')
assert.notEqual(conversationAnswer(record), '我先探索本地專案結構。')

// A silent turn has no answer to offer, and says so with `undefined` rather
// than an invented placeholder.
assert.equal(conversationAnswer(appendTurnRecord(undefined, [
  { kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'user-text', source: 'user', content: '在嗎', turn: 1, step: 1, at: 2 },
  { kind: 'turn-end', source: 'host', settlement: 'empty', turn: 1, step: 1, at: 3 },
])), undefined)
assert.equal(conversationAnswer(undefined), undefined)
assert.deepEqual(projectConversationRows(undefined), [])

// Approvals and compaction are visible as notices, not silently dropped.
const noticed = projectConversationRows(appendTurnRecord(undefined, [
  { kind: 'approval', source: 'host', tool: 'bash', callId: 'c9', decision: 'deny', reason: '未核准', turn: 1, step: 1, at: 1 },
  { kind: 'compaction', source: 'host', replaced: 4, turn: 1, step: 1, at: 2 },
]))
assert.deepEqual(noticed.map((row) => row.kind), ['notice', 'notice'])
assert.match(noticed[0].kind === 'notice' ? noticed[0].content : '', /bash.*deny/)
assert.match(noticed[1].kind === 'notice' ? noticed[1].content : '', /4/)

// A `notice` entry is written precisely so the user sees it — a run whose
// skills went unavailable, say. It must read as its own text, never as the
// unknown-entry fallback.
const spoken = projectConversationRows(appendTurnRecord(undefined, [
  { kind: 'notice', source: 'host', topic: 'skills-unavailable', text: '技能在此 run 不可用：read 工具未啟用。', turn: 1, step: 1, at: 1 },
]))
assert.deepEqual(spoken.map((row) => row.kind), ['notice'])
assert.equal(spoken[0].kind === 'notice' ? spoken[0].content : '', '技能在此 run 不可用：read 工具未啟用。')
assert.doesNotMatch(spoken[0].kind === 'notice' ? spoken[0].content : '', /未知的記錄項目/,
  'a kind this build knows must never reach the unknown-entry arm')

// An entry kind this build does not know becomes a notice — never an
// exception, never a gap. A record from a newer build must still render.
const future = { version: 1, entries: [
  { kind: 'user-text', source: 'user', content: '你好', seq: 1, turn: 1, step: 1, at: 1 },
  { kind: 'telepathy', source: 'host', seq: 2, turn: 1, step: 1, at: 2 },
  { kind: 'assistant-text', source: 'model', content: '嗨', seq: 3, turn: 1, step: 1, at: 3 },
] } as unknown as Parameters<typeof projectConversationRows>[0]
const forward = projectConversationRows(future)
assert.deepEqual(forward.map((row) => row.kind), ['user', 'notice', 'assistant'])
assert.equal(conversationAnswer(future), '嗨', 'the conversation around an unknown entry still reads')

// ── Reasoning is a row of its own, in the place it happened ────────────────
// The question the entry exists to answer is «這個工具呼叫之前它在想什麼», so
// the row has to sit BEFORE the call, interleaved by seq like everything else.
const withReasoning = appendTurnRecord(undefined, [
  { kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'user-text', source: 'user', content: '找出誰擁有迴圈', turn: 1, step: 1, at: 2 },
  { kind: 'reasoning', source: 'model', content: '先看 CLAUDE.md 再決定要 grep 什麼。', turn: 1, step: 1, at: 3 },
  { kind: 'assistant-text', source: 'model', content: '我先讀專案說明。', turn: 1, step: 1, at: 4 },
  { kind: 'tool-call', source: 'model', tool: 'read', callId: 'c1', path: 'CLAUDE.md', turn: 1, step: 1, at: 5 },
  { kind: 'tool-result', source: 'host', tool: 'read', callId: 'c1', settlement: 'success', turn: 1, step: 1, at: 6 },
  { kind: 'reasoning', source: 'model', content: '答案在 Architecture 段。', turn: 1, step: 2, at: 7 },
  { kind: 'assistant-text', source: 'model', content: '結論：Pi Core 擁有迴圈。', turn: 1, step: 2, at: 8 },
])
const reasoned = projectConversationRows(withReasoning)
assert.deepEqual(
  reasoned.map((row) => row.kind),
  ['user', 'reasoning', 'assistant', 'tool', 'tool', 'reasoning', 'assistant'],
  'reasoning interleaves with everything else, never collected at one end',
)
assert.deepEqual(reasoned.map((row) => row.seq), [2, 3, 4, 5, 6, 7, 8], 'order is the record’s, decided by seq')
const firstReasoning = reasoned[1]
assert.equal(firstReasoning.kind, 'reasoning')
assert.ok(reasoned.findIndex((row) => row.kind === 'reasoning') < reasoned.findIndex((row) => row.kind === 'tool'))

// Kept WHOLE. A long thought is projected at its real length — a view may
// collapse it, the projection may not shorten it.
const longThought = 'ㄎ'.repeat(20_000)
const whole = projectConversationRows(appendTurnRecord(undefined, [
  { kind: 'reasoning', source: 'model', content: longThought, turn: 1, step: 1, at: 1 },
]))
assert.equal(whole.length, 1)
assert.equal(whole[0].kind === 'reasoning' ? whole[0].content.length : 0, 20_000, 'no truncation path exists')

// A thought is not an answer, however conclusive it sounds.
assert.equal(conversationAnswer(withReasoning), '結論：Pi Core 擁有迴圈。')
assert.equal(conversationAnswer(appendTurnRecord(undefined, [
  { kind: 'user-text', source: 'user', content: '在嗎', turn: 1, step: 1, at: 1 },
  { kind: 'reasoning', source: 'model', content: '我想我應該說在。', turn: 1, step: 1, at: 2 },
])), undefined, 'reasoning never becomes the published answer')

// ── Backward compatibility: a record written before reasoning existed ──────
// Its projection must be byte-for-byte what it was, so an archived
// conversation does not change shape when the app updates.
assert.deepEqual(
  projectConversationRows(record),
  [
    { id: 'e3', seq: 3, turn: 1, kind: 'user', content: '分析這個專案' },
    { id: 'e4', seq: 4, turn: 1, kind: 'assistant', content: '我先探索本地專案結構。' },
    { id: 'e5', seq: 5, turn: 1, kind: 'tool', tool: 'grep', callId: 'c1', detail: 'src/' },
    { id: 'e6', seq: 6, turn: 1, kind: 'tool', tool: 'grep', callId: 'c1', settlement: 'success' },
    { id: 'e7', seq: 7, turn: 1, kind: 'assistant', content: '結論：Host 擁有迴圈。' },
  ],
  'a record with no reasoning entry projects exactly as it did before',
)

// Purity is a contract, not a hope: the module may not reach for I/O, stores,
// the clock, or randomness, because it replays.
const source = await readFile(resolve(import.meta.dirname, '../src/agent/conversationProjection.ts'), 'utf8')
for (const forbidden of [/Date\.now/, /Math\.random/, /useState|useStore|zustand/, /require\(|await import\(/, /window\./]) {
  assert.doesNotMatch(source, forbidden, `the projection must stay pure: ${forbidden}`)
}
console.log('The conversation is a pure projection of the Turn Record')
