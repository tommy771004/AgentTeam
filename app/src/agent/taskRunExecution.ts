/**
 * Internal Task run execution owner behind the canonical coordinator seam.
 * Every entry funnels through `runTask`. Capacity, attachments, thread bind,
 * beforeRun, dispatch snapshot, and finalization each execute once.
 *
 * When busy: policy decides queue / steer / reject — no caller re-implements lifecycle.
 */

import { v4 as uuid } from 'uuid'
import type {
  AgentState,
  ChatAttachment,
  EventTriggerSnapshot,
  ExternalRunRef,
  LoopType,
  RuntimeOverrides,
  ScheduleTriggerSnapshot,
} from './types'
import { dispatchThreadTask } from './runDispatch'
import {
  bindRunThread,
  checkRunCapacity,
  evaluateBeforeRunHooks,
  finalizeTaskRun,
  prepareRunAttachments,
  reserveRunCapacity,
} from './taskRunLifecycleSupport'
import { useAgentStore } from '../store/agentStore'
import { useThreadStore, type ThreadRunner } from '../store/threadStore'
import { useSettingsStore } from '../store/settingsStore'
import {
  enqueueExternalRun,
  listQueuedRuns,
  queueLength,
} from './runQueue'
import { isContinueGoalPhrase } from './chatHistory'
import {
  detectAutomationSuggestion,
  formatAutomationSuggestion,
  type AutomationSuggestion,
} from './automationSuggestion.ts'
import { resolvePlanBubbleMetadata } from './parser'
import { validateEventTriggerSnapshot } from './eventMatcher'
import {
  isClaimedScheduleTrigger,
  validateScheduleTriggerSnapshot,
} from './scheduler'
import { normalizeTaskObjective } from './taskRunInput'
import type {
  ExternalRunOpts,
  ExternalRunResult,
  RunDispatchSnapshot,
  RunSourceKind,
  TaskRunInput,
  TaskRunResult,
} from './taskRunContracts'

function buildRunDispatchSnapshot(parts: {
  runId: string
  threadId: string
  objective: string
  runner?: ThreadRunner
  forceLoopType?: LoopType
  attachments?: ChatAttachment[]
  overrides: RuntimeOverrides
}): RunDispatchSnapshot {
  const attachments = parts.attachments || parts.overrides.userAttachments || []
  const forceLoopType =
    parts.forceLoopType ||
    (parts.overrides.loopTypeMode === 'force'
      ? parts.overrides.forceLoopType
      : undefined)
  return {
    runId: parts.runId,
    threadId: parts.threadId,
    objective: parts.objective.trim(),
    runner: parts.runner || 'builtin',
    forceLoopType,
    attachments: attachments.slice(),
    overrides: {
      ...parts.overrides,
      runId: parts.runId,
      threadId: parts.threadId,
      userAttachments: attachments.length
        ? attachments
        : parts.overrides.userAttachments,
      forceLoopType: forceLoopType || parts.overrides.forceLoopType,
      loopTypeMode: forceLoopType
        ? 'force'
        : parts.overrides.loopTypeMode || 'auto',
      deferFinalization: true,
    },
  }
}

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

/** Normalize ingress without mutating the caller-owned request. */
function normalizeTaskRunInput(input: TaskRunInput): TaskRunInput {
  return normalizeTaskObjective(input)
}

/**
 * Pull the server-owned todo/children snapshot into the local Thread after a
 * server run. Failures are intentionally non-fatal: the completed session and
 * local transcript remain authoritative when an older server lacks an endpoint.
 */
