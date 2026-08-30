import type {
  AgentMode,
  ApprovalMode,
  ChatAttachment,
  LlmSettings,
  LoopType,
} from './types.ts'
import type { ThreadRunner } from '../store/threadStore.ts'
import type { ExternalRunOpts } from './taskRunTypes.ts'
import { conversationRuntimeOverrides, type SpeedMode, type ThinkingDepth } from './thinking.ts'
import {
  buildHandoffDocument as buildArtifactHandoffDocument,
  readArtifactIndex as readStoredArtifactIndex,
  type ArtifactIndex as StoredArtifactIndex,
  type ArtifactIndexEntry,
} from './artifactIndex.ts'

/** Backwards-compatible view used by the Composer seam. */
export type ArtifactIndex = {
  id?: string
  threadId: string
  runId: string
  entries: ArtifactIndexEntry[]
  status?: StoredArtifactIndex['status']
  currentStatus?: string
  decisions?: string[]
  blockers?: string[]
  suggestedNextSkills?: string[]
  updatedAt?: string
}

export type HandoffAvailability =
  | { available: true; index: ArtifactIndex }
  | { available: false; reason: string }

const NO_ARTIFACT_INDEX_REASON =
  '此對話尚無 Artifact Index。完成可索引的任務後才能建立 Handoff。'

/** Resolve the selection captured by the composer without mutating Settings. */
export function resolveComposerApprovalMode(
  settingsMode: ApprovalMode,
  selectedMode?: ApprovalMode,
): ApprovalMode {
  return selectedMode || settingsMode
}

export function buildComposerRunOverrides(
  settingsMode: ApprovalMode,
  selectedMode?: ApprovalMode,
): { approvalMode: ApprovalMode } {
  return { approvalMode: resolveComposerApprovalMode(settingsMode, selectedMode) }
}

export type ComposerAttachmentsByScope = Record<string, ChatAttachment[]>

/** Runtime-only attachment drafts, isolated by conversation like text drafts. */
export function attachmentsForComposerScope(
  state: ComposerAttachmentsByScope,
  scope: string,
): ChatAttachment[] {
  return state[scope] || []
}

export function replaceComposerScopeAttachments(
  state: ComposerAttachmentsByScope,
  scope: string,
  attachments: ChatAttachment[],
): ComposerAttachmentsByScope {
  if (attachments.length === 0) {
    const { [scope]: _removed, ...rest } = state
    return rest
  }
  return { ...state, [scope]: attachments }
}

/** Composer activity belongs to its conversation; registry-wide activity does not. */
export function isConversationComposerBusy(
  submittingByThread: Record<string, number>,
  threadId: string | null | undefined,
  lifecycleLive: boolean,
): boolean {
  return lifecycleLive || Boolean(threadId && submittingByThread[threadId])
}

type BuiltinSubscriptionSettingsPatch = Pick<
  LlmSettings,
  'apiProvider' | 'model' | 'fallbackModels' | 'discoveredModels'
>

/**
 * Convert an explicit external-CLI-to-builtin switch into the equivalent
 * native Pi subscription connection. Providers without a native Pi OAuth
 * route cannot safely reuse their CLI-only model, so their thread override is
 * cleared and the existing global Pi model remains authoritative.
 */
export function resolveBuiltinRunnerTransition(input: {
  currentRunner: ThreadRunner
  selectedModel: string
}): {
  threadModel: string
  settingsPatch?: BuiltinSubscriptionSettingsPatch
} {
  const threadModel = input.selectedModel.trim()
  if (input.currentRunner === 'builtin') return { threadModel }
  if (!threadModel) return { threadModel: '' }

  const apiProvider = input.currentRunner === 'codex'
    ? 'openai-codex'
    : input.currentRunner === 'claude'
      ? 'anthropic'
      : null
  if (!apiProvider) return { threadModel: '' }

  return {
    threadModel,
    settingsPatch: {
      apiProvider,
      model: threadModel,
      fallbackModels: [],
      discoveredModels: [],
    },
  }
}

/**
 * Freeze every execution-affecting Composer selection at click time. Queueing,
 * project switching, or editing the thread later must not mutate this turn.
 */
export function buildComposerRunInput(input: {
  objective: string
  threadId: string
  runner: ThreadRunner
  followUpAction?: ExternalRunOpts['followUpAction']
  loopType: LoopType | null
  attachments?: ChatAttachment[]
  projectRoot?: string
  settingsApprovalMode: ApprovalMode
  selectedApprovalMode?: ApprovalMode
  agentMode: AgentMode
  model?: string
  thinkingDepth: ThinkingDepth
  speed: SpeedMode
  temporary: boolean
}): ExternalRunOpts {
  const overrides = conversationRuntimeOverrides({
    model: input.model,
    depth: input.thinkingDepth,
    speed: input.speed,
    extra: {
      ...buildComposerRunOverrides(input.settingsApprovalMode, input.selectedApprovalMode),
      agentMode: input.agentMode,
      planCompletionAction: input.agentMode === 'plan' ? 'auto_start_build' : 'wait_for_user',
      thinkingDepth: input.thinkingDepth,
      speed: input.speed,
      temporary: input.temporary,
    },
  })
  return {
    objective: input.objective.trim(),
    sourceKind: 'composer',
    reuseThreadId: input.threadId,
    runner: input.runner,
    followUpAction: input.followUpAction,
    loopType: input.loopType || undefined,
    attachments: input.attachments || [],
    projectRoot: input.projectRoot?.trim() || undefined,
    overrides,
  }
}

/** Only an index owned by the submitted thread can power its Handoff. */
export function buildHandoffAvailability(
  index: ArtifactIndex | null | undefined,
  threadId: string,
): HandoffAvailability {
  if (!index || index.threadId !== threadId || !index.runId || index.entries.length === 0) {
    return { available: false, reason: NO_ARTIFACT_INDEX_REASON }
  }
  return { available: true, index }
}

function toStoredIndex(index: ArtifactIndex): StoredArtifactIndex {
  return {
    id: index.id || `artifact:${index.threadId}:${index.runId}`,
    threadId: index.threadId,
    runId: index.runId,
    status: index.status || 'active',
    currentStatus: index.currentStatus || index.status || 'indexed evidence available',
    decisions: index.decisions || [],
    blockers: index.blockers || [],
    suggestedNextSkills: index.suggestedNextSkills || [],
    updatedAt: index.updatedAt || new Date(0).toISOString(),
    entries: index.entries,
  }
}

export function buildHandoffDocument(input: {
  threadId: string
  runId: string
  index: ArtifactIndex
  generatedAt?: string
}): string {
  return buildArtifactHandoffDocument({
    ...input,
    index: toStoredIndex(input.index),
  })
}

export function readArtifactIndex(storage: Storage | undefined, threadId: string): ArtifactIndex | null {
  return readStoredArtifactIndex(storage, threadId)
}
