/**
 * Lightweight FIFO queue for runs that hit the per-app capacity policy.
 * Persists serializable fields to localStorage so restart does not drop once-jobs.
 */

import type {
  EventTriggerSnapshot,
  LoopType,
  RuntimeOverrides,
  ScheduleKind,
} from './types'
import type { ExternalRunOpts, ExternalRunResult } from './taskRunCoordinator'
import type { ThreadRunner } from '../store/threadStore'

export type QueuedExternalRun = ExternalRunOpts & {
  id: string
  enqueuedAt: string
  dedupeKey: string
}

/** Serializable attachment (prefer filePath; no huge dataUrls) */
type PersistedAttachment = {
  id: string
  kind: 'image' | 'text' | 'binary'
  name: string
  mimeType: string
  size: number
  filePath?: string
  textContent?: string
}

/** Serializable shape (no functions) for disk */
export type PersistedQueueItem = {
  id: string
  enqueuedAt: string
  dedupeKey: string
  /** runTask trace id — survives restart so archive lineage holds */
  runId?: string
  sourceKind?: ExternalRunOpts['sourceKind']
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
  /** Canonical claim time carried through queue/restart. */
  scheduleTriggeredAt?: string
  scheduleKind?: ScheduleKind
  /** Canonical Proactive matcher evidence carried through queue/restart. */
  eventTrigger?: EventTriggerSnapshot
  projectRoot?: string
  extraContext?: string
  reuseThreadId?: string
  skipUserBubble?: boolean
  enqueueWhenBusy?: boolean
  attachments?: PersistedAttachment[]
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
    | 'projectRoot'
    | 'extraSystemContext'
    | 'eventTrigger'
    | 'triggerSource'
    | 'classificationReason'
    | 'nextState'
    | 'webhookTarget'
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
  if (opts.runId) return `runId:${opts.runId}`
  return [
    (opts.objective || '').trim().slice(0, 200),
    opts.loopType || '',
    opts.sourceLabel || '',
    (opts.attachedSkills || []).join(','),
    opts.meta?.scheduleJobId || '',
    opts.meta?.scheduleTriggeredAt || '',
    opts.meta?.eventTrigger?.eventId || '',
    opts.meta?.eventTrigger?.matchedAt || '',
    opts.overrides?.nextState || '',
    opts.overrides?.webhookTarget || '',
    opts.overrides?.triggerSource || '',
    opts.overrides?.classificationReason || '',
    opts.reuseThreadId || '',
  ].join('|')
}

function persistAttachments(
  atts: ExternalRunOpts['attachments'],
): PersistedAttachment[] | undefined {
  if (!atts?.length) return undefined
  return atts.map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
    filePath: a.filePath,
    // keep short text only
    textContent: a.textContent?.slice(0, 4000),
  }))
}

function toPersisted(item: QueuedExternalRun): PersistedQueueItem {
  const o = item.overrides
  return {
    id: item.id,
    enqueuedAt: item.enqueuedAt,
    dedupeKey: item.dedupeKey,
    runId: item.runId,
    sourceKind: item.sourceKind,
    objective: item.objective,
    title: item.title,
    loopType: item.loopType,
    runner: item.runner,
    eventPreMatched: item.eventPreMatched,
    attachedSkills: item.attachedSkills,
    sourceLabel: item.sourceLabel,
    unattended: item.unattended,
    scheduleJobId: item.meta?.scheduleJobId,
    scheduleTriggeredAt: item.meta?.scheduleTriggeredAt,
    scheduleKind: item.meta?.scheduleKind,
    eventTrigger: item.meta?.eventTrigger,
    projectRoot: item.projectRoot,
    extraContext: item.extraContext?.slice(0, 8000),
    reuseThreadId: item.reuseThreadId,
    skipUserBubble: item.skipUserBubble,
    enqueueWhenBusy: item.enqueueWhenBusy,
    attachments: persistAttachments(item.attachments),
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
          projectRoot: o.projectRoot,
          extraSystemContext: o.extraSystemContext?.slice(0, 8000),
          eventTrigger: o.eventTrigger,
          triggerSource: o.triggerSource,
          classificationReason: o.classificationReason,
          nextState: o.nextState,
          webhookTarget: o.webhookTarget,
        }
      : undefined,
  }
}

