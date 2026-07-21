/**
 * Canonical task-run request/result types.
 *
 * Neutral leaf for coordinator + policy + queue — must NOT live on the
 * coordinator module itself (avoids policy↔coordinator type cycles) and must
 * NOT depend on the retired runExternal compatibility shell.
 */
import type {
  ChatAttachment,
  EventTriggerSnapshot,
  LoopType,
  RuntimeOverrides,
  ScheduleKind,
} from './types'
import type { AutomationSuggestion } from './automationSuggestion'
import type { ThreadRunner } from '../store/threadStore'
import type { DispatchResult } from './dispatchResult.ts'

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

/**
 * Dispatch outcome + lifecycle extras (queue / suggestion / thread bind).
 * Shares `DispatchResult` from dispatchResult.ts (single source with runDispatch).
 */
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

/** Canonical input name for the lifecycle controller. */
export type RunTaskInput = ExternalRunOpts
