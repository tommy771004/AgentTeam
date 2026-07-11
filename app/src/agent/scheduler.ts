/**
 * Schedule helpers for Time-based pattern jobs.
 */

import type { ScheduledJob, ScheduleKind } from './types'

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
