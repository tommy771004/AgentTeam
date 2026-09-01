import assert from 'node:assert/strict'
import {
  isWorkflowDefinition,
  validateAndFreezeWorkflowDefinition,
  type WorkflowDefinitionInput,
} from '../src/agent/workflowGraph.ts'

const node = (input: Partial<WorkflowDefinitionInput['nodes'][number]> & Pick<WorkflowDefinitionInput['nodes'][number], 'id' | 'kind' | 'task'>) => ({
  dependsOn: [],
  inputs: [],
  outputs: [],
  runner: { requiredCapabilities: [], workspaceMode: 'shared-readonly' as const },
  retry: { maxAttempts: 1, retryOn: ['execution-failed' as const] },
  ...input,
})

const valid = (): WorkflowDefinitionInput => ({
  schemaVersion: 1,
  id: 'workflow.release',
  revision: 1,
  nodes: [
    node({
      id: 'build', kind: 'agent', task: 'Build artifact',
      outputs: [{ id: 'artifact.build', schemaId: 'build-v1', required: true }],
      runner: { preferred: 'builtin', requiredCapabilities: ['tools'], workspaceMode: 'isolated-worktree' },
    }),
    node({
      id: 'normalize', kind: 'deterministic-reducer', task: 'Normalize artifact', dependsOn: ['build'],
      inputs: [{ name: 'build', artifactRef: 'artifact.build', required: true }],
      outputs: [{ id: 'artifact.normalized', schemaId: 'normalized-v1', required: true }],
    }),
    node({
      id: 'verify', kind: 'verifier', task: 'Verify artifact', dependsOn: ['normalize'],
      inputs: [{ name: 'candidate', artifactRef: 'artifact.normalized', required: true }],
      verifier: { freshContext: true, rubricId: 'release-rubric', quorum: { pass: 2, total: 3 } },
    }),
  ],
  terminalNodeIds: ['verify'],
  budgets: { maxConcurrentNodes: 2, maxTotalAttempts: 8, maxWallClockMs: 60_000 },
})

const admittedInput = valid()
const admitted = await validateAndFreezeWorkflowDefinition(admittedInput)
assert.equal(admitted.ok, true)
assert.equal(admitted.errors.length, 0)
assert.equal(admitted.warnings.length, 0)
assert.ok(admitted.definition)
assert.equal(isWorkflowDefinition(admitted.definition), true)
assert.match(admitted.definition.digest, /^[a-f0-9]{64}$/)
assert.equal(Object.isFrozen(admitted.definition), true)
assert.equal(Object.isFrozen(admitted.definition.nodes[0]), true)
assert.equal(JSON.parse(JSON.stringify(admitted.definition)).digest, admitted.definition.digest, 'definition is persistable JSON')
;(admittedInput.nodes as any[])[0].task = 'mutated caller input'
assert.equal(admitted.definition.nodes[0].task, 'Build artifact')

const same = await validateAndFreezeWorkflowDefinition(valid())
assert.equal(same.definition?.digest, admitted.definition.digest, 'canonical digest is deterministic')
const wrongDigest = await validateAndFreezeWorkflowDefinition({ ...valid(), digest: '0'.repeat(64) })
assert.ok(wrongDigest.errors.some((entry) => entry.code === 'digest-mismatch'))

async function expects(code: string, mutate: (workflow: any) => void) {
  const workflow = valid() as any
  mutate(workflow)
  const result = await validateAndFreezeWorkflowDefinition(workflow)
  assert.equal(result.ok, false, `${code} must fail closed`)
  assert.ok(result.errors.some((entry) => entry.code === code), `${code}: ${JSON.stringify(result.errors)}`)
}

await expects('dependency-cycle', (workflow) => {
  workflow.nodes[0].dependsOn = ['verify']
  workflow.nodes[0].barrier = { justification: 'cycle fixture' }
})
await expects('missing-artifact-ref', (workflow) => { workflow.nodes[1].inputs[0].artifactRef = 'artifact.missing' })
await expects('duplicate-output', (workflow) => { workflow.nodes[2].outputs = [{ id: 'artifact.build', schemaId: 'other', required: true }] })
await expects('unreachable-terminal', (workflow) => {
  workflow.nodes.push(node({ id: 'orphan', kind: 'agent', task: 'Orphan branch' }))
})
await expects('invalid-workspace-policy', (workflow) => { workflow.nodes[1].runner.workspaceMode = 'shared-leased-write' })
await expects('invalid-concurrency-budget', (workflow) => { workflow.budgets.maxConcurrentNodes = 9 })
await expects('invalid-attempt-budget', (workflow) => { workflow.budgets.maxTotalAttempts = 1 })
await expects('invalid-wall-clock-budget', (workflow) => { workflow.budgets.maxWallClockMs = 0 })
await expects('unknown-node-field', (workflow) => {
  workflow.nodes[1].dependsOn = []
  workflow.nodes[1].parentId = 'build'
})

const fakeEdge = valid() as any
fakeEdge.nodes[2].inputs = []
const warned = await validateAndFreezeWorkflowDefinition(fakeEdge)
assert.equal(warned.ok, true)
assert.ok(warned.warnings.some((entry) => entry.code === 'fake-edge'))
fakeEdge.nodes[2].barrier = { justification: 'Verifier waits for reducer completion even without consuming its artifact.' }
const justified = await validateAndFreezeWorkflowDefinition(fakeEdge)
assert.equal(justified.warnings.some((entry) => entry.code === 'fake-edge'), false)

console.log('Workflow Graph smoke: immutable digest, fail-closed DAG validation, budgets, workspace policy, and fake-edge warnings passed')
