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
} from './types'
import {
  formatAutomationSuggestion,
  type AutomationSuggestion,
} from './automationSuggestion'
import { validateEventTriggerSnapshot } from './eventMatcher'
import {
  isClaimedScheduleTrigger,
  validateScheduleTriggerSnapshot,
} from './scheduler'
import { useThreadStore } from '../store/threadStore'
import { useScheduleStore } from '../store/scheduleStore'
import { useAutomationConsentStore } from '../store/automationConsentStore'
import {
  decideSuggestionPresentation,
  type SuggestionPresentation,
} from './automationConsent.ts'
import type {
  ExternalRunOpts,
  ExternalRunResult,
  RunSourceKind,
} from './taskRunTypes'

export type BusyPolicy = 'queue' | 'steer' | 'reject'

/** Compact partial result when steer aborts a running task. */
export function buildSteerPartialDigest(agent: AgentState): string {
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

/** Declarative busy policy. */
export function resolveBusyPolicy(
  sourceKind: RunSourceKind | undefined,
  followUpMode: 'steer' | 'queue' | undefined,
): BusyPolicy {
  switch (sourceKind) {
    case 'schedule':
    case 'webhook':
    case 'telegram':
    case 'event':
    case 'delegate':
    case 'queue-drain':
      return 'queue'
    case 'composer':
    case 'slash':
    case 'retry':
      return (followUpMode || 'steer') === 'queue' ? 'queue' : 'steer'
    default:
      return 'reject'
  }
}

const AUTOMATION_KINDS: ReadonlySet<RunSourceKind> = new Set([
  'schedule',
  'webhook',
  'telegram',
  'event',
  'delegate',
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
  return opts.sourceKind === 'composer' || opts.sourceKind === 'slash'
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
    const { useScheduleStore } = await import('../store/scheduleStore')
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

/**
 * 依目前已存在的自動化與過往決定，判斷這次要不要推卡。
 *
 * store 讀取集中在這裡，讓 `automationConsent` 保持純函式、可被 smoke 完整覆蓋。
 */
function decideConversationSuggestion(suggestion: AutomationSuggestion): SuggestionPresentation {
  try {
    const schedule = useScheduleStore.getState()
    const consent = useAutomationConsentStore.getState()
    consent.hydrate()
    return decideSuggestionPresentation({
      suggestion,
      jobs: schedule.jobs,
      events: schedule.events,
      decisions: useAutomationConsentStore.getState().decisions,
    })
  } catch {
    // 讀不到 store 時仍以推卡為預設——建議本身不會執行任何東西
    return { mode: 'card' }
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
  // 建議如何呈現：推卡、只講一句、或（拒絕過且冷卻中）什麼都不說。
  // 判定純在 automationConsent 裡，這裡只負責把結果放進對話。
  const presentation = decideConversationSuggestion(suggestion)
  if (presentation.mode === 'card') {
    thr.pushBubble(tid, 'system', formatAutomationSuggestion(suggestion), undefined, {
      suggestion,
    })
  } else if (presentation.mode === 'notice') {
    thr.pushBubble(tid, 'system', presentation.message)
  }
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
