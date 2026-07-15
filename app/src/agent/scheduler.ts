/**
 * Schedule helpers for Time-based pattern jobs.
 */

import type {
  ScheduledJob,
  ScheduleKind,
  ScheduleTriggerSnapshot,
} from './types'

export type ScheduleTriggerValidation =
  | { ok: true; snapshot: ScheduleTriggerSnapshot }
  | { ok: false; reason: string }

/**
 * Mint a trigger snapshot only from the value returned by claimDueJobs().
 * An unclaimed job has no lastRunAt and will fail validation at the lifecycle
 * boundary instead of becoming an executable Time-based run.
 */
export function createScheduleTriggerSnapshot(
  job: ScheduledJob,
): ScheduleTriggerSnapshot {
  return {
    source: 'schedule',
    jobId: job.id.trim(),
    scheduleKind: job.kind,
    triggeredAt: job.lastRunAt || '',
  }
}

/** Validate the small serializable proof carried into the Task run coordinator / queue. */
export function validateScheduleTriggerSnapshot(
  input: unknown,
  now = new Date(),
): ScheduleTriggerValidation {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: '缺少 schedule trigger snapshot' }
  }
  const candidate = input as Partial<ScheduleTriggerSnapshot>
  if (candidate.source !== 'schedule') {
    return { ok: false, reason: 'trigger source 必須是 schedule' }
  }
  if (typeof candidate.jobId !== 'string' || !candidate.jobId.trim()) {
    return { ok: false, reason: '缺少 ScheduledJob id' }
  }
  if (
    candidate.scheduleKind !== 'interval' &&
    candidate.scheduleKind !== 'daily' &&
    candidate.scheduleKind !== 'once'
  ) {
    return { ok: false, reason: '無效的 ScheduledJob kind' }
  }
  if (typeof candidate.triggeredAt !== 'string' || !candidate.triggeredAt.trim()) {
    return { ok: false, reason: '缺少 schedule trigger time' }
  }
  const triggeredAt = new Date(candidate.triggeredAt)
  if (Number.isNaN(triggeredAt.getTime())) {
    return { ok: false, reason: 'schedule trigger time 不是有效 ISO 時間' }
  }
  // A claimed job is stamped at claim time. Permit a small clock/rendering
  // skew, but reject forged future triggers before any capacity is reserved.
  if (triggeredAt.getTime() > now.getTime() + 5 * 60_000) {
    return { ok: false, reason: 'schedule trigger time 不可在未來' }
  }
  return {
    ok: true,
    snapshot: {
      source: 'schedule',
      jobId: candidate.jobId.trim(),
      scheduleKind: candidate.scheduleKind,
      triggeredAt: triggeredAt.toISOString(),
    },
  }
}

/**
 * Verify that the snapshot still points at the claimed ScheduledJob state.
 * This allows queued/restarted jobs to resume while rejecting a fabricated
 * job id or a trigger that was never advanced by claimDueJobs().
 */
export function isClaimedScheduleTrigger(
  job: ScheduledJob | undefined,
  snapshot: ScheduleTriggerSnapshot,
): boolean {
  if (!job) return false
  if (
    job.id.trim() !== snapshot.jobId ||
    job.kind !== snapshot.scheduleKind ||
    job.lastRunAt !== snapshot.triggeredAt ||
    job.lastStatus !== 'running'
  ) {
    return false
  }
  const triggerMs = Date.parse(snapshot.triggeredAt)
  if (Number.isNaN(triggerMs)) return false
  const nextMs = job.nextRunAt ? Date.parse(job.nextRunAt) : null
  if (job.kind === 'once') return job.enabled === false && nextMs === null
  return nextMs != null && !Number.isNaN(nextMs) && nextMs > triggerMs
}

