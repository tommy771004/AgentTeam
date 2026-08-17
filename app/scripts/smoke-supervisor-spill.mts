import assert from 'node:assert/strict'
import { DEFAULT_SUPERVISOR_LIMITS, enforceToolPayloadWithSpill, SupervisorViolation } from '../src/agent/supervisor.ts'

let written = ''
const result = await enforceToolPayloadWithSpill(
  'workspace_grep',
  'x'.repeat(500),
  { ...DEFAULT_SUPERVISOR_LIMITS, maxToolPayloadBytes: 32 },
  'truncate',
  { write: async ({ output }) => { written = output; return { locator: 'toolspill:run_1:spill_1', bytes: output.length } } },
  { runId: 'run_1', threadId: 'thread_1' },
)
assert.equal(result.spilled, true)
assert.equal(result.truncated, false)
assert.equal(written.length, 500)
assert.match(result.output, /tool_output_read/)

await assert.rejects(
  () => enforceToolPayloadWithSpill('http_fetch', 'y'.repeat(500), { ...DEFAULT_SUPERVISOR_LIMITS, maxToolPayloadBytes: 32 }, 'halt'),
  (error) => error instanceof SupervisorViolation,
)
console.log('supervisor spill smoke passed')

