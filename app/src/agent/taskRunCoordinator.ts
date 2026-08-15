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
  AgentState,
  ChatAttachment,
  LlmSettings,
  LoopType,
  RuntimeOverrides,
} from './types'
import type {
  ExternalRunOpts,
  ExternalRunResult,
  RunSourceKind,
} from './taskRunTypes'
import type { BusyPolicy } from './taskRunPolicy'
import type { DispatchResult } from './runDispatch'
import type { HookEvaluation } from './hooks'
import type { ThreadRunner } from '../store/threadStore'

import { v4 as uuid } from 'uuid'
import {
  recordRunAdmitted,
  recordRunStarted,
  recordRunTerminal,
  waitForStartupRecovery,
} from './runJournal.ts'

export type { ExternalRunOpts, ExternalRunResult, RunSourceKind }
export type TaskRunInput = ExternalRunOpts
export type TaskRunResult = ExternalRunResult

/** Prevent re-entrant callers from starting the same lifecycle twice. */
const coordinatingRunIds = new Set<string>()

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
  /** G7:hydrate 專案級 hooks(.subagents/hooks.json,需 folder trust) */
  projectRoot?: string
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
    // G7:先 hydrate 專案級 hooks(未信任專案靜默跳過),collect 才收得到
    try {
      const { hydrateProjectHooks } = await import('./projectHooks')
      const hydrated = await hydrateProjectHooks(opts.settings, opts.projectRoot)
      if (hydrated.loaded > 0) {
        useThreadStore
          .getState()
          .pushBubble(opts.threadId, 'system', `專案 hooks 已載入 ${hydrated.loaded} 條（.subagents/hooks.json）`)
      }
    } catch {
      /* project hooks must never break runs */
    }
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
  /** Full runtime overrides; always carries coordinator-owned run/thread identity. */
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
  early?: { error: string; path?: 'builtin' | 'cli'; agent?: AgentState }
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

  try {
    const { useRunActivityStore } = await import('../store/runActivityStore')
    useRunActivityStore.getState().setStatus('正在整理執行摘要…', runId)
  } catch {
    /* renderer activity is optional for headless / recovery paths */
  }

  // G8:plan mode 是 run-scoped 狀態,finalization 唯一出口負責釋放
  try {
    const { clearPlanMode } = await import('./planMode')
    clearPlanMode(runId)
  } catch {
    /* non-fatal */
  }

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
    // G11:每 run 一筆指標(finalization 唯一出口保證恰好一次)
    try {
      const { finalizeRunMetric } = await import('./metrics')
      finalizeRunMetric(runId, {
        sourceKind: input.sourceKind,
        path: result.path,
        status: result.status,
        ok: !result.error && !result.skipped,
      })
    } catch {
      /* metrics must never block finalization */
    }
    try {
      await input.onSettled?.(result)
    } catch {
      /* caller errors non-fatal */
    }
  }

  // ── Early terminal (hook deny / exception before or during dispatch) ──
  if (input.early) {
    recordRunTerminal({ runId, threadId: tid, status: 'failed' })
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
    const agent = useAgentStore.getState()
    const currentAgent = input.early.agent || agent.getRunState(runId)
    const failureAgent = currentAgent
      ? {
          ...currentAgent,
          id: currentAgent.id || runId,
          objective: currentAgent.objective || objective,
          status: 'failed' as const,
          progress: 100,
          result: input.early.error,
          haltReason: input.early.error,
          finishedAt: new Date().toISOString(),
          steps:
            currentAgent.steps.length > 0
              ? currentAgent.steps
              : [
                  {
                    step: 1,
                    action: 'task-run',
                    description: 'Task run lifecycle',
                    status: 'FAILED' as const,
                    result: input.early.error,
                  },
                ],
        }
      : undefined
    const failResult: ExternalRunResult = {
      path: input.early.path || 'builtin',
      status: 'failed',
      error: input.early.error,
      threadId: tid,
      runId,
    }
    await persistArtifactIndexForRun({
      threadId: tid,
      runId,
      objective,
      status: 'failed',
      result: input.early.error,
      blockers: [input.early.error],
      evidenceOperations: [],
      plan: [],
    })
    try {
      const agent = useAgentStore.getState()
      await agent.saveToArchive(failureAgent, runId)
    } catch {
      /* archive optional on early fail */
    }
    try {
      const { useRunActivityStore } = await import('../store/runActivityStore')
      useRunActivityStore.getState().end(runId, '失敗')
    } catch {
      /* renderer activity is optional for headless / recovery paths */
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
  const storedAgent =
    useAgentStore.getState().getRunState(runId) || useAgentStore.getState().agent
  const returnedStatus = result.status || storedAgent.status
  const runnerReturnedTerminal = ['success', 'failed', 'halted'].includes(
    String(returnedStatus),
  )
  const storedTerminal = ['success', 'failed', 'halted'].includes(
    String(storedAgent.status),
  )
  const nonTerminalReason = `runner returned non-terminal status: ${returnedStatus}`
  const needsFailureEvidence =
    (!runnerReturnedTerminal && !storedTerminal) ||
    ((result.status === 'failed' || result.error) &&
      storedAgent.status === 'idle' &&
      !storedAgent.objective)
  const finalAgent =
    needsFailureEvidence
      ? {
          ...storedAgent,
          id: storedAgent.id || runId,
          objective,
          status: 'failed' as const,
          progress: 100,
          result: result.error || nonTerminalReason,
          haltReason: result.error || nonTerminalReason,
          finishedAt: new Date().toISOString(),
          steps: [
            {
              step: 1,
              action: result.path === 'cli' ? 'local-cli' : 'task-run',
              description: result.path === 'cli' ? '外部 CLI 執行' : 'Task run lifecycle',
              status: 'FAILED' as const,
              result: result.error || nonTerminalReason,
            },
          ],
        }
      : storedAgent
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
    const { syncOpenCodeSessionMapping } = await import('./opencode/sessionSync.ts')
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
      objective,
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
    status: status as ExternalRunResult['status'],
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

  // 3) Archive (once; execution adapters never own this step)
  try {
    if (['success', 'failed', 'halted'].includes(String(finalResult.status))) {
      await useAgentStore.getState().saveToArchive(finalAgent, runId)
    }
  } catch {
    /* archive must not block release/drain */
  }

  // Persist the terminal marker only after the user-visible summary and
  // archive evidence have been attempted. A crash before this point remains
  // conservatively recoverable as interrupted instead of claiming a complete
  // run without its evidence.
  recordRunTerminal({ runId, threadId: tid, status: String(status) })

  try {
    const { useRunActivityStore } = await import('../store/runActivityStore')
    const terminalLabel =
      String(status) === 'failed'
        ? '失敗'
        : String(status) === 'halted'
          ? '已停止'
          : '完成'
    useRunActivityStore.getState().end(runId, terminalLabel)
  } catch {
    /* renderer activity is optional for headless / recovery paths */
  }

  // 4) onSettled
  await settle(finalResult)

  // 4b) dispose Restricted Project View (Outbound Data Gate) — never block release.
  // Ticket 25 / ADR-0008: on success, safe-writeback mapped text files before dispose.
  try {
    const writeback = String(status) === 'success'
    const disp = await window.subagents?.outbound?.disposeRunView?.(runId, { writeback })
    if (
      writeback &&
      disp &&
      typeof disp === 'object' &&
      'writeback' in disp &&
      disp.writeback &&
      disp.writeback.filesWritten > 0
    ) {
      thr.pushBubble(
        tid,
        'system',
        `出站資料閘門：安全回寫 ${disp.writeback.filesWritten} 檔（withheld ranges=${disp.writeback.withheldRanges}）`,
      )
    }
  } catch {
    /* non-fatal */
  }
  try {
    const { unpinRestrictedViewRootForRun } = await import('./outbound/sanitizedWorkspace.ts')
    unpinRestrictedViewRootForRun(runId)
  } catch {
    /* non-fatal */
  }

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
  objective: string
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
  const piHostAudits: Array<Record<string, unknown>> = []
  try {
    const listed = await window.subagents?.piHost?.sessions?.list?.()
    const session = (listed?.sessions || []).find((candidate) => {
      if (!candidate || typeof candidate !== 'object') return false
      return (candidate as { threadId?: unknown }).threadId === tid
    })
    const audits = session && typeof session === 'object' ? (session as { toolAudit?: unknown }).toolAudit : undefined
    if (Array.isArray(audits)) {
      for (const audit of audits) {
        if (audit && typeof audit === 'object') piHostAudits.push(audit as Record<string, unknown>)
      }
    }
  } catch {
    /* Pi Host evidence is optional; the run result remains authoritative. */
  }
  const piHostOperations = piHostAudits
    .filter((audit) => audit.phase === 'start')
    .map((audit, index) => {
      const tool = String(audit.tool || 'tool')
      const filePath = typeof audit.path === 'string' && audit.path ? audit.path : undefined
      const result = piHostAudits.find((candidate) => candidate.phase === 'result' && candidate.callId === audit.callId)
      return {
        id: `pi_${String(audit.callId || index)}`,
        kind: /write|edit/i.test(tool) ? 'file' : 'tool',
        title: filePath ? `已處理 ${filePath.split(/[\\/]/).pop()}` : `已執行 ${tool}`,
        detail: filePath || `Pi Host ${tool}`,
        path: filePath,
        ok: result ? result.settlement === 'success' : undefined,
      }
    })
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
  for (const audit of piHostAudits) {
    if (audit.phase !== 'start' || typeof audit.path !== 'string' || !/write|edit/i.test(String(audit.tool || ''))) continue
    const path = audit.path.trim()
    if (!path || fileMap.has(path)) continue
    fileMap.set(path, {
      path,
      action: /write/i.test(String(audit.tool || '')) ? 'create' : 'edit',
    })
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
      : piHostOperations.length > 0
        ? piHostOperations
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
    status:
      status === 'failed' ? 'failed' : status === 'halted' ? 'halted' : 'success',
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

  await persistArtifactIndexForRun({
    threadId: tid,
    runId,
    objective: args.objective,
    status,
    result: finalAgent.result || result.result || result.error,
    blockers: [
      ...(finalAgent.haltReason ? [finalAgent.haltReason] : []),
      ...operations
        .filter((operation) => operation.ok === false)
        .map((operation) => operation.title),
    ],
    decisions: plan.length ? [`執行計畫已保留為引用（${plan.length} 項）`] : [],
    suggestedNextSkills:
      status === 'success' ? ['code-review'] : ['tdd', 'code-review'],
    evidenceOperations: operations,
    plan,
    diff,
    projectRoot: args.projectRoot,
    review: subDesignCritique
      ? {
          source: `subdesign:${subDesignCritique.artifactId || 'artifact'}/critique`,
          status: subDesignCritique.verdict === 'pass' ? 'complete' : 'stale',
          detail: `${subDesignCritique.verdict}; ${subDesignCritique.findings.length} findings`,
        }
      : undefined,
  })
}

async function persistArtifactIndexForRun(args: {
  threadId: string
  runId: string
  objective: string
  status: string
  result?: string
  blockers?: string[]
  decisions?: string[]
  suggestedNextSkills?: string[]
  evidenceOperations: Array<{ id: string; kind: string; title: string; ok?: boolean }>
  plan: Array<{ id: string; text: string; status: string }>
  diff?: string
  projectRoot?: string
  review?: { source: string; status: 'complete' | 'failed' | 'stale' | 'missing'; detail?: string }
}): Promise<void> {
  try {
    const {
      buildArtifactEvidenceFromRun,
      recordArtifactRun,
    } = await import('./artifactIndex.ts')
    const storage = typeof window === 'undefined' ? undefined : window.localStorage
    if (!storage) return
    const evidence = buildArtifactEvidenceFromRun({
      threadId: args.threadId,
      runId: args.runId,
      objective: args.objective,
      status: args.status,
      result: args.result,
      diff: args.diff,
      projectRoot: args.projectRoot,
      operations: args.evidenceOperations,
      plan: args.plan,
      review: args.review,
    })
    recordArtifactRun(storage, {
      threadId: args.threadId,
      runId: args.runId,
      objective: args.objective,
      status: args.status,
      result: args.result,
      blockers: args.blockers,
      decisions: args.decisions,
      suggestedNextSkills: args.suggestedNextSkills,
      evidence,
    })
  } catch {
    /* Artifact indexing is best-effort and never changes run outcome. */
  }
}

/**
 * Coordinate one Task run: admission → immutable dispatch snapshot → adapter → finalization.
 * This is the only lifecycle implementation behind the public runTask seam.
 */
async function coordinateTaskRun(
  opts: ExternalRunOpts,
): Promise<ExternalRunResult> {
  opts = normalizeTaskRunInput(opts)
  const runId = opts.runId || `run_${uuid().slice(0, 12)}`
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

  const [
    { useAgentStore },
    { useThreadStore },
    { useSettingsStore },
    { dispatchThreadTask },
    { enqueueExternalRun, listQueuedRuns, queueLength },
    { isContinueGoalPhrase },
    { detectAutomationSuggestion },
    { resolvePlanBubbleMetadata },
    lifecycleHelpers,
  ] = await Promise.all([
    import('../store/agentStore.ts'),
    import('../store/threadStore.ts'),
    import('../store/settingsStore.ts'),
    import('./runDispatch.ts'),
    import('./runQueue.ts'),
    import('./chatHistory.ts'),
    import('./automationSuggestion.ts'),
    import('./parser.ts'),
    import('./taskRunPolicy.ts'),
  ])
  const {
    buildSteerPartialDigest,
    explicitLoopTypeForConversation,
    isAutomationSource,
    isInteractiveConversationSource,
    presentConversationAutomationSuggestion,
    resolveBusyPolicy,
    resolveProactiveTrigger,
    resolveScheduleTrigger,
    shouldEnqueueWhenBusy,
    verifyClaimedScheduleTrigger,
  } = lifecycleHelpers

  const queuedDuplicate = listQueuedRuns().find((queued) => queued.runId === runId)
  if (queuedDuplicate) {
    return {
      path: 'builtin',
      status: 'skipped',
      error: `runId ${runId} 已在佇列中，略過重入。`,
      threadId: opts.reuseThreadId || null,
      runId,
      skipped: true,
      skipReason: 'duplicate',
      queued: true,
      queueId: queuedDuplicate.id,
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

  if (opts.runId && useAgentStore.getState().activeRunIds.includes(runId)) {
    return {
      path: 'builtin',
      status: 'skipped',
      error: `runId ${runId} 已在執行中，略過重入。`,
      threadId: opts.reuseThreadId || null,
      runId,
      skipped: true,
      skipReason: 'duplicate',
    }
  }

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
    // Trigger validation happens before execution admission, so this never
    // archives or releases a run. The callback still closes scheduler/gateway
    // bookkeeping that marked the external trigger as running.
    try {
      await opts.onSettled?.(rejected)
    } catch {
      /* caller notification is non-fatal */
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

  // Journal admission before any async bind/dispatch work can yield. This
  // lets startup reconciliation classify a renderer/main interruption.
  recordRunAdmitted({
    runId,
    objective,
    sourceKind: opts.sourceKind,
    scheduleJobId: opts.meta?.scheduleJobId,
  })

  const settings = useSettingsStore.getState().settings
  const thr = useThreadStore.getState()
  let boundThreadId = opts.reuseThreadId || ''

  try {

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
  boundThreadId = tid
  recordRunStarted({ runId, threadId: tid })
  // The coordinator is the lifecycle owner for the shared in-chat surfaces.
  // Adapters may still mirror activity for compatibility, but they must not
  // decide when the visible run is terminal.
  try {
    const { useRunActivityStore } = await import('../store/runActivityStore')
    useRunActivityStore.getState().begin(runId)
    useRunActivityStore.getState().setStatus('啟動中…', runId)
  } catch {
    /* renderer activity is optional for headless / recovery paths */
  }
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

  // Builtin vision needs dataUrls; CLI receives the persisted filePath and
  // must not be hydrated back into dataUrl before its own file-path adapter.
  const boundRunner =
    opts.runner || thr.threads.find((thread) => thread.id === tid)?.runner || 'builtin'
  if (boundRunner === 'builtin') {
    attachments = await prepareRunAttachments(attachments, {
      projectRoot: attachmentProjectRoot,
      sessionId: attachmentSessionId || tid,
      phase: 'hydrate',
    })
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
    projectRoot: opts.projectRoot?.trim() || opts.overrides?.projectRoot,
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
    // G7 userTurn hook 事件(被動:log / notify)
    try {
      const { collectHookRules, evaluateHooks } = await import('./hooks')
      const ev = evaluateHooks(collectHookRules(settings), {
        point: 'userTurn',
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
  }

  // Phase 3 item 3: freeze dispatch fields once; runDispatch only selects runner.
  // Pin project root on the snapshot so later UI project switches cannot leak in.
  if (!overrides.projectRoot) {
    overrides.projectRoot =
      opts.projectRoot?.trim() ||
      (await import('../store/projectStore')).useProjectStore.getState().root ||
      undefined
  }

  // Outbound Data Gate: when protection is active, pin tools to a provider-specific
  // Sanitized Workspace (Restricted Project View) created in Electron main.
  // Ticket 17: required fails closed on missing root / prepare / policy (pure admission).
  try {
    const {
      effectiveOutboundGuardFromSettings,
      isProtectionActive,
      decideRestrictedViewAdmission,
    } = await import('./outbound/outboundGate.ts')
    const mode = effectiveOutboundGuardFromSettings(settings)
    if (isProtectionActive(mode)) {
      const bridgeAvailable = typeof window.subagents?.outbound?.prepareRunView === 'function'
      const projectRoot = (overrides.projectRoot || '').trim()

      type PrepOk = {
        ok: true
        viewRoot: string
        exclusionCount: number
        skippedCount: number
        connectionId: string
        profileDegraded?: boolean
      }
      let prepare: PrepOk | { ok: false; reason: string } | null = null
      if (bridgeAvailable && projectRoot) {
        const prep = await window.subagents!.outbound!.prepareRunView!({
          runId,
          projectRoot,
          apiProvider: settings.apiProvider,
          baseUrl: settings.baseUrl,
          effectiveMode: mode,
        })
        prepare = prep.ok
          ? {
              ok: true,
              viewRoot: prep.viewRoot,
              exclusionCount: prep.exclusionCount,
              skippedCount: prep.skippedCount,
              connectionId: prep.connectionId,
              profileDegraded: prep.profileDegraded,
            }
          : { ok: false, reason: prep.reason }
      }

      const admission = decideRestrictedViewAdmission({
        effectiveMode: mode,
        projectRoot,
        prepare:
          prepare == null
            ? null
            : prepare.ok
              ? { ok: true, viewRoot: prepare.viewRoot }
              : { ok: false, reason: prepare.reason },
        bridgeAvailable,
      })

      if (admission.action === 'block') {
        return finalizeTaskRun({
          runId,
          threadId: tid,
          objective,
          sourceKind: opts.sourceKind,
          projectRoot: opts.projectRoot,
          settings,
          onSettled: opts.onSettled,
          early: {
            error: `出站資料閘門：${admission.reason}`,
          },
        })
      }
      if (admission.action === 'use-view' && prepare && prepare.ok) {
        overrides.projectRoot = admission.viewRoot
        // Ticket 18: pin local view root so tools resolve via single truth
        // even when a call site omits explicit projectRoot (main remains owner).
        try {
          const { pinRestrictedViewRootForRun } = await import(
            './outbound/sanitizedWorkspace.ts'
          )
          pinRestrictedViewRootForRun(runId, admission.viewRoot)
        } catch {
          /* ignore */
        }
        const deg = prepare.profileDegraded ? ' · profile=baseline-degraded' : ''
        thr.pushBubble(
          tid,
          'system',
          `出站資料閘門：Restricted Project View 已建立（exclusions=${prepare.exclusionCount} · skipped=${prepare.skippedCount} · connection=${prepare.connectionId}${deg}）`,
        )
        // Evidence for restricted-view is appended in main prepareOutboundRunView (ticket 23).
      } else if (admission.action === 'continue-degraded') {
        thr.pushBubble(
          tid,
          'system',
          `出站資料閘門：${admission.reason}；繼續但 isolation 未驗證（degraded）`,
        )
      }
    }
  } catch (e) {
    // Ticket 17: under required, unexpected errors must not soft-continue to original project.
    try {
      const { effectiveOutboundGuardFromSettings } = await import('./outbound/outboundGate.ts')
      const mode = effectiveOutboundGuardFromSettings(settings)
      if (mode === 'required') {
        return finalizeTaskRun({
          runId,
          threadId: tid,
          objective,
          sourceKind: opts.sourceKind,
          projectRoot: opts.projectRoot,
          settings,
          onSettled: opts.onSettled,
          early: {
            error: `出站資料閘門：受控視圖準備例外（${e instanceof Error ? e.message : String(e)}）`,
          },
        })
      }
    } catch {
      /* ignore nested */
    }
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
  })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const earlyAgent = useAgentStore.getState().getRunState(runId) || undefined
    return finalizeTaskRun({
      runId,
      // A failed bind has no thread to mutate; the runId is a harmless
      // sentinel while Archive/onSettled/release/drain still complete.
      threadId: boundThreadId || runId,
      objective,
      sourceKind: opts.sourceKind,
      projectRoot: opts.projectRoot,
      settings,
      onSettled: opts.onSettled,
      early: {
        error: `執行失敗：${msg}`,
        path: reserveKind,
        agent: earlyAgent,
      },
    })
  }
}

/** Canonical API for new code. */
export async function runTask(input: TaskRunInput): Promise<TaskRunResult> {
  // Every renderer ingress (composer, scheduler, gateway, webhook, and
  // background delegates) waits behind the one-shot storage/journal recovery.
  // Node-only contract smokes have no renderer lifecycle and continue directly.
  if (typeof window !== 'undefined') await waitForStartupRecovery()
  const normalized = normalizeTaskRunInput(input)
  const runId = normalized.runId || `run_${uuid().slice(0, 12)}`
  if (coordinatingRunIds.has(runId)) {
    return {
      path: 'builtin',
      status: 'skipped',
      error: `runId ${runId} 已在執行中，略過重入。`,
      threadId: normalized.reuseThreadId || null,
      runId,
      skipped: true,
      skipReason: 'duplicate',
    }
  }
  coordinatingRunIds.add(runId)
  try {
    return await coordinateTaskRun({ ...normalized, runId })
  } finally {
    coordinatingRunIds.delete(runId)
  }
}
