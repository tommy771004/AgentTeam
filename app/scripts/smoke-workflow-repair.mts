import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { WorkflowRecordStore } from '../electron/workflowRecordStore.ts'
import { WorkflowScheduler, type WorkflowSchedulerOptions } from '../electron/workflowScheduler.ts'
import { createAcceptanceEvidence, createAcceptanceSnapshot } from '../src/agent/acceptanceContract.ts'
import { createGoalContractSnapshot } from '../src/agent/goalContract.ts'
import { createRepairPlan } from '../src/agent/repairPlan.ts'
import type { WorkflowDefinitionInput } from '../src/agent/workflowGraph.ts'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const node = (input: Partial<WorkflowDefinitionInput['nodes'][number]> & Pick<WorkflowDefinitionInput['nodes'][number], 'id' | 'kind' | 'task'>) => ({
  dependsOn: [],
  inputs: [],
  outputs: [],
  runner: { requiredCapabilities: [], workspaceMode: 'shared-readonly' as const },
  retry: { maxAttempts: 2, retryOn: ['criterion-failed' as const] },
  ...input,
})
const definition = (maxTotalAttempts = 5, maxWallClockMs = 60_000): WorkflowDefinitionInput => ({
  schemaVersion: 1,
  id: 'workflow.repair-diamond',
  revision: 1,
  nodes: [
    node({ id: 'left', kind: 'agent', task: 'Produce left branch', outputs: [{ id: 'artifact.left', schemaId: 'text-v1', required: true }] }),
    node({ id: 'right', kind: 'agent', task: 'Produce right branch', outputs: [{ id: 'artifact.right', schemaId: 'text-v1', required: true }] }),
    node({
      id: 'join', kind: 'deterministic-reducer', task: 'Join verified branches', dependsOn: ['left', 'right'],
      inputs: [
        { name: 'left', artifactRef: 'artifact.left', required: true },
        { name: 'right', artifactRef: 'artifact.right', required: true },
      ],
      outputs: [{ id: 'artifact.joined', schemaId: 'text-v1', required: true }],
    }),
  ],
  terminalNodeIds: ['join'],
  budgets: { maxConcurrentNodes: 2, maxTotalAttempts, maxWallClockMs },
})

const contract = await createGoalContractSnapshot({
  schemaVersion: 1,
  id: 'goal-contract:workflow-repair',
  revision: 1,
  mode: 'goal',
  objective: 'Repair only the impacted workflow branch',
  constraints: [],
  outputs: [],
  criteria: [{ id: 'criterion-left', kind: 'file-content', path: 'left.txt', sha256: sha256('expected') }],
  budgets: { maxIterations: 2, maxWallClockMs: 60_000 },
  escalation: { onBlocked: 'fail', onUnverifiable: 'fail', onBudgetExceeded: 'fail', onNoProgress: 'fail' },
})
const evidence = await createAcceptanceEvidence({
  schemaVersion: 1,
  id: 'evidence-left-invalidated',
  criterionId: 'criterion-left',
  issuedBy: 'host-checker',
  observedAt: 1_000,
  kind: 'file-content',
  state: 'invalidated',
  path: 'left.txt',
  expectedSha256: sha256('expected'),
  actualSha256: sha256('drifted'),
})
const acceptance = await createAcceptanceSnapshot({
  runId: 'task-repair',
  iteration: 1,
  goalContract: contract,
  workflowRevision: 1,
  impactedNodeIds: ['left'],
  verdicts: [{
    criterionId: 'criterion-left',
    status: 'invalidated',
    evidenceRefs: [evidence.id],
    reason: 'Left artifact drifted',
    repairHint: 'Re-run the left branch',
    retryable: true,
  }],
})
const plan = await createRepairPlan({ snapshot: acceptance, evidence: [evidence] })
assert.deepEqual(plan.targets[0]?.impactedNodeIds, ['left'])

const counts = new Map<string, number>()
const options = (store: WorkflowRecordStore, clock?: () => number): WorkflowSchedulerOptions => ({
  store,
  clock,
  executeNode: async ({ node, attemptId }) => {
    counts.set(node.id, (counts.get(node.id) || 0) + 1)
    return {
      settlement: 'completed',
      resultRef: `${node.id}:result:${counts.get(node.id)}`,
      outputs: [{ artifactId: `artifact.${node.id}`, schemaId: 'text-v1', value: `${node.id}@${attemptId}` }],
    }
  },
  reducers: {
    join: (inputs) => ({ 'artifact.joined': inputs.map((artifact) => String(artifact.value)).sort().join('+') }),
  },
  schemaValidators: { 'text-v1': (value) => typeof value === 'string' },
  verifyNode: async ({ node }) => ({ passed: true, criterionId: `criterion.${node.id}`, acceptanceDigest: 'a'.repeat(64) }),
})

const store = new WorkflowRecordStore()
const scheduler = await WorkflowScheduler.admit({
  definition: definition(7), taskRunId: 'task-repair', workflowRunId: 'workflow-repair', options: options(store),
})
assert.equal((await scheduler.run()).verdict, 'passed')
const repaired = await scheduler.repair(plan)
assert.equal(repaired.verdict, 'passed')
assert.deepEqual(Object.fromEntries(counts), { left: 2, right: 1 }, 'unaffected sibling branch must not rerun')
const records = store.list('workflow-repair')
assert.deepEqual(
  records.filter((entry) => entry.kind === 'node-dispatched').map((entry) => entry.attemptId),
  [
    'workflow-repair:left:attempt:1',
    'workflow-repair:right:attempt:1',
    'workflow-repair:join:attempt:1',
    'workflow-repair:left:attempt:2',
    'workflow-repair:join:attempt:2',
  ],
)
const invalidation = records.find((entry) => entry.kind === 'subgraph-invalidated')
assert.deepEqual(invalidation?.nodeRunIds, ['workflow-repair:join', 'workflow-repair:left'])
assert.equal(records.filter((entry) => entry.kind === 'node-dispatched' && entry.nodeRunId.endsWith(':right')).length, 1)
const beforeRejectedRetry = records.length
await assert.rejects(() => scheduler.repair(plan), /node retry budget exhausted/)
assert.equal(store.list('workflow-repair').length, beforeRejectedRetry, 'budget rejection cannot partially invalidate history')

const totalBudgetScheduler = await WorkflowScheduler.admit({
  definition: definition(4), taskRunId: 'task-repair', workflowRunId: 'workflow-total-budget',
  options: options(new WorkflowRecordStore()),
})
await totalBudgetScheduler.run()
await assert.rejects(() => totalBudgetScheduler.repair(plan), /total attempt budget exhausted/)

let now = 1_000
const clockStore = new WorkflowRecordStore(undefined, undefined, () => now)
const clockScheduler = await WorkflowScheduler.admit({
  definition: definition(5, 1_000), taskRunId: 'task-repair', workflowRunId: 'workflow-wall-clock',
  options: options(clockStore, () => now),
})
await clockScheduler.run()
now = 2_001
await assert.rejects(() => clockScheduler.repair(plan), /wall-clock budget exhausted/)

console.log('Workflow repair smoke: immutable attempts, impacted downstream closure, sibling preservation, and node/total/wall-clock budget gates passed')
