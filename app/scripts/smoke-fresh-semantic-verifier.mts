import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { evaluateAcceptanceGate } from '../electron/acceptanceGate.ts'
import {
  checkFreshSemanticCriterion,
  isFreshSemanticVerifierRequest,
  type FreshSemanticVerifierRequest,
  type FreshSemanticVerifierRunner,
} from '../electron/criterionCheckers/semanticVerifier.ts'
import { verifyAcceptanceEvidence } from '../src/agent/acceptanceContract.ts'
import { createGoalContractSnapshot, type GoalCriterion } from '../src/agent/goalContract.ts'
import { setOutboundGateObserver } from '../src/agent/outbound/outboundGate.ts'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const rubric = { id: 'rubric.release', instructions: 'Verify correctness, freshness, and source validity.', digest: '' }
rubric.digest = sha256(rubric.instructions)
const artifacts = [{
  artifactId: 'artifact.report',
  schemaId: 'report-v1',
  digest: sha256('sanitized-report'),
  sanitized: true as const,
  content: { text: 'Sanitized report', sources: [{ url: 'https://example.test/source', publishedAt: '2026-09-01' }] },
}]
const semantic = (verifierPolicy: 'all' | 'majority' | 'mandatory'): Extract<GoalCriterion, { kind: 'semantic-rubric' }> => ({
  id: `criterion.semantic.${verifierPolicy}`,
  kind: 'semantic-rubric',
  rubricId: rubric.id,
  verifierPolicy,
})

let active = 0
let maxActive = 0
const requests: FreshSemanticVerifierRequest[] = []
const runner = (verdicts: Partial<Record<FreshSemanticVerifierRequest['check'], 'passed' | 'failed'>> = {}): FreshSemanticVerifierRunner => async (request) => {
  assert.equal(isFreshSemanticVerifierRequest(request), true)
  requests.push(request)
  active += 1
  maxActive = Math.max(maxActive, active)
  await new Promise((resolve) => setTimeout(resolve, 15))
  active -= 1
  return {
    verifierId: `verifier.${request.check}`,
    check: request.check,
    verdict: verdicts[request.check] || 'passed',
    reason: `${request.check} checked in fresh context`,
    freshContextProof: request.freshContext.nonce,
    usage: { tokens: 100, costUsd: 0.01 },
  }
}

const gateEvents: Array<{ inspected: boolean; action: string }> = []
setOutboundGateObserver((event) => gateEvents.push(event))
const allPassed = await checkFreshSemanticCriterion({
  runId: 'run-semantic',
  criterion: semantic('all'),
  rubric,
  artifacts,
  evidenceRefs: ['evidence:artifact'],
  budget: { remainingTokens: 500, remainingCostUsd: 0.05 },
  effectiveMode: 'required',
  buildFlavor: 'standard',
  runner: runner(),
  observedAt: 1_000,
})
setOutboundGateObserver(null)
assert.equal(allPassed.verdict.status, 'passed')
assert.deepEqual(allPassed.usage, { tokens: 300, costUsd: 0.03 })
assert.equal(maxActive, 3, 'correctness, freshness, and source validity must execute concurrently')
assert.equal(gateEvents.length, 3)
assert.ok(gateEvents.every((event) => event.inspected && event.action === 'allow'), 'required-mode verifier payloads enter the Outbound Data Gate')
assert.equal(await verifyAcceptanceEvidence(allPassed.evidence), true)
assert.equal(new Set(requests.map((request) => request.freshContext.nonce)).size, 3)
const serialized = JSON.stringify(requests)
for (const forbidden of ['"workerTranscript":', '"providerHistory":', '"reasoning":', '"messages":', '"conversation":']) {
  assert.equal(serialized.includes(forbidden), false, `fresh request excludes ${forbidden}`)
}

const twoOfThree = { correctness: 'failed' as const, freshness: 'passed' as const, 'source-validity': 'passed' as const }
const majority = await checkFreshSemanticCriterion({
  runId: 'run-majority', criterion: semantic('majority'), rubric, artifacts, evidenceRefs: [],
  budget: { remainingTokens: 500, remainingCostUsd: 0.05 }, effectiveMode: 'optional', buildFlavor: 'standard', runner: runner(twoOfThree),
})
assert.equal(majority.verdict.status, 'passed')
const mandatory = await checkFreshSemanticCriterion({
  runId: 'run-mandatory', criterion: semantic('mandatory'), rubric, artifacts, evidenceRefs: [],
  budget: { remainingTokens: 500, remainingCostUsd: 0.05 }, effectiveMode: 'optional', buildFlavor: 'standard', runner: runner(twoOfThree),
})
assert.equal(mandatory.verdict.status, 'failed', 'two non-mandatory votes cannot override failed correctness')

