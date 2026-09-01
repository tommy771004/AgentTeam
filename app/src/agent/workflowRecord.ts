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
  | Readonly<{ kind: 'node-ready'; nodeRunId: string }>
  | Readonly<{ kind: 'node-dispatched'; nodeRunId: string; attemptId: string; agentSessionId?: string }>
  | Readonly<{ kind: 'node-observed'; nodeRunId: string; attemptId: string; settlement: 'completed' | 'failed' | 'cancelled' | 'interrupted'; resultRef: string }>
  | Readonly<{ kind: 'artifact-published'; nodeRunId: string; attemptId: string; artifactId: string; digest: string }>
  | Readonly<{ kind: 'criterion-evaluated'; nodeRunId: string; attemptId: string; acceptanceDigest: string; criterionId: string; passed: boolean }>
  | Readonly<{ kind: 'node-verified'; nodeRunId: string; attemptId: string; passed: boolean; acceptanceDigest: string }>
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

export function isWorkflowRecordEntry(value: unknown): value is WorkflowRecordEntry {
  if (!value || typeof value !== 'object') return false
  if (workflowRecordContainsTranscript(value)) return false
  const entry = value as Record<string, unknown>
  if (!positiveSeq(entry.workflowSeq) || typeof entry.at !== 'number' || !Number.isFinite(entry.at)) return false
  if (!validId(entry.taskRunId) || !validId(entry.workflowRunId) || typeof entry.kind !== 'string') return false
  if (entry.turnRecordRef !== undefined && !isTurnRecordRangeRef(entry.turnRecordRef)) return false
  if (entry.kind === 'workflow-admitted') return validDigest(entry.definitionDigest)
  if (entry.kind === 'node-ready') return validId(entry.nodeRunId)
  if (entry.kind === 'node-dispatched') return validId(entry.nodeRunId) && validId(entry.attemptId)
  if (entry.kind === 'node-observed') return validId(entry.nodeRunId) && validId(entry.attemptId)
    && ['completed', 'failed', 'cancelled', 'interrupted'].includes(String(entry.settlement)) && validId(entry.resultRef)
  if (entry.kind === 'artifact-published') return validId(entry.nodeRunId) && validId(entry.attemptId) && validId(entry.artifactId) && validDigest(entry.digest)
  if (entry.kind === 'criterion-evaluated') return validId(entry.nodeRunId) && validId(entry.attemptId)
    && validDigest(entry.acceptanceDigest) && validId(entry.criterionId) && typeof entry.passed === 'boolean'
  if (entry.kind === 'node-verified') return validId(entry.nodeRunId) && validId(entry.attemptId)
    && validDigest(entry.acceptanceDigest) && typeof entry.passed === 'boolean'
  if (entry.kind === 'goal-verdict' || entry.kind === 'workflow-terminal') return isGoalVerdict(entry.verdict) && validDigest(entry.acceptanceDigest)
  if (entry.kind !== 'budget-updated' || !entry.remaining || typeof entry.remaining !== 'object') return false
  const remaining = entry.remaining as Record<string, unknown>
  return ['attempts', 'concurrentNodes', 'wallClockMs'].every((key) => Number.isSafeInteger(remaining[key]) && Number(remaining[key]) >= 0)
}

export function workflowRecordContainsTranscript(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(workflowRecordContainsTranscript)
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    /^(transcript|reasoning|messages|prompt|content|summary)$/i.test(key) || workflowRecordContainsTranscript(child))
}
