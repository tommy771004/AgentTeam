/**
 * Lightweight FIFO queue for runs that hit the per-app capacity policy.
 * Persists serializable fields to localStorage so restart does not drop once-jobs.
 */

import type {
  EventTriggerSnapshot,
  LoopType,
  RuntimeOverrides,
  ScheduleKind,
} from './types.ts'
import type { ExternalRunOpts, ExternalRunResult } from './taskRunCoordinator.ts'
import type { ThreadRunner } from '../store/threadStore.ts'
import {
  getJournalEntry,
  recordRecoveryNotice,
  recordQueueDispatching,
  recordQueueEnqueued,
  recordQueueTerminal,
} from './runJournal.ts'

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
    | 'approvalMode'
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
    | 'externalCliPolicy'
  >
}

const STORAGE_KEY = 'subagents.runQueue.v1'
const BACKUP_KEY = `${STORAGE_KEY}.backup`
const DEDUPE_KEY = 'subagents.runQueue.dedupe.v1'
const MAX_QUEUE = 24
const MAX_DEDUPE_EVENTS = 80
const queue: QueuedExternalRun[] = []
export type QueueDedupeEvent = {
  at: string
  dedupeKey: string
  objective: string
  sourceKind?: ExternalRunOpts['sourceKind']
  reason: 'duplicate'
}
const dedupeEvents: QueueDedupeEvent[] = []
let draining = false
let hydrated = false
let dedupeHydrated = false

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
          approvalMode: o.approvalMode,
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
          externalCliPolicy: o.externalCliPolicy,
        }
      : undefined,
  }
}

function fromPersisted(p: PersistedQueueItem): QueuedExternalRun {
  const bounded = (value: unknown, max: number): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
  const base: QueuedExternalRun = {
    id: bounded(p.id, 160) || `q_recovered_${Date.now().toString(36)}`,
    enqueuedAt: bounded(p.enqueuedAt, 40) || new Date().toISOString(),
    dedupeKey: bounded(p.dedupeKey, 400) || `recovered:${p.id}`,
    runId: bounded(p.runId, 160),
    sourceKind: p.sourceKind,
    objective: bounded(p.objective, 240) || 'Recovered queued task',
    title: bounded(p.title, 120),
    loopType: p.loopType,
    runner: p.runner,
    eventPreMatched: p.eventPreMatched,
    attachedSkills: p.attachedSkills,
    sourceLabel: bounded(p.sourceLabel, 160),
    unattended: p.unattended ?? true,
    projectRoot: bounded(p.projectRoot, 1_000),
    extraContext: bounded(p.extraContext, 8_000),
    reuseThreadId: bounded(p.reuseThreadId, 160),
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
        const { useScheduleStore } = await import('../store/scheduleStore.ts')
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
    const current = localStorage.getItem(STORAGE_KEY)
    if (current) localStorage.setItem(BACKUP_KEY, current)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* quota / SSR */
  }
}

function persistDedupeEvents() {
  try {
    localStorage.setItem(DEDUPE_KEY, JSON.stringify(dedupeEvents.slice(-MAX_DEDUPE_EVENTS)))
  } catch {
    /* optional storage */
  }
}

