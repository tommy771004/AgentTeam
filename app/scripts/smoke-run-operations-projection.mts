import assert from 'node:assert/strict'
import {
  appendTurnRecord,
  type TurnRecordAppend,
} from '../src/agent/turnRecord.ts'
import { projectRunOperations, projectProducedFiles } from '../src/agent/runOperationsProjection.ts'
import { TOOL_DEFINITIONS } from '../src/agent/tools/toolDefinitions.ts'

/**
 * The execution-process record is derived from the Turn Record and from
 * nothing else. The ephemeral live-activity store caps its cache at 120
 * events (40 after terminalization), so a long run used to lose its earliest
 * operations the moment the summary was assembled — the cap bounded history.
 *
 * Now: a record longer than any cache cap still yields every operation, the
 * display order comes from `seq`, each tool's card is what the tool declared
 * (diff / terminal / search / generic), produced files come only from diff
 * cards — including a file the model never mentioned — and malformed or older
 * recorded arguments degrade to a plain row instead of breaking replay.
 */

const OPERATIONS = 150 // > MAX_EVENTS(120) and > MAX_TERMINAL_EVENTS(40)

let record = appendTurnRecord(undefined, [{ kind: 'turn-start', source: 'host' }])
const appends: TurnRecordAppend[] = []
for (let step = 1; step <= OPERATIONS; step += 1) {
  const isWrite = step % 10 === 0
  const isEdit = step % 15 === 0 && !isWrite // an edit the narration never mentions
  const isRead = step % 3 === 0
  const append = (): TurnRecordAppend[] => [
    { kind: 'step-start', source: 'host' },
    ...(isWrite
      ? [{
          kind: 'tool-call' as const,
          source: 'model' as const,
          tool: 'write',
          callId: `call_${step}`,
          args: { path: `/proj/file-${step}.ts`, content: `export const step = ${step}\n` },
        }]
      : isEdit
        ? [{
            kind: 'tool-call' as const,
            source: 'model' as const,
            tool: 'edit',
            callId: `call_${step}`,
            args: { path: `/proj/file-${step}.ts`, edits: [{ oldText: 'const old', newText: 'const new' }] },
          }]
        : isRead
          ? [{ kind: 'tool-call' as const, source: 'model' as const, tool: 'grep', callId: `call_${step}`, args: { pattern: `p-${step}` } }]
          : [{ kind: 'tool-call' as const, source: 'model' as const, tool: 'bash', callId: `call_${step}`, args: { command: `echo ${step}` } }]),
    { kind: 'tool-result', source: 'host', tool: isRead ? 'grep' : isWrite ? 'write' : isEdit ? 'edit' : 'bash', callId: `call_${step}`, settlement: 'success' },
    { kind: 'step-end', source: 'host' },
    ...(isWrite ? [{ kind: 'assistant-text' as const, source: 'model' as const, content: `已修改 file-${step}.ts` }] : []),
  ]
  appends.push(...append())
}
record = appendTurnRecord(record, appends)

// ── Declared cards survive replay, whatever the live cache's caps are ────────
const rows = projectRunOperations(record)
const toolRows = rows.filter((row) => row.kind !== 'notice')
assert.equal(toolRows.length, OPERATIONS, `a ${OPERATIONS}-operation run must keep exactly ${OPERATIONS} operation rows`)

// Order is decided by seq, not by array position or map iteration.
for (let index = 1; index < rows.length; index += 1) {
  assert.ok(rows[index - 1].seq < rows[index].seq, 'rows must be ordered by ascending seq')
}

// The FIRST operation is still present (the old ladder lost exactly these).
const firstTool = rows.find((row) => row.callId === 'call_1')
assert.ok(firstTool?.card?.card === 'terminal', 'a shell call presents as a terminal card')

const writeRow = rows.find((row) => row.callId === 'call_10')
assert.equal(writeRow?.card?.card, 'diff', 'a mutating call declares a diff card')
assert.deepEqual(
  writeRow?.card?.card === 'diff' ? writeRow.card.diffs.map((diff) => diff.path) : [],
  ['/proj/file-10.ts'],
)
const grepRow = rows.find((row) => row.callId === 'call_3')
assert.equal(grepRow?.card?.card, 'search', 'a search call presents as a search card')

