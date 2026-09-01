import { createHash } from 'node:crypto'
import { isRepairPlan, type RepairPlan } from '../src/agent/repairPlan.ts'
import type { WorkflowDefinition, WorkflowNode } from '../src/agent/workflowGraph.ts'
import type { WorkflowRecordEntry } from '../src/agent/workflowRecord.ts'
import {
  WorkflowScheduler,
  type WorkflowArtifact,
  type WorkflowNodeExecution,
  type WorkflowNodeExecutionRequest,
  type WorkflowSchedulerResult,
} from './workflowScheduler.ts'
import { WorkflowRecordStore } from './workflowRecordStore.ts'

export type PiWorkflowNodeExecutor = (
  request: WorkflowNodeExecutionRequest,
) => Promise<WorkflowNodeExecution>

export type PiWorkflowRunInput = Readonly<{
  definition: unknown
  taskRunId: string
  workflowRunId: string
  executeNode: PiWorkflowNodeExecutor
}>

export type PiWorkflowProjection = Readonly<{
  result: WorkflowSchedulerResult
  record: readonly WorkflowRecordEntry[]
}>

const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function isJsonValue(value: unknown): boolean {
  try {
    JSON.stringify(value)
    return value !== undefined
  } catch {
    return false
  }
}

const schemaValidators = Object.freeze({
  'json-value-v1': isJsonValue,
  'object-v1': (value: unknown) => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && isJsonValue(value),
  'text-v1': (value: unknown) => typeof value === 'string',
  'string-array-v1': (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string'),
})

function reducerFor(node: WorkflowNode) {
  if (node.task === 'collect-inputs-v1' && node.outputs.length === 1) {
    return (inputs: readonly WorkflowArtifact[]) => ({
      [node.outputs[0].id]: inputs.map((input) => input.value),
    })
  }
  if (node.task === 'merge-object-inputs-v1' && node.outputs.length === 1) {
    return (inputs: readonly WorkflowArtifact[]) => ({
      [node.outputs[0].id]: Object.assign({}, ...inputs.map((input) => input.value)),
    })
  }
  return undefined
}

function reducersFor(value: unknown) {
  const definition = value as Partial<WorkflowDefinition>
  return Object.fromEntries((definition.nodes || []).flatMap((node) => {
    if (node.kind !== 'deterministic-reducer') return []
    const reducer = reducerFor(node)
    return reducer ? [[node.id, reducer] as const] : []
  }))
}

/**
 * Host-owned production seam for Workflow Graph execution.
 *
 * The renderer may submit immutable data contracts, but it cannot supply
 * validators, reducers, verifiers, or node callbacks. Those remain inside the
 * Host and the same interface is used by protocol callers and smokes.
 */
export class PiWorkflowRuntime {
  private readonly store: WorkflowRecordStore
  private readonly schedulers = new Map<string, WorkflowScheduler>()
  private readonly terminal = new Map<string, WorkflowSchedulerResult>()

  constructor(store = new WorkflowRecordStore()) {
    this.store = store
  }

  async run(input: PiWorkflowRunInput): Promise<PiWorkflowProjection> {
    if (!identifier(input.taskRunId) || !identifier(input.workflowRunId)) {
      throw new Error('Workflow taskRunId and workflowRunId must be valid identifiers')
    }
    if (this.schedulers.has(input.workflowRunId)) throw new Error('Workflow run id is already admitted')
    const scheduler = await WorkflowScheduler.admit({
      definition: input.definition,
      taskRunId: input.taskRunId,
      workflowRunId: input.workflowRunId,
      options: {
        store: this.store,
        executeNode: input.executeNode,
        reducers: reducersFor(input.definition),
        schemaValidators,
        verifyNode: async ({ node, attemptId, outputs, execution }) => {
          const acceptanceDigest = digest({
            nodeId: node.id,
            attemptId,
            resultRef: execution.resultRef,
            outputs: outputs.map((output) => ({ artifactId: output.artifactId, digest: output.digest })),
          })
          return { passed: true, criterionId: `output-contract:${node.id}`, acceptanceDigest }
        },
      },
    })
    this.schedulers.set(input.workflowRunId, scheduler)
    const result = await scheduler.run()
    this.terminal.set(input.workflowRunId, result)
    return this.project(input.workflowRunId, result)
  }

  async repair(workflowRunId: string, plan: unknown): Promise<PiWorkflowProjection> {
    const scheduler = this.schedulers.get(workflowRunId)
    if (!scheduler) throw new Error('Workflow run is not admitted in this Host')
    if (!isRepairPlan(plan)) throw new Error('Workflow repair plan is invalid')
    const result = await scheduler.repair(plan as RepairPlan)
    this.terminal.set(workflowRunId, result)
    return this.project(workflowRunId, result)
  }

  async checkpoint(workflowRunId: string) {
    const scheduler = this.schedulers.get(workflowRunId)
    if (!scheduler) throw new Error('Workflow run is not admitted in this Host')
    return scheduler.checkpoint()
  }

  status(workflowRunId: string): PiWorkflowProjection | undefined {
    const result = this.terminal.get(workflowRunId)
    return result ? this.project(workflowRunId, result) : undefined
  }

  record(workflowRunId: string): readonly WorkflowRecordEntry[] {
    return this.store.list(workflowRunId)
  }

  private project(workflowRunId: string, result: WorkflowSchedulerResult): PiWorkflowProjection {
    return Object.freeze({ result, record: Object.freeze([...this.store.list(workflowRunId)]) })
  }
}