/** Exported for coordinator finalization (Phase 3 item 4). */
export async function syncOpenCodeSessionMapping(
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

function explicitLoopTypeForConversation(opts: ExternalRunOpts): LoopType | undefined {
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

function isInteractiveConversationSource(opts: ExternalRunOpts): boolean {
  return opts.sourceKind === 'composer' || opts.sourceKind === 'slash'
}

type ScheduleTriggerResolution =
  | { snapshot: ScheduleTriggerSnapshot }
  | { error: string }
  | null

type ProactiveTriggerResolution =
  | { snapshot: EventTriggerSnapshot }
  | { error: string }
  | null

/**
 * Time-based is an execution mode, not a conversational keyword. It can only
 * enter through a schedule source carrying the proof minted by claimDueJobs.
 */
function resolveScheduleTrigger(opts: ExternalRunOpts): ScheduleTriggerResolution {
  if (explicitLoopTypeForConversation(opts) !== 'Time-based') return null
  if (opts.sourceKind !== 'schedule') {
    return {
      error: 'Time-based 僅能由有效 ScheduledJob 到期 trigger 進入。',
    }
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

/** Proactive is entered only with matcher-produced boolean predicate evidence. */
function resolveProactiveTrigger(opts: ExternalRunOpts): ProactiveTriggerResolution {
  if (explicitLoopTypeForConversation(opts) !== 'Proactive') return null
  const candidate = opts.overrides?.eventTrigger || opts.meta?.eventTrigger
  const validation = validateEventTriggerSnapshot(candidate)
  return validation.ok
    ? { snapshot: validation.snapshot }
    : { error: `Proactive trigger 無效：${validation.reason}` }
}

async function verifyClaimedScheduleTrigger(
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
 * Present a consent-first suggestion without reserving a run or entering the
 * engine. This is the lifecycle seam that keeps conversational trigger words
 * from becoming executable Time/Proactive runs.
 */
function presentConversationAutomationSuggestion(
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

/**
 * Run an objective through the complete Task run lifecycle.
 */
export type TaskRunExecutionDeps = {
  reenterTask: (input: TaskRunInput) => Promise<TaskRunResult>
}

export async function executeTaskRun(
  input: TaskRunInput,
  deps: TaskRunExecutionDeps,
): Promise<TaskRunResult> {
  const opts = normalizeTaskRunInput(input)
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

  const runId = opts.runId || `run_${uuid().slice(0, 12)}`

  const scheduleTriggerResolution = resolveScheduleTrigger(opts)
  const proactiveTriggerResolution = resolveProactiveTrigger(opts)
  const rejectBeforeStart = async (error: string): Promise<ExternalRunResult> => {
    const threadId = opts.reuseThreadId || useThreadStore.getState().activeId || null
    if (threadId && (opts.reuseThreadId || isInteractiveConversationSource(opts))) {
      useThreadStore.getState().pushBubble(threadId, 'system', error)
    }
    const rejected: ExternalRunResult = {
      path: 'builtin',
      status: 'failed',
      error,
      threadId,
      runId,
    }
    try {
      await opts.onSettled?.(rejected)
    } catch {
      /* caller errors are non-fatal */
    }
    return rejected
  }
  if (scheduleTriggerResolution && 'error' in scheduleTriggerResolution) {
    return rejectBeforeStart(scheduleTriggerResolution.error)
  }
  if (proactiveTriggerResolution && 'error' in proactiveTriggerResolution) {
    return rejectBeforeStart(proactiveTriggerResolution.error)
  }
  const scheduleTrigger =
    scheduleTriggerResolution && 'snapshot' in scheduleTriggerResolution
      ? scheduleTriggerResolution.snapshot
      : undefined
  const eventTrigger =
    proactiveTriggerResolution && 'snapshot' in proactiveTriggerResolution
      ? proactiveTriggerResolution.snapshot
      : undefined
  if (scheduleTrigger) {
    const claimError = await verifyClaimedScheduleTrigger(scheduleTrigger)
    if (claimError) {
      return rejectBeforeStart(`Time-based trigger 無效：${claimError}`)
    }
  }

  // Coordinator owns attachment I/O: materialize once early so queue keeps filePath.
  // Hydrate happens once after capacity is reserved (below).
  const { useProjectStore } = await import('../store/projectStore')
  const attachmentProjectRoot =
    opts.projectRoot || useProjectStore.getState().root || undefined
  const attachmentSessionId = opts.reuseThreadId || opts.meta?.scheduleJobId
  let attachments = await prepareRunAttachments(opts.attachments, {
    projectRoot: attachmentProjectRoot,
    sessionId: attachmentSessionId,
    phase: 'persist',
  })

  // Conversation text can mention a schedule or event, but that is not a
  // validated trigger. Keep the request in the chat as an advisory proposal;
  // no capacity reservation, engine start, or tool call is allowed here.
  const conversationSuggestion =
    !opts._fromQueue &&
    isInteractiveConversationSource(opts) &&
    !explicitLoopTypeForConversation(opts)
      ? detectAutomationSuggestion(objective)
      : null
  if (conversationSuggestion) {
    return presentConversationAutomationSuggestion(
      opts,
      objective,
      conversationSuggestion,
    )
  }

  // Coordinator owns capacity: check once, then reserve once.
  const agent = useAgentStore.getState()
  let capacity = await checkRunCapacity(runId, opts.reuseThreadId)
  if (!capacity.allowed) {
    const policy: BusyPolicy = opts.sourceKind
      ? resolveBusyPolicy(
          opts.sourceKind,
          useSettingsStore.getState().settings.followUpMode,
        )
      : shouldEnqueueWhenBusy(opts)
        ? 'queue'
        : 'reject'

    const thrBusy = useThreadStore.getState()
    const busyThreadId = opts.reuseThreadId || thrBusy.runningThreadId || thrBusy.runningThreadIds[0]
    const busyRunId = opts.reuseThreadId
      ? agent.getRunIdForThread(opts.reuseThreadId)
      : agent.selectedRunId || agent.activeRunIds[0]
    const runningTitle = busyThreadId
      ? thrBusy.threads.find((t) => t.id === busyThreadId)?.title?.slice(0, 32)
      : undefined

    if (policy === 'steer' && !opts._fromQueue) {
      // Interactive steer: capture partial digest, abort, then proceed
      const tid0 = opts.reuseThreadId || thrBusy.activeId
      const partial = buildSteerPartialDigest(agent.getRunState(busyRunId || undefined) || agent.agent)
      if (tid0) {
        const lines = [
          `轉向目前執行：已中止前一個任務${runningTitle ? `（${runningTitle.slice(0, 32)}）` : ''}`,
        ]
        if (partial) lines.push('', '### 中止前摘要', partial)
        thrBusy.pushBubble(tid0, 'system', lines.join('\n'))
      }
      if (busyRunId) useAgentStore.getState().stopExecution(busyRunId)
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 50))
        capacity = await checkRunCapacity(runId, opts.reuseThreadId)
        if (capacity.allowed) break
      }
    } else if (policy === 'queue' && !opts._fromQueue) {
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
          error: `並行執行上限 ${capacity.limit}${runningTitle ? `（${runningTitle}）` : ''} — 已加入佇列第 ${posLabel} 位（${queueLength()}/24）`,
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
        error: `並行執行上限 ${capacity.limit}${runningTitle ? `（${runningTitle}）` : ''} — 佇列已滿或重複`,
        threadId: opts.reuseThreadId || thrBusy.activeId,
        runId,
        skipped: true,
        skipReason: 'busy',
      }
    }
    if (!capacity.allowed) {
      return {
        path: 'builtin',
        status: 'skipped',
        error: `並行執行上限 ${capacity.limit}${runningTitle ? `（${runningTitle}）` : ''}，請稍候或改用佇列模式`,
        threadId: thrBusy.activeId,
        runId,
        skipped: true,
        skipReason: 'busy',
      }
    }
  }

  const reserveKind: 'builtin' | 'cli' =
    opts.runner && opts.runner !== 'builtin' ? 'cli' : 'builtin'
  if (!(await reserveRunCapacity(runId, opts.reuseThreadId, reserveKind))) {
    const retryCapacity = await checkRunCapacity(runId, opts.reuseThreadId)
    if (!opts._fromQueue && (opts.sourceKind ? resolveBusyPolicy(opts.sourceKind, useSettingsStore.getState().settings.followUpMode) : 'queue') === 'queue') {
      const item = enqueueExternalRun({ ...opts, runId, attachments, unattended: opts.unattended ?? isAutomationSource(opts) })
      if (item) return { path: 'builtin', status: 'skipped', error: `並行執行上限 ${retryCapacity.limit}，已加入佇列`, threadId: opts.reuseThreadId || null, runId, skipped: true, skipReason: 'queued', queued: true, queueId: item.id }
    }
    return { path: 'builtin', status: 'skipped', error: `並行執行上限 ${retryCapacity.limit}，請稍候`, threadId: opts.reuseThreadId || null, runId, skipped: true, skipReason: 'busy' }
  }

  const settings = useSettingsStore.getState().settings
  const thr = useThreadStore.getState()

  // continueGoal needs the existing thread snapshot before bind creates/reuses.
  const preBindId = opts.reuseThreadId || ''
  const existing = preBindId ? thr.threads.find((t) => t.id === preBindId) : null
  const existingSnap = existing?.continueGoal || undefined
  let wantContinue = Boolean(
    existingSnap &&
      (opts.continueGoal === true || isContinueGoalPhrase(objective)),
  )
  // Phase 5: only runners that declare continueGoal may resume DoD/missing.
  // External CLI must not silently ignore gaps.
  const intendedRunner = opts.runner || existing?.runner || 'builtin'
  let continueBlockedNote: string | undefined
  if (wantContinue) {
    const { capabilitiesForRunner } = await import('./runners')
    if (!capabilitiesForRunner(intendedRunner).continueGoal) {
      wantContinue = false
      continueBlockedNote =
        '目前 runner 為外部 CLI（或不支援 continueGoal）。「補齊缺口繼續」僅適用內建引擎；已改為一般任務執行。請切換 runner 為 builtin 後再試，或重新描述任務。'
    }
  }
  const continueSnap = wantContinue ? existingSnap : undefined

  // Conversation default: omit loopType → auto classify (Chat-lite / Goal).
  // Continue-goal forces Goal-based; automation / UI pin still force.
  const forcedLoopType = continueSnap
    ? ('Goal-based' as LoopType)
    : opts.loopType
  const loopTypeMode: 'force' | 'auto' = forcedLoopType ? 'force' : 'auto'

  // Coordinator owns thread bind once after capacity is reserved.
  const { threadId: tid } = await bindRunThread({
    runId,
    objective,
    title: opts.title,
    reuseThreadId: opts.reuseThreadId,
    runner: opts.runner,
    loopType: forcedLoopType || null,
    hidden: opts.workerThread === true,
  })
  if (!opts.skipUserBubble) {
    thr.pushBubble(tid, 'user', objective, attachments)
  }
  if (continueBlockedNote) {
    thr.pushBubble(tid, 'system', continueBlockedNote)
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

  const planBubbleMetadata = resolvePlanBubbleMetadata({
    mode: loopTypeMode,
    sourceKind: opts.sourceKind || opts.overrides?.sourceKind,
    triggerSource: opts.overrides?.triggerSource,
    sourceLabel: opts.sourceLabel,
    classificationReason: opts.overrides?.classificationReason,
    loopType: forcedLoopType,
    continueGoal: Boolean(continueSnap),
  })

  // Hydrate once under coordinator ownership for vision / CLI (after admit).
  attachments = await prepareRunAttachments(attachments, {
    projectRoot: attachmentProjectRoot,
    sessionId: attachmentSessionId || tid,
    phase: 'hydrate',
  })

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
    triggerSource: planBubbleMetadata.triggerSource,
    classificationReason: planBubbleMetadata.classificationReason,
    scheduleTrigger,
    eventTrigger,
    agentMode:
      opts.overrides?.agentMode ||
      thr.threads.find((thread) => thread.id === tid)?.agentMode ||
      'build',
    eventPreMatched: Boolean(eventTrigger),
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

  // Coordinator owns beforeRun once: deny / append-context / log / notify
  const beforeRun = await evaluateBeforeRunHooks({
    settings,
    sourceKind: opts.sourceKind,
    objective,
    threadId: tid,
    runId,
  })
  if (!beforeRun.ok) {
    // Finalization owns afterRun / Archive / onSettled / release / drain once.
    return finalizeTaskRun({
      runId,
      threadId: tid,
      objective,
      sourceKind: opts.sourceKind,
      projectRoot: opts.projectRoot,
      settings,
      onSettled: opts.onSettled,
      reenterTask: deps.reenterTask,
      syncExternalSession: syncOpenCodeSessionMapping,
      early: {
        error: `執行被 hook 政策拒絕：${beforeRun.denyReason}`,
      },
    })
  }
  if (beforeRun.appendTexts.length) {
    overrides.extraSystemContext = [
      overrides.extraSystemContext,
      ...beforeRun.appendTexts.map((t) => `## Hook context\n${t}`),
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  // Phase 4 / R7: count user-initiated chat turns only (not success, not automation).
  // Queued items keep their original sourceKind; count once when the run actually admits.
  const userChatTurn =
    opts.sourceKind === 'composer' ||
    opts.sourceKind === 'slash' ||
    opts.sourceKind === 'retry'
  if (userChatTurn && !temporary) {
    try {
      const { learningLoop } = await import('./hermes/learning')
      learningLoop.onUserTurn()
    } catch {
      /* non-fatal */
    }
  }

  // Phase 3 item 3: freeze dispatch fields once; runDispatch only selects runner.
  // Pin project root on the snapshot so later UI project switches cannot leak in.
  if (!overrides.projectRoot) {
    overrides.projectRoot =
      opts.projectRoot?.trim() ||
      (await import('../store/projectStore')).useProjectStore.getState().root ||
      undefined
  }
  const snapshot = buildRunDispatchSnapshot({
    runId,
    threadId: tid,
    objective: dispatchObjective,
    runner: opts.runner,
    forceLoopType: forcedLoopType,
    attachments,
    overrides,
  })

  try {
    const result = await dispatchThreadTask(snapshot)
    return finalizeTaskRun({
      runId,
      threadId: tid,
      objective,
      sourceKind: opts.sourceKind,
      projectRoot: snapshot.overrides.projectRoot || opts.projectRoot,
      settings,
      dispatchResult: result,
      onSettled: opts.onSettled,
      reenterTask: deps.reenterTask,
      syncExternalSession: syncOpenCodeSessionMapping,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return finalizeTaskRun({
      runId,
      threadId: tid,
      objective,
      sourceKind: opts.sourceKind,
      projectRoot: snapshot.overrides.projectRoot || opts.projectRoot,
      settings,
      onSettled: opts.onSettled,
      reenterTask: deps.reenterTask,
      syncExternalSession: syncOpenCodeSessionMapping,
      early: { error: `執行失敗：${msg}` },
    })
  }
}
