import assert from 'node:assert/strict'
import type { AgentTerminalResult } from '../src/agent/agentCollaboration.ts'
import type { WorkflowDefinitionInput } from '../src/agent/workflowGraph.ts'
import { SingleNodeWorkflowTracer } from '../electron/singleNodeWorkflowTracer.ts'
import { WorkflowRecordStore } from '../electron/workflowRecordStore.ts'

const digest = (character: string) => character.repeat(64)
const definition: WorkflowDefinitionInput = {
  schemaVersion: 1,
  id: 'workflow.single',
  revision: 1,
  nodes: [{
    id: 'worker',
    kind: 'agent',
    task: 'Produce the declared report artifact',
    dependsOn: [],
    inputs: [],
    outputs: [{ id: 'artifact.report', schemaId: 'report-v1', required: true }],
    runner: { preferred: 'builtin', requiredCapabilities: ['tools'], workspaceMode: 'shared-readonly' },
    retry: { maxAttempts: 1, retryOn: ['execution-failed'] },
  }],
  terminalNodeIds: ['worker'],
  budgets: { maxConcurrentNodes: 1, maxTotalAttempts: 1, maxWallClockMs: 60_000 },
}

let now = 1_000
const store = new WorkflowRecordStore(undefined, undefined, () => ++now)
const tracer = await SingleNodeWorkflowTracer.admit({
  definition,
  taskRunId: 'task-1',
  workflowRunId: 'workflow-run-1',
  store,
  clock: () => now,
})
tracer.dispatch('pi-session-1')
const child: AgentTerminalResult = {
  version: 1,
  resultId: 'result-1',
  agentId: 'agent-worker-1',
  parentAgentId: 'agent-root',
  rootAgentId: 'agent-root',
  runId: 'child-run-1',
  originTurn: 1,
  settlement: 'completed',
  summary: 'Report produced',
  observationOnly: true,
  createdAt: now,
}
tracer.observeChild(child, { sessionId: 'pi-session-1', fromSeq: 3, toSeq: 9 })
assert.equal(tracer.status, 'observed', 'child completed is observation only')
assert.throws(() => tracer.terminal('passed'), /requires node verification/)
assert.throws(
  () => tracer.verifyNode({ criterionId: 'criterion.report', acceptanceDigest: digest('a'), passed: true }),
  /Required workflow artifacts missing/,
)
tracer.publishArtifact({ artifactId: 'artifact.report', digest: digest('b') })
tracer.verifyNode({ criterionId: 'criterion.report', acceptanceDigest: digest('a'), passed: true })
assert.equal(tracer.status, 'passed')
tracer.terminal('passed')

const entries = store.list('workflow-run-1')
assert.deepEqual(entries.map((entry) => entry.workflowSeq), entries.map((_, index) => index + 1))
assert.deepEqual(entries.map((entry) => entry.kind), [
  'workflow-admitted',
  'node-ready',
  'budget-updated',
  'node-dispatched',
  'budget-updated',
  'node-observed',
  'artifact-published',
  'criterion-evaluated',
  'node-verified',
  'goal-verdict',
  'workflow-terminal',
])
const dispatch = entries.find((entry) => entry.kind === 'node-dispatched')
assert.equal(dispatch?.nodeRunId, 'workflow-run-1:worker')
assert.equal(dispatch?.attemptId, 'workflow-run-1:worker:attempt:1')
assert.equal(dispatch?.sessionId, 'pi-session-1')
const observed = entries.find((entry) => entry.kind === 'node-observed')
assert.equal(observed?.sessionId, 'pi-session-1', 'session correlation is not replaced by Agent Tree actor id')
assert.deepEqual(observed?.turnRecordRef, { sessionId: 'pi-session-1', fromSeq: 3, toSeq: 9 })
assert.equal(JSON.stringify(entries).includes(child.summary), false, 'Workflow Record never copies child transcript/summary')
assert.ok(Object.isFrozen(entries[0]))

const persisted = store.snapshot()
const restored = new WorkflowRecordStore(persisted)
assert.deepEqual(restored.list('workflow-run-1'), entries)
assert.throws(
  () => store.append({ taskRunId: 'task-1', workflowRunId: 'workflow-run-2' }, {
    kind: 'node-observed',
    nodeRunId: 'node-2',
    attemptId: 'attempt-2',
    settlement: 'completed',
    resultRef: 'result-2',
    ...({ reasoning: 'forbidden canonical payload' } as object),
  }),
  /metadata refs only/,
)
const poisoned = new WorkflowRecordStore({
  version: 1,
  entries: [{ ...entries[0], transcript: 'forbidden restored payload' } as any],
})
assert.equal(poisoned.list('workflow-run-1').length, 0)

console.log('Workflow Record smoke: ordered Host metadata, node correlation, observation-only completion, verification gate, and transcript exclusion passed')
