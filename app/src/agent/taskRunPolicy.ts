/**
 * Task-run admission policy and trigger validation.
 *
 * These decisions belong beside the coordinator. Types live in taskRunTypes
 * (neutral leaf) so this module never reaches backward into a legacy shell.
 */

import type {
  AgentState,
  EventTriggerSnapshot,
  LoopType,
  ScheduleTriggerSnapshot,
} from './types.ts'
import {
  formatAutomationSuggestion,
  type AutomationSuggestion,
} from './automationSuggestion.ts'
import { validateEventTriggerSnapshot } from './eventMatcher.ts'
import { MAX_RUN_QUEUE } from './runQueue.ts'
import {
  isClaimedScheduleTrigger,
  validateScheduleTriggerSnapshot,
} from './scheduler.ts'
import { useThreadStore } from '../store/threadStore.ts'
import type {
  ExternalRunOpts,
  ExternalRunResult,
  RunSourceKind,
} from './taskRunTypes.ts'

export { resolveBusyPolicy, type BusyPolicy } from './taskRunTypes.ts'

/**
 * What an abort-and-replace takeover actually achieved. A safe park stops at the next tool boundary,
 * so "the previous run was told to stop" and "the new goal is running" are two
 * different facts and the thread must not conflate them.
 */
export type TakeoverOutcome =
  /** Capacity came free inside the wait window; the new goal is running. */
  | 'took-over'
  /** The previous run was aborted but had not let go; the new goal is queued. */
  | 'queued'
  /** The previous run was aborted, but the queue refused the new goal. */
  | 'aborted-not-queued'
  /** Nothing abortable was behind the busy signal; the new goal did not start. */
  | 'not-abortable'

export type TakeoverNoticeInput = {
  outcome: TakeoverOutcome
  runningTitle?: string
  partial?: string
  /** 1-based queue position; only meaningful for `queued`. */
  queuePosition?: number
  /** Total items in the queue after this one was added. */
  queueTotal?: number
}

/**
 * The one sentence that says what a takeover did. Both the thread bubble and the
 * admission result's `error` are built from it, so the two can never drift
 * into claiming different things about the same steer.
 */
export function takeoverOutcomeSummary(input: TakeoverNoticeInput): string {
  const title = input.runningTitle ? `（${input.runningTitle.slice(0, 32)}）` : ''
  switch (input.outcome) {
    case 'took-over':
      return `中止並接手：已中止前一個任務${title}，新目標已接手`
    case 'queued':
      return `中止並接手：已中止前一個任務${title}，但容量尚未釋出 — 新目標已排入佇列第 ${input.queuePosition || 1} 位（${input.queueTotal || 1}/${MAX_RUN_QUEUE}）`
    case 'aborted-not-queued':
      return `中止並接手：已中止前一個任務${title}，但佇列已滿或重複 — 新目標未啟動，請稍後重送`
    case 'not-abortable':
      return `中止並接手：無法中止前一個任務${title}，新目標未啟動`
  }
}

/**
 * The thread bubble: the summary above, plus what the stopped run had already
 * achieved. That digest rides along in every branch — the partial progress is
 * the cost of steering, and the user is owed it whichever way the steer landed.
 */
export function formatTakeoverNotice(input: TakeoverNoticeInput): string {
  const headline = takeoverOutcomeSummary(input)
  const partial = input.partial?.trim()
  return partial ? `${headline}\n\n### 中止前摘要\n${partial}` : headline
}

/** Compact partial result when takeover stops a running task. */
export function buildTakeoverPartialDigest(agent: AgentState): string {
  const bits: string[] = []
  if (agent.objective) bits.push(`目標：${agent.objective.slice(0, 120)}`)
  if (agent.loopConfig?.loopType) bits.push(`Loop：${agent.loopConfig.loopType}`)
  if (agent.progress) bits.push(`進度：${Math.round(agent.progress)}%`)
  const done = (agent.steps || []).filter((s) => s.status === 'COMPLETED')
  if (done.length) {
    bits.push(
      `已完成步驟：${done
        .slice(-3)
        .map((s) => s.description)
        .join(' · ')
        .slice(0, 200)}`,
    )
  }
  const tools = (agent.toolCalls || []).slice(-4)
  if (tools.length) {
    bits.push(
      `近期工具：${tools.map((t) => `${t.ok ? '✓' : '✗'}${t.tool}`).join(', ')}`,
    )
  }
  if (agent.result?.trim()) {
    bits.push(`部分產出：${agent.result.trim().slice(0, 400)}`)
  } else {
    const stepTail = done
      .map((s) => s.result)
      .filter(Boolean)
      .slice(-1)[0]
    if (stepTail) bits.push(`部分產出：${String(stepTail).slice(0, 400)}`)
  }
  return bits.join('\n').slice(0, 1200)
}

const AUTOMATION_KINDS: ReadonlySet<RunSourceKind> = new Set([
  'schedule',
  'webhook',
  'telegram',
  'event',
  'delegate',
  'headless',
  'queue-drain',
])

