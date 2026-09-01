import assert from 'node:assert/strict'
import type { WorkflowDefinitionInput } from '../src/agent/workflowGraph.ts'
import { WorkflowRecordStore } from '../electron/workflowRecordStore.ts'
import {
  WorkflowScheduler,
  type WorkflowNodeExecutionRequest,
  type WorkflowSchedulerOptions,
  type WorkflowWorkspaceAuthority,
} from '../electron/workflowScheduler.ts'

const acceptanceDigest = 'a'.repeat(64)
const node = (input: Partial<WorkflowDefinitionInput['nodes'][number]> & Pick<WorkflowDefinitionInput['nodes'][number], 'id' | 'kind' | 'task'>) => ({
  dependsOn: [],
  inputs: [],
  outputs: [],
  runner: { requiredCapabilities: [], workspaceMode: 'shared-readonly' as const },
  retry: { maxAttempts: 1, retryOn: ['execution-failed' as const] },
  ...input,
})

const fanoutDefinition: WorkflowDefinitionInput = {
  schemaVersion: 1,
  id: 'workflow.fanout',
  revision: 1,
  nodes: [
    node({ id: 'read-a', kind: 'agent', task: 'Read source A', outputs: [{ id: 'artifact.a', schemaId: 'text-v1', required: true }] }),
    node({ id: 'read-b', kind: 'agent', task: 'Read source B', outputs: [{ id: 'artifact.b', schemaId: 'text-v1', required: true }] }),
    node({ id: 'read-c', kind: 'agent', task: 'Read source C', outputs: [{ id: 'artifact.c', schemaId: 'text-v1', required: true }] }),
    node({
      id: 'merge', kind: 'deterministic-reducer', task: 'Merge all verified inputs', dependsOn: ['read-a', 'read-b', 'read-c'],
      inputs: [
        { name: 'a', artifactRef: 'artifact.a', required: true },
        { name: 'b', artifactRef: 'artifact.b', required: true },
        { name: 'c', artifactRef: 'artifact.c', required: true },
      ],
      outputs: [{ id: 'artifact.merged', schemaId: 'text-v1', required: true }],
    }),
  ],
  terminalNodeIds: ['merge'],
  budgets: { maxConcurrentNodes: 2, maxTotalAttempts: 4, maxWallClockMs: 60_000 },
}

let active = 0
let maxActive = 0
const executorCalls: string[] = []
const baseOptions = (store: WorkflowRecordStore): WorkflowSchedulerOptions => ({
  store,
  executeNode: async (request) => {
    executorCalls.push(request.node.id)
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 20))
    active -= 1
    return {
      settlement: 'completed',
      resultRef: `${request.node.id}:result`,
      agentSessionId: `${request.node.id}:session`,
      outputs: [{ artifactId: `artifact.${request.node.id.at(-1)}`, schemaId: 'text-v1', value: request.node.id }],
    }
  },
  reducers: {
    merge: (inputs) => ({
      'artifact.merged': inputs.map((artifact) => String(artifact.value)).sort().join('+'),
    }),
  },
  schemaValidators: { 'text-v1': (value) => typeof value === 'string' },
  verifyNode: async ({ node }) => ({ passed: true, criterionId: `criterion.${node.id}`, acceptanceDigest }),
})

const store = new WorkflowRecordStore()
const scheduler = await WorkflowScheduler.admit({
  definition: fanoutDefinition,
  taskRunId: 'task-fanout',
  workflowRunId: 'run-fanout',
  options: baseOptions(store),
})
const result = await scheduler.run()
assert.equal(result.verdict, 'passed')
assert.equal(maxActive, 2, 'independent read nodes must have overlapping execution windows')
assert.deepEqual(executorCalls.sort(), ['read-a', 'read-b', 'read-c'], 'deterministic reducer never enters the model/agent executor')
assert.equal(result.artifacts.find((artifact) => artifact.artifactId === 'artifact.merged')?.value, 'read-a+read-b+read-c')
const entries = store.list('run-fanout')
const barrierIndex = entries.findIndex((entry) => entry.kind === 'barrier-opened' && entry.nodeRunId === 'run-fanout:merge')
const upstreamVerified = entries
  .map((entry, index) => ({ entry, index }))
  .filter(({ entry }) => entry.kind === 'node-verified' && entry.nodeRunId.includes(':read-'))
assert.equal(upstreamVerified.length, 3)
assert.ok(upstreamVerified.every(({ index }) => index < barrierIndex), 'fan-in opens only after all required upstream nodes are verified')

let conflictExecuted = false
const denyLease: WorkflowWorkspaceAuthority = {
  admit: async () => ({ ok: false, reason: 'scope already leased' }),
}
const writeDefinition: WorkflowDefinitionInput = {
  schemaVersion: 1,
  id: 'workflow.writer',
  revision: 1,
  nodes: [node({
    id: 'writer', kind: 'agent', task: 'Write bounded output',
    runner: { requiredCapabilities: ['tools'], workspaceMode: 'shared-leased-write', workspaceScopes: ['src/generated'] },
  })],
  terminalNodeIds: ['writer'],
  budgets: { maxConcurrentNodes: 1, maxTotalAttempts: 1, maxWallClockMs: 60_000 },
}
const conflict = await WorkflowScheduler.admit({
  definition: writeDefinition,
  taskRunId: 'task-conflict',
  workflowRunId: 'run-conflict',
  options: {
    ...baseOptions(new WorkflowRecordStore()),
    workspaceAuthority: denyLease,
    executeNode: async () => {
      conflictExecuted = true
      throw new Error('must not execute')
    },
  },
})
const conflictResult = await conflict.run()
assert.equal(conflictResult.verdict, 'blocked')
assert.equal(conflictExecuted, false, 'shared writer cannot dispatch without a lease')

let isolatedRequest: WorkflowNodeExecutionRequest | undefined
const isolatedDefinition: WorkflowDefinitionInput = structuredClone(writeDefinition)
isolatedDefinition.id = 'workflow.isolated'
isolatedDefinition.nodes[0].runner = { requiredCapabilities: ['tools'], workspaceMode: 'isolated-worktree' }
const isolated = await WorkflowScheduler.admit({
  definition: isolatedDefinition,
  taskRunId: 'task-isolated',
  workflowRunId: 'run-isolated',
  options: {
    ...baseOptions(new WorkflowRecordStore()),
    workspaceAuthority: {
      admit: async () => ({ ok: true, grant: { mode: 'isolated-worktree', workspaceRef: 'worktree.verified', verified: true } }),
    },
    executeNode: async (request) => {
      isolatedRequest = request
      return { settlement: 'completed', resultRef: 'isolated:result', outputs: [] }
    },
  },
})
assert.equal((await isolated.run()).verdict, 'passed')
assert.equal(isolatedRequest?.workspace.mode, 'isolated-worktree')

const badReducerOptions = baseOptions(new WorkflowRecordStore())
const badReducer = await WorkflowScheduler.admit({
  definition: fanoutDefinition,
  taskRunId: 'task-schema',
  workflowRunId: 'run-schema',
  options: {
    ...badReducerOptions,
    reducers: { merge: () => ({ 'artifact.merged': 42 }) },
  },
})
const badReducerResult = await badReducer.run()
assert.equal(badReducerResult.verdict, 'failed')
assert.equal(badReducerResult.nodeStatuses.merge, 'failed')
assert.ok(badReducerResult.errors.some((error) => error.includes('schema mismatch')))

console.log('Workflow scheduler smoke: bounded fan-out, verified fan-in, lease fail-closed, isolated worktree admission, deterministic reducer, and schema rejection passed')
