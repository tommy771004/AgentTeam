import { isGoalVerdict, type GoalVerdict } from './goalOutcome.ts'

export const WORKFLOW_RECORD_CAPABILITY = 'workflow-record-v1' as const

export type TurnRecordRangeRef = Readonly<{
  sessionId: string
  fromSeq: number
  toSeq: number
}>

export type WorkflowRecordContext = Readonly<{
  taskRunId: string
  workflowRunId: string
  nodeRunId?: string
  attemptId?: string
  sessionId?: string
  runId?: string
  turnRecordRef?: TurnRecordRangeRef
  reviewSnapshotRef?: Readonly<{ snapshotId: string; revision?: string }>
}>

export type WorkflowRecordEvent =
  | Readonly<{ kind: 'workflow-admitted'; definitionDigest: string }>
  | Readonly<{ kind: 'workflow-resumed'; definitionDigest: string }>
  | Readonly<{ kind: 'node-ready'; nodeRunId: string }>
  | Readonly<{ kind: 'node-dispatched'; nodeRunId: string; attemptId: string; agentSessionId?: string }>
  | Readonly<{ kind: 'node-observed'; nodeRunId: string; attemptId: string; settlement: 'completed' | 'failed' | 'cancelled' | 'interrupted'; resultRef: string }>
  | Readonly<{ kind: 'artifact-published'; nodeRunId: string; attemptId: string; artifactId: string; digest: string }>
  | Readonly<{ kind: 'criterion-evaluated'; nodeRunId: string; attemptId: string; acceptanceDigest: string; criterionId: string; passed: boolean }>
  | Readonly<{ kind: 'node-verified'; nodeRunId: string; attemptId: string; passed: boolean; acceptanceDigest: string }>
  | Readonly<{ kind: 'barrier-opened'; nodeRunId: string; upstreamArtifactIds: readonly string[] }>
  | Readonly<{ kind: 'subgraph-invalidated'; nodeRunIds: readonly string[]; repairPlanDigest: string }>
  | Readonly<{ kind: 'goal-verdict'; verdict: GoalVerdict; acceptanceDigest: string }>
  | Readonly<{ kind: 'budget-updated'; remaining: Readonly<{ attempts: number; concurrentNodes: number; wallClockMs: number }> }>
  | Readonly<{ kind: 'workflow-terminal'; verdict: GoalVerdict; acceptanceDigest: string }>

export type WorkflowRecordEntry = Readonly<WorkflowRecordContext & WorkflowRecordEvent & {
  workflowSeq: number
  at: number
}>

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const SHA256 = /^[a-f0-9]{64}$/
const validId = (value: unknown): value is string => typeof value === 'string' && ID.test(value)
const validDigest = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value)
const positiveSeq = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1

export function isTurnRecordRangeRef(value: unknown): value is TurnRecordRangeRef {
  if (!value || typeof value !== 'object') return false
  const ref = value as Record<string, unknown>
  return Object.keys(ref).every((key) => ['sessionId', 'fromSeq', 'toSeq'].includes(key))
    && validId(ref.sessionId) && positiveSeq(ref.fromSeq) && positiveSeq(ref.toSeq)
    && Number(ref.fromSeq) <= Number(ref.toSeq)
}

type EntryValidator = (entry: Record<string, unknown>) => boolean
const EVENT_VALIDATORS: Readonly<Record<string, EntryValidator>> = {
  'workflow-admitted': (entry) => validDigest(entry.definitionDigest),
  'workflow-resumed': (entry) => validDigest(entry.definitionDigest),
  'node-ready': (entry) => validId(entry.nodeRunId),
  'node-dispatched': (entry) => validId(entry.nodeRunId) && validId(entry.attemptId),
  'node-observed': (entry) => validId(entry.nodeRunId) && validId(entry.attemptId)
    && ['completed', 'failed', 'cancelled', 'interrupted'].includes(String(entry.settlement)) && validId(entry.resultRef),
  'artifact-published': (entry) => validId(entry.nodeRunId) && validId(entry.attemptId)
    && validId(entry.artifactId) && validDigest(entry.digest),
  'criterion-evaluated': (entry) => validId(entry.nodeRunId) && validId(entry.attemptId)
    && validDigest(entry.acceptanceDigest) && validId(entry.criterionId) && typeof entry.passed === 'boolean',
  'node-verified': (entry) => validId(entry.nodeRunId) && validId(entry.attemptId)
    && validDigest(entry.acceptanceDigest) && typeof entry.passed === 'boolean',
  'barrier-opened': (entry) => validId(entry.nodeRunId) && Array.isArray(entry.upstreamArtifactIds)
    && entry.upstreamArtifactIds.every(validId),
  'subgraph-invalidated': (entry) => Array.isArray(entry.nodeRunIds) && entry.nodeRunIds.length > 0
    && entry.nodeRunIds.every(validId) && validDigest(entry.repairPlanDigest),
  'goal-verdict': (entry) => isGoalVerdict(entry.verdict) && validDigest(entry.acceptanceDigest),
  'workflow-terminal': (entry) => isGoalVerdict(entry.verdict) && validDigest(entry.acceptanceDigest),
  'budget-updated': (entry) => Boolean(entry.remaining) && typeof entry.remaining === 'object'
    && ['attempts', 'concurrentNodes', 'wallClockMs'].every((key) => {
      const value = (entry.remaining as Record<string, unknown>)[key]
      return Number.isSafeInteger(value) && Number(value) >= 0
    }),
}

export function isWorkflowRecordEntry(value: unknown): value is WorkflowRecordEntry {
  if (!value || typeof value !== 'object') return false
  if (workflowRecordContainsTranscript(value)) return false
  const entry = value as Record<string, unknown>
  if (!positiveSeq(entry.workflowSeq) || typeof entry.at !== 'number' || !Number.isFinite(entry.at)) return false
  if (!validId(entry.taskRunId) || !validId(entry.workflowRunId) || typeof entry.kind !== 'string') return false
  if (entry.turnRecordRef !== undefined && !isTurnRecordRangeRef(entry.turnRecordRef)) return false
  return EVENT_VALIDATORS[entry.kind]?.(entry) === true
}

export function workflowRecordContainsTranscript(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(workflowRecordContainsTranscript)
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    /^(transcript|reasoning|messages|prompt|content|summary)$/i.test(key) || workflowRecordContainsTranscript(child))
}
