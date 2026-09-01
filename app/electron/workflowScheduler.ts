import type { TurnRecordRangeRef } from '../src/agent/workflowRecord.ts'
import { isRepairPlan, type RepairPlan } from '../src/agent/repairPlan.ts'
import {
  validateAndFreezeWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowNode,
} from '../src/agent/workflowGraph.ts'
import { WorkflowRecordStore } from './workflowRecordStore.ts'

export const WORKFLOW_SCHEDULER_CAPABILITY = 'workflow-scheduler-v1' as const

export type WorkflowArtifact = Readonly<{
  artifactId: string
  schemaId: string
  value: unknown
  digest: string
  producerNodeRunId: string
}>

export type WorkflowWorkspaceGrant =
  | Readonly<{ mode: 'shared-readonly' }>
  | Readonly<{ mode: 'shared-leased-write'; leaseId: string }>
  | Readonly<{ mode: 'isolated-worktree'; workspaceRef: string; verified: true }>

export type WorkflowWorkspaceAuthority = Readonly<{
  admit(input: Readonly<{
    workflowRunId: string
    nodeRunId: string
    attemptId: string
    mode: WorkflowNode['runner']['workspaceMode']
    scopes: readonly string[]
  }>): Promise<Readonly<{ ok: true; grant: WorkflowWorkspaceGrant }> | Readonly<{ ok: false; reason: string }>>
  release?(grant: WorkflowWorkspaceGrant): Promise<void> | void
}>

export type WorkflowNodeExecution = Readonly<{
  settlement: 'completed' | 'failed' | 'cancelled' | 'interrupted'
  resultRef: string
  agentSessionId?: string
  runId?: string
  turnRecordRef?: TurnRecordRangeRef
  reviewSnapshotRef?: Readonly<{ snapshotId: string; revision?: string }>
  outputs: readonly Readonly<{ artifactId: string; schemaId: string; value: unknown }>[]
}>

export type WorkflowNodeExecutionRequest = Readonly<{
  workflowRunId: string
  nodeRunId: string
  attemptId: string
  node: WorkflowNode
  inputs: readonly WorkflowArtifact[]
  workspace: WorkflowWorkspaceGrant
}>

export type WorkflowNodeVerification = Readonly<{
  passed: boolean
  criterionId: string
  acceptanceDigest: string
}>

export type WorkflowSchedulerOptions = Readonly<{
  store: WorkflowRecordStore
  executeNode(request: WorkflowNodeExecutionRequest): Promise<WorkflowNodeExecution>
  reducers: Readonly<Record<string, (inputs: readonly WorkflowArtifact[]) => Readonly<Record<string, unknown>>>>
  schemaValidators: Readonly<Record<string, (value: unknown) => boolean>>
  verifyNode(input: Readonly<{
    node: WorkflowNode
    nodeRunId: string
    attemptId: string
    inputs: readonly WorkflowArtifact[]
    outputs: readonly WorkflowArtifact[]
    execution: WorkflowNodeExecution
  }>): Promise<WorkflowNodeVerification>
  workspaceAuthority?: WorkflowWorkspaceAuthority
  clock?: () => number
}>

export type WorkflowNodeStatus = 'pending' | 'running' | 'passed' | 'failed' | 'blocked'
export type WorkflowSchedulerResult = Readonly<{
  workflowRunId: string
  verdict: 'passed' | 'failed' | 'blocked'
  acceptanceDigest: string
  nodeStatuses: Readonly<Record<string, WorkflowNodeStatus>>
  artifacts: readonly WorkflowArtifact[]
  errors: readonly string[]
}>

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const SHA256 = /^[a-f0-9]{64}$/

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

