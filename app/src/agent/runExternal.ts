/**
 * Unified external / automation run path.
 * Always: create thread → bubbles → show Run panel → dispatchThreadTask
 * so Scheduler / Webhook / Telegram / Event simulate / retry share one UX.
 *
 * When busy: automation sources enqueue (G3) instead of permanent miss.
 */

import type { LoopType, RuntimeOverrides } from './types'
import { dispatchThreadTask, type DispatchResult } from './runDispatch'
import { useAgentStore } from '../store/agentStore'
import { useThreadStore, type ThreadRunner } from '../store/threadStore'
import { useSettingsStore } from '../store/settingsStore'
import {
  drainExternalRunQueue,
  enqueueExternalRun,
} from './runQueue'

export type ExternalRunOpts = {
  objective: string
  /** Thread title */
  title?: string
  loopType?: LoopType
  runner?: ThreadRunner
  /** Webhook/event already boolean-matched */
  eventPreMatched?: boolean
  attachedSkills?: string[]
  /** Shown as system bubble */
  sourceLabel?: string
  /** Extra overrides merged into dispatch */
  overrides?: RuntimeOverrides
  /** Navigate to home (caller may also navigate) */
  preferHome?: boolean
  /**
   * Force unattended HITL policy (auto-timeout deny).
   * Auto-inferred from sourceLabel for scheduler/webhook/telegram when omitted.
   */
  unattended?: boolean
  /**
   * Called when the run actually finishes (success/fail/halted).
   * Survives enqueue → drain so schedule once-jobs can markJobResult after 補跑.
   * Not called when only enqueued or dropped as busy.
   * (Not persisted across app restart — use meta.scheduleJobId for durable rebind.)
   */
  onSettled?: (result: ExternalRunResult) => void | Promise<void>
  /** Serializable metadata for queue persistence */
  meta?: {
    scheduleJobId?: string
  }
  /** Internal: skip re-enqueue when draining queue */
  _fromQueue?: boolean
}

export type ExternalRunResult = DispatchResult & {
  threadId: string | null
  skipped?: boolean
  /** busy | queued | cancelled */
  skipReason?: string
  queued?: boolean
  queueId?: string
}

function isAutomationSource(opts: ExternalRunOpts): boolean {
  return (
    opts.unattended === true ||
    Boolean(
      opts.sourceLabel &&
        /排程|定時|webhook|telegram|事件|scheduler|cron|gateway|TG\b|佇列/i.test(
          opts.sourceLabel,
        ),
    )
  )
}

/**
 * Run an objective from automation/external source with full thread UX.
 */
export async function runExternalObjective(
  opts: ExternalRunOpts,
): Promise<ExternalRunResult> {
  const objective = opts.objective.trim()
  if (!objective) {
    return {
      path: 'builtin',
      status: 'failed',
      error: 'empty objective',
      threadId: null,
    }
  }

  const agent = useAgentStore.getState()
  if (agent.isRunning) {
    // G3: automation → enqueue instead of permanent miss
    if (isAutomationSource(opts) && !opts._fromQueue) {
      const item = enqueueExternalRun({ ...opts, unattended: true })
      if (item) {
        return {
          path: 'builtin',
          status: 'skipped',
          error: '已有任務執行中 — 已加入待跑佇列',
          threadId: useThreadStore.getState().activeId,
          skipped: true,
          skipReason: 'queued',
          queued: true,
          queueId: item.id,
        }
      }
      return {
        path: 'builtin',
        status: 'skipped',
        error: '已有任務執行中（佇列已滿或重複）',
        threadId: useThreadStore.getState().activeId,
        skipped: true,
        skipReason: 'busy',
      }
    }
    return {
      path: 'builtin',
      status: 'skipped',
      error: '已有任務執行中',
      threadId: useThreadStore.getState().activeId,
      skipped: true,
      skipReason: 'busy',
    }
  }

  const thr = useThreadStore.getState()
  if (!thr.activeId && thr.threads.length === 0) thr.hydrate()

  const settings = useSettingsStore.getState().settings
  const loopType = opts.loopType || 'Goal-based'
  const tid = thr.createThread({
    title: (opts.title || objective).slice(0, 48),
    loopType,
    thinkingDepth: 'standard',
  })
  thr.selectThread(tid)
  if (opts.runner) thr.setRunner(tid, opts.runner)
  thr.setShowRunPanel(true)
  thr.setRunningThreadId(tid)
  thr.pushBubble(tid, 'user', objective)
  if (opts.sourceLabel) {
    thr.pushBubble(tid, 'system', opts.sourceLabel)
  }
  thr.setThreadStatus(tid, 'running')

  agent.setSelectedLoopType(loopType)

  const temporary =
    opts.overrides?.temporary ??
    settings.temporaryChatDefault === true

  const sourceIsAutomation = isAutomationSource(opts)

  const overrides: RuntimeOverrides = {
    ...(opts.overrides || {}),
    eventPreMatched: opts.eventPreMatched ?? opts.overrides?.eventPreMatched,
    attachedSkills:
      opts.attachedSkills || opts.overrides?.attachedSkills || undefined,
    temporary,
    unattended: opts.overrides?.unattended ?? sourceIsAutomation,
    hitlTimeoutMs: opts.overrides?.hitlTimeoutMs,
  }

  try {
    const result = await dispatchThreadTask(objective, {
      threadId: tid,
      runner: opts.runner,
      overrides,
      forceLoopType: loopType,
    })
    const status = useAgentStore.getState().agent.status
    thr.setThreadStatus(tid, status)
    thr.pushBubble(
      tid,
      'assistant',
      useAgentStore.getState().agent.result?.slice(0, 3500) ||
        result.result?.slice(0, 3500) ||
        `狀態：${status}`,
    )
    thr.setRunningThreadId(null)
    const finalResult: ExternalRunResult = { ...result, threadId: tid }
    try {
      await opts.onSettled?.(finalResult)
    } catch {
      /* caller errors non-fatal */
    }
    // Drain automation queue after free (preserves onSettled on queued items)
    void drainExternalRunQueue((o) =>
      runExternalObjective({ ...o, _fromQueue: true }),
    )
    return finalResult
  } catch (e) {
    thr.setThreadStatus(tid, 'failed')
    thr.setRunningThreadId(null)
    const msg = e instanceof Error ? e.message : String(e)
    thr.pushBubble(tid, 'system', `執行失敗：${msg}`)
    const failResult: ExternalRunResult = {
      path: 'builtin',
      status: 'failed',
      error: msg,
      threadId: tid,
    }
    try {
      await opts.onSettled?.(failResult)
    } catch {
      /* ignore */
    }
    void drainExternalRunQueue((o) =>
      runExternalObjective({ ...o, _fromQueue: true }),
    )
    return failResult
  }
}
