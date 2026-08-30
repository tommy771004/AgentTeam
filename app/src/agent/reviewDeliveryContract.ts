export type ReviewDeliveryFailureCode =
  | 'stale'
  | 'empty_commit'
  | 'identity_missing'
  | 'hooks_failed'
  | 'signing_failed'
  | 'remote_missing'
  | 'upstream_missing'
  | 'protected_branch'
  | 'force_forbidden'
  | 'auth_failed'
  | 'non_fast_forward'
  | 'push_unverified'
  | 'gh_unavailable'
  | 'duplicate_pr'
  | 'invalid'
  | 'unknown'

export type ReviewDeliveryIntent =
  | {
      kind: 'commit'
      workspaceId: string
      expectedIndexRevision: string
      message: string
      /** Request signing even when repository config does not require it. */
      sign?: true
    }
  | {
      kind: 'push'
      workspaceId: string
      /** Host-issued identity from a successful commit receipt. */
      commitId: string
      remote?: string
      /** Required only for a branch without an upstream. */
      setUpstream?: boolean
      /** Accepted only so older renderers receive a classified fail-closed error. */
      force?: boolean
    }
  | {
      kind: 'pr'
      workspaceId: string
      /** Host-issued identity from a remotely verified push receipt. */
      pushId: string
      title: string
      body: string
      base?: string
      draft?: boolean
    }

export type ReviewDeliveryPreview = {
  id: string
  kind: ReviewDeliveryIntent['kind']
  workspaceId: string
  title: string
  detail: string
  expiresAt: string
  expectedIndexRevision?: string
  stagedPatchHash?: string
  stagedBytes?: number
  signing?: 'configured' | 'requested' | 'off'
  commitId?: string
  commitOid?: string
  branch?: string
  remote?: string
  upstream?: string
  pushId?: string
}

export type ReviewDeliveryApproval = {
  decision: 'allow' | 'deny' | 'cancel'
  source: 'electron-main'
  decidedAt: string
}

export type ReviewDeliveryReceipt = {
  previewId: string
  kind: ReviewDeliveryIntent['kind']
  status: 'applied' | 'denied' | 'cancelled' | 'failed'
  code?: ReviewDeliveryFailureCode
  detail?: string
  commitId?: string
  commitOid?: string
  treeOid?: string
  committedIndexRevision?: string
  branch?: string
  remote?: string
  pushId?: string
  prUrl?: string
  prNumber?: number
  workingRevision?: string
  indexRevision?: string
  audit: ReviewDeliveryApproval
}
