import type {
  ChatAttachment,
  EventTriggerSnapshot,
  LoopType,
  PostStateOutcome,
  RuntimeOverrides,
  ScheduleKind,
} from './types'
import type { ThreadRunner } from '../store/threadStore'
import type { AutomationSuggestion } from './automationSuggestion.ts'
import type { LocalRunnerKind } from './localCliRun'

export type DispatchResult = {
  path: 'builtin' | 'cli'
  executionKind?: 'loop' | 'external'
  kind?: LocalRunnerKind
  status: string
  result?: string
  error?: string
  postState?: PostStateOutcome
}

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
  sourceKind?: RunSourceKind
  runId?: string
  title?: string
  loopType?: LoopType
  runner?: ThreadRunner
  eventPreMatched?: boolean
  attachedSkills?: string[]
  sourceLabel?: string
  overrides?: RuntimeOverrides
  projectRoot?: string
  attachments?: ChatAttachment[]
  extraContext?: string
  reuseThreadId?: string
  workerThread?: boolean
  skipUserBubble?: boolean
  enqueueWhenBusy?: boolean
  preferHome?: boolean
  unattended?: boolean
  onSettled?: (result: ExternalRunResult) => void | Promise<void>
  meta?: {
    scheduleJobId?: string
    scheduleTriggeredAt?: string
    scheduleKind?: ScheduleKind
    eventTrigger?: EventTriggerSnapshot
  }
  _fromQueue?: boolean
  continueGoal?: boolean
  continueHint?: string
}

export type ExternalRunResult = DispatchResult & {
  threadId: string | null
  runId?: string
  skipped?: boolean
  skipReason?: string
  queued?: boolean
  queueId?: string
  suggestion?: AutomationSuggestion
}

export type RunDispatchSnapshot = {
  runId: string
  threadId: string
  objective: string
  runner: ThreadRunner
  forceLoopType?: LoopType
  attachments: ChatAttachment[]
  overrides: RuntimeOverrides
}

export type TaskRunInput = ExternalRunOpts
export type TaskRunResult = ExternalRunResult
