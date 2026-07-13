/**
 * runTask — the single task lifecycle controller (W1 / P0-A).
 * Every entry (composer / slash / retry / schedule / webhook / telegram / queue drain)
 * goes through here: one runId, one busy policy table, one thread/bubble/archive semantic.
 *
 * When busy: policy decides queue / steer / reject — no caller re-implements lifecycle.
 */

import { v4 as uuid } from 'uuid'
import type { AgentState, ChatAttachment, ExternalRunRef, LoopType, RuntimeOverrides } from './types'
import { dispatchThreadTask, type DispatchResult } from './runDispatch'
import { useAgentStore } from '../store/agentStore'
import { useThreadStore, type ThreadRunner } from '../store/threadStore'
import { useSubDesignStore } from '../store/subDesignStore'
import { useSubDesignArtifactStore } from '../store/subDesignArtifactStore'
import { useSubDesignCritiqueStore } from '../store/subDesignCritiqueStore'
import { useSubDesignExportStore } from '../store/subDesignExportStore'
import { useSettingsStore } from '../store/settingsStore'
import {
  drainExternalRunQueue,
  enqueueExternalRun,
  listQueuedRuns,
  queueLength,
} from './runQueue'
import { isContinueGoalPhrase } from './chatHistory'

/** Compact partial result when steer aborts a running task. */
function buildSteerPartialDigest(agent: AgentState): string {
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
  /**
   * Resume thread.continueGoal (same DoD / missing).
   * When true, forces Goal-based corrective run.
   */
  continueGoal?: boolean
  /** Extra user hint when continuing (appended to corrective context) */
  continueHint?: string
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

/**
 * Pull the server-owned todo/children snapshot into the local Thread after a
 * server run. Failures are intentionally non-fatal: the completed session and
 * local transcript remain authoritative when an older server lacks an endpoint.
 */
async function syncOpenCodeSessionMapping(
  threadId: string,
  externalRun?: ExternalRunRef,
): Promise<void> {
  if (externalRun?.provider !== 'opencode' || !externalRun.serverUrl || !externalRun.sessionId) return
  try {
    const [{ getOpenCodeSessionTodo, getOpenCodeSessionChildren }, { mapOpenCodeTodoToThreadPlan, normalizeOpenCodeChildren }] =
      await Promise.all([
        import('./opencode/serverClient'),
        import('./opencode/sessionMapping'),
      ])
    const [todoResult, childrenResult] = await Promise.allSettled([
      getOpenCodeSessionTodo(externalRun.serverUrl, externalRun.sessionId),
      getOpenCodeSessionChildren(externalRun.serverUrl, externalRun.sessionId),
    ])
    const plan = todoResult.status === 'fulfilled'
      ? mapOpenCodeTodoToThreadPlan(todoResult.value)
      : []
    if (plan.length) useThreadStore.getState().setRunPlan(threadId, plan)

    const children = childrenResult.status === 'fulfilled'
      ? normalizeOpenCodeChildren(childrenResult.value)
      : []
    const childSessionIds = children.map((child) => child.id)
    const activeBefore = useThreadStore.getState().activeId
    for (const child of children) {
      const state = useThreadStore.getState()
      if (state.threads.some((thread) =>
        thread.externalRun?.provider === 'opencode' &&
        thread.externalRun.serverUrl === externalRun.serverUrl &&
        thread.externalRun.sessionId === child.id,
      )) continue
      const childThreadId = state.createThread({
        title: `子任務 · ${child.title}`.slice(0, 48),
        runner: 'opencode',
        agentMode: 'build',
        loopType: null,
      })
      useThreadStore.getState().setExternalRun(childThreadId, {
        ...externalRun,
        sessionId: child.id,
        parentSessionId: child.parentId || externalRun.sessionId,
        childSessionIds: undefined,
        status: 'running',
        startedAt: child.time || externalRun.startedAt,
        finishedAt: undefined,
        completionReason: 'child-session-discovered',
      })
      useThreadStore.getState().pushBubble(
        childThreadId,
        'system',
        `OpenCode child session 已同步 · ${child.id}`,
      )
    }
    if (activeBefore) {
      useThreadStore.getState().selectThread(activeBefore)
      useThreadStore.getState().setShowRunPanel(true)
    }
    if (plan.length || childSessionIds.length) {
      useThreadStore.getState().setExternalRun(threadId, {
        ...externalRun,
        childSessionIds: childSessionIds.length ? childSessionIds : externalRun.childSessionIds,
        lastTodoAt: plan.length ? new Date().toISOString() : externalRun.lastTodoAt,
        lastChildrenAt: childrenResult.status === 'fulfilled' ? new Date().toISOString() : externalRun.lastChildrenAt,
      })
    }
  } catch {
    /* Session mapping is an audit enhancement; never change run outcome. */
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

  // Background delegates can sit in the queue while Settings changes. Recheck
  // the opt-in at drain time so disabling Sub Agent cannot start a stale child run.
  if (
    opts.sourceKind === 'delegate' &&
    useSettingsStore.getState().settings.subAgentsEnabled !== true
  ) {
    return {
      path: 'builtin',
      status: 'failed',
      error: 'Sub Agent 功能目前已關閉，委派未啟動。',
      threadId: null,
      runId: opts.runId,
    }
  }

  // Materialize attachments early so queue persistence keeps filePath
  let attachments = opts.attachments
  if (attachments?.length) {
    try {
      const {
        materializeAttachmentsOnDisk,
        normalizeImageAttachmentsForVision,
      } = await import('../lib/chatAttachments')
      const { useProjectStore } = await import('../store/projectStore')
      attachments = await normalizeImageAttachmentsForVision(attachments)
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
      // Interactive steer: capture partial digest, abort, then proceed
      const thrBusy = useThreadStore.getState()
      const tid0 = opts.reuseThreadId || thrBusy.activeId
      const runningId = thrBusy.runningThreadId
      const runningTitle = runningId
        ? thrBusy.threads.find((t) => t.id === runningId)?.title
        : undefined
      const partial = buildSteerPartialDigest(useAgentStore.getState().agent)
      if (tid0) {
        const lines = [
          `轉向目前執行：已中止前一個任務${runningTitle ? `（${runningTitle.slice(0, 32)}）` : ''}`,
        ]
        if (partial) lines.push('', '### 中止前摘要', partial)
        thrBusy.pushBubble(tid0, 'system', lines.join('\n'))
      }
      useAgentStore.getState().stopExecution()
      await new Promise((r) => setTimeout(r, 100))
    } else if (policy === 'queue' && !opts._fromQueue) {
      const thrBusy = useThreadStore.getState()
      const runningId = thrBusy.runningThreadId
      const runningTitle = runningId
        ? thrBusy.threads.find((t) => t.id === runningId)?.title?.slice(0, 32)
        : undefined
      const item = enqueueExternalRun({
        ...opts,
        runId,
        attachments,
        unattended: opts.unattended ?? isAutomationSource(opts),
      })
      if (item) {
        const pos = listQueuedRuns().findIndex((q) => q.id === item.id) + 1
        const posLabel = pos > 0 ? pos : queueLength()
        return {
          path: 'builtin',
          status: 'skipped',
          error: `全域執行中${runningTitle ? `（${runningTitle}）` : ''} — 已加入佇列第 ${posLabel} 位（${queueLength()}/24）`,
          threadId: opts.reuseThreadId || thrBusy.activeId,
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
        error: `全域執行中${runningTitle ? `（${runningTitle}）` : ''} — 佇列已滿或重複`,
        threadId: opts.reuseThreadId || thrBusy.activeId,
        runId,
        skipped: true,
        skipReason: 'busy',
      }
    } else if (policy !== 'steer') {
      const thrBusy = useThreadStore.getState()
      const runningId = thrBusy.runningThreadId
      const runningTitle = runningId
        ? thrBusy.threads.find((t) => t.id === runningId)?.title?.slice(0, 32)
        : undefined
      return {
        path: 'builtin',
        status: 'skipped',
        error: `全域執行中${runningTitle ? `（${runningTitle}）` : ''}，請稍候或改用佇列模式`,
        threadId: thrBusy.activeId,
        runId,
        skipped: true,
        skipReason: 'busy',
      }
    }
  }

  const thr = useThreadStore.getState()
  if (!thr.activeId && thr.threads.length === 0) thr.hydrate()

  const settings = useSettingsStore.getState().settings

  // Reuse existing thread (interactive follow-up) or create new
  let tid = opts.reuseThreadId || ''
  const existing = tid ? thr.threads.find((t) => t.id === tid) : null

  // P3: continueGoal — resume same DoD when flag set or user says 繼續/補齊
  const existingSnap = existing?.continueGoal || undefined
  const wantContinue = Boolean(
    existingSnap &&
      (opts.continueGoal === true || isContinueGoalPhrase(objective)),
  )
  const continueSnap = wantContinue ? existingSnap : undefined

  // Conversation default: omit loopType → auto classify (Chat-lite / Goal).
  // Continue-goal forces Goal-based; automation / UI pin still force.
  const forcedLoopType = continueSnap
    ? ('Goal-based' as LoopType)
    : opts.loopType
  const loopTypeMode: 'force' | 'auto' = forcedLoopType ? 'force' : 'auto'

  if (!existing) {
    tid = thr.createThread({
      title: (opts.title || objective).slice(0, 48),
      // null = auto until user pins a loop type
      loopType: forcedLoopType || null,
      thinkingDepth: 'standard',
      runner: opts.runner || 'builtin',
    })
  }
  thr.selectThread(tid)
  if (opts.runner) thr.setRunner(tid, opts.runner)
  thr.clearRunPlan(tid)
  thr.setShowRunPanel(true)
  thr.setRunningThreadId(tid)
  if (!opts.skipUserBubble) {
    thr.pushBubble(tid, 'user', objective, attachments)
  }
  if (continueSnap) {
    thr.pushBubble(
      tid,
      'system',
      `▶ 補齊缺口繼續 · DoD 保留 · 缺口 ${continueSnap.missing.length || 0} 項`,
    )
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

  if (forcedLoopType) {
    agent.setSelectedLoopType(forcedLoopType)
  } else {
    // Clear sticky force from previous run so auto classification works
    agent.setSelectedLoopType(null)
  }

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

  // Pure "繼續" has no extra hint; "補齊價格欄" keeps the phrase as corrective hint.
  const pureContinue =
    /^(繼續|接著做?|再試|重試|continue|retry|keep going)\s*[!！.。…]*$/i.test(
      objective.trim(),
    )
  const continueHint =
    opts.continueHint ||
    (continueSnap && !pureContinue && objective.trim() !== continueSnap.objective.trim()
      ? objective.trim()
      : undefined)

  // When resuming, engine objective is the original goal (not the "繼續" phrase)
  const dispatchObjective = continueSnap ? continueSnap.objective : objective

  const overrides: RuntimeOverrides = {
    ...(opts.overrides || {}),
    runId,
    sourceKind: opts.sourceKind || opts.overrides?.sourceKind,
    agentMode:
      opts.overrides?.agentMode ||
      thr.threads.find((thread) => thread.id === tid)?.agentMode ||
      'build',
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
    loopTypeMode,
    forceLoopType: forcedLoopType,
    threadId: tid,
    continueGoal: continueSnap
      ? {
          objective: continueSnap.objective,
          definitionOfDone: continueSnap.definitionOfDone,
          loopType: continueSnap.loopType || 'Goal-based',
          steps: continueSnap.steps,
          missing: continueSnap.missing,
          priorDigest: continueSnap.priorDigest,
          userHint: continueHint,
        }
      : opts.overrides?.continueGoal,
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
    const result = await dispatchThreadTask(dispatchObjective, {
      threadId: tid,
      runner: opts.runner,
      overrides,
      // Only pin loop when user/automation explicitly chose one
      forceLoopType: forcedLoopType,
      attachments,
    })
    // P0 CLI/dispatch: prefer dispatch result over stale global agent state
    const finalAgent = useAgentStore.getState().agent
    await syncOpenCodeSessionMapping(tid, finalAgent.externalRun)
    if (finalAgent.steps.length > 0) {
      thr.setRunPlan(
        tid,
        finalAgent.steps.map((step) => ({
          id: `step_${step.step}`,
          text: step.description || step.action || `步驟 ${step.step}`,
          status:
            step.status === 'COMPLETED'
              ? 'done'
              : step.status === 'FAILED'
                ? 'failed'
                : step.status === 'IN_PROGRESS'
                  ? 'active'
                  : 'pending',
        })),
      )
    }
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
    const stepsTail = finalAgent.steps
      .filter((step) => step.result)
      .slice(-3)
      .map((step) => step.result)
      .join('\n\n')
    const finalAnswer =
      finalAgent.result ||
      stepsTail ||
      result.result ||
      `狀態：${status}`
    const hasFinalAnswer = !(result.error && result.status === 'failed' && !result.result)
    if (!hasFinalAnswer) {
      thr.pushBubble(tid, 'system', result.error || finalAgent.haltReason || '執行失敗')
    }
    // Persist a compact process record *before* the answer. This mirrors
    // OpenCode's part order: context/tools → final text, both live and after reload.
    try {
      const { useRunActivityStore } = await import('../store/runActivityStore')
      const activity = useRunActivityStore.getState()
      const activityOperations = activity.events
        .filter((event) => event.kind !== 'thought' && event.kind !== 'text')
        .map((event) => ({
          id: event.id,
          kind: event.kind,
          title: event.title || event.kind,
          detail: event.detail,
          path: event.path,
          ok: event.ok,
        }))
      const fallbackOperations = finalAgent.toolCalls.map((tool) => ({
        id: tool.id,
        kind: /write|edit|create|patch/i.test(tool.tool) ? 'file' : 'tool',
        title: /bash|shell/i.test(tool.tool) ? '已執行指令' : `已執行 ${tool.tool}`,
        detail:
          typeof tool.input?.command === 'string'
            ? tool.input.command
            : tool.output?.slice(0, 400),
        path: String(tool.input?.path ?? tool.input?.file ?? tool.input?.filePath ?? '') || undefined,
        ok: tool.ok,
      }))
      const fileMap = new Map<string, { path: string; action: string; added?: number; removed?: number }>()
      for (const file of activity.fileChanges) {
        fileMap.set(file.path, file)
      }
      for (const tool of finalAgent.toolCalls) {
        if (!/write|edit|create|patch/i.test(tool.tool)) continue
        const path = String(tool.input?.path ?? tool.input?.file ?? tool.input?.filePath ?? '')
        if (path && !fileMap.has(path)) {
          fileMap.set(path, { path, action: /write|create/i.test(tool.tool) ? 'create' : 'edit' })
        }
      }
      const stepOps = (finalAgent.steps || []).map((step, index) => ({
        id: `step_${step.step}_${index}`,
        kind: step.status === 'FAILED' ? 'error' : 'status',
        title: step.description || step.action || `步驟 ${step.step}`,
        detail:
          step.status === 'COMPLETED'
            ? '完成'
            : step.status === 'FAILED'
              ? (step.result || '失敗').slice(0, 400)
              : step.status,
        ok: step.status !== 'FAILED',
      }))
      const logOps = (finalAgent.logs || [])
        .filter((line) => {
          const m = line.message || ''
          return m && !m.startsWith('$ ') && m.length < 240
        })
        .slice(-16)
        .map((line) => ({
          id: line.id,
          kind: line.level === 'ERROR' ? 'error' : line.level === 'SUCCESS' ? 'done' : 'status',
          title: line.message.slice(0, 200),
          detail: line.message.slice(0, 400),
          ok: line.level !== 'ERROR',
        }))
      // Prefer structured stream ops → tools → steps → logs (never empty if run ran)
      const operations =
        activityOperations.length > 0
          ? activityOperations
          : fallbackOperations.length > 0
            ? fallbackOperations
            : stepOps.length > 0
              ? [...stepOps, ...logOps].slice(-40)
              : logOps
      let diff: string | undefined
      if (fileMap.size > 0) {
        try {
          const { useProjectStore } = await import('../store/projectStore')
          const projectRoot = opts.projectRoot || useProjectStore.getState().root || undefined
          const result = await window.subagents?.tools?.workspaceDiff?.(
            [...fileMap.keys()],
            projectRoot,
          )
          if (result?.ok && result.diff.trim()) diff = result.diff.slice(0, 200_000)
        } catch {
          /* Diff is an optional review aid; never fail the run summary. */
        }
      }
      const plan = (thr.threads.find((thread) => thread.id === tid)?.runPlan || []).slice(0, 40)
      const subDesignBrief = useSubDesignStore.getState().findByThreadId(tid)
      const subDesignArtifact = subDesignBrief
        ? useSubDesignArtifactStore.getState().findByBriefId(subDesignBrief.id)[0]
        : null
      const subDesignCritique = subDesignArtifact
        ? useSubDesignCritiqueStore.getState().latestForArtifact(subDesignArtifact.id, subDesignArtifact.revision)
        : null
      const subDesignExports = subDesignArtifact
        ? useSubDesignExportStore.getState().findByArtifactId(subDesignArtifact.id)
        : []
      // Always persist a process card so chat shows more than the bare answer
      thr.pushRunSummary(tid, {
        durationMs: finalAgent.metrics?.executionMs,
        subDesign: subDesignBrief
          ? {
              briefId: subDesignBrief.id,
              stage: subDesignBrief.stage,
              selectedDirectionId: subDesignBrief.selectedDirectionId,
              designSystemId: subDesignBrief.designSystemId,
              artifactId: subDesignArtifact?.id,
              artifactRevision: subDesignArtifact?.revision,
              critique: subDesignCritique
                ? {
                    revision: subDesignCritique.revision || 1,
                    verdict: subDesignCritique.verdict,
                    blockerCount: subDesignCritique.findings.filter((finding) => finding.severity === 'blocker').length,
                    scores: {
                      briefCoverage: subDesignCritique.briefCoverage,
                      brandConformance: subDesignCritique.brandConformance,
                      accessibility: subDesignCritique.accessibility,
                      implementationReadiness: subDesignCritique.implementationReadiness,
                    },
                  }
                : undefined,
              exports: subDesignExports.map((item) => ({
                format: item.format,
                revision: item.revision,
                path: item.path,
                sha256: item.sha256,
              })),
            }
          : undefined,
        diff,
        plan,
        agents: (finalAgent.subAgents || []).map((agent) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          status: agent.status,
          lastMessage: agent.lastMessage,
          model: agent.model,
        })),
        operations:
          operations.length > 0
            ? operations
            : [
                {
                  id: 'run_done',
                  kind: status === 'success' ? 'done' : 'status',
                  title:
                    result.path === 'cli'
                      ? `本機 CLI 完成（${result.kind || 'cli'}）`
                      : `執行完成 · ${status}`,
                  detail: (finalAgent.result || '').slice(0, 200),
                  ok: status === 'success',
                },
              ],
        files: [...fileMap.values()],
      })
    } catch {
      /* execution summary must not break the task lifecycle */
    }
    if (hasFinalAnswer) {
      thr.pushBubble(tid, 'assistant', finalAnswer)
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
