/**
 * Unified external / automation run path.
 * Always: create thread → bubbles → show Run panel → dispatchThreadTask
 * so Scheduler / Webhook / Telegram / Event simulate / retry share one UX.
 *
 * When busy: automation sources enqueue (G3) instead of permanent miss.
 */

import type { ChatAttachment, LoopType, RuntimeOverrides } from './types'
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
  /** Pin project for this run (scheduler multi-project) */
  projectRoot?: string
  /** Chat attachments (Telegram images, etc.) */
  attachments?: ChatAttachment[]
  /** Extra context folded into system (webhook body, TG meta) */
  extraContext?: string
  /**
   * Continue an existing thread (interactive follow-up queue).
   * When set, does not create a new thread.
   */
  reuseThreadId?: string
  /** User bubble already shown — skip duplicate on drain */
  skipUserBubble?: boolean
  /** Interactive: enqueue when busy even if not unattended automation */
  enqueueWhenBusy?: boolean
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
        /排程|定時|webhook|telegram|事件|scheduler|cron|gateway|TG\b|佇列|對話追問/i.test(
          opts.sourceLabel,
        ),
    )
  )
}

function shouldEnqueueWhenBusy(opts: ExternalRunOpts): boolean {
  return (
    isAutomationSource(opts) ||
    opts.enqueueWhenBusy === true ||
    Boolean(opts.reuseThreadId)
  )
}

/**
 * Run an objective from automation/external source with full thread UX.
 * Also used for interactive follow-ups (reuseThreadId + enqueueWhenBusy).
 */
export async function runExternalObjective(
  opts: ExternalRunOpts,
): Promise<ExternalRunResult> {
  let objective = opts.objective.trim()
  if (!objective && opts.attachments?.length) {
    objective = '請分析我附上的圖片或檔案。'
  }
  if (!objective) {
    return {
      path: 'builtin',
      status: 'failed',
      error: 'empty objective',
      threadId: null,
    }
  }

  // Materialize attachments early so queue persistence keeps filePath
  let attachments = opts.attachments
  if (attachments?.length) {
    try {
      const { materializeAttachmentsOnDisk } = await import('../lib/chatAttachments')
      const { useProjectStore } = await import('../store/projectStore')
      attachments = await materializeAttachmentsOnDisk(attachments, {
        projectRoot: opts.projectRoot || useProjectStore.getState().root || undefined,
        sessionId: opts.reuseThreadId || opts.meta?.scheduleJobId,
      })
    } catch {
      /* keep original */
    }
  }

  const agent = useAgentStore.getState()
  if (agent.isRunning) {
    // Unified queue: automation + interactive follow-up
    if (shouldEnqueueWhenBusy(opts) && !opts._fromQueue) {
      const item = enqueueExternalRun({
        ...opts,
        attachments,
        unattended: opts.unattended ?? isAutomationSource(opts),
      })
      if (item) {
        return {
          path: 'builtin',
          status: 'skipped',
          error: '已有任務執行中 — 已加入待跑佇列',
          threadId: opts.reuseThreadId || useThreadStore.getState().activeId,
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
        threadId: opts.reuseThreadId || useThreadStore.getState().activeId,
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

  // Reuse existing thread (interactive follow-up) or create new
  let tid = opts.reuseThreadId || ''
  const existing = tid ? thr.threads.find((t) => t.id === tid) : null
  if (!existing) {
    tid = thr.createThread({
      title: (opts.title || objective).slice(0, 48),
      loopType,
      thinkingDepth: 'standard',
      runner: opts.runner || 'builtin',
    })
  }
  thr.selectThread(tid)
  if (opts.runner) thr.setRunner(tid, opts.runner)
  thr.setShowRunPanel(true)
  thr.setRunningThreadId(tid)
  if (!opts.skipUserBubble) {
    thr.pushBubble(tid, 'user', objective, attachments)
  }
  if (opts.sourceLabel && !opts.skipUserBubble) {
    thr.pushBubble(tid, 'system', opts.sourceLabel)
  } else if (opts.sourceLabel && opts._fromQueue) {
    thr.pushBubble(tid, 'system', opts.sourceLabel)
  }
  if (opts.extraContext?.trim() && !opts.skipUserBubble) {
    thr.pushBubble(
      tid,
      'system',
      `事件內容（節錄）\n${opts.extraContext.trim().slice(0, 2000)}`,
    )
  }
  if (opts.projectRoot?.trim() && !opts.skipUserBubble) {
    thr.pushBubble(tid, 'system', `專案綁定：${opts.projectRoot.trim()}`)
  }
  thr.setThreadStatus(tid, 'running')

  agent.setSelectedLoopType(loopType)

  const temporary =
    opts.overrides?.temporary ??
    settings.temporaryChatDefault === true

  const sourceIsAutomation = isAutomationSource(opts)

  // Hydrate image dataUrls from disk for builtin vision
  if (attachments?.length) {
    try {
      const { hydrateAttachmentsFromDisk } = await import('../lib/chatAttachments')
      attachments = await hydrateAttachmentsFromDisk(attachments)
    } catch {
      /* ignore */
    }
  }

  const extraSystem = [
    opts.overrides?.extraSystemContext,
    opts.extraContext?.trim()
      ? `## External event / channel context\n${opts.extraContext.trim().slice(0, 12_000)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const overrides: RuntimeOverrides = {
    ...(opts.overrides || {}),
    eventPreMatched: opts.eventPreMatched ?? opts.overrides?.eventPreMatched,
    attachedSkills:
      opts.attachedSkills || opts.overrides?.attachedSkills || undefined,
    temporary,
    unattended: opts.overrides?.unattended ?? sourceIsAutomation,
    hitlTimeoutMs: opts.overrides?.hitlTimeoutMs,
    projectRoot: opts.projectRoot?.trim() || opts.overrides?.projectRoot,
    extraSystemContext: extraSystem || undefined,
    userAttachments: attachments?.length
      ? attachments
      : opts.overrides?.userAttachments,
  }

  try {
    const result = await dispatchThreadTask(objective, {
      threadId: tid,
      runner: opts.runner,
      overrides,
      forceLoopType: loopType,
      attachments,
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
