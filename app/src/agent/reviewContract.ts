/** A typed source of code changes shown by the Run Review Workspace. */
export type ReviewTarget =
  | { kind: 'run-snapshot'; snapshotId: string }
  | { kind: 'live-working-tree'; workspaceId: string; revision: string }
  | { kind: 'staged'; workspaceId: string; revision: string }
  | { kind: 'branch-range'; workspaceId: string; baseRef: string; headRef: string }
  | { kind: 'snapshot-range'; beforeSnapshotId: string; afterSnapshotId: string }

export type ReviewTargetCapabilities = {
  readonly immutable: boolean
  readonly refreshable: boolean
  readonly mutationCapable: boolean
}

const MUTABLE_TARGET_CAPABILITIES: ReviewTargetCapabilities = {
  immutable: false,
  refreshable: true,
  mutationCapable: true,
}

const IMMUTABLE_TARGET_CAPABILITIES: ReviewTargetCapabilities = {
  immutable: true,
  refreshable: false,
  mutationCapable: false,
}

/**
 * Capability is a property of the target kind, never a UI toggle. Historical
 * and range targets are read-only; only current working/index revisions may
 * enter the Git mutation workflow.
 */
export function reviewTargetCapabilities(target: ReviewTarget): ReviewTargetCapabilities {
  return target.kind === 'live-working-tree' || target.kind === 'staged'
    ? MUTABLE_TARGET_CAPABILITIES
    : IMMUTABLE_TARGET_CAPABILITIES
}

export type ReviewSnapshotStatus =
  | 'pending'
  | 'capturing'
  | 'ready'
  | 'partial'
  | 'failed'
  | 'missing'
  | 'deleted'

const REVIEW_SNAPSHOT_TRANSITIONS: Readonly<Record<ReviewSnapshotStatus, ReadonlySet<ReviewSnapshotStatus>>> = {
  pending: new Set(['pending', 'capturing', 'failed', 'deleted']),
  capturing: new Set(['capturing', 'ready', 'partial', 'failed', 'missing', 'deleted']),
  ready: new Set(['ready', 'missing', 'deleted']),
  partial: new Set(['partial', 'capturing', 'missing', 'deleted']),
  failed: new Set(['failed', 'capturing', 'deleted']),
  missing: new Set(['missing', 'capturing', 'deleted']),
  deleted: new Set(['deleted']),
}

/** Idempotent transitions are allowed; every unlisted transition fails closed. */
export function canTransitionReviewSnapshot(
  from: ReviewSnapshotStatus,
  to: ReviewSnapshotStatus,
): boolean {
  return REVIEW_SNAPSHOT_TRANSITIONS[from].has(to)
}

export type AttributionFidelity = 'exact' | 'attributed' | 'shared' | 'partial'

export type HostAttributionEvidence =
  | {
      source: 'host'
      claim: 'exact'
      isolatedWorktree: boolean
      baselineCaptured: boolean
      settlementCaptured: boolean
      contaminationReasons: string[]
    }
  | {
      source: 'host'
      claim: 'attributed'
      trustedMutationCount: number
      coverageComplete: boolean
      contaminationReasons: string[]
    }
  | {
      source: 'host'
      claim: 'shared'
      captureComplete: boolean
      contaminationReasons: string[]
    }
  | {
      source: 'host'
      claim: 'partial'
      reasons: string[]
    }

function evidenceRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function hasContamination(evidence: Record<string, unknown>): boolean {
  return Array.isArray(evidence.contaminationReasons) && evidence.contaminationReasons.length > 0
}

function hasContaminationList(evidence: Record<string, unknown>): boolean {
  return Array.isArray(evidence.contaminationReasons)
    && evidence.contaminationReasons.every((reason) => typeof reason === 'string')
}

/**
 * Project a Host evidence envelope into a displayable fidelity. Unknown,
 * malformed, model-authored, or incomplete evidence always becomes partial.
 */
export function attributionFromHostEvidence(evidence: unknown): AttributionFidelity {
  const item = evidenceRecord(evidence)
  if (!item || item.source !== 'host') return 'partial'

  if (item.claim === 'exact') {
    if (!hasContaminationList(item) || item.baselineCaptured !== true || item.settlementCaptured !== true) return 'partial'
    return item.isolatedWorktree === true && !hasContamination(item) ? 'exact' : 'shared'
  }
  if (item.claim === 'attributed') {
    if (!hasContaminationList(item) || item.coverageComplete !== true || !Number.isInteger(item.trustedMutationCount) || Number(item.trustedMutationCount) <= 0) {
      return 'partial'
    }
    return hasContamination(item) ? 'shared' : 'attributed'
  }
  if (item.claim === 'shared') {
    return hasContaminationList(item) && item.captureComplete === true ? 'shared' : 'partial'
  }
  return 'partial'
}

const ATTRIBUTION_STRENGTH: Record<AttributionFidelity, number> = {
  exact: 3,
  attributed: 2,
  shared: 1,
  partial: 0,
}

/** Return the weaker fidelity; this public operation has no upgrade behavior. */
export function downgradeAttribution(
  current: AttributionFidelity,
  maximumAllowed: AttributionFidelity,
): AttributionFidelity {
  return ATTRIBUTION_STRENGTH[current] <= ATTRIBUTION_STRENGTH[maximumAllowed]
    ? current
    : maximumAllowed
}