const overBudget = await checkFreshSemanticCriterion({
  runId: 'run-budget', criterion: semantic('all'), rubric, artifacts, evidenceRefs: [],
  budget: { remainingTokens: 299, remainingCostUsd: 0.05 }, effectiveMode: 'required', buildFlavor: 'standard', runner: runner(),
})
assert.equal(overBudget.verdict.status, 'failed')
assert.equal(overBudget.evidence.kind === 'semantic-verifier' && overBudget.evidence.state, 'budget-exceeded')
assert.deepEqual(overBudget.usage, { tokens: 300, costUsd: 0.03 }, 'verifier usage remains charged when the budget is exceeded')

let blockedRunnerCalls = 0
const blocked = await checkFreshSemanticCriterion({
  runId: 'run-blocked', criterion: semantic('all'), rubric, artifacts, evidenceRefs: [],
  budget: {}, effectiveMode: 'required', buildFlavor: 'standard',
  runner: async () => { blockedRunnerCalls += 1; throw new Error('must not run') },
  gate: (request) => ({ action: 'block', reason: `blocked ${request.channel}`, effectiveMode: request.effectiveMode }),
})
assert.equal(blocked.verdict.status, 'blocked')
assert.equal(blockedRunnerCalls, 0)

const contract = await createGoalContractSnapshot({
  schemaVersion: 1,
  id: 'goal-contract:semantic',
  revision: 1,
  mode: 'goal',
  objective: 'Semantically verify the sanitized report',
  constraints: [],
  outputs: [],
  criteria: [semantic('mandatory')],
  budgets: { maxIterations: 2, maxWallClockMs: 60_000, maxTokens: 500, maxCostUsd: 0.05 },
  escalation: { onBlocked: 'fail', onUnverifiable: 'fail', onBudgetExceeded: 'fail', onNoProgress: 'fail' },
})
const acceptance = await evaluateAcceptanceGate({
  runId: 'run-acceptance-semantic',
  iteration: 1,
  goalContract: contract,
  workspaceRoot: process.cwd(),
  settlement: 'answered',
  answer: 'worker claim is not evidence',
  semanticVerifier: {
    artifacts,
    rubrics: { [rubric.id]: rubric },
    evidenceRefs: ['evidence:artifact'],
    budget: { remainingTokens: 500, remainingCostUsd: 0.05 },
    effectiveMode: 'required',
    buildFlavor: 'standard',
    runner: runner(),
  },
})
assert.equal(acceptance.snapshot.overall, 'passed')
assert.deepEqual(acceptance.verifierUsage, { tokens: 300, costUsd: 0.03 })

const aggregateContract = await createGoalContractSnapshot({
  schemaVersion: 1,
  id: 'goal-contract:semantic-aggregate',
  revision: 1,
  mode: 'goal',
  objective: 'Enforce one aggregate semantic verifier budget',
  constraints: [],
  outputs: [],
  criteria: [semantic('all'), semantic('majority')],
  budgets: { maxIterations: 2, maxWallClockMs: 60_000, maxTokens: 500, maxCostUsd: 0.05 },
  escalation: { onBlocked: 'fail', onUnverifiable: 'fail', onBudgetExceeded: 'fail', onNoProgress: 'fail' },
})
const aggregate = await evaluateAcceptanceGate({
  runId: 'run-acceptance-aggregate', iteration: 1, goalContract: aggregateContract,
  workspaceRoot: process.cwd(), settlement: 'answered', answer: 'claim',
  semanticVerifier: {
    artifacts,
    rubrics: { [rubric.id]: rubric },
    evidenceRefs: [],
    budget: { remainingTokens: 1_000, remainingCostUsd: 1 },
    effectiveMode: 'required',
    buildFlavor: 'standard',
    runner: runner(),
  },
})
assert.equal(aggregate.verifierUsage.tokens, 600)
assert.ok(Math.abs(aggregate.verifierUsage.costUsd - 0.06) < Number.EPSILON * 10)
assert.equal(aggregate.snapshot.overall, 'unmet', 'parallel semantic criteria cannot each spend the same remaining Goal budget')
assert.ok(aggregate.snapshot.verdicts.every((verdict) => verdict.reason.includes('Aggregate fresh verifier usage')))

const unavailable = await evaluateAcceptanceGate({
  runId: 'run-acceptance-unavailable', iteration: 1, goalContract: contract,
  workspaceRoot: process.cwd(), settlement: 'answered', answer: 'claim',
})
assert.equal(unavailable.snapshot.overall, 'blocked', 'semantic criteria fail closed without a fresh verifier runtime')

console.log('Fresh semantic verifier smoke: context isolation, outbound gate, parallel checks, deterministic quorum, mandatory veto, and Goal budget accounting passed')
