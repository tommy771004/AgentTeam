import { strict as assert } from 'node:assert'
import { buildExternalCliRecord } from '../src/agent/externalCliRecord.ts'
import { appendTurnRecord, recordRunnerDeclaration, turnRecordEntries } from '../src/agent/turnRecord.ts'
import { conversationAnswer, projectConversationRows } from '../src/agent/conversationProjection.ts'
import { projectProducedFiles, projectRunOperations } from '../src/agent/runOperationsProjection.ts'
import { isPiHostDefinitionOfDoneMet, PI_CORE_SETTLEMENT_DEFINITION_OF_DONE } from '../src/agent/piHostRun.ts'
import { presentToolCall } from '../src/agent/tools/toolPresentation.ts'

/**
 * An external CLI run produces the same record shape as a builtin one — so the
 * user does not drop into a worse view by switching provider — while the
 * record keeps saying that this path validated no Definition of Done.
 */

const external = buildExternalCliRecord({
  runner: 'codex',
  prompt: '修好那個測試',
  events: [
    { kind: 'tool', tool: 'bash', command: 'npm test', ok: true },
    { kind: 'file', tool: 'write', path: 'src/fix.ts', ok: true },
    { kind: 'tool', tool: 'some_unknown_cli_tool', detail: '做了點什麼', ok: true },
    { kind: 'file', tool: 'write', path: 'src/broken.ts', ok: false },
    { kind: 'status', title: '不是工具事件' },
  ],
  answer: '已修好，並補了一個測試。',
  settlement: 'answered',
  startedAt: 1_000,
  finishedAt: 2_000,
})

// Same entry kinds as a builtin turn, in the same order.
const builtin = appendTurnRecord(undefined, [
  { kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'step-start', source: 'host', turn: 1, step: 1, at: 2 },
  { kind: 'user-text', source: 'user', content: 'x', turn: 1, step: 1, at: 3 },
  { kind: 'tool-call', source: 'model', tool: 'bash', callId: 'c1', turn: 1, step: 1, at: 4 },
  { kind: 'tool-result', source: 'host', tool: 'bash', callId: 'c1', settlement: 'success', turn: 1, step: 1, at: 5 },
  { kind: 'assistant-text', source: 'model', content: 'y', turn: 1, step: 1, at: 6 },
  { kind: 'step-end', source: 'host', turn: 1, step: 1, at: 7 },
  { kind: 'turn-end', source: 'host', settlement: 'answered', turn: 1, step: 1, at: 8 },
])
const kindsOf = (record: Parameters<typeof turnRecordEntries>[0]) => [...new Set(turnRecordEntries(record).map((entry) => entry.kind))]
for (const kind of kindsOf(builtin)) {
  assert.ok(kindsOf(external).includes(kind), `an external run records ${kind} like a builtin one`)
}
assert.deepEqual(turnRecordEntries(external).map((entry) => entry.seq), turnRecordEntries(external).map((_, index) => index + 1))

// Accountability survives the path change: the model asked, the Host reported.
assert.equal(turnRecordEntries(external).find((entry) => entry.kind === 'tool-call')?.source, 'model')
assert.equal(turnRecordEntries(external).find((entry) => entry.kind === 'tool-result')?.source, 'host')

// The same projections read it — no external-only view.
assert.equal(conversationAnswer(external), '已修好，並補了一個測試。')
assert.ok(projectConversationRows(external).some((row) => row.kind === 'tool'))
assert.ok(projectRunOperations(external).length > 0)
// Only the successful write produced a file; the failed one did not.
assert.deepEqual(projectProducedFiles(external).map((file) => file.path), ['src/fix.ts'])

// Declared cards apply; a tool the catalog does not know falls back.
assert.equal(presentToolCall('bash', { command: 'npm test' })?.card, 'terminal')
assert.equal(presentToolCall('some_unknown_cli_tool', { detail: 'x' }), undefined)

// The capability declaration rides on the record and stays false.
const declared = recordRunnerDeclaration(external)
assert.equal(declared?.runner, 'codex')
assert.deepEqual(declared?.capabilities, { parse: false, validateDoD: false, iterate: false })
assert.equal(recordRunnerDeclaration(builtin), undefined, 'the builtin loop declares no external runner')

// CLI success is never Definition of Done met.
assert.equal(isPiHostDefinitionOfDoneMet(PI_CORE_SETTLEMENT_DEFINITION_OF_DONE, 'answered', '已修好'), true)
assert.equal(declared?.capabilities?.validateDoD, false, 'nothing on this path validated a DoD')

// A silent external run settles empty, exactly as a builtin one does.
const silent = buildExternalCliRecord({ runner: 'claude', prompt: 'hi', events: [], answer: '   ', settlement: 'empty' })
assert.equal(conversationAnswer(silent), undefined)
const closing = turnRecordEntries(silent).find((entry) => entry.kind === 'turn-end')
assert.equal(closing && 'settlement' in closing ? closing.settlement : undefined, 'empty')
console.log('An external CLI run records the same shape while still declaring what it did not do')