export function isAutomationSource(opts: ExternalRunOpts): boolean {
  if (opts.sourceKind) return AUTOMATION_KINDS.has(opts.sourceKind)
  return (
    opts.unattended === true ||
    Boolean(
      opts.sourceLabel &&
        /排程|定時|webhook|telegram|事件|scheduler|cron|gateway|TG\b|佇列|對話追問/i.test(
          opts.sourceLabel,
        ),
    )
  )
}

export function shouldEnqueueWhenBusy(opts: ExternalRunOpts): boolean {
  return (
    isAutomationSource(opts) ||
    opts.enqueueWhenBusy === true ||
    Boolean(opts.reuseThreadId)
  )
}

export function explicitLoopTypeForConversation(opts: ExternalRunOpts): LoopType | undefined {
  if (opts.loopType) return opts.loopType
  if (opts.overrides?.loopTypeMode === 'force') {
    return opts.overrides.forceLoopType
  }
  if (opts.reuseThreadId) {
    return useThreadStore
      .getState()
      .threads.find((thread) => thread.id === opts.reuseThreadId)?.loopType || undefined
  }
  return undefined
}

export function isInteractiveConversationSource(opts: ExternalRunOpts): boolean {
  return (
    opts.sourceKind === 'composer' ||
    opts.sourceKind === 'slash' ||
    opts.sourceKind === 'review'
  )
}

export type ScheduleTriggerResolution =
  | { snapshot: ScheduleTriggerSnapshot }
  | { error: string }
  | null

export type ProactiveTriggerResolution =
  | { snapshot: EventTriggerSnapshot }
  | { error: string }
  | null

export function resolveScheduleTrigger(opts: ExternalRunOpts): ScheduleTriggerResolution {
  if (explicitLoopTypeForConversation(opts) !== 'Time-based') return null
  if (opts.sourceKind !== 'schedule') {
    return { error: 'Time-based 僅能由有效 ScheduledJob 到期 trigger 進入。' }
  }

  const candidate = opts.overrides?.scheduleTrigger || {
    source: 'schedule' as const,
    jobId: opts.meta?.scheduleJobId,
    scheduleKind: opts.meta?.scheduleKind,
    triggeredAt: opts.meta?.scheduleTriggeredAt,
  }
  const validation = validateScheduleTriggerSnapshot(candidate)
  return validation.ok
    ? { snapshot: validation.snapshot }
    : { error: `Time-based trigger 無效：${validation.reason}` }
}

export function resolveProactiveTrigger(opts: ExternalRunOpts): ProactiveTriggerResolution {
  if (explicitLoopTypeForConversation(opts) !== 'Proactive') return null
  const candidate = opts.overrides?.eventTrigger || opts.meta?.eventTrigger
  const validation = validateEventTriggerSnapshot(candidate)
  return validation.ok
    ? { snapshot: validation.snapshot }
    : { error: `Proactive trigger 無效：${validation.reason}` }
}

export async function verifyClaimedScheduleTrigger(
  snapshot: ScheduleTriggerSnapshot,
): Promise<string | null> {
  try {
    const { useScheduleStore } = await import('../store/scheduleStore.ts')
    const store = useScheduleStore.getState()
    if (!store.loaded) await store.load()
    const job = useScheduleStore
      .getState()
      .jobs.find((candidate) => candidate.id === snapshot.jobId)
    return isClaimedScheduleTrigger(job, snapshot)
      ? null
      : '找不到與 trigger snapshot 一致的已 claim ScheduledJob'
  } catch {
    return '無法載入 schedule store 驗證 trigger snapshot'
  }
}

/** Present a consent-first automation suggestion without admitting a run. */
export function presentConversationAutomationSuggestion(
  opts: ExternalRunOpts,
  objective: string,
  suggestion: AutomationSuggestion,
): ExternalRunResult {
  let thr = useThreadStore.getState()
  if (!thr.activeId && thr.threads.length === 0) {
    thr.hydrate()
    thr = useThreadStore.getState()
  }

  let tid = opts.reuseThreadId || thr.activeId || ''
  if (!tid || !thr.threads.some((thread) => thread.id === tid)) {
    tid = thr.createThread({
      title: (opts.title || objective).slice(0, 48),
      loopType: null,
      runner: opts.runner || 'builtin',
    })
    thr = useThreadStore.getState()
  }

  thr.selectThread(tid)
  const threadIsRunning = Boolean(
    thr.runningRunIds[tid] ||
      thr.threads.find((thread) => thread.id === tid)?.lastStatus === 'running',
  )
  if (!opts.skipUserBubble) {
    thr.pushBubble(tid, 'user', objective, opts.attachments)
  }
  if (opts.sourceLabel && !opts.skipUserBubble) {
    thr.pushBubble(tid, 'system', opts.sourceLabel)
  }
  thr.pushBubble(tid, 'system', formatAutomationSuggestion(suggestion))
  if (!threadIsRunning) {
    thr.setThreadStatus(tid, 'idle')
    thr.setAwaitingReply(tid, false)
  }

  return {
    path: 'builtin',
    status: 'suggested',
    threadId: tid,
    suggestion,
  }
}
