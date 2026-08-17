import type { ApprovalMode } from './types.ts'
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
