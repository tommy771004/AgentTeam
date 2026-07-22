import { strict as assert } from 'node:assert'
import { PiRunQueue } from '../electron/piRunQueue.ts'

const queue = new PiRunQueue(1)
const run = { runId: 'r1', sessionId: 's1', prompt: 'do', trigger: 'interactive' as const, profile: { model: 'm1' }, status: 'queued' as const }
assert.deepEqual(queue.enqueue(run), { ok: true })
assert.deepEqual(queue.enqueue(run), { ok: false, code: 'duplicate' })
assert.deepEqual(queue.enqueue({ ...run, runId: 'r2' }), { ok: false, code: 'queue_full' })
const snapshot = queue.snapshot(); snapshot[0].profile.model = 'changed'; assert.equal(queue.dequeue()?.profile.model, 'm1')
queue.markInterrupted('r1'); assert.equal(queue.snapshot()[0].status, 'interrupted')
console.log('pi durable queue preserves dedupe, bounds, and interruption')
