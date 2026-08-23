import assert from 'node:assert/strict'
import {
  appendTurnRecord,
  type TurnRecordAppend,
} from '../src/agent/turnRecord.ts'
import { projectRunOperations, projectProducedFiles } from '../src/agent/runOperationsProjection.ts'

/**
 * The execution-process record is derived from the Turn Record and from
 * nothing else. The ephemeral live-activity store caps its cache at 120
 * events (40 after terminalization), so a long run used to lose its earliest
 * operations the moment the summary was assembled — the cap bounded history.
 *
 * Now: a record longer than any cache cap still yields every operation, the
 * display order comes from `seq`, produced files come only from mutating
 * tool results, and reads never appear in them.
 */

const OPERATIONS = 150 // > MAX_EVENTS(120) and > MAX_TERMINAL_EVENTS(40)

let record = appendTurnRecord(undefined, [{ kind: 'turn-start', source: 'host' }])
const appends: TurnRecordAppend[] = []
for (let step = 1; step <= OPERATIONS; step += 1) {
  const isWrite = step % 10 === 0
  const isRead = step % 3 === 0
  const tool = isWrite ? 'edit' : isRead ? 'grep' : 'ls'
  appends.push(
    { kind: 'step-start', source: 'host' },
    { kind: 'tool-call', source: 'model', tool, callId: `call_${step}`, ...(isWrite || isRead ? { path: `/proj/file-${step}.ts` } : {}) },
    isRead
      ? { kind: 'tool-result', source: 'host', tool, callId: `call_${step}`, settlement: 'success' }
      : { kind: 'tool-result', source: 'host', tool, callId: `call_${step}`, settlement: 'success', detail: 'ok' },
    { kind: 'step-end', source: 'host' },
    ...(isWrite ? [{ kind: 'assistant-text' as const, source: 'model' as const, content: `已修改 file-${step}.ts` }] : []),
  )
}
record = appendTurnRecord(record, appends)
record = appendTurnRecord(record, [{ kind: 'turn-end', source: 'host', settlement: 'answered' }])

// Every operation survives, whatever the live cache's caps are.
const rows = projectRunOperations(record)
const toolRows = rows.filter((row) => row.kind === 'tool')
assert.equal(toolRows.length, OPERATIONS, `a ${OPERATIONS}-operation run must yield ${OPERATIONS} rows, saw ${toolRows.length}`)

// Order is decided by seq, not by array position or map iteration.
for (let index = 1; index < rows.length; index += 1) {
  assert.ok(rows[index - 1].seq < rows[index].seq, 'rows must be ordered by ascending seq')
}

// The FIRST operation is still present (the old ladder lost exactly these).
assert.equal(toolRows[0]?.callId, 'call_1')

// Produced files come from mutating tools only; reads are excluded.
const files = projectProducedFiles(record)
assert.equal(files.length, OPERATIONS / 10, `${OPERATIONS / 10} edits expected`)
const fileStep = (path: string) => Number(path.match(/-(\d+)\.ts$/)?.[1])
assert.ok(files.every((file) => fileStep(file.path) % 10 === 0), 'only edit targets may appear as produced files')
assert.ok(!files.some((file) => fileStep(file.path) % 3 === 0 && fileStep(file.path) % 10 !== 0), 'a grep target is not a produced file')

console.log('the execution-process record derives from the Turn Record alone; no cache cap bounds it')
