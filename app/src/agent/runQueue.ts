/**
 * Lightweight FIFO queue for automation runs that hit the global isRunning lock.
 * Persists serializable fields to localStorage so restart does not drop once-jobs.
 */

import type { LoopType, RuntimeOverrides } from './types'
import type { ExternalRunOpts, ExternalRunResult } from './runExternal'
import type { ThreadRunner } from '../store/threadStore'

export type QueuedExternalRun = ExternalRunOpts & {
  id: string
  enqueuedAt: string
  dedupeKey: string
}

/** Serializable shape (no functions) for disk */
export type PersistedQueueItem = {
  id: string
  enqueuedAt: string
  dedupeKey: string
  objective: string
  title?: string
  loopType?: LoopType
  runner?: ThreadRunner
  eventPreMatched?: boolean
  attachedSkills?: string[]
  sourceLabel?: string
  unattended?: boolean
  /** Re-bind markJobResult after hydrate */
  scheduleJobId?: string
  /** Safe subset of overrides only */
  overrides?: Pick<
    RuntimeOverrides,
    | 'eventPreMatched'
    | 'attachedSkills'
    | 'unattended'
    | 'hitlTimeoutMs'
    | 'temporary'
    | 'preloadCapabilityIds'
    | 'preloadUnlockedTools'
    | 'maxIterations'
    | 'maxToolRounds'
  >
}

const STORAGE_KEY = 'subagents.runQueue.v1'
const MAX_QUEUE = 24
const queue: QueuedExternalRun[] = []
let draining = false
let hydrated = false

type QueueListener = () => void
const listeners = new Set<QueueListener>()

function emit() {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
  persist()
}

function dedupeKey(opts: ExternalRunOpts): string {
  return [
    (opts.objective || '').trim().slice(0, 200),
    opts.loopType || '',
    opts.sourceLabel || '',
    (opts.attachedSkills || []).join(','),
    opts.meta?.scheduleJobId || '',
  ].join('|')
}

function toPersisted(item: QueuedExternalRun): PersistedQueueItem {
  const o = item.overrides
  return {
    id: item.id,
    enqueuedAt: item.enqueuedAt,
    dedupeKey: item.dedupeKey,
    objective: item.objective,
    title: item.title,
    loopType: item.loopType,
    runner: item.runner,
    eventPreMatched: item.eventPreMatched,
    attachedSkills: item.attachedSkills,
    sourceLabel: item.sourceLabel,
    unattended: item.unattended,
    scheduleJobId: item.meta?.scheduleJobId,
    overrides: o
      ? {
          eventPreMatched: o.eventPreMatched,
          attachedSkills: o.attachedSkills,
          unattended: o.unattended,
          hitlTimeoutMs: o.hitlTimeoutMs,
          temporary: o.temporary,
          preloadCapabilityIds: o.preloadCapabilityIds,
          preloadUnlockedTools: o.preloadUnlockedTools,
          maxIterations: o.maxIterations,
          maxToolRounds: o.maxToolRounds,
        }
      : undefined,
  }
}

function fromPersisted(p: PersistedQueueItem): QueuedExternalRun {
  const base: QueuedExternalRun = {
    id: p.id,
    enqueuedAt: p.enqueuedAt,
    dedupeKey: p.dedupeKey,
    objective: p.objective,
    title: p.title,
    loopType: p.loopType,
    runner: p.runner,
    eventPreMatched: p.eventPreMatched,
    attachedSkills: p.attachedSkills,
    sourceLabel: p.sourceLabel,
    unattended: p.unattended ?? true,
    overrides: p.overrides,
    meta: p.scheduleJobId ? { scheduleJobId: p.scheduleJobId } : undefined,
  }
  // Re-attach schedule onSettled after hydrate
  if (p.scheduleJobId) {
    const jobId = p.scheduleJobId
    base.onSettled = async (r) => {
      try {
        const { useScheduleStore } = await import('../store/scheduleStore')
        const mark = useScheduleStore.getState().markJobResult
        if (r.skipped) {
          if (r.skipReason === 'cancelled') {
            await mark(jobId, 'skipped')
          }
          return
        }
        await mark(jobId, r.status === 'success' ? 'success' : 'failed')
        void window.subagents?.notify?.(
          'SubAgents AI · 排程',
          `佇列補跑完成 · ${r.status}`,
        )
      } catch {
        /* ignore */
      }
    }
  }
  return base
}

