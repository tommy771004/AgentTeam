import { strict as assert } from 'node:assert'
import { evaluatePiPolicy } from '../electron/piPolicyExtension.ts'

assert.deepEqual(evaluatePiPolicy({ channel: 'llm', content: 'hello', mode: 'off' }), { decision: 'allow', content: 'hello', inspected: false })
assert.equal(evaluatePiPolicy({ channel: 'llm', content: 'token=abc', mode: 'optional', protectedTerms: ['abc'] }).decision, 'sanitize')
assert.equal(evaluatePiPolicy({ channel: 'llm', content: 'token=abc', mode: 'required', protectedTerms: ['abc'] }).decision, 'ask')
assert.equal(evaluatePiPolicy({ channel: 'llm', content: 'token=abc', mode: 'required', protectedTerms: ['abc'], unattended: true }).decision, 'deny')
console.log('pi policy extension is fail-closed and single-seam')