function fromPersisted(p: PersistedQueueItem): QueuedExternalRun {
  const base: QueuedExternalRun = {
    id: p.id,
    enqueuedAt: p.enqueuedAt,
    dedupeKey: p.dedupeKey,
    runId: p.runId,
    sourceKind: p.sourceKind,
    objective: p.objective,
    title: p.title,
    loopType: p.loopType,
    runner: p.runner,
    eventPreMatched: p.eventPreMatched,
    attachedSkills: p.attachedSkills,
    sourceLabel: p.sourceLabel,
    unattended: p.unattended ?? true,
    projectRoot: p.projectRoot,
    extraContext: p.extraContext,
    reuseThreadId: p.reuseThreadId,
    skipUserBubble: p.skipUserBubble,
    enqueueWhenBusy: p.enqueueWhenBusy,
    attachments: p.attachments,
    overrides: p.overrides,
    meta:
      p.scheduleJobId || p.scheduleTriggeredAt || p.scheduleKind || p.eventTrigger
        ? {
            scheduleJobId: p.scheduleJobId,
            scheduleTriggeredAt: p.scheduleTriggeredAt,
            scheduleKind: p.scheduleKind,
            eventTrigger: p.eventTrigger,
          }
        : undefined,
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

/** Move item up/down by one slot (priority). dir -1 = earlier, +1 = later */
export function moveQueuedRun(id: string, dir: -1 | 1): boolean {
  hydrateRunQueue()
  const idx = queue.findIndex((q) => q.id === id)
  if (idx < 0) return false
  const j = idx + dir
  if (j < 0 || j >= queue.length) return false
  const next = [...queue]
  const [item] = next.splice(idx, 1)
  next.splice(j, 0, item)
  queue.length = 0
  queue.push(...next)
  emit()
  return true
}

/** Jump item to front of the queue (highest priority) */
export function promoteQueuedRun(id: string): boolean {
  hydrateRunQueue()
  const idx = queue.findIndex((q) => q.id === id)
  if (idx <= 0) return false
  const [item] = queue.splice(idx, 1)
  queue.unshift(item)
  emit()
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
    const dropped = queue.shift()
    // P0: never silent-drop schedule jobs — settle as cancelled
    if (dropped) {
      try {
        void dropped.onSettled?.({
          path: 'builtin',
          status: 'skipped',
          error: '佇列已滿，最舊項目被丟棄',
          threadId: null,
          skipped: true,
          skipReason: 'cancelled',
          runId: dropped.runId,
        })
      } catch {
        /* ignore */
      }
    }
  }
  emit()
  return item
}

async function availableDrainSlots(): Promise<number> {
  try {
    const { useAgentStore } = await import('../store/agentStore')
    const capacity = useAgentStore.getState().canStartRun()
    return capacity.allowed ? Math.max(1, capacity.limit - capacity.active) : 0
  } catch {
    // Keep the legacy one-at-a-time fallback if the store is not ready yet.
    return 1
  }
}

/**
 * Drain queued work into every currently available run slot. Safe to call
 * after every external run finishes; the guard prevents nested drains from
 * starting the same queue item twice.
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
      const slots = await availableDrainSlots()
      if (slots <= 0) break

      const batch: Array<{
        item: QueuedExternalRun
        promise: Promise<ExternalRunResult>
      }> = []
      for (let i = 0; i < slots && queue.length; i += 1) {
        const next = queue.shift()
        if (!next) break
        emit()
        const { id: _id, enqueuedAt: _at, dedupeKey: _k, ...opts } = next
        batch.push({
          item: next,
          promise: runner({
            ...opts,
            sourceLabel: opts.sourceLabel
              ? `${opts.sourceLabel}（佇列補跑）`
              : '佇列補跑',
          }),
        })
      }
      if (!batch.length) break

      const results = await Promise.all(batch.map((entry) => entry.promise))
      const busyItems = batch
        .filter((_entry, index) => {
          const result = results[index]
          return result.skipped && result.skipReason === 'busy'
        })
        .map((entry) => entry.item)
      if (busyItems.length) {
        queue.unshift(...busyItems.reverse())
        emit()
        break
      }
    }
  } finally {
    draining = false
    emit()
  }
}