function persist() {
  try {
    const payload = {
      v: 1,
      items: queue.map(toPersisted),
      savedAt: new Date().toISOString(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* quota / SSR */
  }
}

/**
 * Load queue from localStorage once. Safe to call multiple times.
 * Returns number of items restored.
 */
export function hydrateRunQueue(): number {
  if (hydrated) return queue.length
  hydrated = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return 0
    const data = JSON.parse(raw) as { items?: PersistedQueueItem[] }
    if (!Array.isArray(data.items)) return 0
    for (const p of data.items) {
      if (!p?.id || !p.objective) continue
      if (queue.some((q) => q.id === p.id || q.dedupeKey === p.dedupeKey)) continue
      queue.push(fromPersisted(p))
    }
    while (queue.length > MAX_QUEUE) queue.shift()
    emit()
    return queue.length
  } catch {
    return 0
  }
}

/** UI / slash subscribe — fires on enqueue, drain, clear, hydrate */
export function subscribeRunQueue(fn: QueueListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function listQueuedRuns(): QueuedExternalRun[] {
  return [...queue]
}

export function queueLength(): number {
  return queue.length
}

export function isRunQueueDraining(): boolean {
  return draining
}

/** Drop all pending items (does not abort in-flight run). */
export function clearRunQueue(): number {
  const n = queue.length
  queue.length = 0
  emit()
  return n
}

/** Remove one pending item by id. Returns true if removed. */
export function removeQueuedRun(id: string): boolean {
  const idx = queue.findIndex((q) => q.id === id)
  if (idx < 0) return false
  const [removed] = queue.splice(idx, 1)
  emit()
  try {
    void removed.onSettled?.({
      path: 'builtin',
      status: 'skipped',
      error: '使用者取消佇列項目',
      threadId: null,
      skipped: true,
      skipReason: 'cancelled',
    })
  } catch {
    /* ignore */
  }
  return true
}

/**
 * Enqueue if not duplicate. Returns queued item or null if dropped (full / duplicate).
 */
export function enqueueExternalRun(opts: ExternalRunOpts): QueuedExternalRun | null {
  hydrateRunQueue()
  const key = dedupeKey(opts)
  if (queue.some((q) => q.dedupeKey === key)) {
    return null
  }
  const item: QueuedExternalRun = {
    ...opts,
    id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    enqueuedAt: new Date().toISOString(),
    dedupeKey: key,
  }
  queue.push(item)
  while (queue.length > MAX_QUEUE) {
    queue.shift()
  }
  emit()
  return item
}

/**
 * Drain queue one-by-one when idle. Safe to call after every external run finishes.
 */
export async function drainExternalRunQueue(
  runner: (opts: ExternalRunOpts) => Promise<ExternalRunResult>,
): Promise<void> {
  hydrateRunQueue()
  if (draining) return
  draining = true
  emit()
  try {
    while (queue.length) {
      const next = queue.shift()
      emit()
      if (!next) break
      const { id: _id, enqueuedAt: _at, dedupeKey: _k, ...opts } = next
      const r = await runner({
        ...opts,
        sourceLabel: opts.sourceLabel
          ? `${opts.sourceLabel}（佇列補跑）`
          : '佇列補跑',
      })
      if (r.skipped && r.skipReason === 'busy') {
        queue.unshift(next)
        emit()
        break
      }
    }
  } finally {
    draining = false
    emit()
  }
}
