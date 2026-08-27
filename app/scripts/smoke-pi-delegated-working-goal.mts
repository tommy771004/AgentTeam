import assert from 'node:assert/strict'
import {
  checkDelegatedGoalObservation,
  createDelegatedGoalAssignment,
  createInitialWorkingState,
  type DelegatedGoalObservation,
} from '../src/agent/workingState.ts'

const digest = 'a'.repeat(64)
const state = createInitialWorkingState({
  runId: 'parent-run',
  objective: '完成 parent goal',
  constraints: ['只接受 Host evidence'],
  completionPredicate: { kind: 'file-content', path: 'result.txt', sha256: digest },
})
const goal = state.goals[0]
const assignment = createDelegatedGoalAssignment({
  state,
  goalId: goal.id,
  parentSessionId: 'parent-session',
  childSessionId: 'child-session-a',
})
assert.deepEqual(assignment.goal, {
  id: goal.id,
  description: goal.description,
  completionPredicate: goal.completionPredicate,
})
assert.deepEqual(assignment.constraints, state.constraints)
assert.equal('goals' in assignment, false, 'child snapshot does not expose a run-wide ledger')

const verified: DelegatedGoalObservation = {
  schemaVersion: 1,
  delegationId: assignment.delegationId,
  parentRunId: state.runId,
  parentSessionId: assignment.parentSessionId,
  childSessionId: assignment.childSessionId,
  childRunId: 'child-run-a',
  goalId: goal.id,
  baseRevision: state.revision,
  status: 'verified',
  summary: 'child produced verified bytes',
  resource: goal.completionPredicate,
  evidenceRef: {
    seq: 12,
    evidenceId: `execution:${digest}`,
    runId: 'child-run-a',
    parentRunId: state.runId,
    goalId: goal.id,
    tool: 'write',
    callId: 'child-call-a',
    contractDigest: digest,
    schemaDigest: digest,
    receiptDigest: digest,
    delegationId: assignment.delegationId,
    childSessionId: assignment.childSessionId,
    childRecordSeq: 12,
  },
}
const accepted = checkDelegatedGoalObservation({ state, assignment, observation: verified })
assert.equal(accepted.check.verdict, 'accepted')
assert.equal(accepted.state?.revision, 2)
assert.equal(accepted.state?.goals[0].status, 'done')

const falseClaim = checkDelegatedGoalObservation({
  state,
  assignment,
  observation: { ...verified, status: 'unverified', summary: 'assistant said done', resource: undefined, evidenceRef: undefined },
})
assert.equal(falseClaim.check.verdict, 'rejected')
assert.equal(falseClaim.check.reason, 'child-goal-not-verified')
assert.equal(falseClaim.state, undefined)

const invalidated = checkDelegatedGoalObservation({
  state,
  assignment,
  observation: { ...verified, status: 'invalidated', summary: 'child evidence was overwritten before parent adoption' },
})
assert.equal(invalidated.check.verdict, 'rejected')
assert.equal(invalidated.check.reason, 'delegated-evidence-invalidated')
assert.equal(invalidated.state, undefined)

const otherGoal = checkDelegatedGoalObservation({
  state,
  assignment,
  observation: { ...verified, goalId: 'other-goal' },
})
assert.equal(otherGoal.check.reason, 'delegation-goal-mismatch')

const staleSameGoal = checkDelegatedGoalObservation({
  state: accepted.state!,
  assignment: { ...assignment, childSessionId: 'child-session-b', delegationId: `${assignment.delegationId}:b` },
  observation: {
    ...verified,
    childSessionId: 'child-session-b',
    delegationId: `${assignment.delegationId}:b`,
    evidenceRef: {
      ...verified.evidenceRef!,
      childSessionId: 'child-session-b',
      delegationId: `${assignment.delegationId}:b`,
    },
  },
})
assert.equal(staleSameGoal.check.verdict, 'rejected')
assert.equal(staleSameGoal.check.reason, 'stale-goal-conflict')
assert.equal(staleSameGoal.state, undefined, 'a stale child cannot overwrite the committed parent goal')

console.log('Delegated goal completion remains parent-owned and CAS-checked')
