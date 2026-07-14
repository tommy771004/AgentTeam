/**
 * Canonical task-run seam.
 *
 * Phase 3 ownership:
 *   item 1 — ingress (`runTask` / `coordinateTaskRun`)
 *   item 2 — capacity · attachments · thread bind · beforeRun (once)
 *   item 3 — build `RunDispatchSnapshot`; runDispatch only selects runner
 *   item 4/5 — unique finalization order; only finalization drains
 *
 * Store/hook dependencies are loaded lazily so pure helpers (normalizeTaskRunInput)
 * stay importable without pulling the full renderer graph.
 */

import type {
  ChatAttachment,
  LlmSettings,
  LoopType,
  RuntimeOverrides,
} from './types'
import type {
  ExternalRunOpts,
  ExternalRunResult,
  RunSourceKind,
} from './runExternal'
import type { DispatchResult } from './runDispatch'
import type { HookEvaluation } from './hooks'
import type { ThreadRunner } from '../store/threadStore'

export type { ExternalRunOpts, ExternalRunResult, RunSourceKind }
export type TaskRunInput = ExternalRunOpts
export type TaskRunResult = ExternalRunResult

/**
 * Normalize only the canonical ingress field; preserve the caller object and
 * every lifecycle option so queue/retry/automation semantics stay intact.
 */
export function normalizeTaskRunInput(input: TaskRunInput): TaskRunInput {
  const objective = input.objective.trim()
  return objective === input.objective ? input : { ...input, objective }
}

export type AttachmentPrepPhase = 'persist' | 'hydrate' | 'full'

export type PrepareAttachmentsOpts = {
  projectRoot?: string
  sessionId?: string
  /**
   * - `persist` (default): normalize + materialize once for queue-safe filePath
   * - `hydrate`: restore dataUrls only (after admit; never re-materialize)
   * - `full`: all three steps once (tests / one-shot callers)
   */
  phase?: AttachmentPrepPhase
}

/**
 * Single attachment pipeline owned by the coordinator.
 * Each phase runs at most once per run; runDispatch must not call this.
 */
export async function prepareRunAttachments(
  attachments: ChatAttachment[] | undefined,
  opts: PrepareAttachmentsOpts = {},
): Promise<ChatAttachment[] | undefined> {
  if (!attachments?.length) return attachments
  const phase = opts.phase || 'persist'
  try {
    const {
      materializeAttachmentsOnDisk,
      normalizeImageAttachmentsForVision,
      hydrateAttachmentsFromDisk,
    } = await import('../lib/chatAttachments')
    let next = attachments
    if (phase === 'persist' || phase === 'full') {
      next = await normalizeImageAttachmentsForVision(next)
      next = await materializeAttachmentsOnDisk(next, {
        projectRoot: opts.projectRoot,
        sessionId: opts.sessionId,
      })
    }
    if (phase === 'hydrate' || phase === 'full') {
      next = await hydrateAttachmentsFromDisk(next)
    }
    return next
  } catch {
    return attachments
  }
}

export type CapacityCheck = {
  allowed: boolean
  active: number
  limit: number
  reason?: string
}

/** Read current capacity without reserving. Idempotent for an already-reserved runId. */
export async function checkRunCapacity(
  runId: string,
  threadId?: string,
): Promise<CapacityCheck> {
  const { useAgentStore } = await import('../store/agentStore')
  return useAgentStore.getState().canStartRun(runId, threadId)
}

/**
 * Reserve one capacity slot for this runId. Same runId is re-entrant (true).
 * Returns false when the concurrent cap blocks a new reservation.
 */
export async function reserveRunCapacity(
  runId: string,
  threadId: string | undefined,
  kind: 'builtin' | 'cli',
): Promise<boolean> {
  const { useAgentStore } = await import('../store/agentStore')
  return useAgentStore.getState().reserveRun(runId, threadId, kind)
}

/** Release a previously reserved slot (hook deny / early failure before dispatch). */
export async function releaseRunCapacity(runId: string): Promise<void> {
  const { useAgentStore } = await import('../store/agentStore')
  useAgentStore.getState().releaseRun(runId)
}

