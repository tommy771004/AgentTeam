import assert from 'node:assert/strict'
import { handlePiHostTurnDomain } from '../electron/piHostTurnDomain.ts'

const calls: string[] = []
const route = (method: string, params: Record<string, unknown> = {}) => handlePiHostTurnDomain({
  method,
  params,
  invalid: (message) => ({ kind: 'invalid', message }),
  interrupt: (runId, reason) => { calls.push(`interrupt:${runId}:${reason}`); return { kind: 'interrupt' } },
  cancel: (runId) => { calls.push(`cancel:${runId}`); return { kind: 'cancel' } },
  submit: () => { calls.push('submit'); return { kind: 'submit' } },
})

assert.equal(route('session/list'), undefined)
assert.deepEqual(route('turn/interrupt'), { kind: 'invalid', message: 'runId is required' })
assert.deepEqual(route('turn/cancel'), { kind: 'invalid', message: 'runId is required' })
assert.deepEqual(route('turn/interrupt', { runId: 'r1', reason: 'timeout' }), { kind: 'interrupt' })
assert.deepEqual(route('turn/interrupt', { runId: 'r2', reason: 'anything' }), { kind: 'interrupt' })
assert.deepEqual(route('turn/cancel', { runId: 'r3' }), { kind: 'cancel' })
assert.deepEqual(route('turn/submit'), { kind: 'submit' })
assert.deepEqual(calls, ['interrupt:r1:timeout', 'interrupt:r2:user', 'cancel:r3', 'submit'])

console.log('Pi Host turn routing delegates versioned methods without changing Host authority')
