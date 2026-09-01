import assert from 'node:assert/strict'
import {
  decideInitialTaskRunAdmission,
  decideExternalQueueSnapshotAdmission,
  decideBusyPolicy,
} from '../src/agent/taskRunAdmission.ts'

const base = {
  objective: 'ship it',
  runId: 'run-1',
  hasExplicitRunId: true,
  reuseThreadId: 'thread-1',
  sourceKind: 'composer' as const,
  fromQueue: false,
  queuedDuplicateId: undefined,
  delegateEnabled: true,
  activeRunIds: [] as string[],
}

assert.equal(decideInitialTaskRunAdmission({ ...base, objective: '' }).kind, 'empty-objective')
assert.deepEqual(
  decideInitialTaskRunAdmission({ ...base, queuedDuplicateId: 'queue-1' }),
  { kind: 'queued-duplicate', queueId: 'queue-1' },
)
assert.equal(
  decideInitialTaskRunAdmission({ ...base, sourceKind: 'delegate', delegateEnabled: false }).kind,
  'delegate-disabled',
)
assert.equal(
  decideInitialTaskRunAdmission({ ...base, activeRunIds: ['run-1'] }).kind,
  'active-duplicate',
)
assert.deepEqual(decideInitialTaskRunAdmission(base), { kind: 'proceed' })

assert.equal(
  decideExternalQueueSnapshotAdmission({ runner: 'claude', fromQueue: true, hasConnectorSnapshot: false }).kind,
  'missing-connector-snapshot',
)
assert.deepEqual(
  decideExternalQueueSnapshotAdmission({ runner: 'builtin', fromQueue: true, hasConnectorSnapshot: false }),
  { kind: 'proceed' },
)

assert.equal(decideBusyPolicy({ followUpAction: 'takeover', sourceKind: 'composer', resolvedSourcePolicy: 'queue', shouldEnqueue: true }), 'steer')
assert.equal(decideBusyPolicy({ followUpAction: 'queue', sourceKind: 'composer', resolvedSourcePolicy: 'steer', shouldEnqueue: false }), 'queue')
assert.equal(decideBusyPolicy({ sourceKind: 'schedule', resolvedSourcePolicy: 'queue', shouldEnqueue: false }), 'queue')
assert.equal(decideBusyPolicy({ shouldEnqueue: false }), 'reject')

console.log('task run admission prefactor keeps decisions pure and coordinator effects explicit')
