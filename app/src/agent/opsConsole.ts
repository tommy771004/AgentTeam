/** Pure Ops projection: scheduler/events, queue, execution capacity, recovery. */
import type { ProactiveEvent, ScheduledJob } from './types.ts'
import type { JournalEntry, RecoveryReport } from './runJournal.ts'
import type { QueueDedupeEvent, QueuedExternalRun } from './runQueue.ts'

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
}

export type OpsQueueItem = {
  id: string
  objective: string
  sourceKind?: string
  runner?: string
  enqueuedAt: string
  dedupeKey: string
  reason: 'capacity'
  position: number
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
  return {
    generatedAt: new Date().toISOString(),
    activeRuns: input.activeRuns.map((run) => ({ ...run })),
    capacity: {
      active: input.capacity.active,
      limit: input.capacity.limit,
      remaining: Math.max(0, input.capacity.limit - input.capacity.active),
    },
    queue: input.queuedRuns.map((item, index) => ({
      id: item.id,
      objective: item.objective,
      sourceKind: item.sourceKind,
      runner: item.runner,
      enqueuedAt: item.enqueuedAt,
      dedupeKey: item.dedupeKey,
      reason: 'capacity',
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
