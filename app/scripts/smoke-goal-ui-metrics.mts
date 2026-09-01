import assert from 'node:assert/strict'
import { GOAL_WORKFLOW_METRIC_NAMES, goalWorkflowMetricsSummary, metricsSummary, type RunMetricRecord } from '../src/agent/metrics.ts'
import { deriveRunLifecycle, type RunLifecycleInput } from '../src/agent/runLifecycle.ts'

const lifecycle = (input: RunLifecycleInput) => deriveRunLifecycle(input)
assert.equal(GOAL_WORKFLOW_METRIC_NAMES.length, 16)
const terminal = (goalVerdict: 'passed' | 'failed' | 'blocked' | 'unverifiable' | 'exhausted', appFinalization: 'pending' | 'completed' = 'completed') => lifecycle({
  status: 'success', terminal: true,
  outcome: { turnSettlement: 'answered', executionSettlement: 'completed', goalVerdict, appFinalization, executionKind: 'loop' },
})

const answered = lifecycle({
  phase: 'responding', status: 'running', active: true,
  outcome: { turnSettlement: 'answered', executionKind: 'loop' },
})
assert.equal(answered.modelAnswered, true)
assert.equal(answered.goalChecking, false)
assert.match(answered.label, /模型已回答/)

const checking = lifecycle({
  phase: 'finalizing', status: 'running', active: true,
  outcome: { executionSettlement: 'completed', executionKind: 'loop' },
})
assert.equal(checking.goalChecking, true)
assert.match(checking.label, /Goal 驗收中/)
assert.match(terminal('passed').label, /Goal 已通過/)
assert.match(terminal('failed').label, /Goal 未通過/)
assert.match(terminal('blocked').label, /Goal 被阻擋/)
assert.match(terminal('unverifiable').label, /Goal 無法驗證/)
assert.match(terminal('exhausted').label, /Goal 用盡 budget/)
const recovery = terminal('passed', 'pending')
assert.equal(recovery.finalizationRecovery, true)
assert.match(recovery.label, /Goal 已通過.*App finalization 待恢復/)

const external = lifecycle({
  status: 'success', terminal: true,
  outcome: { executionSettlement: 'completed', executionKind: 'external', legacyStatus: 'success' },
})
assert.equal(external.outcome.goalVerdict, undefined)
assert.equal(external.outcome.goalProjection, 'not-applicable')
const legacy = lifecycle({ status: 'success', terminal: true, outcome: { legacyStatus: 'success', executionKind: 'loop' } })
assert.equal(legacy.outcome.goalVerdict, undefined)
assert.equal(legacy.outcome.goalProjection, 'legacy-unverified')

const counters = { toolAsks: 0, toolDenials: 0, compactions: 0, llmRetries: 0 }
const records: RunMetricRecord[] = [
  {
    runId: 'metric-1', at: '2026-09-01T00:00:00.000Z', status: 'success', ok: true, counters,
    facts: {
      executionSettlement: 'completed', goalVerdict: 'passed', iterations: 2,
      criteria: [
        { kind: 'file-content', evaluated: 2, failed: 0, invalidated: 1 },
        { kind: 'registered-command', evaluated: 1, failed: 1, invalidated: 0 },
      ],
      repair: { attempts: 1, succeeded: 1, impactedNodes: 2 },
      artifacts: { produced: 3, accepted: 2 },
      workflow: { parallelNodeSlotsUsed: 4, parallelNodeSlotsAvailable: 4, fanoutWidth: 4, nodeAttempts: 4, retriedNodes: 1 },
      verifier: { tokens: 600, passedArtifacts: 2 },
      finalization: { attempts: 1, recoveries: 0, claimAttempts: 2, claimConflicts: 1 },
    },
  },
  {
    runId: 'metric-2', at: '2026-09-01T00:01:00.000Z', status: 'warning', ok: true, counters,
    facts: {
      executionSettlement: 'failed', goalVerdict: 'unverifiable',
      criteria: [
        { kind: 'file-content', evaluated: 2, failed: 1, invalidated: 0 },
        { kind: 'registered-command', evaluated: 1, failed: 0, invalidated: 0 },
      ],
      repair: { attempts: 1, succeeded: 0, impactedNodes: 4 },
      artifacts: { produced: 2, accepted: 2 },
      workflow: { parallelNodeSlotsUsed: 2, parallelNodeSlotsAvailable: 4, fanoutWidth: 2, nodeAttempts: 4, retriedNodes: 1 },
      verifier: { tokens: 300, passedArtifacts: 1 },
      finalization: { attempts: 1, recoveries: 1, claimAttempts: 2, claimConflicts: 0 },
    },
  },
]

const unknown = goalWorkflowMetricsSummary([])
assert.equal(unknown.executionCompletionRate, undefined, 'unknown denominator must remain absent, never zero')
assert.equal(unknown.goalPassRate, undefined)
assert.equal(unknown.artifactKeepRate, undefined)

const measured = goalWorkflowMetricsSummary(records)
assert.deepEqual(measured.executionCompletionRate, { numerator: 1, denominator: 2, value: 0.5 })
assert.deepEqual(measured.goalPassRate, { numerator: 1, denominator: 2, value: 0.5 })
assert.deepEqual(measured.goalUnverifiableRate, { numerator: 1, denominator: 2, value: 0.5 })
assert.deepEqual(measured.goalExhaustedRate, { numerator: 0, denominator: 2, value: 0 })
assert.deepEqual(measured.criterionFailureRate['file-content'], { numerator: 1, denominator: 4, value: 0.25 })
assert.deepEqual(measured.criterionFailureRate['registered-command'], { numerator: 1, denominator: 2, value: 0.5 })
assert.deepEqual(measured.evidenceInvalidationRate, { numerator: 1, denominator: 6, value: 1 / 6 })
assert.deepEqual(measured.repairSuccessRate, { numerator: 1, denominator: 2, value: 0.5 })
assert.deepEqual(measured.iterationsToPass, { total: 2, observations: 1, value: 2 })
assert.deepEqual(measured.artifactKeepRate, { numerator: 4, denominator: 5, value: 0.8 })
assert.deepEqual(measured.workflowParallelismRatio, { numerator: 6, denominator: 8, value: 0.75 })
assert.deepEqual(measured.fanoutWidth, { total: 6, observations: 2, value: 3 })
assert.deepEqual(measured.nodeRetryRate, { numerator: 2, denominator: 8, value: 0.25 })
assert.deepEqual(measured.impactedSubgraphSize, { total: 6, observations: 2, value: 3 })
assert.deepEqual(measured.verifierTokensPerPassedArtifact, { numerator: 900, denominator: 3, value: 300 })
assert.deepEqual(measured.finalizationRecoveryRate, { numerator: 1, denominator: 2, value: 0.5 })
assert.deepEqual(measured.finalizationClaimConflictRate, { numerator: 1, denominator: 4, value: 0.25 })
assert.deepEqual(metricsSummary(records).goalWorkflow, measured)

console.log('Goal UI/metrics smoke: orthogonal states and denominator-preserving execution/Goal/criteria/workflow/verifier/finalization metrics passed')
