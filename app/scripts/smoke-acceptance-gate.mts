import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluateAcceptanceGate, goalVerdictFromAcceptance } from '../electron/acceptanceGate.ts'
import { verifyAcceptanceEvidence, verifyAcceptanceSnapshot } from '../src/agent/acceptanceContract.ts'
import { goalContractFromWorkingState } from '../src/agent/goalContract.ts'
import { createInitialWorkingState } from '../src/agent/workingState.ts'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const workspace = await mkdtemp(join(tmpdir(), 'acceptance-gate-'))

try {
  const turnState = createInitialWorkingState({ runId: 'turn-acceptance', objective: 'answer the user' })
  const turnContract = await goalContractFromWorkingState({
    state: turnState, mode: 'turn', maxIterations: 1, maxWallClockMs: 10_000, unattended: false,
  })
  const turnAcceptance = await evaluateAcceptanceGate({
    runId: turnState.runId,
    iteration: 1,
    goalContract: turnContract,
    workspaceRoot: workspace,
    settlement: 'answered',
    answer: 'Here is the answer.',
  })
  assert.equal(turnAcceptance.snapshot.overall, 'passed')
  assert.equal(goalVerdictFromAcceptance({ mode: turnContract.mode, snapshot: turnAcceptance.snapshot }), 'not-applicable')
  assert.equal(Object.isFrozen(turnAcceptance.snapshot), true)
  assert.equal(Object.isFrozen(turnAcceptance.evidence[0]), true)
  assert.match(turnAcceptance.snapshot.digest, /^[a-f0-9]{64}$/)
  assert.equal(await verifyAcceptanceSnapshot(turnAcceptance.snapshot), true)
  assert.equal(await verifyAcceptanceEvidence(turnAcceptance.evidence[0]), true)
  assert.equal(await verifyAcceptanceSnapshot({ ...turnAcceptance.snapshot, overall: 'failed' }), false)

  const expected = 'verified\n'
  const predicate = { kind: 'file-content' as const, path: 'result.txt', sha256: sha256(expected) }
  const goalState = createInitialWorkingState({ runId: 'goal-acceptance', objective: 'write result', completionPredicate: predicate })
  const goalContract = await goalContractFromWorkingState({
    state: goalState, mode: 'goal', maxIterations: 1, maxWallClockMs: 10_000, unattended: false,
  })
  await writeFile(join(workspace, predicate.path), expected)
  const accepted = await evaluateAcceptanceGate({
    runId: goalState.runId,
    iteration: 1,
    goalContract,
    workspaceRoot: workspace,
    settlement: 'answered',
    answer: 'I completed the task.',
  })
  assert.equal(accepted.snapshot.overall, 'passed')
  assert.equal(goalVerdictFromAcceptance({ mode: goalContract.mode, snapshot: accepted.snapshot }), 'passed')
  assert.equal(accepted.snapshot.verdicts[0]?.evidenceRefs[0], accepted.evidence[0]?.id)
  assert.equal(accepted.evidence[0]?.kind, 'file-content')
  assert.equal(accepted.evidence[0]?.kind === 'file-content' && accepted.evidence[0].actualSha256, predicate.sha256)

  await writeFile(join(workspace, predicate.path), 'drifted\n')
  const drifted = await evaluateAcceptanceGate({
    runId: goalState.runId,
    iteration: 2,
    goalContract,
    workspaceRoot: workspace,
    settlement: 'answered',
    answer: 'I completed the task.',
    previousEvidence: accepted.evidence,
  })
  assert.equal(drifted.snapshot.verdicts[0]?.status, 'invalidated')
  assert.equal(drifted.snapshot.overall, 'unmet')
  assert.equal(goalVerdictFromAcceptance({ mode: goalContract.mode, snapshot: drifted.snapshot }), 'exhausted')
  assert.notEqual(drifted.snapshot.digest, accepted.snapshot.digest)

  console.log('Acceptance Gate passed: turn-only answer, trusted file digest, drift invalidation, checker-governed Goal verdict')
} finally {
  await rm(workspace, { recursive: true, force: true })
}
