import type { ReviewTarget } from './reviewContract.ts'

export type ReviewMutationOperation = 'stage' | 'unstage' | 'revert'
export type ReviewMutationSelection =
  | { kind: 'file'; path: string }
  | { kind: 'hunk'; path: string; hunkIndex: number }

export type ReviewMutationIntent = {
  operation: ReviewMutationOperation
  target: Extract<ReviewTarget, { kind: 'live-working-tree' | 'staged' }>
  expectedRevision: string
  selection: ReviewMutationSelection
}

export type ReviewMutationPreview = {
  id: string
  operation: ReviewMutationOperation
  workspaceId: string
  expectedRevision: string
  selection: ReviewMutationSelection
  patchHash: string
  /** Exact bounded patch that Approval Decision presents to the user. */
  patch: string
  patchBytes: number
  additions: number
  removals: number
  binary: boolean
  expiresAt: string
}

export type ReviewMutationApproval = {
  decision: 'allow' | 'deny' | 'cancel'
  source: 'electron-main'
  decidedAt: string
}

export type ReviewMutationReceipt = {
  previewId: string
  operation: ReviewMutationOperation
  status: 'applied' | 'denied' | 'cancelled'
  previousRevision: string
  revision: string
  workingRevision?: string
  indexRevision?: string
  patchHash: string
  recoveryRef?: string
  audit: ReviewMutationApproval
}
