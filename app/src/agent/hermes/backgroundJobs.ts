/**
 * Compatibility projection for pre-cutover renderer background jobs.
 *
 * New work is never admitted here. Pi Host owns child queues, durable
 * mailboxes, completion, and recovery; this module only keeps old UI imports
 * fail-closed while the Host Agent Work Tree replaces them.
 */

import type { LlmSettings } from '../types.ts'
import type { DelegateTaskInput } from './delegate.ts'

export type BackgroundJobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

export interface BackgroundJob {
  id: string
  goal: string
  status: BackgroundJobStatus
  notifyOnComplete: boolean
  summary?: string
  ok?: boolean
  startedAt: string
  finishedAt?: string
  durationMs?: number
  tokensUsed?: number
  depth?: number
  error?: string
  parentThreadId?: string
  archiveRunId?: string
}

type JobListener = (job: BackgroundJob) => void
const jobs = new Map<string, BackgroundJob>()
const listeners = new Set<JobListener>()

export function subscribeBackgroundJobs(listener: JobListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** @deprecated Use Pi Host agents/spawn. This compatibility port never starts work. */
export function enqueueBackgroundDelegate(
  _settings: LlmSettings,
  input: DelegateTaskInput & { notifyOnComplete?: boolean },
): BackgroundJob {
  const now = new Date().toISOString()
  const job: BackgroundJob = {
    id: `host-only-${Date.now().toString(36)}`,
    goal: input.goal,
    status: 'failed',
    notifyOnComplete: input.notifyOnComplete !== false,
    startedAt: now,
    finishedAt: now,
    ok: false,
    error: 'Renderer background delegation 已凍結；請使用 Pi Host Agent Work Tree。',
    summary: 'Renderer background delegation 已凍結；請使用 Pi Host Agent Work Tree。',
    durationMs: 0,
    tokensUsed: 0,
    depth: 0,
    parentThreadId: input.parentThreadId,
  }
  jobs.set(job.id, job)
  for (const listener of listeners) listener({ ...job })
  return { ...job }
}

export async function waitBackgroundJobs(
  ids: string[],
  mode: 'wait_any' | 'wait_all' = 'wait_all',
  timeoutMs = 30_000,
): Promise<{ timedOut: boolean; jobs: BackgroundJob[] }> {
  const wanted = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 20)
  const snapshot = () => wanted.map((id) => jobs.get(id)).filter((job): job is BackgroundJob => Boolean(job)).map((job) => ({ ...job }))
  const terminal = (job?: BackgroundJob) => Boolean(job && ['success', 'failed', 'cancelled'].includes(job.status))
  const done = () => mode === 'wait_any' ? wanted.some((id) => terminal(jobs.get(id))) : wanted.every((id) => terminal(jobs.get(id)))
  if (done()) return { timedOut: false, jobs: snapshot() }
  return new Promise((resolve) => {
    let settled = false
    const finish = (timedOut: boolean) => {
      if (settled) return
      settled = true
      unsubscribe()
      clearTimeout(timer)
      resolve({ timedOut, jobs: snapshot() })
    }
    const unsubscribe = subscribeBackgroundJobs(() => { if (done()) finish(false) })
    const timer = setTimeout(() => finish(true), Math.max(1_000, Math.min(timeoutMs, 120_000)))
  })
}

export function listBackgroundJobs(): BackgroundJob[] {
  return [...jobs.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt)).map((job) => ({ ...job }))
}

export function getBackgroundJob(id: string): BackgroundJob | undefined {
  const job = jobs.get(id)
  return job ? { ...job } : undefined
}

export function clearFinishedBackgroundJobs(): number {
  let removed = 0
  for (const [id, job] of jobs) {
    if (!['success', 'failed', 'cancelled'].includes(job.status)) continue
    jobs.delete(id)
    removed += 1
  }
  return removed
}
