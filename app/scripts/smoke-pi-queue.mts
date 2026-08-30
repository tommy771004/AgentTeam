import { strict as assert } from 'node:assert'
import { PiRunQueue } from '../electron/piRunQueue.ts'

const queue = new PiRunQueue(1)
const run = { runId: 'r1', sessionId: 's1', prompt: 'do', trigger: 'interactive' as const, profile: { model: 'm1', runner: 'builtin', attachments: [{ id: 'a1', filePath: '/tmp/a1' }] }, status: 'queued' as const, action: 'queue' as const, clientMessageId: 'client-r1' }
assert.deepEqual(queue.enqueue(run), { ok: true })
assert.deepEqual(queue.enqueue(run), { ok: false, code: 'duplicate' })
assert.deepEqual(queue.enqueue({ ...run, runId: 'retry-id' }), { ok: false, code: 'duplicate' }, 'client identity dedupes transport retries')
assert.deepEqual(queue.enqueue({ ...run, runId: 'r2', clientMessageId: 'client-r2' }), { ok: false, code: 'queue_full' })
const snapshot = queue.snapshot(); snapshot[0].profile.model = 'changed'; assert.equal(queue.dequeue()?.profile.model, 'm1')
queue.markInterrupted('r1'); assert.equal(queue.snapshot()[0].status, 'interrupted')
const recovered = new PiRunQueue(1, queue.snapshot())
assert.equal(recovered.snapshot()[0]?.clientMessageId, 'client-r1')
assert.equal(recovered.snapshot()[0]?.revision, queue.snapshot()[0]?.revision)
assert.equal((recovered.snapshot()[0]?.profile.attachments as Array<{ filePath: string }>)[0]?.filePath, '/tmp/a1')
console.log('pi durable queue preserves dedupe, bounds, and interruption')
