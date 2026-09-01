import type { WorkingState } from './workingState.ts'

export const GOAL_CONTRACT_CAPABILITY = 'goal-contract-v1' as const

export type GoalCriterion =
  | Readonly<{ id: string; kind: 'assistant-answer-present' }>
  | Readonly<{ id: string; kind: 'file-content'; path: string; sha256: string }>
  | Readonly<{ id: string; kind: 'registered-command'; commandId: string; expectedExitCode: number }>
  | Readonly<{ id: string; kind: 'test-suite'; suite: 'build' | 'lint' | 'smoke' | 'test' }>
  | Readonly<{ id: string; kind: 'artifact-exists'; artifactId: string; path: string; sha256?: string }>
  | Readonly<{ id: string; kind: 'json-schema'; artifactId: string; path: string; schemaId: string }>
  | Readonly<{
      id: string
      kind: 'review-verification'
      snapshotId: string
      verifiedRevision: string
      verification: 'build' | 'smoke' | 'test'
    }>
  | Readonly<{
      id: string
      kind: 'semantic-rubric'
      rubricId: string
      verifierPolicy: 'all' | 'majority' | 'mandatory'
    }>

export type GoalContractSnapshot = Readonly<{
  schemaVersion: 1
  id: string
  revision: number
  digest: string
  mode: 'turn' | 'goal'
  objective: string
  constraints: readonly string[]
  outputs: readonly Readonly<{ id: string; schemaId: string; required: boolean }>[]
  criteria: readonly GoalCriterion[]
  budgets: Readonly<{
    maxIterations: number
    maxWallClockMs: number
    maxTokens?: number
    maxCostUsd?: number
    maxNodeAttempts?: number
  }>
  escalation: Readonly<{
    onBlocked: 'hitl' | 'fail'
    onUnverifiable: 'hitl' | 'fail'
    onBudgetExceeded: 'checkpoint' | 'fail'
    onNoProgress: 'hitl' | 'fail'
  }>
}>

type GoalContractBody = Omit<GoalContractSnapshot, 'digest'>
export type GoalContractInput = GoalContractBody

