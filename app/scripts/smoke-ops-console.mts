import assert from 'node:assert/strict'
import { buildOpsSnapshot } from '../src/agent/opsConsole.ts'

const result = buildOpsSnapshot({
  jobs: [],
  events: [],
  activeRuns: [{ runId: 'run_1', status: 'running' }],
  capacity: { active: 1, limit: 4 },
  queuedRuns: [{
    id: 'q_1',
    objective: 'queued work',
    sourceKind: 'schedule',
    runner: 'builtin',
    enqueuedAt: '2026-08-17T00:00:00.000Z',
    dedupeKey: 'same',
  }],
  dedupeEvents: [{
    at: '2026-08-17T00:00:00.000Z',
    dedupeKey: 'same',
    objective: 'duplicate work',
    sourceKind: 'schedule',
    reason: 'duplicate',
  }],
  journal: [],
  recoveryReports: [],
})
assert.equal(result.capacity.remaining, 3)
assert.equal(result.queue[0]?.reason, 'capacity')
assert.equal(result.deduplicated[0]?.reason, 'duplicate')
console.log('smoke-ops-console: 3 assertions passed')
