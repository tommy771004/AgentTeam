import type { ExternalRunResult, RunSourceKind } from './taskRunTypes.ts'

export type InitialTaskRunAdmissionDecision =
  | { kind: 'proceed' }
  | { kind: 'empty-objective' }
  | { kind: 'queued-duplicate'; queueId: string }
  | { kind: 'delegate-disabled' }
  | { kind: 'active-duplicate' }

export function decideInitialTaskRunAdmission(input: {
  objective: string
  runId: string
  hasExplicitRunId: boolean
  reuseThreadId?: string
  sourceKind?: RunSourceKind
  fromQueue: boolean
  queuedDuplicateId?: string
  delegateEnabled: boolean
  activeRunIds: readonly string[]
}): InitialTaskRunAdmissionDecision {
  if (!input.objective) return { kind: 'empty-objective' }
  if (input.queuedDuplicateId && !input.fromQueue) {
    return { kind: 'queued-duplicate', queueId: input.queuedDuplicateId }
  }
  if (input.sourceKind === 'delegate' && !input.delegateEnabled) {
    return { kind: 'delegate-disabled' }
  }
  if (input.hasExplicitRunId && input.activeRunIds.includes(input.runId)) {
    return { kind: 'active-duplicate' }
  }
  return { kind: 'proceed' }
}

export function initialTaskRunAdmissionResult(
  decision: Exclude<InitialTaskRunAdmissionDecision, { kind: 'proceed' }>,
  input: { runId: string; originalRunId?: string; reuseThreadId?: string },
): ExternalRunResult {
  if (decision.kind === 'empty-objective') {
    return { path: 'builtin', status: 'failed', error: 'empty objective', threadId: null }
  }
  if (decision.kind === 'delegate-disabled') {
    return {
      path: 'builtin',
      status: 'failed',
      error: 'Sub Agent 功能目前已關閉，委派未啟動。',
      threadId: null,
      runId: input.originalRunId,
    }
  }
  return {
    path: 'builtin',
    status: 'skipped',
    error: `runId ${input.runId} ${decision.kind === 'queued-duplicate' ? '已在佇列中' : '已在執行中'}，略過重入。`,
    threadId: input.reuseThreadId || null,
    runId: input.runId,
    skipped: true,
    skipReason: 'duplicate',
    ...(decision.kind === 'queued-duplicate'
      ? { queued: true, queueId: decision.queueId }
      : {}),
  }
}

export type ExternalQueueSnapshotDecision =
  | { kind: 'proceed' }
  | { kind: 'missing-connector-snapshot' }

export function decideExternalQueueSnapshotAdmission(input: {
  runner?: string
  fromQueue: boolean
  hasConnectorSnapshot: boolean
}): ExternalQueueSnapshotDecision {
  return input.runner && input.runner !== 'builtin' && input.fromQueue && !input.hasConnectorSnapshot
    ? { kind: 'missing-connector-snapshot' }
    : { kind: 'proceed' }
}

export type AdmissionBusyPolicy = 'steer' | 'queue' | 'reject'

export function decideBusyPolicy(input: {
  followUpAction?: 'queue' | 'takeover' | 'steer'
  sourceKind?: RunSourceKind
  resolvedSourcePolicy?: AdmissionBusyPolicy
  shouldEnqueue: boolean
}): AdmissionBusyPolicy {
  if (input.followUpAction === 'queue') return 'queue'
  if (input.followUpAction === 'takeover') return 'steer'
  if (input.sourceKind && input.resolvedSourcePolicy) return input.resolvedSourcePolicy
  return input.shouldEnqueue ? 'queue' : 'reject'
}
