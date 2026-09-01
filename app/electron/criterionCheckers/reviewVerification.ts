import type { ReviewArtifactProjection } from '../reviewArtifactStore.ts'
import type { ReviewVerificationRecord } from '../../src/agent/reviewVerificationContract.ts'
import type { GoalCriterion } from '../../src/agent/goalContract.ts'

export type ReviewVerificationBinding = Readonly<{
  artifact?: ReviewArtifactProjection
  verifications: readonly ReviewVerificationRecord[]
}>

export function checkRevisionBoundReviewVerification(input: {
  criterion: Extract<GoalCriterion, { kind: 'review-verification' }>
  binding?: ReviewVerificationBinding
}): Readonly<{
  state: 'matched' | 'snapshot-missing' | 'snapshot-not-ready' | 'revision-mismatch' | 'verification-missing' | 'verification-failed'
  snapshotRevision?: string
  verification?: ReviewVerificationRecord
}> {
  const artifact = input.binding?.artifact
  if (!artifact || artifact.snapshotId !== input.criterion.snapshotId) return { state: 'snapshot-missing' }
  if (artifact.status !== 'ready' && artifact.status !== 'partial') return { state: 'snapshot-not-ready' }
  const snapshotRevision = artifact.settlement?.workingRevision || artifact.admission.baseline?.workingRevision
  if (snapshotRevision !== input.criterion.verifiedRevision) return { state: 'revision-mismatch', ...(snapshotRevision ? { snapshotRevision } : {}) }
  const candidates = (input.binding?.verifications || []).filter((record) => record.snapshotId === artifact.snapshotId
    && record.kind === input.criterion.verification)
  const verification = candidates.find((record) => record.verifiedRevision === input.criterion.verifiedRevision)
  if (!verification) return { state: 'verification-missing', snapshotRevision }
  return Number.isInteger(verification.exitCode) && verification.exitCode === 0
    ? { state: 'matched', snapshotRevision, verification }
    : { state: 'verification-failed', snapshotRevision, verification }
}
