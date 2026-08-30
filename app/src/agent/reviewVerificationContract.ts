export type ReviewVerificationKind = 'build' | 'smoke' | 'test'
export type ReviewVerificationStatus = 'passed' | 'failed' | 'not-run' | 'stale'
export type ReviewVerificationOutputAvailability = 'available' | 'missing'

export type ReviewVerificationRecord = {
  id: string
  snapshotId: string
  runId: string
  workspaceId: string
  verifiedRevision: string
  kind: ReviewVerificationKind
  command: string
  args: string[]
  cwd: string
  runner: 'host'
  startedAt: string
  durationMs: number
  exitCode?: number
  signal?: string
  outputRef?: string
  outputAvailability: ReviewVerificationOutputAvailability
  detail?: string
}

export type ReviewVerificationProjection = ReviewVerificationRecord & {
  status: ReviewVerificationStatus
}

/** Only Host execution fields and the current workspace revision determine status. */
export function projectReviewVerification(
  record: ReviewVerificationRecord,
  currentRevision?: string,
): ReviewVerificationProjection {
  const completed = Number.isInteger(record.exitCode)
  const status: ReviewVerificationStatus = completed && currentRevision && currentRevision !== record.verifiedRevision
    ? 'stale'
    : !completed
      ? 'not-run'
      : record.exitCode === 0
        ? 'passed'
        : 'failed'
  return { ...record, status }
}
