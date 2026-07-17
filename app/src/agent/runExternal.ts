/**
 * Compatibility and runner-policy helpers for the canonical taskRunCoordinator.
 * The coordinator owns Task run admission, dispatch, and finalization. This module
 * retains the legacy exports and pure policy helpers so existing integrations can
 * migrate without creating a second lifecycle owner.
 */

import type {
  ChatAttachment,
  ExternalRunRef,
  LoopType,
  RuntimeOverrides,
  EventTriggerSnapshot,
  ScheduleKind,
} from './types'
import type { DispatchResult } from './runDispatch'
import { useThreadStore, type ThreadRunner } from '../store/threadStore.ts'
import {
  type AutomationSuggestion,
} from './automationSuggestion.ts'

export {
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
} from './taskRunPolicy.ts'
export type { BusyPolicy } from './taskRunPolicy.ts'

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
  /**
   * Phase 3 item 7: background worker — creates a hidden thread that does not
   * appear in the sidebar or steal active selection.
   */
  workerThread?: boolean
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
    scheduleTriggeredAt?: string
    scheduleKind?: ScheduleKind
    eventTrigger?: EventTriggerSnapshot
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
  /** Conversation automation was recognised but awaits explicit consent. */
  suggestion?: AutomationSuggestion
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

/** Canonical input name for the lifecycle controller. */
export type RunTaskInput = ExternalRunOpts

/**
 * runTask — compatibility adapter for the canonical taskRunCoordinator seam.
 * @deprecated New callers must use `taskRunCoordinator.runTask`.
 * New callers must import `runTask` from `taskRunCoordinator` instead.
 */
export async function runTask(input: RunTaskInput): Promise<ExternalRunResult> {
  const { runTask: canonicalRunTask } = await import('./taskRunCoordinator.ts')
  return canonicalRunTask(input)
}

/**
 * Legacy compatibility adapter. New code must use taskRunCoordinator.runTask.
 */
export async function runExternalObjective(
  input: ExternalRunOpts,
): Promise<ExternalRunResult> {
  const { runTask } = await import('./taskRunCoordinator.ts')
  return runTask(input)
}
