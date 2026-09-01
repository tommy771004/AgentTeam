import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { goalVerdictFromAcceptance } from '../electron/acceptanceGate.ts'
import { runPiOrchestration } from '../electron/piOrchestrationExtension.ts'
import { createAcceptanceEvidence, createAcceptanceSnapshot } from '../src/agent/acceptanceContract.ts'
import { createGoalContractSnapshot } from '../src/agent/goalContract.ts'
import { createRepairPlan, isRepairNoProgress, repairPlanPrompt } from '../src/agent/repairPlan.ts'
import type { ContinuationItem } from '../src/agent/continuation.ts'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const contract = await createGoalContractSnapshot({
  schemaVersion: 1, id: 'goal-contract:repair', revision: 1, mode: 'goal', objective: 'repair failed artifact',
  constraints: [], outputs: [],
  criteria: [{ id: 'criterion-file', kind: 'file-content', path: 'result.txt', sha256: sha256('expected') }],
  budgets: { maxIterations: 2, maxWallClockMs: 60_000 },
  escalation: { onBlocked: 'fail', onUnverifiable: 'fail', onBudgetExceeded: 'fail', onNoProgress: 'fail' },
})

const acceptance = async (iteration: number, observedAt: number, actual: string) => {
  const evidence = await createAcceptanceEvidence({
    schemaVersion: 1, id: `evidence-${iteration}`, criterionId: 'criterion-file', issuedBy: 'host-checker', observedAt,
    kind: 'file-content', state: 'mismatched', path: 'result.txt', expectedSha256: sha256('expected'), actualSha256: sha256(actual),
  })
  const snapshot = await createAcceptanceSnapshot({
    runId: 'repair-run', iteration, goalContract: contract,
    verdicts: [{
      criterionId: 'criterion-file', status: 'failed', evidenceRefs: [evidence.id],
      reason: 'Host file-content check returned mismatched', repairHint: 'Restore result.txt', retryable: true,
    }],
  })
  return { evidence, snapshot }
}

const proposals: ContinuationItem[] = [
  {
    id: 'useful-hint', title: 'Fix result', description: 'write expected content',
    acceptanceCriteria: ['criterion-file must pass'], priority: 90, dependencies: [],
    scope: 'original-objective', requiresAdditionalAuthority: false, status: 'candidate',
  },
  {
    id: 'scope-expansion', title: 'Redesign app', description: 'unrelated work',
    acceptanceCriteria: ['make everything nicer'], priority: 100, dependencies: [],
    scope: 'expanded', requiresAdditionalAuthority: false, status: 'candidate',
  },
]

const first = await acceptance(1, 1_000, 'wrong')
const firstPlan = await createRepairPlan({ snapshot: first.snapshot, evidence: [first.evidence], modelProposals: proposals })
assert.deepEqual(firstPlan.targets.map((target) => target.criterionId), ['criterion-file'])
assert.deepEqual(firstPlan.targets[0]?.impactedArtifactIds, ['result.txt'])
assert.deepEqual(firstPlan.proposalHintIds, ['useful-hint'])
assert.deepEqual(firstPlan.rejectedProposalIds, ['scope-expansion'])
assert.match(repairPlanPrompt('original', firstPlan), /Restore result\.txt/)

const unchanged = await acceptance(2, 2_000, 'wrong')
const unchangedPlan = await createRepairPlan({ snapshot: unchanged.snapshot, evidence: [unchanged.evidence], modelProposals: proposals })
assert.notEqual(unchanged.snapshot.digest, first.snapshot.digest)
assert.equal(unchangedPlan.progressIdentity, firstPlan.progressIdentity)
assert.equal(isRepairNoProgress(firstPlan.progressIdentity, unchangedPlan), true)

const progressed = await acceptance(2, 3_000, 'closer')
const progressedPlan = await createRepairPlan({ snapshot: progressed.snapshot, evidence: [progressed.evidence], modelProposals: proposals })
assert.notEqual(progressedPlan.progressIdentity, firstPlan.progressIdentity)
assert.equal(isRepairNoProgress(firstPlan.progressIdentity, progressedPlan), false)

let turns = 0
const exhausted = await runPiOrchestration({
  pattern: 'Goal-based', prompt: 'repair', maxIterations: contract.budgets.maxIterations,
  turn: async () => { turns += 1; return { settlement: 'answered', result: 'claimed done', done: false, nextPrompt: 'Host repair plan' } },
})
assert.equal(turns, 2)
assert.equal(exhausted.settlement, 'failed')
assert.equal(exhausted.dodMet, false)
assert.equal(goalVerdictFromAcceptance({ mode: contract.mode, snapshot: unchanged.snapshot }), 'exhausted')

console.log('Criterion repair loop passed: Host targets, proposal filtering, evidence/artifact no-progress identity, bounded exhaustion')