export type BindRunThreadOpts = {
  runId: string
  objective: string
  title?: string
  reuseThreadId?: string
  runner?: ThreadRunner
  /** Force-create with this loop pin; null leaves auto until user pins. */
  loopType?: LoopType | null
  thinkingDepth?: 'standard' | 'deep' | 'max'
  /**
   * Phase 3 item 7: create a hidden worker thread (background delegate).
   * Does not steal active selection or open the run panel.
   */
  hidden?: boolean
}

export type BoundRunThread = {
  threadId: string
  /** True when an existing thread was reused. */
  reused: boolean
}

/**
 * Bind a reserved run to a conversation thread: create or reuse, select,
 * clear plan, show panel, bindRun, set running flags.
 * Call once after capacity is reserved; never from runDispatch.
 */
export async function bindRunThread(opts: BindRunThreadOpts): Promise<BoundRunThread> {
  const [{ useThreadStore }, { useAgentStore }] = await Promise.all([
    import('../store/threadStore'),
    import('../store/agentStore'),
  ])
  const thr = useThreadStore.getState()
  if (!thr.activeId && thr.threads.length === 0) thr.hydrate()

  let tid = opts.reuseThreadId || ''
  const existing = tid ? thr.threads.find((t) => t.id === tid) : null
  let reused = Boolean(existing)

  if (!existing) {
    tid = thr.createThread({
      title: (opts.title || opts.objective).slice(0, 48),
      loopType: opts.loopType ?? null,
      thinkingDepth: opts.thinkingDepth || 'standard',
      runner: opts.runner || 'builtin',
      hidden: opts.hidden === true ? true : undefined,
    })
    reused = false
  }

  const isHidden =
    opts.hidden === true ||
    Boolean(useThreadStore.getState().threads.find((t) => t.id === tid)?.hidden)

  // Worker threads must not steal the user's active conversation focus.
  if (!isHidden) {
    thr.selectThread(tid)
    thr.setShowRunPanel(true)
  }
  if (opts.runner) thr.setRunner(tid, opts.runner)
  thr.clearRunPlan(tid)
  useAgentStore.getState().bindRun(opts.runId, tid)
  thr.setThreadRunning(tid, true, opts.runId)
  thr.setAwaitingReply(tid, false)
  thr.setThreadStatus(tid, 'running')

  return { threadId: tid, reused }
}

export type BeforeRunHookOpts = {
  settings: LlmSettings
  sourceKind?: RunSourceKind
  objective: string
  threadId: string
  runId: string
}

export type BeforeRunHookResult =
  | { ok: true; appendTexts: string[]; audits: string[]; notifications: string[] }
  | {
      ok: false
      denyReason: string
      audits: string[]
      notifications: string[]
      /** afterRun audits already applied for deny path */
      afterAudits: string[]
      afterNotifications: string[]
    }

/**
 * Evaluate beforeRun hooks once under coordinator ownership.
 * On deny, caller still owns release/onSettled/drain (finalization later).
 */
export async function evaluateBeforeRunHooks(
  opts: BeforeRunHookOpts,
): Promise<BeforeRunHookResult> {
  try {
    const [{ collectHookRules, evaluateHooks }, { useThreadStore }] = await Promise.all([
      import('./hooks'),
      import('../store/threadStore'),
    ])
    const rules = collectHookRules(opts.settings)
    const thr = useThreadStore.getState()
    const ev: HookEvaluation = evaluateHooks(rules, {
      point: 'beforeRun',
      sourceKind: opts.sourceKind,
      objective: opts.objective,
    })
    for (const line of ev.audits) thr.pushBubble(opts.threadId, 'system', line)
    for (const n of ev.notifications) {
      void window.subagents?.notify?.('SubAgents AI · Hook', n.slice(0, 160))
    }
    if (ev.deny) {
      // afterRun is owned by finalizeTaskRun — do not evaluate it here.
      return {
        ok: false,
        denyReason: ev.deny.reason,
        audits: ev.audits,
        notifications: ev.notifications,
        afterAudits: [],
        afterNotifications: [],
      }
    }
    return {
      ok: true,
      appendTexts: ev.appendTexts,
      audits: ev.audits,
      notifications: ev.notifications,
    }
  } catch {
    /* hook infra must never break runs */
    return { ok: true, appendTexts: [], audits: [], notifications: [] }
  }
}

