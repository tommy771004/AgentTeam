/** Pure Ops projection: scheduler/events, queue, execution capacity, recovery. */
import type { ProactiveEvent, ScheduledJob } from './types.ts'
import type { JournalEntry, RecoveryReport } from './runJournal.ts'
import type { QueueDedupeEvent, QueuedExternalRun } from './runQueue.ts'
import { resolveBusyPolicy, type BusyPolicy, type RunSourceKind } from './taskRunTypes.ts'

export type OpsActiveRun = {
  runId: string
  threadId?: string
  status: string
}

export type OpsSnapshotInput = {
  jobs: ScheduledJob[]
  events: ProactiveEvent[]
  activeRuns: OpsActiveRun[]
  capacity: { active: number; limit: number }
  queuedRuns: QueuedExternalRun[]
  dedupeEvents?: QueueDedupeEvent[]
  journal: JournalEntry[]
  recoveryReports: RecoveryReport[]
  /** `settings.followUpMode` — the other half of the busy-policy decision. */
  followUpMode?: 'steer' | 'queue'
}

/** Why this item is in the queue rather than steering the running task. */
export type OpsQueueReason =
  | 'automation-source'
  | 'follow-up-mode'
  | 'explicit-enqueue'
  | 'capacity'

export type OpsQueueItem = {
  id: string
  objective: string
  sourceKind?: string
  runner?: string
  enqueuedAt: string
  dedupeKey: string
  busyPolicy: BusyPolicy
  reason: OpsQueueReason
  reasonDetail: string
  position: number
}

const REASON_LABELS: Record<OpsQueueReason, string> = {
  'automation-source': '自動化來源一律排隊，不打斷進行中的任務',
  'follow-up-mode': '互動來源，但 followUpMode 設為 queue',
  'explicit-enqueue': '呼叫端明確要求排隊（enqueueWhenBusy／同一 thread 續跑）',
  capacity: '併發額度已滿，等待釋出',
}

/**
 * Explain one queued item using the same decision the coordinator made, so the
 * console answers "why was this queued rather than steered" from the policy
 * rather than from a constant.
 */
function explainQueueItem(
  item: QueuedExternalRun,
  followUpMode: 'steer' | 'queue' | undefined,
  capacityExhausted: boolean,
): { busyPolicy: BusyPolicy; reason: OpsQueueReason; reasonDetail: string } {
  const sourceKind = item.sourceKind as RunSourceKind | undefined
  const busyPolicy = resolveBusyPolicy(sourceKind, followUpMode)
  const reason: OpsQueueReason =
    busyPolicy === 'queue'
      ? sourceKind === 'composer' || sourceKind === 'slash' || sourceKind === 'retry'
        ? 'follow-up-mode'
        : 'automation-source'
      : item.enqueueWhenBusy === true || Boolean(item.reuseThreadId)
        ? 'explicit-enqueue'
        : 'capacity'
  const detail = capacityExhausted && reason !== 'capacity'
    ? `${REASON_LABELS[reason]}；目前併發額度亦已滿`
    : REASON_LABELS[reason]
  return {
    busyPolicy,
    reason,
    reasonDetail: `sourceKind=${sourceKind || '未標示'} · busyPolicy=${busyPolicy} · ${detail}`,
  }
}

export type OpsSnapshot = {
  generatedAt: string
  activeRuns: OpsActiveRun[]
  capacity: { active: number; limit: number; remaining: number }
  queue: OpsQueueItem[]
  deduplicated: QueueDedupeEvent[]
  schedules: ScheduledJob[]
  events: ProactiveEvent[]
  journal: JournalEntry[]
  recoveredRuns: Array<RecoveryReport['items'][number] & { reportId: string; at: string }>
}

export function buildOpsSnapshot(input: OpsSnapshotInput): OpsSnapshot {
  const remaining = Math.max(0, input.capacity.limit - input.capacity.active)
  return {
    generatedAt: new Date().toISOString(),
    activeRuns: input.activeRuns.map((run) => ({ ...run })),
    capacity: {
      active: input.capacity.active,
      limit: input.capacity.limit,
      remaining,
    },
    queue: input.queuedRuns.map((item, index) => ({
      id: item.id,
      objective: item.objective,
      sourceKind: item.sourceKind,
      runner: item.runner,
      enqueuedAt: item.enqueuedAt,
      dedupeKey: item.dedupeKey,
      ...explainQueueItem(item, input.followUpMode, remaining === 0),
      position: index + 1,
    })),
    deduplicated: (input.dedupeEvents || []).map((event) => ({ ...event })),
    schedules: input.jobs.map((job) => ({ ...job })),
    events: input.events.map((event) => ({ ...event })),
    journal: input.journal.map((entry) => ({ ...entry })),
    recoveredRuns: input.recoveryReports.flatMap((report) =>
      report.items
        .filter((item) => item.kind === 'run')
        .map((item) => ({ ...item, reportId: report.id, at: report.at })),
    ),
  }
}
