import {
  isAcceptanceSnapshot,
  verifyAcceptanceSnapshot,
  type AcceptanceSnapshot,
} from './acceptanceContract.ts'
import {
  isGoalContractSnapshot,
  verifyGoalContractSnapshot,
  type GoalContractSnapshot,
} from './goalContract.ts'
import {
  isMemoryControlPackageIdentity,
  type MemoryControlPackageIdentity,
} from './memoryControlPackage.ts'

export type CheckpointDigestRef = Readonly<{ id: string; digest: string }>

export type WorkflowRecoveryCheckpoint = Readonly<{
  schemaVersion: 1
  taskRunId: string
  workflowRunId: string
  definition: Readonly<{ id: string; revision: number; digest: string }>
  nodeAttempts: readonly Readonly<{
    nodeId: string
    attempts: number
    status: 'pending' | 'passed' | 'failed' | 'blocked'
    failureReason?: 'execution-failed' | 'schema-failed' | 'criterion-failed'
  }>[]
  artifacts: readonly Readonly<{
    artifactId: string
    schemaId: string
    digest: string
    producerNodeRunId: string
    value: unknown
  }>[]
  remainingBudgets: Readonly<{
    attempts: number
    wallClockMs: number
  }>
  elapsedMs: number
  initialRunComplete: boolean
}>

export type GoalRuntimeCheckpoint = Readonly<{
  schemaVersion: 1
  goalContract: GoalContractSnapshot
  acceptanceSnapshot: AcceptanceSnapshot
  governingPackage: MemoryControlPackageIdentity
  workflow: WorkflowRecoveryCheckpoint
  remainingBudgets: Readonly<{
    iterations: number
    wallClockMs: number
    tokens?: number
    costUsd?: number
    nodeAttempts?: number
  }>
  completedEffects: readonly string[]
  evidence: readonly CheckpointDigestRef[]
  digest: string
}>

type GoalRuntimeCheckpointBody = Omit<GoalRuntimeCheckpoint, 'digest'>

const SHA256 = /^[a-f0-9]{64}$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/

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

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function freezeDeep<T>(value: T): Readonly<T> {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
  return Object.freeze(value)
}

