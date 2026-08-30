import assert from 'node:assert/strict'
import { updateDraftStateAtomically } from '../src/components/settings/draftState.ts'

type Draft = { value: string; presence: 'unset' | 'blank' | 'value'; edited: boolean }
const initial: Draft = { value: 'old', presence: 'value', edited: false }
const ref = { current: initial }
let stateValue: Draft | undefined
let callbackSawSynchronousRef = false

const resolved = updateDraftStateAtomically(ref, (next) => {
  callbackSawSynchronousRef = ref.current === next
  stateValue = next
}, (current) => ({ ...current, value: '', presence: 'blank', edited: true }))

assert.equal(ref.current, resolved, 'draft ref must be updated before state publication')
assert.equal(stateValue, resolved, 'React state must receive the same resolved draft object')
assert.equal(callbackSawSynchronousRef, true, 'state publication must observe the resolved ref synchronously')
assert.deepEqual(resolved, { value: '', presence: 'blank', edited: true })

console.log('personalization draft atomic contract passed: ref-before-state and identical resolved draft')
