import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JsonCompactionCheckpointStore } from '../electron/compactionCheckpointStore.ts'
import { WorkflowRecordStore } from '../electron/workflowRecordStore.ts'
import { WorkflowScheduler, type WorkflowSchedulerOptions } from '../electron/workflowScheduler.ts'
import { createAcceptanceEvidence, createAcceptanceSnapshot } from '../src/agent/acceptanceContract.ts'
import { createGoalContractSnapshot } from '../src/agent/goalContract.ts'
import { admitGoalRuntimeResume, createGoalRuntimeCheckpoint } from '../src/agent/goalRuntimeCheckpoint.ts'
import { createRepairPlan } from '../src/agent/repairPlan.ts'
import type { WorkflowDefinitionInput } from '../src/agent/workflowGraph.ts'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const node = (input: Partial<WorkflowDefinitionInput['nodes'][number]> & Pick<WorkflowDefinitionInput['nodes'][number], 'id' | 'kind' | 'task'>) => ({
  dependsOn: [], inputs: [], outputs: [],
  runner: { requiredCapabilities: [], workspaceMode: 'shared-readonly' as const },
  retry: { maxAttempts: 2, retryOn: ['criterion-failed' as const] },
  ...input,
})
const definition: WorkflowDefinitionInput = {
  schemaVersion: 1,
  id: 'workflow.recovery',
  revision: 1,
  nodes: [
    node({ id: 'left', kind: 'agent', task: 'Left effect', outputs: [{ id: 'artifact.left', schemaId: 'text-v1', required: true }] }),
    node({ id: 'right', kind: 'agent', task: 'Right effect', outputs: [{ id: 'artifact.right', schemaId: 'text-v1', required: true }] }),
    node({
      id: 'join', kind: 'deterministic-reducer', task: 'Join', dependsOn: ['left', 'right'],
      inputs: [
        { name: 'left', artifactRef: 'artifact.left', required: true },
        { name: 'right', artifactRef: 'artifact.right', required: true },
      ],
      outputs: [{ id: 'artifact.join', schemaId: 'text-v1', required: true }],
    }),
  ],
  terminalNodeIds: ['join'],
  budgets: { maxConcurrentNodes: 2, maxTotalAttempts: 6, maxWallClockMs: 60_000 },
}

const counts = new Map<string, number>()
const records = new WorkflowRecordStore()
const options: WorkflowSchedulerOptions = {
  store: records,
  executeNode: async ({ node, attemptId }) => {
    counts.set(node.id, (counts.get(node.id) || 0) + 1)
    return {
      settlement: 'completed', resultRef: `${node.id}:result:${counts.get(node.id)}`,
      outputs: [{ artifactId: `artifact.${node.id}`, schemaId: 'text-v1', value: `${node.id}@${attemptId}` }],
    }
  },
  reducers: { join: (inputs) => ({ 'artifact.join': inputs.map((item) => item.value).join('+') }) },
  schemaValidators: { 'text-v1': (value) => typeof value === 'string' },
  verifyNode: async ({ node, attemptId }) => ({
    passed: node.id !== 'left' || attemptId.endsWith(':2'),
    criterionId: `criterion.${node.id}`,
    acceptanceDigest: 'a'.repeat(64),
  }),
}

const scheduler = await WorkflowScheduler.admit({
  definition, taskRunId: 'task-recovery', workflowRunId: 'workflow-recovery', options,
})
assert.equal((await scheduler.run()).verdict, 'failed')
assert.deepEqual(Object.fromEntries(counts), { left: 1, right: 1 })
const workflowCheckpoint = await scheduler.checkpoint()
assert.equal(workflowCheckpoint.nodeAttempts.find((item) => item.nodeId === 'right')?.status, 'passed')
assert.equal(workflowCheckpoint.nodeAttempts.find((item) => item.nodeId === 'right')?.attempts, 1)
assert.equal(workflowCheckpoint.remainingBudgets.attempts, 4)