export function computeNextRun(
  kind: ScheduleKind,
  opts: { intervalMinutes?: number; dailyAt?: string; runAt?: string; from?: Date },
): string | null {
  const from = opts.from || new Date()

  if (kind === 'interval') {
    const mins = Math.max(1, opts.intervalMinutes || 60)
    // Anti-pattern from specs: avoid < 10 min unless strictly specified — we allow but warn in UI
    return new Date(from.getTime() + mins * 60_000).toISOString()
  }

  if (kind === 'daily') {
    const [hh, mm] = (opts.dailyAt || '08:00').split(':').map((n) => Number(n))
    const next = new Date(from)
    next.setSeconds(0, 0)
    next.setHours(hh || 8, mm || 0, 0, 0)
    if (next.getTime() <= from.getTime()) {
      next.setDate(next.getDate() + 1)
    }
    return next.toISOString()
  }

  if (kind === 'once') {
    if (!opts.runAt) return null
    const t = new Date(opts.runAt)
    if (Number.isNaN(t.getTime())) return null
    return t.getTime() <= from.getTime() ? null : t.toISOString()
  }

  return null
}

export function jobIsDue(job: ScheduledJob, now = new Date()): boolean {
  if (!job.enabled) return false
  if (!job.nextRunAt) return false
  return new Date(job.nextRunAt).getTime() <= now.getTime()
}

export function advanceJobAfterRun(job: ScheduledJob, now = new Date()): ScheduledJob {
  const nextRunAt =
    job.kind === 'once'
      ? null
      : computeNextRun(job.kind, {
          intervalMinutes: job.intervalMinutes,
          dailyAt: job.dailyAt,
          runAt: job.runAt,
          from: now,
        })

  return {
    ...job,
    lastRunAt: now.toISOString(),
    nextRunAt,
    enabled: job.kind === 'once' ? false : job.enabled,
    lastStatus: 'running',
  }
}

export function createJob(input: {
  name: string
  objective: string
  loopType?: ScheduledJob['loopType']
  kind: ScheduleKind
  intervalMinutes?: number
  dailyAt?: string
  runAt?: string
  skillNames?: string[]
  runner?: ScheduledJob['runner']
  projectRoot?: string
}): ScheduledJob {
  const now = new Date()
  const id = `job_${Math.random().toString(36).slice(2, 10)}`
  const nextRunAt = computeNextRun(input.kind, {
    intervalMinutes: input.intervalMinutes,
    dailyAt: input.dailyAt,
    runAt: input.runAt,
    from: now,
  })

  return {
    id,
    name: input.name,
    objective: input.objective,
    loopType: input.loopType || 'Time-based',
    enabled: true,
    kind: input.kind,
    intervalMinutes: input.intervalMinutes,
    dailyAt: input.dailyAt,
    runAt: input.runAt,
    skillNames: input.skillNames?.filter(Boolean) || [],
    runner: input.runner && input.runner !== 'builtin' ? input.runner : undefined,
    projectRoot: input.projectRoot?.trim() || undefined,
    lastRunAt: null,
    nextRunAt,
    lastStatus: 'idle',
    createdAt: now.toISOString(),
  }
}

/** Build cron prompt with attached skills (Hermes cron inject skills as context) */
export function buildJobPromptWithSkills(
  objective: string,
  skillBodies: Array<{ name: string; body: string }>,
): string {
  if (!skillBodies.length) return objective
  const block = skillBodies
    .map((s) => `### 掛載技能：${s.name}\n${s.body.slice(0, 2500)}`)
    .join('\n\n')
  return `${objective}\n\n---\n## 本任務掛載的 Skills（必須遵循）\n\n${block}`
}

/** Parse simple natural language schedule hints from objective */
export function parseScheduleFromText(text: string): {
  kind: ScheduleKind
  intervalMinutes?: number
  dailyAt?: string
} | null {
  const lower = text.toLowerCase()
  const daily = lower.match(/(?:every day|daily)\s*(?:at\s*)?(\d{1,2}):(\d{2})/)
  if (daily) {
    const hh = daily[1].padStart(2, '0')
    const mm = daily[2]
    return { kind: 'daily', dailyAt: `${hh}:${mm}` }
  }
  const every = lower.match(/every\s+(\d+)\s*(min|mins|minute|minutes|hour|hours)/)
  if (every) {
    const n = Number(every[1])
    const unit = every[2]
    const intervalMinutes = /hour/.test(unit) ? n * 60 : n
    return { kind: 'interval', intervalMinutes }
  }
  if (/daily|every day/.test(lower)) {
    return { kind: 'daily', dailyAt: '08:00' }
  }
  return null
}
