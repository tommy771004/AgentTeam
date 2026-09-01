import type { AgentTerminalResult } from '../src/agent/agentCollaboration.ts'
import { validateAndFreezeWorkflowDefinition, type WorkflowDefinition, type WorkflowNode } from '../src/agent/workflowGraph.ts'
import type { GoalVerdict } from '../src/agent/goalOutcome.ts'
import type { TurnRecordRangeRef } from '../src/agent/workflowRecord.ts'
import { WorkflowRecordStore } from './workflowRecordStore.ts'

export type SingleNodeWorkflowStatus = 'ready' | 'dispatched' | 'observed' | 'passed' | 'failed' | 'terminal'

export class SingleNodeWorkflowTracer {
  readonly definition: WorkflowDefinition
  readonly workflowRunId: string
  readonly nodeRunId: string
  readonly attemptId: string
  private readonly taskRunId: string
  private readonly node: WorkflowNode
  private readonly store: WorkflowRecordStore
  private readonly startedAt: number
  private readonly clock: () => number
  private published = new Set<string>()
  private agentSessionId?: string
  private acceptanceDigest?: string
  status: SingleNodeWorkflowStatus = 'ready'

  private constructor(input: {
    definition: WorkflowDefinition
    taskRunId: string
    workflowRunId: string
    store: WorkflowRecordStore
    clock: () => number
  }) {
    this.definition = input.definition
    this.taskRunId = input.taskRunId
    this.workflowRunId = input.workflowRunId
    this.node = input.definition.nodes[0]
    this.nodeRunId = `${input.workflowRunId}:${this.node.id}`
    this.attemptId = `${this.nodeRunId}:attempt:1`
    this.store = input.store
    this.clock = input.clock
    this.startedAt = input.clock()
    this.store.append(this.context(), { kind: 'workflow-admitted', definitionDigest: input.definition.digest })
    this.store.append(this.context(), { kind: 'node-ready', nodeRunId: this.nodeRunId })
    this.recordBudget(input.definition.budgets.maxTotalAttempts, 0)
  }

  static async admit(input: {
    definition: unknown
    taskRunId: string
    workflowRunId: string
    store: WorkflowRecordStore
    clock?: () => number
  }): Promise<SingleNodeWorkflowTracer> {
    const admitted = await validateAndFreezeWorkflowDefinition(input.definition)
    if (!admitted.ok || !admitted.definition) throw new Error(`Workflow admission failed: ${admitted.errors.map((entry) => entry.code).join(', ')}`)
    if (admitted.definition.nodes.length !== 1) throw new Error('SingleNodeWorkflowTracer requires exactly one workflow node')
    return new SingleNodeWorkflowTracer({ ...input, definition: admitted.definition, clock: input.clock || Date.now })
  }

  private context(extra: Record<string, unknown> = {}) {
    return { taskRunId: this.taskRunId, workflowRunId: this.workflowRunId, ...extra }
  }

  private assertStatus(expected: SingleNodeWorkflowStatus): void {
    if (this.status !== expected) throw new Error(`Workflow node must be ${expected}; current=${this.status}`)
    if (this.clock() - this.startedAt > this.definition.budgets.maxWallClockMs) throw new Error('Workflow wall-clock budget exhausted')
  }

  private recordBudget(attempts: number, concurrentNodes: number): void {
    this.store.append(this.context(), {
      kind: 'budget-updated',
      remaining: {
        attempts,
        concurrentNodes,
        wallClockMs: Math.max(0, this.definition.budgets.maxWallClockMs - (this.clock() - this.startedAt)),
      },
    })
  }

  dispatch(agentSessionId?: string): void {
    this.assertStatus('ready')
    this.store.append(this.context({ nodeRunId: this.nodeRunId, attemptId: this.attemptId, sessionId: agentSessionId }), {
      kind: 'node-dispatched', nodeRunId: this.nodeRunId, attemptId: this.attemptId, ...(agentSessionId ? { agentSessionId } : {}),
    })
    this.agentSessionId = agentSessionId
    this.status = 'dispatched'
    this.recordBudget(this.definition.budgets.maxTotalAttempts - 1, 0)
  }

  observeChild(result: AgentTerminalResult, turnRecordRef?: TurnRecordRangeRef): void {
    this.assertStatus('dispatched')
    if (result.observationOnly !== true) throw new Error('Child terminal result must remain observationOnly')
    this.store.append(this.context({
      nodeRunId: this.nodeRunId, attemptId: this.attemptId,
      ...(this.agentSessionId ? { sessionId: this.agentSessionId } : {}),
      runId: result.runId,
      ...(turnRecordRef ? { turnRecordRef } : {}),
      ...(result.reviewSnapshotRef ? { reviewSnapshotRef: { snapshotId: result.reviewSnapshotRef.snapshotId } } : {}),
    }), {
      kind: 'node-observed', nodeRunId: this.nodeRunId, attemptId: this.attemptId,
      settlement: result.settlement, resultRef: result.resultId,
    })
    this.status = 'observed'
  }

  publishArtifact(input: { artifactId: string; digest: string }): void {
    this.assertStatus('observed')
    if (!this.node.outputs.some((output) => output.id === input.artifactId)) throw new Error(`Undeclared workflow artifact: ${input.artifactId}`)
    if (this.published.has(input.artifactId)) throw new Error(`Workflow artifact already published: ${input.artifactId}`)
    this.store.append(this.context({ nodeRunId: this.nodeRunId, attemptId: this.attemptId }), {
      kind: 'artifact-published', nodeRunId: this.nodeRunId, attemptId: this.attemptId, ...input,
    })
    this.published.add(input.artifactId)
  }

  verifyNode(input: { criterionId: string; acceptanceDigest: string; passed: boolean }): void {
    this.assertStatus('observed')
    const missing = this.node.outputs.filter((output) => output.required && !this.published.has(output.id))
    if (input.passed && missing.length) throw new Error(`Required workflow artifacts missing: ${missing.map((output) => output.id).join(', ')}`)
    const context = this.context({ nodeRunId: this.nodeRunId, attemptId: this.attemptId })
    this.store.append(context, { kind: 'criterion-evaluated', nodeRunId: this.nodeRunId, attemptId: this.attemptId, ...input })
    this.store.append(context, { kind: 'node-verified', nodeRunId: this.nodeRunId, attemptId: this.attemptId, passed: input.passed, acceptanceDigest: input.acceptanceDigest })
    this.acceptanceDigest = input.acceptanceDigest
    this.status = input.passed ? 'passed' : 'failed'
  }

  terminal(verdict: GoalVerdict): void {
    if (this.status !== 'passed' && this.status !== 'failed') throw new Error('Workflow terminal requires node verification')
    if (!this.acceptanceDigest) throw new Error('Workflow terminal requires acceptance evidence')
    if (this.status === 'passed' && verdict !== 'passed') throw new Error('Passed node requires passed Goal verdict')
    if (this.status === 'failed' && verdict === 'passed') throw new Error('Failed node cannot produce passed Goal verdict')
    this.store.append(this.context(), { kind: 'goal-verdict', verdict, acceptanceDigest: this.acceptanceDigest })
    this.store.append(this.context(), { kind: 'workflow-terminal', verdict, acceptanceDigest: this.acceptanceDigest })
    this.status = 'terminal'
  }
}