// ── Phase 3 item 3: dispatch snapshot ─────────────────────────────

/**
 * Frozen fields for one adapter dispatch. Built once after admit; runDispatch
 * must not re-read capacity, materialize attachments, or invent a new runId.
 */
export type RunDispatchSnapshot = {
  runId: string
  threadId: string
  /** Goal text for the adapter (continueGoal may differ from the user phrase). */
  objective: string
  runner: ThreadRunner
  forceLoopType?: LoopType
  /** Coordinator-prepared attachments (persist + hydrate already done). */
  attachments: ChatAttachment[]
  /** Full runtime overrides; always carries runId / threadId / deferFinalization. */
  overrides: RuntimeOverrides
}

/** Build the immutable dispatch snapshot after capacity/thread/beforeRun admit. */
export function buildRunDispatchSnapshot(parts: {
  runId: string
  threadId: string
  objective: string
  runner?: ThreadRunner
  forceLoopType?: LoopType
  attachments?: ChatAttachment[]
  overrides: RuntimeOverrides
}): RunDispatchSnapshot {
  const attachments =
    parts.attachments || parts.overrides.userAttachments || ([] as ChatAttachment[])
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
      // Adapter must not archive / release / drain — finalization owns that once.
      deferFinalization: true,
    },
  }
}

// ── Phase 3 item 4/5: unique finalization + single drain ──────────

export type FinalizeTaskRunInput = {
  runId: string
  threadId: string
  objective: string
  sourceKind?: RunSourceKind
  projectRoot?: string
  settings: LlmSettings
  /** Present after a successful dispatchThreadTask return (including failed status). */
  dispatchResult?: DispatchResult
  onSettled?: (result: ExternalRunResult) => void | Promise<void>
  /**
   * Early terminal without adapter execution (hook deny / exception).
   * Skips thread process summary derived from agent state.
   */
  early?: { error: string; path?: 'builtin' | 'cli' }
}

/**
 * Single finalization sequence for every terminal outcome:
 *   thread summary/bubble → afterRun → Archive → onSettled → release capacity → drain
 *
 * Learning still fires inside adapters (engine/CLI) before they return; moving
 * that is deferred so outcome semantics stay stable.
 *
 * Only this function (and early/deny paths that call it) may drain the queue.
 */
