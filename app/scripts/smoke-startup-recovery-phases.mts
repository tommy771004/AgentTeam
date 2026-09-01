import assert from 'node:assert/strict'
import {
  STARTUP_RECOVERY_PHASES,
  classifyLiveExternalSessions,
  createStartupRecoveryPhaseTracker,
  isExternalThreadStillLive,
} from '../src/agent/startupRecoveryPhases.ts'

assert.deepEqual(STARTUP_RECOVERY_PHASES, [
  'durable-read',
  'host-reconciliation',
  'cursor-replay',
  'active-reattachment',
  'terminal-finalization',
  'queue-drain',
])

const tracker = createStartupRecoveryPhaseTracker()
for (const phase of STARTUP_RECOVERY_PHASES) tracker.advance(phase)
assert.deepEqual(tracker.complete(), { status: 'complete', phases: STARTUP_RECOVERY_PHASES })

const outOfOrder = createStartupRecoveryPhaseTracker()
assert.throws(() => outOfOrder.advance('cursor-replay'), /expected durable-read/)
assert.throws(() => outOfOrder.complete(), /incomplete startup recovery/)

const failed = createStartupRecoveryPhaseTracker()
failed.advance('durable-read')
assert.deepEqual(failed.fail(new Error('corrupted projection')), {
  status: 'failed',
  phases: ['durable-read'],
  failedPhase: 'durable-read',
  reason: 'corrupted projection',
})

const finalPhaseFailed = createStartupRecoveryPhaseTracker()
for (const phase of STARTUP_RECOVERY_PHASES) finalPhaseFailed.advance(phase)
assert.deepEqual(finalPhaseFailed.fail(new Error('queue drain failed')), {
  status: 'failed',
  phases: STARTUP_RECOVERY_PHASES,
  failedPhase: 'queue-drain',
  reason: 'queue drain failed',
})

const live = classifyLiveExternalSessions([
  { active: true, runId: 'run-live', conversationId: 'thread-live' },
  { active: false, runId: 'run-terminal', conversationId: 'thread-terminal' },
  null,
  'corrupt',
])
assert.deepEqual([...live.runIds], ['run-live'])
assert.equal(isExternalThreadStillLive({ id: 'thread-live' }, live), true)
assert.equal(isExternalThreadStillLive({ id: 'other', externalRun: { runId: 'run-live' } }, live), true)
assert.equal(isExternalThreadStillLive({ id: 'thread-terminal', externalRun: { runId: 'run-terminal' } }, live), false)
assert.deepEqual(classifyLiveExternalSessions({ corrupted: true }), { runIds: new Set(), conversationIds: new Set() })

console.log('startup recovery phases are explicit, ordered, fail-closed, and non-blocking')
