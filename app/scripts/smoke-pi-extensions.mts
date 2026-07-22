import { strict as assert } from 'node:assert'
import { validatePiTrigger } from '../electron/piAutomationExtension.ts'
import { createPiChildSession } from '../electron/piDelegationExtension.ts'

assert.throws(() => validatePiTrigger({ kind: 'time', scheduleId: '', claim: '', prompt: 'x' }))
assert.equal(validatePiTrigger({ kind: 'time', scheduleId: 'daily', claim: 'claim-1', prompt: 'x' }).kind, 'time')
const child = createPiChildSession({ role: 'writer', profile: { model: 'm' }, context: { objective: 'write', facts: ['f'], constraints: ['c'] }, depth: 1 })
assert.equal(child.role, 'writer'); assert.deepEqual(child.context.facts, ['f']); assert.throws(() => createPiChildSession({ ...child, context: child.context, depth: 3, maxDepth: 2 }))
console.log('pi automation evidence and child-session isolation are valid')
