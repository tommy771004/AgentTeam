import type { LlmSettings } from './types'

/** Small fixed rollout ceiling for the opt-in concurrent-run mode. */
export const DEFAULT_MAX_CONCURRENT_RUNS = 4
export const MIN_MAX_CONCURRENT_RUNS = 2
export const HARD_MAX_CONCURRENT_RUNS = 8

export function concurrentRunsEnabled(settings: Pick<LlmSettings, 'concurrentRunsEnabled'>): boolean {
  return settings.concurrentRunsEnabled === true
}

export function maxConcurrentRuns(settings: Pick<LlmSettings, 'maxConcurrentRuns'>): number {
  const value = Number(settings.maxConcurrentRuns)
  if (!Number.isFinite(value)) return DEFAULT_MAX_CONCURRENT_RUNS
  return Math.max(MIN_MAX_CONCURRENT_RUNS, Math.min(HARD_MAX_CONCURRENT_RUNS, Math.round(value)))
}

export function runCapacity(settings: Pick<LlmSettings, 'concurrentRunsEnabled' | 'maxConcurrentRuns'>, activeCount: number): {
  allowed: boolean
  limit: number
  active: number
} {
  const limit = concurrentRunsEnabled(settings) ? maxConcurrentRuns(settings) : 1
  const active = Math.max(0, Math.floor(Number(activeCount) || 0))
  return { allowed: active < limit, limit, active }
}