function hydrateDedupeEvents() {
  if (dedupeHydrated) return
  dedupeHydrated = true
  try {
    const raw = localStorage.getItem(DEDUPE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return
    dedupeEvents.push(
      ...parsed.filter((item): item is QueueDedupeEvent => Boolean(
        item && typeof item === 'object' && typeof item.dedupeKey === 'string' &&
        typeof item.objective === 'string' && item.reason === 'duplicate',
      )).slice(-MAX_DEDUPE_EVENTS),
    )
  } catch {
    /* optional storage */
  }
}

function recordDedupeEvent(opts: ExternalRunOpts, key: string) {
  hydrateDedupeEvents()
  dedupeEvents.push({
    at: new Date().toISOString(),
    dedupeKey: key,
    objective: opts.objective.slice(0, 240),
    sourceKind: opts.sourceKind,
    reason: 'duplicate',
  })
  while (dedupeEvents.length > MAX_DEDUPE_EVENTS) dedupeEvents.shift()
  persistDedupeEvents()
}

/**
 * Load queue from localStorage once. Safe to call multiple times.
 * Returns number of items restored.
 */
export function hydrateRunQueue(): number {
  hydrateDedupeEvents()
  if (hydrated) return queue.length
  hydrated = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return 0
    let data: { items: PersistedQueueItem[] }
    try {
      data = parsePersistedQueue(raw)
    } catch {
      const backupRaw = localStorage.getItem(BACKUP_KEY)
      try {
        data = parsePersistedQueue(backupRaw)
        localStorage.setItem(STORAGE_KEY, backupRaw!)
        recordRecoveryNotice({
          kind: 'storage',
          id: STORAGE_KEY,
          action: 'restored',
          detail: '待跑佇列已從最後一份有效備份復原。',
        })
      } catch {
        localStorage.setItem(`${STORAGE_KEY}.corrupt.${Date.now()}`, raw.slice(0, 1_000_000))
        localStorage.removeItem(STORAGE_KEY)
        recordRecoveryNotice({
          kind: 'storage',
          id: STORAGE_KEY,
          action: 'quarantined',
          detail: '待跑佇列損壞，已隔離損壞副本並停止自動重跑。',
        })
        return 0
      }
    }
    for (const p of data.items) {
      if (queue.some((q) => q.id === p.id || q.dedupeKey === p.dedupeKey)) continue
      const marker = getJournalEntry('queue', p.id)
      // A dispatch marker means the item was removed from the in-memory queue
      // before termination. Replaying it would duplicate an uncertain side
      // effect, so discard the stale persisted copy and surface the decision.
      if (marker && marker.status !== 'queued') {
        recordRecoveryNotice({
          kind: 'queue',
          id: p.id,
          previousStatus: marker.status,
          action: marker.status === 'interrupted' ? 'marked-interrupted' : 'resume-once',
          detail: '佇列項目已有 dispatch/終態 marker，啟動時不重複補跑。',
        })
        continue
      }
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

export function listQueueDedupeEvents(): QueueDedupeEvent[] {
  hydrateDedupeEvents()
  return dedupeEvents.map((event) => ({ ...event }))
}

export function queueLength(): number {
  return queue.length
}

export function isRunQueueDraining(): boolean {
  return draining
}

/** Test seam for simulating a fresh renderer without leaking queue state. */
export function resetRunQueueForTests(): void {
  queue.splice(0)
  draining = false
  hydrated = false
  dedupeEvents.splice(0)
  dedupeHydrated = false
}

function parsePersistedQueue(raw: string | null): { items: PersistedQueueItem[] } {
  if (!raw || raw.length > 1_000_000) throw new Error('queue payload too large')
  const data = JSON.parse(raw) as { v?: unknown; items?: unknown }
  if (data.v !== 1 || !Array.isArray(data.items) || data.items.length > MAX_QUEUE * 4) {
    throw new Error('queue payload schema invalid')
  }
  for (const item of data.items) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as PersistedQueueItem).id !== 'string' ||
      typeof (item as PersistedQueueItem).objective !== 'string' ||
      typeof (item as PersistedQueueItem).dedupeKey !== 'string' ||
      typeof (item as PersistedQueueItem).enqueuedAt !== 'string'
    ) {
      throw new Error('queue item schema invalid')
    }
  }
  return { items: data.items as PersistedQueueItem[] }
}

/**
 * Complete a queued run that will never be admitted.
 *
 * Queue mutations stay synchronous for UI callers, while settlement is safely
 * detached so both synchronous throws and rejected callbacks remain non-fatal.
 */
function settleQueuedCancellation(item: QueuedExternalRun, error: string): void {
  const onSettled = item.onSettled
  if (!onSettled) return
  const result: ExternalRunResult = {
    path: 'builtin',
    status: 'skipped',
    error,
    threadId: null,
    runId: item.runId,
    skipped: true,
    skipReason: 'cancelled',
  }
  try {
    void Promise.resolve(onSettled(result)).catch(() => undefined)
  } catch {
    /* settlement notification is non-fatal */
  }
}

/** Drop all pending items (does not abort in-flight run). */
export function clearRunQueue(): number {
  const removed = queue.splice(0)
  emit()
  for (const item of removed) {
    recordQueueTerminal({ queueId: item.id, status: 'cancelled' })
    settleQueuedCancellation(item, '使用者清除佇列')
  }
  return removed.length
}

/** Remove one pending item by id. Returns true if removed. */
export function removeQueuedRun(id: string): boolean {
  const idx = queue.findIndex((q) => q.id === id)
  if (idx < 0) return false
  const [removed] = queue.splice(idx, 1)
  emit()
  recordQueueTerminal({ queueId: removed.id, status: 'cancelled' })
  settleQueuedCancellation(removed, '使用者取消佇列項目')
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
    recordDedupeEvent(opts, key)
    return null
  }
  const item: QueuedExternalRun = {
    ...opts,
    id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    enqueuedAt: new Date().toISOString(),
    dedupeKey: key,
  }
  recordQueueEnqueued({
    queueId: item.id,
    runId: item.runId,
    objective: item.objective,
    sourceKind: item.sourceKind,
  })
  queue.push(item)
  while (queue.length > MAX_QUEUE) {
    const dropped = queue.shift()
    // P0: never silent-drop schedule jobs — settle as cancelled
    if (dropped) {
      recordQueueTerminal({ queueId: dropped.id, status: 'cancelled' })
      settleQueuedCancellation(dropped, '佇列已滿，最舊項目被丟棄')
    }
  }
  emit()
  return item
}

async function availableDrainSlots(): Promise<number> {
  try {
    const { useAgentStore } = await import('../store/agentStore.ts')
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
        recordQueueDispatching({ queueId: next.id, runId: next.runId })
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
        for (const item of busyItems) {
          recordQueueEnqueued({
            queueId: item.id,
            runId: item.runId,
            objective: item.objective,
            sourceKind: item.sourceKind,
          })
        }
        emit()
        break
      }
      for (const [index, entry] of batch.entries()) {
        recordQueueTerminal({ queueId: entry.item.id, status: results[index]?.status || 'failed' })
      }
    }
  } finally {
    draining = false
    emit()
  }
}