const contract = await createGoalContractSnapshot({
  schemaVersion: 1, id: 'goal-contract:recovery', revision: 1, mode: 'goal',
  objective: 'Resume without replaying completed effects', constraints: [], outputs: [],
  criteria: [{ id: 'criterion.left', kind: 'file-content', path: 'left.txt', sha256: hash('expected') }],
  budgets: { maxIterations: 3, maxWallClockMs: 60_000, maxTokens: 10_000, maxCostUsd: 2, maxNodeAttempts: 6 },
  escalation: { onBlocked: 'fail', onUnverifiable: 'fail', onBudgetExceeded: 'checkpoint', onNoProgress: 'fail' },
})
const evidence = await createAcceptanceEvidence({
  schemaVersion: 1, id: 'evidence.left.1', criterionId: 'criterion.left', issuedBy: 'host-checker', observedAt: 1,
  kind: 'file-content', state: 'mismatched', path: 'left.txt', expectedSha256: hash('expected'), actualSha256: hash('old'),
})
const acceptance = await createAcceptanceSnapshot({
  runId: 'task-recovery', iteration: 1, goalContract: contract, workflowRevision: 1, impactedNodeIds: ['left'],
  verdicts: [{ criterionId: 'criterion.left', status: 'invalidated', evidenceRefs: [evidence.id], reason: 'drift', retryable: true }],
})
const governingPackage = { id: 'memory.default', revision: 3, digest: 'b'.repeat(64) }
const completedEffects = ['effect.left.attempt.1', 'effect.right.attempt.1']
const runtimeCheckpoint = await createGoalRuntimeCheckpoint({
  schemaVersion: 1, goalContract: contract, acceptanceSnapshot: acceptance, governingPackage,
  workflow: workflowCheckpoint,
  remainingBudgets: { iterations: 2, wallClockMs: 58_000, tokens: 9_000, costUsd: 1.75, nodeAttempts: 4 },
  completedEffects,
  evidence: [{ id: evidence.id, digest: evidence.digest }],
})

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentteam-workflow-recovery-'))
try {
  const store = new JsonCompactionCheckpointStore(root)
  const saved = store.save({
    runId: 'task-recovery', summary: 'exact recovery checkpoint', messages: [], parkedAtToolBoundary: true,
    replaySafe: true, effects: completedEffects, goalRuntime: runtimeCheckpoint,
  })
  assert.equal(saved.ok, true)
  const reloaded = new JsonCompactionCheckpointStore(root).load('task-recovery')
  assert.deepEqual(reloaded?.goalRuntime, runtimeCheckpoint)

  const artifactDigests = new Map(workflowCheckpoint.artifacts.map((artifact) => [artifact.artifactId, artifact.digest]))
  const environment = {
    goalContract: contract,
    governingPackage,
    completedEffects,
    artifactDigest: (id: string) => artifactDigests.get(id),
    evidenceDigest: (id: string) => id === evidence.id ? evidence.digest : undefined,
  }
  assert.equal((await admitGoalRuntimeResume(reloaded?.goalRuntime, environment)).ok, true)
  assert.equal((await admitGoalRuntimeResume(reloaded?.goalRuntime, { ...environment, completedEffects: [...completedEffects, 'effect.new'] })).ok, false)
  assert.equal((await admitGoalRuntimeResume(reloaded?.goalRuntime, { ...environment, governingPackage: { ...governingPackage, revision: 4 } })).ok, false)
  assert.match((await admitGoalRuntimeResume(reloaded?.goalRuntime, { ...environment, artifactDigest: () => hash('drift') })).reason || '', /artifact-drift/)
  assert.match((await admitGoalRuntimeResume(reloaded?.goalRuntime, { ...environment, evidenceDigest: () => undefined })).reason || '', /evidence-invalidated/)
  const { digest: _contractDigest, ...contractBody } = contract
  const changedContract = await createGoalContractSnapshot({ ...contractBody, revision: 2 })
  assert.match((await admitGoalRuntimeResume(reloaded?.goalRuntime, { ...environment, goalContract: changedContract })).reason || '', /goal-contract/)

  const claim = store.claimResume('task-recovery')
  assert.equal(claim.ok, true)
  assert.equal(store.claimResume('task-recovery').reason, 'already-claimed')

  const resumed = await WorkflowScheduler.resume({
    checkpoint: workflowCheckpoint, definition, taskRunId: 'task-recovery', workflowRunId: 'workflow-recovery', options,
  })
  const repair = await createRepairPlan({ snapshot: acceptance, evidence: [evidence] })
  assert.equal((await resumed.repair(repair)).verdict, 'passed')
  assert.deepEqual(Object.fromEntries(counts), { left: 2, right: 1 }, 'resume must not replay the completed right-side effect')
  assert.equal(records.list('workflow-recovery').filter((entry) => entry.kind === 'workflow-resumed').length, 1)
  assert.equal(records.list('workflow-recovery').filter((entry) => entry.kind === 'node-dispatched' && entry.nodeRunId.endsWith(':right')).length, 1)
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('Workflow recovery smoke: exact identity, drift gates, once-only claim, immutable attempts, and no completed-effect replay passed')
