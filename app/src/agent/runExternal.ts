/**
 * runTask — the single task lifecycle controller (W1 / P0-A).
 * Every entry (composer / slash / retry / schedule / webhook / telegram / queue drain)
 * goes through here: one runId, one busy policy table, one thread/bubble/archive semantic.
 *
 * When busy: policy decides queue / steer / reject — no caller re-implements lifecycle.
 */

import { v4 as uuid } from 'uuid'
import type { ChatAttachment, LoopType, RuntimeOverrides } from './types'
import { dispatchThreadTask, type DispatchResult } from './runDispatch'
import { useAgentStore } from '../store/agentStore'
import { useThreadStore, type ThreadRunner } from '../store/threadStore'
import { useSettingsStore } from '../store/settingsStore'
import {
  drainExternalRunQueue,
  enqueueExternalRun,
} from './runQueue'

/** Where a run request came from — the ONLY thing entries may vary. */
export type RunSourceKind =
  | 'composer'
  | 'slash'
  | 'retry'
  | 'schedule'
  | 'webhook'
  | 'telegram'
  | 'event'
  | 'delegate'
  | 'queue-drain'

export type BusyPolicy = 'queue' | 'steer' | 'reject'

/**
 * Declarative busy policy (table-driven; mirrored in smoke-caps).
 * Interactive sources follow the user's followUpMode preference.
 */
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

export type ExternalRunOpts = {
  objective: string
  /** Entry source — drives busy policy / unattended / trace. Legacy callers may omit. */
  sourceKind?: RunSourceKind
  /** Stable run id for trace correlation (assigned here; survives queue). */
  runId?: string
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
  /** Trace id — correlates thread / archive / queue / HITL */
  runId?: string
  skipped?: boolean
  /** busy | queued | cancelled */
  skipReason?: string
  queued?: boolean
  queueId?: string
}

const AUTOMATION_KINDS: ReadonlySet<RunSourceKind> = new Set([
  'schedule',
  'webhook',
  'telegram',
  'event',
  'delegate',
  'queue-drain',
])

