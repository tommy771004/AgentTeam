import { isDeepStrictEqual } from 'node:util'
import type { ReviewComment, ReviewCommentAnchor, ReviewFileState } from '../src/agent/reviewStateContract.ts'

export type ReviewStateSnapshot = {
  snapshotId: string
  comments: ReviewComment[]
  fileStates: ReviewFileState[]
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid review state object')
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== 'string' || !value.length) throw new Error('Invalid review state string')
  return value
}

function timestamp(value: unknown): string {
  const result = string(value)
  if (!Number.isFinite(Date.parse(result))) throw new Error('Invalid review state timestamp')
  return result
}

function anchor(value: unknown): ReviewCommentAnchor {
  const item = object(value)
  if (item.side !== 'old' && item.side !== 'new') throw new Error('Invalid review comment side')
  if (!Number.isSafeInteger(item.line) || Number(item.line) < 1) throw new Error('Invalid review comment line')
  return {
    snapshotId: string(item.snapshotId), path: string(item.path), side: item.side, line: Number(item.line),
    hunkFingerprint: string(item.hunkFingerprint), contextHash: string(item.contextHash), originalContext: string(item.originalContext),
  }
}

function comment(value: unknown): ReviewComment {
  const item = object(value)
  if (!['draft', 'submitted', 'acknowledged', 'resolved', 'outdated'].includes(String(item.status))) throw new Error('Invalid review comment status')
  return {
    id: string(item.id), anchor: anchor(item.anchor), body: string(item.body), status: item.status as ReviewComment['status'],
    createdAt: timestamp(item.createdAt), updatedAt: timestamp(item.updatedAt),
    ...(item.rebasedFrom === undefined ? {} : { rebasedFrom: anchor(item.rebasedFrom) }),
    ...(item.sourceCommentId === undefined ? {} : { sourceCommentId: string(item.sourceCommentId) }),
  }
}

function fileState(value: unknown): ReviewFileState {
  const item = object(value)
  if (!['reviewed', 'changed-after-review', 'has-open-comments'].includes(String(item.state))) throw new Error('Invalid file review state')
  if (typeof item.contentHash !== 'string') throw new Error('Invalid reviewed content hash')
  return {
    snapshotId: string(item.snapshotId), path: string(item.path), contentHash: item.contentHash,
    state: item.state as ReviewFileState['state'], reviewedAt: timestamp(item.reviewedAt),
    ...(item.inheritedFromSnapshotId === undefined ? {} : { inheritedFromSnapshotId: string(item.inheritedFromSnapshotId) }),
  }
}

/** Parse a bounded transfer payload without granting it execution authority. */
export function parseReviewStateSnapshot(value: unknown, snapshotId: string): ReviewStateSnapshot {
  const item = object(value)
  if (item.snapshotId !== snapshotId) throw new Error('Review state snapshot identity mismatch')
  if (!Array.isArray(item.comments) || !Array.isArray(item.fileStates)) throw new Error('Review state arrays are required')
  if (item.comments.length + item.fileStates.length > 10_000 || Buffer.byteLength(JSON.stringify(item)) > 4 * 1024 * 1024) throw new Error('Review state transfer exceeds limit')
  const comments = item.comments.map(comment)
  const fileStates = item.fileStates.map(fileState)
  if (comments.some((entry) => entry.anchor.snapshotId !== snapshotId) || fileStates.some((entry) => entry.snapshotId !== snapshotId)) throw new Error('Cross-snapshot review state is forbidden')
  if (new Set(comments.map((entry) => entry.id)).size !== comments.length || new Set(fileStates.map((entry) => entry.path)).size !== fileStates.length) throw new Error('Duplicate review state identity')
  return { snapshotId, comments, fileStates }
}

/** Exact retries are safe after an interrupted transfer; never overwrite data. */
export function assertReviewStateCompatible(current: unknown, incoming: unknown): void {
  if (current !== undefined && !isDeepStrictEqual(current, incoming)) throw new Error('Review state import collision')
}