const SHA256 = /^[a-f0-9]{64}$/
const boundedString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max

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

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function freezeDeep<T>(value: T): Readonly<T> {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
  return Object.freeze(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

const validFileCriterion = (criterion: Record<string, unknown>): boolean => hasOnlyKeys(criterion, ['id', 'kind', 'path', 'sha256'])
  && boundedString(criterion.path, 1_024) && typeof criterion.sha256 === 'string' && SHA256.test(criterion.sha256)

const validCommandCriterion = (criterion: Record<string, unknown>): boolean => hasOnlyKeys(criterion, ['id', 'kind', 'commandId', 'expectedExitCode'])
  && boundedString(criterion.commandId, 160) && Number.isSafeInteger(criterion.expectedExitCode)
  && Number(criterion.expectedExitCode) >= 0 && Number(criterion.expectedExitCode) <= 255

const validArtifactCriterion = (criterion: Record<string, unknown>): boolean => hasOnlyKeys(criterion, ['id', 'kind', 'artifactId', 'path', 'sha256'])
  && boundedString(criterion.artifactId, 1_024) && boundedString(criterion.path, 1_024)
  && (criterion.sha256 === undefined || typeof criterion.sha256 === 'string' && SHA256.test(criterion.sha256))

const validJsonSchemaCriterion = (criterion: Record<string, unknown>): boolean => hasOnlyKeys(criterion, ['id', 'kind', 'artifactId', 'path', 'schemaId'])
  && boundedString(criterion.artifactId, 1_024) && boundedString(criterion.path, 1_024) && boundedString(criterion.schemaId, 1_024)

const validReviewCriterion = (criterion: Record<string, unknown>): boolean => hasOnlyKeys(criterion, ['id', 'kind', 'snapshotId', 'verifiedRevision', 'verification'])
  && boundedString(criterion.snapshotId, 512) && boundedString(criterion.verifiedRevision, 512)
  && ['build', 'smoke', 'test'].includes(String(criterion.verification))

const validSemanticCriterion = (criterion: Record<string, unknown>): boolean => hasOnlyKeys(criterion, ['id', 'kind', 'rubricId', 'verifierPolicy'])
  && boundedString(criterion.rubricId, 1_024) && ['all', 'majority', 'mandatory'].includes(String(criterion.verifierPolicy))

export function isGoalCriterion(value: unknown): value is GoalCriterion {
  if (!value || typeof value !== 'object') return false
  const criterion = value as Record<string, unknown>
  if (!boundedString(criterion.id, 1_024)) return false
  if (criterion.kind === 'assistant-answer-present') return hasOnlyKeys(criterion, ['id', 'kind'])
  if (criterion.kind === 'file-content') return validFileCriterion(criterion)
  if (criterion.kind === 'registered-command') return validCommandCriterion(criterion)
  if (criterion.kind === 'test-suite') return hasOnlyKeys(criterion, ['id', 'kind', 'suite'])
    && ['build', 'lint', 'smoke', 'test'].includes(String(criterion.suite))
  if (criterion.kind === 'artifact-exists') return validArtifactCriterion(criterion)
  if (criterion.kind === 'json-schema') return validJsonSchemaCriterion(criterion)
  if (criterion.kind === 'review-verification') return validReviewCriterion(criterion)
  return criterion.kind === 'semantic-rubric' && validSemanticCriterion(criterion)
}

function isGoalOutputs(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 100 && value.every((item) => Boolean(item) && typeof item === 'object'
    && hasOnlyKeys(item as Record<string, unknown>, ['id', 'schemaId', 'required'])
    && boundedString((item as Record<string, unknown>).id, 1_024)
    && boundedString((item as Record<string, unknown>).schemaId, 1_024)
    && typeof (item as Record<string, unknown>).required === 'boolean')
}

function isGoalCriteria(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 100
    && value.every(isGoalCriterion)
    && new Set(value.map((item) => (item as GoalCriterion).id)).size === value.length
}

function isGoalBudgets(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const budgets = value as Record<string, unknown>
  return hasOnlyKeys(budgets, ['maxIterations', 'maxWallClockMs', 'maxTokens', 'maxCostUsd', 'maxNodeAttempts'])
    && Number.isSafeInteger(budgets.maxIterations) && Number(budgets.maxIterations) >= 1
    && Number.isSafeInteger(budgets.maxWallClockMs) && Number(budgets.maxWallClockMs) >= 1
    && (budgets.maxTokens === undefined || (Number.isSafeInteger(budgets.maxTokens) && Number(budgets.maxTokens) >= 1))
    && (budgets.maxCostUsd === undefined || (typeof budgets.maxCostUsd === 'number' && Number.isFinite(budgets.maxCostUsd) && budgets.maxCostUsd > 0))
    && (budgets.maxNodeAttempts === undefined || (Number.isSafeInteger(budgets.maxNodeAttempts) && Number(budgets.maxNodeAttempts) >= 1))
}

function isGoalEscalation(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const escalation = value as Record<string, unknown>
  return hasOnlyKeys(escalation, ['onBlocked', 'onUnverifiable', 'onBudgetExceeded', 'onNoProgress'])
    && (escalation.onBlocked === 'hitl' || escalation.onBlocked === 'fail')
    && (escalation.onUnverifiable === 'hitl' || escalation.onUnverifiable === 'fail')
    && (escalation.onBudgetExceeded === 'checkpoint' || escalation.onBudgetExceeded === 'fail')
    && (escalation.onNoProgress === 'hitl' || escalation.onNoProgress === 'fail')
}

function isGoalContractBody(value: unknown): value is GoalContractBody {
  if (!value || typeof value !== 'object') return false
  const contract = value as Record<string, unknown>
  return hasOnlyKeys(contract, [
    'schemaVersion', 'id', 'revision', 'mode', 'objective', 'constraints', 'outputs', 'criteria', 'budgets', 'escalation',
  ])
    && contract.schemaVersion === 1
    && boundedString(contract.id, 1_024)
    && Number.isSafeInteger(contract.revision) && Number(contract.revision) >= 1
    && (contract.mode === 'turn' || contract.mode === 'goal')
    && boundedString(contract.objective, 800)
    && Array.isArray(contract.constraints) && contract.constraints.length <= 100
    && contract.constraints.every((item) => boundedString(item, 400))
    && isGoalOutputs(contract.outputs)
    && isGoalCriteria(contract.criteria)
    && (contract.criteria as GoalCriterion[]).every((criterion) => {
      if (criterion.kind !== 'json-schema' && criterion.kind !== 'artifact-exists') return true
      return (contract.outputs as GoalContractSnapshot['outputs']).some((output) => output.id === criterion.artifactId
        && (criterion.kind !== 'json-schema' || output.schemaId === criterion.schemaId))
    })
    && isGoalBudgets(contract.budgets)
    && isGoalEscalation(contract.escalation)
}

export function isGoalContractSnapshot(value: unknown): value is GoalContractSnapshot {
  if (!value || typeof value !== 'object') return false
  const { digest, ...body } = value as GoalContractSnapshot
  return typeof digest === 'string' && SHA256.test(digest) && isGoalContractBody(body)
}

/** Recompute the canonical digest when a snapshot crosses a trust boundary. */
export async function verifyGoalContractSnapshot(value: unknown): Promise<boolean> {
  if (!isGoalContractSnapshot(value)) return false
  const { digest, ...body } = value
  return digest === await sha256(canonicalJson(body))
}

export async function createGoalContractSnapshot(body: GoalContractInput): Promise<GoalContractSnapshot> {
  if (!isGoalContractBody(body)) throw new Error('Goal Contract validation failed')
  const snapshot: GoalContractSnapshot = { ...body, digest: await sha256(canonicalJson(body)) }
  if (!isGoalContractSnapshot(snapshot)) throw new Error('Goal Contract snapshot validation failed')
  return freezeDeep(snapshot) as GoalContractSnapshot
}

export function hasExecutableGoalCriterion(contract: GoalContractSnapshot): boolean {
  return contract.criteria.some((criterion) => criterion.kind !== 'assistant-answer-present'
    || (criterion.kind === 'assistant-answer-present' && contract.mode === 'turn'))
}

export async function goalContractFromWorkingState(input: {
  state: WorkingState
  mode: 'turn' | 'goal'
  maxIterations: number
  maxWallClockMs: number
  unattended: boolean
}): Promise<GoalContractSnapshot> {
  const body: GoalContractBody = {
    schemaVersion: 1,
    id: `goal-contract:${input.state.runId}`,
    revision: 1,
    mode: input.mode,
    objective: input.state.objective,
    constraints: [...input.state.constraints],
    outputs: [],
    criteria: input.mode === 'turn'
      ? [{ id: `turn-answer:${input.state.runId}`, kind: 'assistant-answer-present' }]
      : input.state.goals.flatMap((goal) => goal.completionPredicate?.kind === 'file-content'
        ? [{ id: goal.id, kind: 'file-content' as const, path: goal.completionPredicate.path, sha256: goal.completionPredicate.sha256 }]
        : []),
    budgets: {
      maxIterations: input.maxIterations,
      maxWallClockMs: input.maxWallClockMs,
    },
    escalation: {
      onBlocked: input.unattended ? 'fail' : 'hitl',
      onUnverifiable: input.unattended ? 'fail' : 'hitl',
      onBudgetExceeded: 'checkpoint',
      onNoProgress: input.unattended ? 'fail' : 'hitl',
    },
  }
  return createGoalContractSnapshot(body)
}