function isAutomationSource(opts: ExternalRunOpts): boolean {
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

function shouldEnqueueWhenBusy(opts: ExternalRunOpts): boolean {
  return (
    isAutomationSource(opts) ||
    opts.enqueueWhenBusy === true ||
    Boolean(opts.reuseThreadId)
  )
}

/** Canonical input name for the lifecycle controller. */
export type RunTaskInput = ExternalRunOpts

/**
 * runTask — the ONLY entry to start a run. UI / slash / automation callers
 * provide input + sourceKind; lifecycle (queue, steer, thread, bubbles,
 * trace, drain, settle callbacks) is owned here.
 */
export async function runTask(input: RunTaskInput): Promise<ExternalRunResult> {
  return runExternalObjective(input)
}

/**
 * Run an objective from automation/external source with full thread UX.
 * Also used for interactive follow-ups (reuseThreadId + enqueueWhenBusy).
 * (Legacy name — prefer `runTask`.)
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

  const runId = opts.runId || `run_${uuid().slice(0, 12)}`

  const agent = useAgentStore.getState()
  if (agent.isRunning) {
    const policy: BusyPolicy = opts.sourceKind
      ? resolveBusyPolicy(
          opts.sourceKind,
          useSettingsStore.getState().settings.followUpMode,
        )
      : shouldEnqueueWhenBusy(opts)
        ? 'queue'
        : 'reject'

    if (policy === 'steer' && !opts._fromQueue) {
      // Interactive steer: abort current run, then proceed with this one
      const tid0 = opts.reuseThreadId || useThreadStore.getState().activeId
      if (tid0) {
        useThreadStore
          .getState()
          .pushBubble(tid0, 'system', '轉向目前執行：已中止前一個任務')
      }
      useAgentStore.getState().stopExecution()
      await new Promise((r) => setTimeout(r, 100))
    } else if (policy === 'queue' && !opts._fromQueue) {
      const item = enqueueExternalRun({
        ...opts,
        runId,
        attachments,
        unattended: opts.unattended ?? isAutomationSource(opts),
      })
      if (item) {
        return {
          path: 'builtin',
          status: 'skipped',
          error: '已有任務執行中 — 已加入待跑佇列',
          threadId: opts.reuseThreadId || useThreadStore.getState().activeId,
          runId,
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
        runId,
        skipped: true,
        skipReason: 'busy',
      }
    } else if (policy !== 'steer') {
      return {
        path: 'builtin',
        status: 'skipped',
        error: '已有任務執行中',
        threadId: useThreadStore.getState().activeId,
        runId,
        skipped: true,
        skipReason: 'busy',
      }
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
    runId,
    sourceKind: opts.sourceKind || opts.overrides?.sourceKind,
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

  // P1-D lifecycle hooks (beforeRun): deny / append-context / log / notify
  try {
    const { collectHookRules, evaluateHooks } = await import('./hooks')
    const ev = evaluateHooks(collectHookRules(settings), {
      point: 'beforeRun',
      sourceKind: opts.sourceKind,
      objective,
    })
    for (const line of ev.audits) thr.pushBubble(tid, 'system', line)
    for (const n of ev.notifications) {
      void window.subagents?.notify?.('SubAgents AI · Hook', n.slice(0, 160))
    }
    if (ev.deny) {
      // P0: still complete lifecycle — onSettled / afterRun / drain / archive path
      thr.setThreadStatus(tid, 'failed')
      thr.setRunningThreadId(null)
      thr.pushBubble(tid, 'system', `執行被 hook 政策拒絕：${ev.deny.reason}`)
      const denyResult: ExternalRunResult = {
        path: 'builtin',
        status: 'failed',
        error: `hook deny：${ev.deny.reason}`,
        threadId: tid,
        runId,
      }
      try {
        const after = evaluateHooks(collectHookRules(settings), {
          point: 'afterRun',
          sourceKind: opts.sourceKind,
          objective,
        })
        for (const line of after.audits) thr.pushBubble(tid, 'system', line)
        for (const n of after.notifications) {
          void window.subagents?.notify?.('SubAgents AI · Hook', n.slice(0, 160))
        }
      } catch {
        /* non-fatal */
      }
      try {
        await opts.onSettled?.(denyResult)
      } catch {
        /* ignore */
      }
      void drainExternalRunQueue((o) =>
        runExternalObjective({
          ...o,
          _fromQueue: true,
          sourceKind: o.sourceKind || 'queue-drain',
        }),
      )
      return denyResult
    }
    if (ev.appendTexts.length) {
      overrides.extraSystemContext = [
        overrides.extraSystemContext,
        ...ev.appendTexts.map((t) => `## Hook context\n${t}`),
      ]
        .filter(Boolean)
        .join('\n\n')
    }
  } catch {
    /* hook infra must never break runs */
  }

  try {
    const result = await dispatchThreadTask(objective, {
      threadId: tid,
      runner: opts.runner,
      overrides,
      forceLoopType: loopType,
      attachments,
    })
    // P0 CLI/dispatch: prefer dispatch result over stale global agent state
    const finalAgent = useAgentStore.getState().agent
    const status =
      result.status === 'failed' || result.error
        ? result.status === 'failed'
          ? 'failed'
          : finalAgent.status
        : finalAgent.status || result.status
    thr.setThreadStatus(
      tid,
      (status === 'success' ||
      status === 'failed' ||
      status === 'halted' ||
      status === 'idle'
        ? status
        : finalAgent.status) as 'success' | 'failed' | 'halted' | 'idle' | 'running',
    )
    if (result.error && result.status === 'failed' && !result.result) {
      thr.pushBubble(tid, 'system', result.error)
    } else {
      const stepsTail = finalAgent.steps
        .filter((s) => s.result)
        .slice(-3)
        .map((s) => s.result)
        .join('\n\n')
      thr.pushBubble(
        tid,
        'assistant',
        finalAgent.result?.slice(0, 4000) ||
          stepsTail.slice(0, 4000) ||
          result.result?.slice(0, 4000) ||
          `狀態：${status}`,
      )
    }
    thr.setRunningThreadId(null)
    const finalResult: ExternalRunResult = {
      ...result,
      threadId: tid,
      runId,
      status: result.status || finalAgent.status,
      error: result.error || finalAgent.haltReason,
    }
    // P1-D lifecycle hooks (afterRun): observe / notify
    try {
      const { collectHookRules, evaluateHooks } = await import('./hooks')
      const ev = evaluateHooks(collectHookRules(settings), {
        point: 'afterRun',
        sourceKind: opts.sourceKind,
        objective,
      })
      for (const line of ev.audits) thr.pushBubble(tid, 'system', line)
      for (const n of ev.notifications) {
        void window.subagents?.notify?.('SubAgents AI · Hook', n.slice(0, 160))
      }
    } catch {
      /* non-fatal */
    }
    try {
      await opts.onSettled?.(finalResult)
    } catch {
      /* caller errors non-fatal */
    }
    void drainExternalRunQueue((o) =>
      runExternalObjective({ ...o, _fromQueue: true, sourceKind: o.sourceKind || 'queue-drain' }),
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
      runId,
    }
    try {
      await opts.onSettled?.(failResult)
    } catch {
      /* ignore */
    }
    void drainExternalRunQueue((o) =>
      runExternalObjective({ ...o, _fromQueue: true, sourceKind: o.sourceKind || 'queue-drain' }),
    )
    return failResult
  }
}
