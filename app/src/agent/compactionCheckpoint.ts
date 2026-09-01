/**
 * Compaction checkpoint — the pre-compaction transcript, kept whole.
 *
 * A checkpoint exists so a run that was compacted (or interrupted) can be
 * audited and resumed from what the agent actually saw. That only works if the
 * record survives: it lives in the main process alongside the durable journal
 * (ADR-0040), not in renderer storage, so a reload, a quota limit, or an LRU
 * eviction cannot quietly reduce it to a summary. There is no renderer-storage
 * fallback — a checkpoint that cannot be written is reported as not written.
 */

import type { WorkingState } from './workingState.ts'
import type { MemoryControlPackageIdentity } from './memoryControlPackage.ts'
import type { ContinuationItem } from './continuation.ts'
import type { GoalRuntimeCheckpoint } from './goalRuntimeCheckpoint.ts'

export type CompactionReason = 'auto' | 'manual' | 'emergency' | 'interrupt'

/** Structured state retained across a context rewrite. */
export interface CompactionManifest {
  schemaVersion: 1
  sessionId: string
  runId: string
  objective: string
  constraints: string[]
  changedFiles: string[]
  decisions: Array<{ decision: string; reason?: string }>
  unresolvedErrors: string[]
  pendingWork: string[]
  pendingApprovals: string[]
  completedEffects: string[]
  references: Array<{ kind: 'file' | 'tool-output' | 'turn-record'; target: string }>
  sourceHash: string
  latestSeq: number
  /** Exact Host-committed state; absent only for legacy sessions. */
  workingState?: WorkingState
}

export interface CompactionCheckpoint {
  runId: string
  at: string
  summary: string
  messageCount: number
  /** The pre-compaction transcript. Absent only when nothing was captured. */
  messages?: unknown[]
  /**
   * Retained for older records. Durable checkpoints are never degraded to a
   * summary, so this is always false for anything written by this module.
   */
  truncated: boolean
  /** Ordinal within the run, so a resume can name which checkpoint it used. */
  sequence?: number
  threadId?: string
  /** What the run was trying to achieve, replayed into a resume prompt. */
  objective?: string
  /**
   * The Host confirmed no tool was mid-execution when this checkpoint was
   * written. Only a checkpoint taken at a clean tool boundary can support the
   * claim that nothing effectful happened after it (ADR-0042).
   */
  parkedAtToolBoundary?: boolean
  /**
   * Resume is permitted from this checkpoint. False whenever replay safety
   * could not be established — the resume path then refuses, fail-closed.
   */
  replaySafe?: boolean
  /**
   * Identities of the side-effecting tool calls that had already completed.
   * A resume replays none of them; the list is what makes that checkable.
   */
  effects?: string[]
  /** Why this checkpoint was taken; older interruption records omit it. */
  reason?: CompactionReason
  /** Hash of the exact message range replaced by the compaction. */
  sourceHash?: string
  estimatedTokens?: number
  contextWindow?: number
  /** Machine-readable state; summary remains the model-facing projection. */
  manifest?: CompactionManifest
  workingStateRevision?: number
  workingState?: WorkingState
  /** Package frozen for this lifecycle; resume must re-admit this exact identity. */
  governingPackage?: MemoryControlPackageIdentity
  /** Host-owned continuation backlog captured at the same clean tool boundary. */
  continuationItems?: ContinuationItem[]
  /** Exact Goal/Acceptance/Workflow state required for replay-safe graph recovery. */
  goalRuntime?: GoalRuntimeCheckpoint
  /** Set the moment a resume claims this checkpoint; one claim, ever. */
  resumeClaimedAt?: string
}

/** Main-process durable store, reached over IPC. */
export type CompactionCheckpointSaveInput = {
  runId: string
  threadId?: string
  summary: string
  messages: unknown[]
  objective?: string
  parkedAtToolBoundary?: boolean
  replaySafe?: boolean
  effects?: string[]
  reason?: CompactionReason
  sourceHash?: string
  estimatedTokens?: number
  contextWindow?: number
  manifest?: CompactionManifest
  workingStateRevision?: number
  workingState?: WorkingState
  governingPackage?: MemoryControlPackageIdentity
  continuationItems?: ContinuationItem[]
  goalRuntime?: GoalRuntimeCheckpoint
}

export type CompactionCheckpointBridge = {
  save: (input: CompactionCheckpointSaveInput) => Promise<{ ok: boolean; checkpoint?: CompactionCheckpoint; error?: string }>
  load: (runId: string) => Promise<CompactionCheckpoint | null>
  list: (runId?: string) => Promise<CompactionCheckpoint[]>
  remove: (runId: string) => Promise<{ ok: boolean }>
}

/**
 * Resolved off `globalThis` rather than the renderer `window` type, so this
 * module stays compilable from the main-process project that shares its types.
 */
function bridge(): Partial<CompactionCheckpointBridge> | undefined {
  const host = globalThis as { subagents?: { checkpoints?: Partial<CompactionCheckpointBridge> } }
  return host.subagents?.checkpoints
}

/**
 * Persist the pre-compaction transcript.
 *
 * Returns false when no durable store is reachable — the caller must treat that
 * as "no checkpoint exists", never as a silent success.
 */
export async function saveCompactionCheckpoint(
  runId: string,
  data: Omit<CompactionCheckpointSaveInput, 'runId'>,
): Promise<boolean> {
  const api = bridge()
  if (!api?.save || !runId) return false
  try {
    const result = await api.save({ ...data, runId })
    return (result as { ok?: boolean } | undefined)?.ok === true
  } catch {
    return false
  }
}

export async function loadCompactionCheckpoint(runId: string): Promise<CompactionCheckpoint | null> {
  const api = bridge()
  if (!api?.load || !runId) return null
  try {
    return ((await api.load(runId)) as CompactionCheckpoint | null) || null
  } catch {
    return null
  }
}

/** Every checkpoint for one run, oldest first; all runs when `runId` is absent. */
export async function listCompactionCheckpoints(runId?: string): Promise<CompactionCheckpoint[]> {
  const api = bridge()
  if (!api?.list) return []
  try {
    return ((await api.list(runId)) as CompactionCheckpoint[] | undefined) || []
  } catch {
    return []
  }
}

export async function clearCompactionCheckpoints(runId: string): Promise<boolean> {
  const api = bridge()
  if (!api?.remove || !runId) return false
  try {
    return ((await api.remove(runId)) as { ok?: boolean } | undefined)?.ok === true
  } catch {
    return false
  }
}