export async function finalizeTaskRun(
  input: FinalizeTaskRunInput,
): Promise<ExternalRunResult> {
  const [{ useAgentStore }, { useThreadStore }, { drainExternalRunQueue }] =
    await Promise.all([
      import('../store/agentStore'),
      import('../store/threadStore'),
      import('./runQueue'),
    ])

  const thr = useThreadStore.getState()
  const { runId, threadId: tid, objective, settings } = input

  const drainOnce = () => {
    void drainExternalRunQueue((o) =>
      runTask({
        ...o,
        _fromQueue: true,
        sourceKind: o.sourceKind || 'queue-drain',
      }),
    )
  }

  const settle = async (result: ExternalRunResult) => {
    try {
      await input.onSettled?.(result)
    } catch {
      /* caller errors non-fatal */
    }
  }

  // ── Early terminal (hook deny / exception before or during dispatch) ──
  if (input.early) {
    thr.setThreadStatus(tid, 'failed')
    thr.setThreadRunning(tid, false, runId)
    thr.pushBubble(tid, 'system', input.early.error)
    try {
      const { collectHookRules, evaluateHooks } = await import('./hooks')
      const ev = evaluateHooks(collectHookRules(settings), {
        point: 'afterRun',
        sourceKind: input.sourceKind,
        objective,
      })
      for (const line of ev.audits) thr.pushBubble(tid, 'system', line)
      for (const n of ev.notifications) {
        void window.subagents?.notify?.('SubAgents AI · Hook', n.slice(0, 160))
      }
    } catch {
      /* non-fatal */
    }
    const failResult: ExternalRunResult = {
      path: input.early.path || 'builtin',
      status: 'failed',
      error: input.early.error,
      threadId: tid,
      runId,
    }
    try {
      const agent = useAgentStore.getState()
      await agent.saveToArchive(agent.getRunState(runId) || undefined, runId)
    } catch {
      /* archive optional on early fail */
    }
    await settle(failResult)
    await releaseRunCapacity(runId)
    thr.setThreadRunning(tid, false, runId)
    drainOnce()
    return failResult
  }

  const result = input.dispatchResult || {
    path: 'builtin' as const,
    status: 'failed',
    error: 'missing dispatch result',
  }
  const finalAgent =
    useAgentStore.getState().getRunState(runId) || useAgentStore.getState().agent
  const postState = finalAgent.postState

  // 1) Thread summary / bubbles / plan
  if (postState?.status === 'failed') {
    thr.pushBubble(
      tid,
      'system',
      `Next_State=${postState.nextState}：${postState.error || 'delivery failed'}`,
    )
  } else if (postState?.status === 'delivered') {
    thr.pushBubble(
      tid,
      'system',
      `Next_State=Dispatch Webhook 已送出：${postState.target || 'target'}${postState.responseStatus ? ` · HTTP ${postState.responseStatus}` : ''}`,
    )
  }

  try {
    const { syncOpenCodeSessionMapping } = await import('./runExternal')
    await syncOpenCodeSessionMapping(tid, finalAgent.externalRun)
  } catch {
    /* OpenCode mapping is optional; keep finalization resilient. */
  }

  if (finalAgent.steps?.length > 0) {
    thr.setRunPlan(
      tid,
      finalAgent.steps.map((step) => ({
        id: `step_${step.step}`,
        text: step.description || step.action || `步驟 ${step.step}`,
        status:
          step.status === 'COMPLETED'
            ? ('done' as const)
            : step.status === 'FAILED'
              ? ('failed' as const)
              : step.status === 'IN_PROGRESS'
                ? ('active' as const)
                : ('pending' as const),
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

  const stepsTail = (finalAgent.steps || [])
    .filter((step) => step.result)
    .slice(-3)
    .map((step) => step.result)
    .join('\n\n')
  const finalAnswer =
    finalAgent.result || stepsTail || result.result || `狀態：${status}`
  const hasFinalAnswer = !(result.error && result.status === 'failed' && !result.result)
  if (!hasFinalAnswer) {
    thr.pushBubble(tid, 'system', result.error || finalAgent.haltReason || '執行失敗')
  }

  try {
    await pushRunProcessSummary({
      thr,
      tid,
      runId,
      finalAgent,
      result,
      status: String(status),
      projectRoot: input.projectRoot,
    })
  } catch {
    /* execution summary must not break the task lifecycle */
  }

  if (hasFinalAnswer) {
    thr.pushBubble(tid, 'assistant', finalAnswer)
  }
  thr.setThreadRunning(tid, false, runId)
  thr.setAwaitingReply(tid, finalAgent.loopConfig?.nextState === 'Await User Input')

  const finalResult: ExternalRunResult = {
    ...result,
    threadId: tid,
    runId,
    status: result.status || finalAgent.status,
    error: result.error || finalAgent.haltReason,
    postState,
  }

  // 2) afterRun hooks
  try {
    const { collectHookRules, evaluateHooks } = await import('./hooks')
    const ev = evaluateHooks(collectHookRules(settings), {
      point: 'afterRun',
      sourceKind: input.sourceKind,
      objective,
    })
    for (const line of ev.audits) thr.pushBubble(tid, 'system', line)
    for (const n of ev.notifications) {
      void window.subagents?.notify?.('SubAgents AI · Hook', n.slice(0, 160))
    }
  } catch {
    /* non-fatal */
  }

  // 3) Archive (once; adapters with deferFinalization skipped their own write)
  try {
    if (['success', 'failed', 'halted'].includes(String(finalResult.status))) {
      await useAgentStore.getState().saveToArchive(finalAgent, runId)
    }
  } catch {
    /* archive must not block release/drain */
  }

  // 4) onSettled
  await settle(finalResult)

  // 5) release capacity
  await releaseRunCapacity(runId)

  // 6) queue drain — only finalization may drain
  drainOnce()

  return finalResult
}

async function pushRunProcessSummary(args: {
  thr: ReturnType<typeof import('../store/threadStore').useThreadStore.getState>
  tid: string
  runId: string
  finalAgent: import('./types').AgentState
  result: DispatchResult
  status: string
  projectRoot?: string
}): Promise<void> {
  const { thr, tid, runId, finalAgent, result, status } = args
  const { useRunActivityStore } = await import('../store/runActivityStore')
  const {
    useSubDesignStore,
  } = await import('../store/subDesignStore')
  const { useSubDesignArtifactStore } = await import('../store/subDesignArtifactStore')
  const { useSubDesignCritiqueStore } = await import('../store/subDesignCritiqueStore')
  const { useSubDesignExportStore } = await import('../store/subDesignExportStore')

  const presentation = useRunActivityStore.getState().getPresentation(runId)
  const activityOperations = (presentation?.events || [])
    .filter((event) => event.kind !== 'thought' && event.kind !== 'text')
    .map((event) => ({
      id: event.id,
      kind: event.kind,
      title: event.title || event.kind,
      detail: event.detail,
      path: event.path,
      ok: event.ok,
    }))
  const fallbackOperations = (finalAgent.toolCalls || []).map((tool) => ({
    id: tool.id,
    kind: /write|edit|create|patch/i.test(tool.tool) ? 'file' : 'tool',
    title: /bash|shell/i.test(tool.tool) ? '已執行指令' : `已執行 ${tool.tool}`,
    detail:
      typeof tool.input?.command === 'string'
        ? tool.input.command
        : tool.output?.slice(0, 400),
    path:
      String(tool.input?.path ?? tool.input?.file ?? tool.input?.filePath ?? '') ||
      undefined,
    ok: tool.ok,
  }))
  const fileMap = new Map<
    string,
    { path: string; action: string; added?: number; removed?: number }
  >()
  for (const file of presentation?.fileChanges || []) {
    fileMap.set(file.path, file)
  }
  for (const tool of finalAgent.toolCalls || []) {
    if (!/write|edit|create|patch/i.test(tool.tool)) continue
    const path = String(tool.input?.path ?? tool.input?.file ?? tool.input?.filePath ?? '')
    if (path && !fileMap.has(path)) {
      fileMap.set(path, {
        path,
        action: /write|create/i.test(tool.tool) ? 'create' : 'edit',
      })
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
      const projectRoot = args.projectRoot || useProjectStore.getState().root || undefined
      const diffResult = await window.subagents?.tools?.workspaceDiff?.(
        [...fileMap.keys()],
        projectRoot,
      )
      if (diffResult?.ok && diffResult.diff.trim()) {
        diff = diffResult.diff.slice(0, 200_000)
      }
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
    ? useSubDesignCritiqueStore
        .getState()
        .latestForArtifact(subDesignArtifact.id, subDesignArtifact.revision)
    : null
  const subDesignExports = subDesignArtifact
    ? useSubDesignExportStore.getState().findByArtifactId(subDesignArtifact.id)
    : []
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
                blockerCount: subDesignCritique.findings.filter(
                  (finding) => finding.severity === 'blocker',
                ).length,
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
}

/**
 * Coordinate one task run through the existing lifecycle implementation.
 * The dynamic import is intentional: it keeps the legacy compatibility module
 * from creating a runtime import cycle while the implementation is migrated.
 */
export async function coordinateTaskRun(
  input: TaskRunInput,
): Promise<TaskRunResult> {
  const normalized = normalizeTaskRunInput(input)
  const { runExternalObjective } = await import('./runExternal')
  return runExternalObjective(normalized)
}

/** Canonical API for new code. */
export async function runTask(input: TaskRunInput): Promise<TaskRunResult> {
  return coordinateTaskRun(input)
}