function nonNegative(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

export function isWorkflowRecoveryCheckpoint(value: unknown): value is WorkflowRecoveryCheckpoint {
  if (!value || typeof value !== 'object') return false
  const workflow = value as WorkflowRecoveryCheckpoint
  return validWorkflowIdentity(workflow)
    && validWorkflowNodes(workflow.nodeAttempts)
    && validWorkflowArtifacts(workflow.artifacts)
    && validWorkflowBudget(workflow)
}

function validWorkflowIdentity(workflow: WorkflowRecoveryCheckpoint): boolean {
  return workflow.schemaVersion === 1 && ID.test(workflow.taskRunId) && ID.test(workflow.workflowRunId)
    && ID.test(workflow.definition?.id) && Number.isSafeInteger(workflow.definition?.revision)
    && workflow.definition.revision >= 1 && SHA256.test(workflow.definition?.digest || '')
}

function validWorkflowNodes(nodes: WorkflowRecoveryCheckpoint['nodeAttempts']): boolean {
  return Array.isArray(nodes) && nodes.every((node) => ID.test(node.nodeId) && nonNegativeInteger(node.attempts)
    && ['pending', 'passed', 'failed', 'blocked'].includes(node.status)
    && (node.failureReason === undefined || ['execution-failed', 'schema-failed', 'criterion-failed'].includes(node.failureReason)))
}

function validWorkflowArtifacts(artifacts: WorkflowRecoveryCheckpoint['artifacts']): boolean {
  return Array.isArray(artifacts) && artifacts.every((artifact) => ID.test(artifact.artifactId)
    && ID.test(artifact.schemaId) && SHA256.test(artifact.digest) && ID.test(artifact.producerNodeRunId))
}

function validWorkflowBudget(workflow: WorkflowRecoveryCheckpoint): boolean {
  return nonNegativeInteger(workflow.remainingBudgets?.attempts)
    && nonNegativeInteger(workflow.remainingBudgets?.wallClockMs)
    && nonNegativeInteger(workflow.elapsedMs) && typeof workflow.initialRunComplete === 'boolean'
}

function validGoalBudget(budget: GoalRuntimeCheckpoint['remainingBudgets']): boolean {
  return nonNegativeInteger(budget?.iterations) && nonNegativeInteger(budget?.wallClockMs)
    && (budget.tokens === undefined || nonNegativeInteger(budget.tokens))
    && (budget.costUsd === undefined || nonNegative(budget.costUsd))
    && (budget.nodeAttempts === undefined || nonNegativeInteger(budget.nodeAttempts))
}

function validGoalRecoveryRefs(checkpoint: GoalRuntimeCheckpoint): boolean {
  return Array.isArray(checkpoint.completedEffects) && checkpoint.completedEffects.every((id) => ID.test(id))
    && new Set(checkpoint.completedEffects).size === checkpoint.completedEffects.length
    && Array.isArray(checkpoint.evidence) && checkpoint.evidence.every((ref) => ID.test(ref.id) && SHA256.test(ref.digest))
    && new Set(checkpoint.evidence.map((ref) => ref.id)).size === checkpoint.evidence.length
}

export function isGoalRuntimeCheckpoint(value: unknown): value is GoalRuntimeCheckpoint {
  if (!value || typeof value !== 'object') return false
  const checkpoint = value as GoalRuntimeCheckpoint
  return checkpoint.schemaVersion === 1
    && isGoalContractSnapshot(checkpoint.goalContract)
    && isAcceptanceSnapshot(checkpoint.acceptanceSnapshot)
    && checkpoint.acceptanceSnapshot.goalContractDigest === checkpoint.goalContract.digest
    && isMemoryControlPackageIdentity(checkpoint.governingPackage)
    && isWorkflowRecoveryCheckpoint(checkpoint.workflow)
    && validGoalBudget(checkpoint.remainingBudgets)
    && validGoalRecoveryRefs(checkpoint)
    && SHA256.test(checkpoint.digest)
}

export async function createGoalRuntimeCheckpoint(body: GoalRuntimeCheckpointBody): Promise<GoalRuntimeCheckpoint> {
  if (!await verifyGoalContractSnapshot(body.goalContract)) throw new Error('Checkpoint Goal Contract is invalid')
  if (!await verifyAcceptanceSnapshot(body.acceptanceSnapshot)) throw new Error('Checkpoint AcceptanceSnapshot is invalid')
  if (body.acceptanceSnapshot.goalContractDigest !== body.goalContract.digest) {
    throw new Error('Checkpoint AcceptanceSnapshot does not belong to the Goal Contract')
  }
  const checkpoint = { ...structuredClone(body), digest: await sha256(body) }
  if (!isGoalRuntimeCheckpoint(checkpoint)) throw new Error('Goal runtime checkpoint is malformed')
  return freezeDeep(checkpoint) as GoalRuntimeCheckpoint
}

export type GoalRuntimeResumeEnvironment = Readonly<{
  goalContract: GoalContractSnapshot
  governingPackage: MemoryControlPackageIdentity
  completedEffects: readonly string[]
  artifactDigest(artifactId: string): Promise<string | undefined> | string | undefined
  evidenceDigest(evidenceId: string): Promise<string | undefined> | string | undefined
}>

export async function admitGoalRuntimeResume(
  checkpoint: unknown,
  environment: GoalRuntimeResumeEnvironment,
): Promise<Readonly<{ ok: true; checkpoint: GoalRuntimeCheckpoint }> | Readonly<{ ok: false; reason: string }>> {
  if (!isGoalRuntimeCheckpoint(checkpoint)) return { ok: false, reason: 'checkpoint-malformed' }
  if (!await verifyGoalContractSnapshot(environment.goalContract)) return { ok: false, reason: 'goal-contract-invalid' }
  if (!isMemoryControlPackageIdentity(environment.governingPackage)) return { ok: false, reason: 'governing-package-invalid' }
  const { digest, ...body } = checkpoint
  if (digest !== await sha256(body)) return { ok: false, reason: 'checkpoint-digest-mismatch' }
  if (!await verifyGoalContractSnapshot(checkpoint.goalContract)
    || !await verifyAcceptanceSnapshot(checkpoint.acceptanceSnapshot)) {
    return { ok: false, reason: 'checkpoint-snapshot-invalid' }
  }
  if (checkpoint.goalContract.digest !== environment.goalContract.digest
    || checkpoint.goalContract.id !== environment.goalContract.id
    || checkpoint.goalContract.revision !== environment.goalContract.revision) {
    return { ok: false, reason: 'goal-contract-identity-mismatch' }
  }
  const expectedPackage = checkpoint.governingPackage
  const actualPackage = environment.governingPackage
  if (expectedPackage.id !== actualPackage.id || expectedPackage.revision !== actualPackage.revision
    || expectedPackage.digest !== actualPackage.digest) {
    return { ok: false, reason: 'governing-package-identity-mismatch' }
  }
  const checkpointEffects = [...checkpoint.completedEffects].sort()
  const currentEffects = [...new Set(environment.completedEffects)].sort()
  if (canonicalJson(checkpointEffects) !== canonicalJson(currentEffects)) {
    return { ok: false, reason: 'completed-effects-drift' }
  }
  for (const artifact of checkpoint.workflow.artifacts) {
    if (await environment.artifactDigest(artifact.artifactId) !== artifact.digest) {
      return { ok: false, reason: `artifact-drift:${artifact.artifactId}` }
    }
  }
  for (const evidence of checkpoint.evidence) {
    if (await environment.evidenceDigest(evidence.id) !== evidence.digest) {
      return { ok: false, reason: `evidence-invalidated:${evidence.id}` }
    }
  }
  return { ok: true, checkpoint: freezeDeep(structuredClone(checkpoint)) as GoalRuntimeCheckpoint }
}