export type ReviewSnapshotRef = {
  snapshotId: string
  runId: string
  status: ReviewSnapshotStatus
  attributionFidelity: AttributionFidelity
  manifestHash?: string
}

export function isReviewSnapshotRef(value: unknown): value is ReviewSnapshotRef {
  if (!value || typeof value !== 'object') return false
  const ref = value as Record<string, unknown>
  return typeof ref.snapshotId === 'string' && ref.snapshotId.length > 0 && ref.snapshotId.length <= 512
    && typeof ref.runId === 'string' && ref.runId.length > 0 && ref.runId.length <= 512
    && ['pending', 'capturing', 'ready', 'partial', 'failed', 'missing', 'deleted'].includes(String(ref.status))
    && ['exact', 'attributed', 'shared', 'partial'].includes(String(ref.attributionFidelity))
    && (ref.manifestHash === undefined || typeof ref.manifestHash === 'string' && /^[a-f0-9]{64}$/.test(ref.manifestHash))
}

export type ReviewRunnerKind = 'builtin' | 'external'

export type ReviewWorkspaceBinding = {
  workspaceId: string
  mode: 'git' | 'non-git'
  projectRoot: string
  repoRoot?: string
  worktreeRoot?: string
  gitDir?: string
}

export type ReviewWorkspaceBaseline = {
  capturedAt: string
  head?: string
  /** Git tree objects freeze index and full working state without moving refs. */
  indexTree?: string
  workingTree?: string
  indexRevision: string
  workingRevision: string
}

export type ReviewAdmissionSnapshot =
  | {
      snapshotId: string
      runId: string
      status: 'pending' | 'failed'
      canonical: true
      runnerKind: ReviewRunnerKind
      workspace?: ReviewWorkspaceBinding
      baseline?: ReviewWorkspaceBaseline
      error?: ReviewArtifactError
    }
  | {
      /** Plain-browser projection: no Host means no canonical artifact id. */
      snapshotId?: never
      runId: string
      status: 'failed'
      canonical: false
      runnerKind: ReviewRunnerKind
      workspace?: never
      baseline?: never
      error: ReviewArtifactError
    }

/** Explicit fail-open run / fail-closed review projection for no-Host clients. */
export function nonCanonicalReviewAdmission(
  runId: string,
  runnerKind: ReviewRunnerKind,
  message: string,
): ReviewAdmissionSnapshot {
  return {
    runId,
    status: 'failed',
    canonical: false,
    runnerKind,
    error: { code: 'unavailable', message, retryable: true },
  }
}

export const REVIEW_FILE_STATUSES = [
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'type-changed',
  'untracked',
] as const

export type ReviewFileStatus = typeof REVIEW_FILE_STATUSES[number]

export type ReviewFileManifestEntry = {
  path: string
  oldPath?: string
  status: ReviewFileStatus
  oldMode?: string
  newMode?: string
  binary: boolean
  additions?: number
  removals?: number
  contentHash?: string
  /** Host-only payload identity; content is fetched through bounded pages. */
  payloadRef?: string
  hunkCount?: number
}

export type ReviewPageOmission = {
  items: number
  bytes: number
  reasons: string[]
}

type ReviewPageBase<T> = {
  target: ReviewTarget
  revision: string
  items: T[]
  total: number
  diagnostics: string[]
}

/** Complete pages cannot carry truncation metadata; incomplete pages must. */
export type ReviewPageEnvelope<T> = ReviewPageBase<T> & (
  | { complete: true; nextCursor?: never; omitted?: never }
  | { complete: false; nextCursor?: string; omitted: ReviewPageOmission }
)

export const REVIEW_ARTIFACT_ERROR_CODES = [
  'invalid-target',
  'snapshot-missing',
  'snapshot-deleted',
  'snapshot-corrupt',
  'target-stale',
  'unsupported-file',
  'cancelled',
  'timeout',
  'unavailable',
  'partial',
] as const

export type ReviewArtifactErrorCode = typeof REVIEW_ARTIFACT_ERROR_CODES[number]

export type ReviewArtifactError = {
  code: ReviewArtifactErrorCode
  message: string
  retryable: boolean
  details?: Record<string, unknown>
}

export type RunReviewSource =
  | {
      kind: 'run-snapshot'
      canonical: true
      target: Extract<ReviewTarget, { kind: 'run-snapshot' }>
      status: ReviewSnapshotStatus
      ref: ReviewSnapshotRef
    }
  | { kind: 'legacy-ephemeral'; canonical: false; diff: string }
  | { kind: 'unavailable'; canonical: false }

/**
 * New summaries prefer their immutable reference even when its payload is
 * missing. Legacy diff text is used only when no canonical identity exists.
 */
export function projectRunReviewSource(input: {
  reviewSnapshotRef?: ReviewSnapshotRef
  diff?: string
}): RunReviewSource {
  if (input.reviewSnapshotRef) {
    const ref = input.reviewSnapshotRef
    return {
      kind: 'run-snapshot',
      canonical: true,
      target: { kind: 'run-snapshot', snapshotId: ref.snapshotId },
      status: ref.status,
      ref,
    }
  }
  if (input.diff !== undefined) {
    return { kind: 'legacy-ephemeral', canonical: false, diff: input.diff }
  }
  return { kind: 'unavailable', canonical: false }
}
