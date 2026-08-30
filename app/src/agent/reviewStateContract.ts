import type { ReviewFileManifestEntry, ReviewWorkspaceBinding } from './reviewContract.ts'

export type ReviewCommentStatus = 'draft' | 'submitted' | 'acknowledged' | 'resolved' | 'outdated'
export type ReviewCommentSide = 'old' | 'new'

export type ReviewCommentAnchor = {
  snapshotId: string
  path: string
  side: ReviewCommentSide
  line: number
  hunkFingerprint: string
  contextHash: string
  originalContext: string
}

export type ReviewComment = {
  id: string
  anchor: ReviewCommentAnchor
  body: string
  status: ReviewCommentStatus
  createdAt: string
  updatedAt: string
  rebasedFrom?: ReviewCommentAnchor
  /** Previous-snapshot comment identity; inheritance never moves the source row. */
  sourceCommentId?: string
}

export type ReviewFileState = {
  snapshotId: string
  path: string
  contentHash: string
  state: 'reviewed' | 'changed-after-review' | 'has-open-comments'
  reviewedAt: string
  inheritedFromSnapshotId?: string
}

export type ReviewFeedbackBundle = {
  id: string
  snapshotId: string
  threadId: string
  workspace: ReviewWorkspaceBinding
  comments: ReviewComment[]
  createdAt: string
  status: 'prepared' | 'dispatched'
  runId?: string
}

const TRANSITIONS: Readonly<Record<ReviewCommentStatus, ReadonlySet<ReviewCommentStatus>>> = {
  draft: new Set(['draft', 'submitted']),
  submitted: new Set(['submitted', 'acknowledged']),
  acknowledged: new Set(['acknowledged', 'resolved', 'outdated']),
  resolved: new Set(['resolved']),
  outdated: new Set(['outdated']),
}

export function canTransitionReviewComment(from: ReviewCommentStatus, to: ReviewCommentStatus): boolean {
  return TRANSITIONS[from].has(to)
}

export function rebaseReviewComment(
  comment: ReviewComment,
  nextSnapshotId: string,
  candidates: ReviewCommentAnchor[],
  now: string,
): ReviewComment {
  const matches = candidates.filter((candidate) => candidate.snapshotId === nextSnapshotId
    && candidate.path === comment.anchor.path
    && candidate.side === comment.anchor.side
    && candidate.hunkFingerprint === comment.anchor.hunkFingerprint
    && candidate.contextHash === comment.anchor.contextHash)
  if (matches.length === 1) return { ...comment, anchor: matches[0], rebasedFrom: comment.anchor, updatedAt: now }
  if (comment.status !== 'acknowledged') return comment
  return { ...comment, anchor: { ...comment.anchor, snapshotId: nextSnapshotId }, rebasedFrom: comment.anchor, status: 'outdated', updatedAt: now }
}

export function inheritReviewedFiles(input: {
  fromSnapshotId: string
  toSnapshotId: string
  reviewed: ReviewFileState[]
  nextManifest: ReviewFileManifestEntry[]
  now: string
}): ReviewFileState[] {
  const nextByPath = new Map(input.nextManifest.map((file) => [file.path, file]))
  return input.reviewed.filter((item) => item.state === 'reviewed').map((item) => {
    const next = nextByPath.get(item.path)
    const unchanged = Boolean(item.contentHash && next?.contentHash && item.contentHash === next.contentHash)
    return {
      snapshotId: input.toSnapshotId,
      path: item.path,
      contentHash: next?.contentHash || '',
      state: unchanged ? 'reviewed' as const : 'changed-after-review' as const,
      reviewedAt: input.now,
      inheritedFromSnapshotId: input.fromSnapshotId,
    }
  })
}

export function fileReviewState(
  file: ReviewFileManifestEntry,
  stored: ReviewFileState | undefined,
  comments: ReviewComment[],
): 'unreviewed' | ReviewFileState['state'] {
  if (comments.some((comment) => comment.anchor.path === file.path && comment.status !== 'resolved' && comment.status !== 'outdated')) return 'has-open-comments'
  if (!stored) return 'unreviewed'
  return stored.contentHash && file.contentHash === stored.contentHash ? stored.state : 'changed-after-review'
}