// A read call declares a generic read card with its location.
const readCall = { kind: 'tool-call' as const, source: 'model' as const, tool: 'read', callId: 'read_1', args: { path: '/proj/index.ts', offset: 10 } }
let withRead = appendTurnRecord(undefined, [{ kind: 'turn-start', source: 'host' }])
withRead = appendTurnRecord(withRead, [
  readCall,
  { kind: 'tool-result', source: 'host', tool: 'read', callId: 'read_1', settlement: 'success', detail: 'file body' },
])
const readRow = projectRunOperations(withRead).find((row) => row.callId === 'read_1')
assert.equal(readRow?.card?.card, 'generic', 'a read presents as a generic card')
assert.equal(readRow?.card?.card === 'generic' ? readRow.card.kind : undefined, 'read')

// ── Produced files come from declared diffs, not filename guesses ────────────
const files = projectProducedFiles(record)
const editedSteps = Array.from({ length: OPERATIONS }, (_, index) => index + 1)
  .filter((step) => step % 10 === 0 || (step % 15 === 0 && step % 10 !== 0))
assert.equal(files.length, editedSteps.length, `${editedSteps.length} mutating calls expected`)
assert.ok(
  files.every((file) => editedSteps.includes(Number(file.path.match(/-(\d+)\.ts$/)?.[1]))),
  'only declared mutations may appear as produced files',
)
assert.ok(files.some((file) => Number(file.path.match(/-(\d+)\.ts$/)?.[1]) % 15 === 0), 'a file the model never mentioned is still listed')
// The read-only run above contributes nothing: reads are not mutations.
assert.deepEqual(projectProducedFiles(withRead), [], 'a read-only run produces no files')

// ── Fallbacks: undeclared tools and malformed arguments degrade safely ──────
let degraded = appendTurnRecord(undefined, [{ kind: 'turn-start', source: 'host' }])
degraded = appendTurnRecord(degraded, [
  { kind: 'tool-call', source: 'model', tool: 'mystery_tool', callId: 'c1' },
  { kind: 'tool-result', source: 'host', tool: 'mystery_tool', callId: 'c1', settlement: 'success', detail: 'ok' },
  // Older recorded arguments: no args at all, or args this presenter rejects.
  { kind: 'tool-call', source: 'model', tool: 'write', callId: 'c2' },
  { kind: 'tool-result', source: 'host', tool: 'write', callId: 'c2', settlement: 'success', detail: 'ok' },
  { kind: 'tool-call', source: 'model', tool: 'write', callId: 'c3', args: { nonsense: true } },
  { kind: 'tool-result', source: 'host', tool: 'write', callId: 'c3', settlement: 'failed', detail: 'disk full' },
])
const degradedRows = projectRunOperations(degraded)
assert.equal(degradedRows.length, 3, 'every recorded operation renders, whatever it recorded')
assert.ok(degradedRows.every((row) => !row.card), 'undeclared or malformed calls fall back to the plain row')
assert.equal(degradedRows.find((row) => row.callId === 'c3')?.kind, 'error', 'a failed mutation reads as an error')
assert.deepEqual(projectProducedFiles(degraded), [], 'malformed arguments contribute no produced files')

// ── Catalog tools declare on their definitions, next to the schema ──────────
const declared = TOOL_DEFINITIONS.workspace_write.presentCall?.({ path: '/w/report.md', content: '# hi\n' })
assert.equal(declared?.card, 'diff', 'a catalog write tool declares its diff card on its definition')
assert.equal(TOOL_DEFINITIONS.bash.presentCall?.({ command: 'ls' })?.card, 'terminal')
assert.equal(TOOL_DEFINITIONS.workspace_grep.presentCall?.({ query: 'todo' })?.card, 'search')

console.log('the execution-process record derives from the Turn Record alone; tools declare their own presentation')