async function digestValue(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function readonlyGrant(node: WorkflowNode): WorkflowWorkspaceGrant | undefined {
  return node.runner.workspaceMode === 'shared-readonly' ? { mode: 'shared-readonly' } : undefined
}

function validWorkspaceGrant(node: WorkflowNode, grant: WorkflowWorkspaceGrant): boolean {
  if (grant.mode !== node.runner.workspaceMode) return false
  if (grant.mode === 'shared-leased-write') return ID.test(grant.leaseId)
  if (grant.mode === 'isolated-worktree') return grant.verified === true && ID.test(grant.workspaceRef)
  return true
}

function syntheticExecution(attemptId: string, outputs: readonly Readonly<{ artifactId: string; schemaId: string; value: unknown }>[]): WorkflowNodeExecution {
  return { settlement: 'completed', resultRef: `${attemptId}:reducer`, outputs }
}

export class WorkflowScheduler {
  readonly definition: WorkflowDefinition
  readonly workflowRunId: string
  private readonly taskRunId: string
  private readonly options: WorkflowSchedulerOptions
  private readonly clock: () => number
  private readonly startedAt: number
  private readonly statuses = new Map<string, WorkflowNodeStatus>()
  private readonly artifacts = new Map<string, WorkflowArtifact>()
  private readonly attemptsByNode = new Map<string, number>()
  private readonly failureReasons = new Map<string, WorkflowNode['retry']['retryOn'][number]>()
  private readonly errors: string[] = []
  private attempts = 0
  private active = 0
  private initialRunComplete = false

  private constructor(input: {
    definition: WorkflowDefinition
    taskRunId: string
    workflowRunId: string
    options: WorkflowSchedulerOptions
  }) {
    this.definition = input.definition
    this.taskRunId = input.taskRunId
    this.workflowRunId = input.workflowRunId
    this.options = input.options
    this.clock = input.options.clock || Date.now
    this.startedAt = this.clock()
    for (const node of this.definition.nodes) this.statuses.set(node.id, 'pending')
    this.append({ kind: 'workflow-admitted', definitionDigest: this.definition.digest })
    this.recordBudget()
  }

  static async admit(input: {
    definition: unknown
    taskRunId: string
    workflowRunId: string
    options: WorkflowSchedulerOptions
  }): Promise<WorkflowScheduler> {
    const admitted = await validateAndFreezeWorkflowDefinition(input.definition)
    if (!admitted.ok || !admitted.definition) {
      throw new Error(`Workflow admission failed: ${admitted.errors.map((entry) => entry.code).join(', ')}`)
    }
    return new WorkflowScheduler({ ...input, definition: admitted.definition })
  }

  private context(extra: Record<string, unknown> = {}) {
    return { taskRunId: this.taskRunId, workflowRunId: this.workflowRunId, ...extra }
  }

  private append(event: Parameters<WorkflowRecordStore['append']>[1], extra?: Record<string, unknown>): void {
    this.options.store.append(this.context(extra), event)
  }

  private recordBudget(): void {
    this.append({
      kind: 'budget-updated',
      remaining: {
        attempts: Math.max(0, this.definition.budgets.maxTotalAttempts - this.attempts),
        concurrentNodes: Math.max(0, this.definition.budgets.maxConcurrentNodes - this.active),
        wallClockMs: Math.max(0, this.definition.budgets.maxWallClockMs - (this.clock() - this.startedAt)),
      },
    })
  }

  private inputsFor(node: WorkflowNode): readonly WorkflowArtifact[] {
    return node.inputs.flatMap((input) => {
      const artifact = this.artifacts.get(input.artifactRef)
      return artifact ? [artifact] : []
    })
  }

  private isReady(node: WorkflowNode): boolean {
    if (this.statuses.get(node.id) !== 'pending') return false
    if (!node.dependsOn.every((id) => this.statuses.get(id) === 'passed')) return false
    return node.inputs.every((input) => !input.required || this.artifacts.has(input.artifactRef))
  }

  private async admitWorkspace(node: WorkflowNode, nodeRunId: string, attemptId: string): Promise<WorkflowWorkspaceGrant> {
    const local = readonlyGrant(node)
    if (local) return local
    if (!this.options.workspaceAuthority) throw new Error(`${node.id}: write-capable workspace authority is unavailable`)
    const decision = await this.options.workspaceAuthority.admit({
      workflowRunId: this.workflowRunId,
      nodeRunId,
      attemptId,
      mode: node.runner.workspaceMode,
      scopes: node.runner.workspaceScopes || [],
    })
    if (!decision.ok) throw new Error(`${node.id}: workspace admission denied: ${decision.reason}`)
    if (!validWorkspaceGrant(node, decision.grant)) {
      await this.options.workspaceAuthority.release?.(decision.grant)
      throw new Error(`${node.id}: workspace authority returned an invalid grant`)
    }
    return decision.grant
  }

  private reducerExecution(node: WorkflowNode, attemptId: string, inputs: readonly WorkflowArtifact[]): WorkflowNodeExecution {
    const reduce = this.options.reducers[node.id]
    if (!reduce) throw new Error(`${node.id}: deterministic reducer is not registered`)
    const values = reduce(inputs)
    return syntheticExecution(attemptId, Object.entries(values).map(([artifactId, value]) => {
      const output = node.outputs.find((candidate) => candidate.id === artifactId)
      return { artifactId, schemaId: output?.schemaId || 'undeclared', value }
    }))
  }

  private async normalizeOutputs(node: WorkflowNode, nodeRunId: string, execution: WorkflowNodeExecution): Promise<readonly WorkflowArtifact[]> {
    const declared = new Map(node.outputs.map((output) => [output.id, output]))
    const seen = new Set<string>()
    const normalized: WorkflowArtifact[] = []
    for (const output of execution.outputs) {
      const contract = declared.get(output.artifactId)
      if (!contract) throw new Error(`${node.id}: undeclared artifact ${output.artifactId}`)
      if (seen.has(output.artifactId)) throw new Error(`${node.id}: duplicate artifact ${output.artifactId}`)
      if (contract.schemaId !== output.schemaId) throw new Error(`${node.id}: schema id mismatch for ${output.artifactId}`)
      const validator = this.options.schemaValidators[contract.schemaId]
      if (!validator || !validator(output.value)) throw new Error(`${node.id}: schema mismatch for ${output.artifactId}`)
      seen.add(output.artifactId)
      normalized.push(Object.freeze({ ...output, digest: await digestValue(output.value), producerNodeRunId: nodeRunId }))
    }
    const missing = node.outputs.filter((output) => output.required && !seen.has(output.id))
    if (missing.length) throw new Error(`${node.id}: required artifacts missing: ${missing.map((output) => output.id).join(', ')}`)
    return Object.freeze(normalized)
  }

  private recordObservation(nodeRunId: string, attemptId: string, execution: WorkflowNodeExecution): void {
    this.append({
      kind: 'node-observed', nodeRunId, attemptId,
      settlement: execution.settlement, resultRef: execution.resultRef,
    }, {
      nodeRunId, attemptId,
      ...(execution.agentSessionId ? { sessionId: execution.agentSessionId } : {}),
      ...(execution.runId ? { runId: execution.runId } : {}),
      ...(execution.turnRecordRef ? { turnRecordRef: execution.turnRecordRef } : {}),
      ...(execution.reviewSnapshotRef ? { reviewSnapshotRef: execution.reviewSnapshotRef } : {}),
    })
  }

  private async releaseWorkspace(node: WorkflowNode, grant: WorkflowWorkspaceGrant | undefined): Promise<void> {
    if (!grant || grant.mode === 'shared-readonly') return
    try {
      await this.options.workspaceAuthority?.release?.(grant)
    } catch (error) {
      this.statuses.set(node.id, 'failed')
      this.failureReasons.set(node.id, 'execution-failed')
      this.errors.push(error instanceof Error
        ? `${node.id}: workspace release failed: ${error.message}`
        : `${node.id}: workspace release failed`)
    }
  }

  private async executeOne(node: WorkflowNode): Promise<void> {
    const nodeRunId = `${this.workflowRunId}:${node.id}`
    const attemptNumber = (this.attemptsByNode.get(node.id) || 0) + 1
    const attemptId = `${nodeRunId}:attempt:${attemptNumber}`
    let grant: WorkflowWorkspaceGrant | undefined
    let failureStatus: WorkflowNodeStatus = 'blocked'
    let failureReason: WorkflowNode['retry']['retryOn'][number] = 'execution-failed'
    try {
      if (attemptNumber > node.retry.maxAttempts) {
        failureStatus = 'failed'
        throw new Error(`${node.id}: node retry budget exhausted`)
      }
      if (this.attempts >= this.definition.budgets.maxTotalAttempts) {
        failureStatus = 'failed'
        throw new Error(`${node.id}: workflow attempt budget exhausted`)
      }
      grant = await this.admitWorkspace(node, nodeRunId, attemptId)
      failureStatus = 'failed'
      this.attempts += 1
      this.attemptsByNode.set(node.id, attemptNumber)
      this.active += 1
      this.statuses.set(node.id, 'running')
      this.append({ kind: 'node-dispatched', nodeRunId, attemptId }, { nodeRunId, attemptId })
      this.recordBudget()
      const inputs = this.inputsFor(node)
      const execution = node.kind === 'deterministic-reducer'
        ? this.reducerExecution(node, attemptId, inputs)
        : await this.options.executeNode({ workflowRunId: this.workflowRunId, nodeRunId, attemptId, node, inputs, workspace: grant })
      if (!ID.test(execution.resultRef)) throw new Error(`${node.id}: execution resultRef is invalid`)
      this.recordObservation(nodeRunId, attemptId, execution)
      if (execution.settlement !== 'completed') throw new Error(`${node.id}: execution ${execution.settlement}`)
      failureReason = 'schema-failed'
      const outputs = await this.normalizeOutputs(node, nodeRunId, execution)
      failureReason = 'criterion-failed'
      const verification = await this.options.verifyNode({ node, nodeRunId, attemptId, inputs, outputs, execution })
      if (!ID.test(verification.criterionId) || !SHA256.test(verification.acceptanceDigest)) throw new Error(`${node.id}: verifier returned invalid evidence refs`)
      for (const artifact of outputs) this.append({
        kind: 'artifact-published', nodeRunId, attemptId,
        artifactId: artifact.artifactId, digest: artifact.digest,
      }, { nodeRunId, attemptId })
      this.append({ kind: 'criterion-evaluated', nodeRunId, attemptId, ...verification }, { nodeRunId, attemptId })
      this.append({
        kind: 'node-verified', nodeRunId, attemptId,
        passed: verification.passed, acceptanceDigest: verification.acceptanceDigest,
      }, { nodeRunId, attemptId })
      if (!verification.passed) throw new Error(`${node.id}: node verification failed`)
      for (const artifact of outputs) this.artifacts.set(artifact.artifactId, artifact)
      this.statuses.set(node.id, 'passed')
      this.failureReasons.delete(node.id)
    } catch (error) {
      this.statuses.set(node.id, failureStatus)
      if (failureStatus === 'failed') this.failureReasons.set(node.id, failureReason)
      this.errors.push(error instanceof Error ? error.message : `${node.id}: unknown workflow failure`)
    } finally {
      if (this.active > 0 && this.statuses.get(node.id) !== 'blocked') this.active -= 1
      await this.releaseWorkspace(node, grant)
      this.recordBudget()
    }
  }

  private recordReady(node: WorkflowNode): void {
    const nodeRunId = `${this.workflowRunId}:${node.id}`
    if (node.dependsOn.length > 0) this.append({
      kind: 'barrier-opened',
      nodeRunId,
      upstreamArtifactIds: node.inputs.map((input) => input.artifactRef),
    }, { nodeRunId })
    this.append({ kind: 'node-ready', nodeRunId }, { nodeRunId })
  }

  private async runPending(): Promise<void> {
    while ([...this.statuses.values()].some((status) => status === 'pending')) {
      if (this.clock() - this.startedAt > this.definition.budgets.maxWallClockMs) {
        this.errors.push('Workflow wall-clock budget exhausted')
        break
      }
      const ready = this.definition.nodes.filter((node) => this.isReady(node))
      if (ready.length === 0) break
      const batch = ready.slice(0, this.definition.budgets.maxConcurrentNodes)
      for (const node of batch) this.recordReady(node)
      await Promise.all(batch.map((node) => this.executeOne(node)))
    }
    for (const node of this.definition.nodes) {
      if (this.statuses.get(node.id) === 'pending') this.statuses.set(node.id, 'blocked')
    }
  }

  private impactedClosure(seedNodeIds: readonly string[]): Set<string> {
    const impacted = new Set(seedNodeIds)
    const queue = [...impacted]
    for (let index = 0; index < queue.length; index += 1) {
      for (const node of this.definition.nodes) {
        if (!node.dependsOn.includes(queue[index]) || impacted.has(node.id)) continue
        impacted.add(node.id)
        queue.push(node.id)
      }
    }
    return impacted
  }

  private repairSeeds(plan: RepairPlan): string[] {
    if (plan.runId !== this.taskRunId) throw new Error('RepairPlan runId does not match the Workflow task run')
    if (plan.targets.some((target) => !target.retryable)) throw new Error('RepairPlan contains a non-retryable target')
    const seeds = [...new Set(plan.targets.flatMap((target) => target.impactedNodeIds))].sort()
    if (seeds.length === 0) throw new Error('RepairPlan contains no impacted workflow nodes')
    const byId = new Map(this.definition.nodes.map((node) => [node.id, node]))
    for (const seed of seeds) {
      const node = byId.get(seed)
      if (!node) throw new Error(`RepairPlan references unknown workflow node: ${seed}`)
      const reason = this.failureReasons.get(seed) || 'criterion-failed'
      if (!node.retry.retryOn.includes(reason)) throw new Error(`${seed}: retry policy rejects ${reason}`)
    }
    return seeds
  }

  private assertRepairBudget(impacted: ReadonlySet<string>): void {
    if (this.clock() - this.startedAt > this.definition.budgets.maxWallClockMs) throw new Error('Workflow wall-clock budget exhausted')
    if (this.attempts + impacted.size > this.definition.budgets.maxTotalAttempts) throw new Error('Workflow total attempt budget exhausted')
    for (const node of this.definition.nodes) {
      if (!impacted.has(node.id)) continue
      if ((this.attemptsByNode.get(node.id) || 0) >= node.retry.maxAttempts) throw new Error(`${node.id}: node retry budget exhausted`)
    }
  }

  private invalidateSubgraph(impacted: ReadonlySet<string>, repairPlanDigest: string): void {
    for (const node of this.definition.nodes) {
      if (!impacted.has(node.id)) continue
      this.statuses.set(node.id, 'pending')
      this.failureReasons.delete(node.id)
      for (const output of node.outputs) this.artifacts.delete(output.id)
    }
    this.append({
      kind: 'subgraph-invalidated',
      nodeRunIds: [...impacted].sort().map((nodeId) => `${this.workflowRunId}:${nodeId}`),
      repairPlanDigest,
    })
    this.recordBudget()
  }

  private async finish(): Promise<WorkflowSchedulerResult> {
    const values = [...this.statuses.values()]
    const verdict = values.every((status) => status === 'passed')
      ? 'passed' as const
      : values.some((status) => status === 'failed') ? 'failed' as const : 'blocked' as const
    const acceptanceDigest = await digestValue({
      definitionDigest: this.definition.digest,
      statuses: Object.fromEntries(this.statuses),
      artifacts: [...this.artifacts.values()].map((artifact) => ({ id: artifact.artifactId, digest: artifact.digest })),
      errors: this.errors,
    })
    this.append({ kind: 'workflow-terminal', verdict, acceptanceDigest })
    return Object.freeze({
      workflowRunId: this.workflowRunId,
      verdict,
      acceptanceDigest,
      nodeStatuses: Object.freeze(Object.fromEntries(this.statuses)),
      artifacts: Object.freeze([...this.artifacts.values()]),
      errors: Object.freeze([...this.errors]),
    })
  }

  async run(): Promise<WorkflowSchedulerResult> {
    if (this.initialRunComplete) throw new Error('Initial workflow run is already complete')
    this.initialRunComplete = true
    await this.runPending()
    return this.finish()
  }

  async repair(plan: RepairPlan): Promise<WorkflowSchedulerResult> {
    if (!this.initialRunComplete) throw new Error('Workflow repair requires an initial terminal run')
    if (!isRepairPlan(plan)) throw new Error('Workflow repair requires a valid immutable RepairPlan')
    const impacted = this.impactedClosure(this.repairSeeds(plan))
    this.assertRepairBudget(impacted)
    this.invalidateSubgraph(impacted, plan.digest)
    await this.runPending()
    return this.finish()
  }
}
