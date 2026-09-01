import type { GoalContractSnapshot } from './goalContract.ts'

export type CriterionVerdictStatus = 'passed' | 'failed' | 'blocked' | 'invalidated'

export type CriterionVerdict = Readonly<{
  criterionId: string
  status: CriterionVerdictStatus
  evidenceRefs: readonly string[]
  reason: string
  repairHint?: string
  retryable: boolean
}>

function serializableCriterionVerdict(verdict: CriterionVerdict): CriterionVerdict {
  return {
    criterionId: verdict.criterionId,
    status: verdict.status,
    evidenceRefs: [...verdict.evidenceRefs],
    reason: verdict.reason,
    ...(verdict.repairHint === undefined ? {} : { repairHint: verdict.repairHint }),
    retryable: verdict.retryable,
  }
}

type AcceptanceEvidenceBase = Readonly<{
  schemaVersion: 1
  id: string
  criterionId: string
  issuedBy: 'host-checker'
  observedAt: number
  digest: string
}>

export type AcceptanceEvidence =
  | (AcceptanceEvidenceBase & Readonly<{
      kind: 'assistant-answer-present'
      state: 'present' | 'absent' | 'not-applicable'
      answerSha256?: string
    }>)
  | (AcceptanceEvidenceBase & Readonly<{
      kind: 'file-content'
      state: 'matched' | 'mismatched' | 'missing' | 'invalid-path'
      path: string
      expectedSha256: string
      actualSha256?: string
    }>)
  | (AcceptanceEvidenceBase & Readonly<{
      kind: 'registered-command' | 'test-suite'
      state: 'matched' | 'exit-code-mismatch' | 'unknown-command' | 'unavailable' | 'revision-drift'
      registryId: string
      command: string
      args: readonly string[]
      cwd: string
      workspaceRevision?: string
      finalWorkspaceRevision?: string
      exitCode?: number
      expectedExitCode: number
      outputSha256?: string
    }>)
  | (AcceptanceEvidenceBase & Readonly<{
      kind: 'artifact-exists' | 'json-schema'
      state: 'matched' | 'missing' | 'invalid-path' | 'digest-mismatch' | 'invalid-json' | 'unknown-schema' | 'schema-mismatch'
      artifactId: string
      path: string
      schemaId?: string
      expectedSha256?: string
      actualSha256?: string
      validationErrorSha256?: string
    }>)
  | (AcceptanceEvidenceBase & Readonly<{
      kind: 'review-verification'
      state: 'matched' | 'snapshot-missing' | 'snapshot-not-ready' | 'revision-mismatch' | 'verification-missing' | 'verification-failed'
      snapshotId: string
      verification: 'build' | 'smoke' | 'test'
      expectedRevision: string
      snapshotRevision?: string
      verificationId?: string
      verifiedRevision?: string
      exitCode?: number
    }>)
  | (AcceptanceEvidenceBase & Readonly<{
      kind: 'semantic-verifier'
      state: 'matched' | 'mismatched' | 'blocked' | 'budget-exceeded' | 'unavailable'
      rubricId: string
      rubricDigest: string
      artifactDigests: readonly string[]
      checks: readonly Readonly<{
        kind: 'correctness' | 'freshness' | 'source-validity'
        verifierId: string
        verdict: 'passed' | 'failed' | 'blocked'
        reasonDigest: string
        freshContextProof: string
        tokens: number
        costUsd: number
      }>[]
      totalTokens: number
      totalCostUsd: number
    }>)

export type AcceptanceSnapshot = Readonly<{
  schemaVersion: 1
  runId: string
  iteration: number
  goalContractDigest: string
  workflowRevision?: number
  verdicts: readonly CriterionVerdict[]
  overall: 'passed' | 'unmet' | 'blocked' | 'unverifiable' | 'failed'
  weakestCriterionId?: string
  impactedNodeIds: readonly string[]
  digest: string
  evaluatedAt: number
}>

const SHA256 = /^[a-f0-9]{64}$/

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function freezeDeep<T>(value: T): Readonly<T> {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
  return Object.freeze(value)
}

type EvidenceBody = AcceptanceEvidence extends infer Evidence
  ? Evidence extends unknown ? Omit<Evidence, 'digest'> : never
  : never

export async function createAcceptanceEvidence(body: EvidenceBody): Promise<AcceptanceEvidence> {
  const evidence = { ...body, digest: await sha256(canonicalJson(body)) } as AcceptanceEvidence
  return freezeDeep(evidence) as AcceptanceEvidence
}

export async function verifyAcceptanceEvidence(value: unknown): Promise<boolean> {
  if (!isAcceptanceEvidence(value)) return false
  const { digest, ...body } = value
  return digest === await sha256(canonicalJson(body))
}

function isCriterionVerdict(value: unknown): value is CriterionVerdict {
  if (!value || typeof value !== 'object') return false
  const verdict = value as Record<string, unknown>
  return typeof verdict.criterionId === 'string'
    && ['passed', 'failed', 'blocked', 'invalidated'].includes(String(verdict.status))
    && Array.isArray(verdict.evidenceRefs) && verdict.evidenceRefs.every((ref) => typeof ref === 'string')
    && typeof verdict.reason === 'string'
    && (verdict.repairHint === undefined || typeof verdict.repairHint === 'string')
    && typeof verdict.retryable === 'boolean'
}

const validEvidenceBase = (evidence: Record<string, unknown>): boolean => evidence.schemaVersion === 1
  && evidence.issuedBy === 'host-checker' && typeof evidence.id === 'string' && typeof evidence.criterionId === 'string'
  && typeof evidence.observedAt === 'number' && SHA256.test(String(evidence.digest))

const validAnswerEvidence = (evidence: Record<string, unknown>): boolean => ['present', 'absent', 'not-applicable'].includes(String(evidence.state))
  && (evidence.answerSha256 === undefined || SHA256.test(String(evidence.answerSha256)))

const validFileEvidence = (evidence: Record<string, unknown>): boolean => ['matched', 'mismatched', 'missing', 'invalid-path'].includes(String(evidence.state))
  && typeof evidence.path === 'string' && SHA256.test(String(evidence.expectedSha256))
  && (evidence.actualSha256 === undefined || SHA256.test(String(evidence.actualSha256)))

const validCommandEvidence = (evidence: Record<string, unknown>): boolean => ['matched', 'exit-code-mismatch', 'unknown-command', 'unavailable', 'revision-drift'].includes(String(evidence.state))
  && typeof evidence.registryId === 'string' && typeof evidence.command === 'string'
  && Array.isArray(evidence.args) && evidence.args.every((arg) => typeof arg === 'string')
  && typeof evidence.cwd === 'string' && Number.isInteger(evidence.expectedExitCode)
  && (evidence.workspaceRevision === undefined || typeof evidence.workspaceRevision === 'string')
  && (evidence.finalWorkspaceRevision === undefined || typeof evidence.finalWorkspaceRevision === 'string')
  && (evidence.exitCode === undefined || Number.isInteger(evidence.exitCode))
  && (evidence.outputSha256 === undefined || SHA256.test(String(evidence.outputSha256)))

const validArtifactEvidence = (evidence: Record<string, unknown>): boolean => ['matched', 'missing', 'invalid-path', 'digest-mismatch', 'invalid-json', 'unknown-schema', 'schema-mismatch'].includes(String(evidence.state))
  && typeof evidence.artifactId === 'string' && typeof evidence.path === 'string'
  && (evidence.schemaId === undefined || typeof evidence.schemaId === 'string')
  && (evidence.expectedSha256 === undefined || SHA256.test(String(evidence.expectedSha256)))
  && (evidence.actualSha256 === undefined || SHA256.test(String(evidence.actualSha256)))
  && (evidence.validationErrorSha256 === undefined || SHA256.test(String(evidence.validationErrorSha256)))

const validReviewEvidence = (evidence: Record<string, unknown>): boolean => ['matched', 'snapshot-missing', 'snapshot-not-ready', 'revision-mismatch', 'verification-missing', 'verification-failed'].includes(String(evidence.state))
  && typeof evidence.snapshotId === 'string' && ['build', 'smoke', 'test'].includes(String(evidence.verification))
  && typeof evidence.expectedRevision === 'string'
  && (evidence.snapshotRevision === undefined || typeof evidence.snapshotRevision === 'string')
  && (evidence.verificationId === undefined || typeof evidence.verificationId === 'string')
  && (evidence.verifiedRevision === undefined || typeof evidence.verifiedRevision === 'string')
  && (evidence.exitCode === undefined || Number.isInteger(evidence.exitCode))

const validSemanticEvidence = (evidence: Record<string, unknown>): boolean => ['matched', 'mismatched', 'blocked', 'budget-exceeded', 'unavailable'].includes(String(evidence.state))
  && typeof evidence.rubricId === 'string' && SHA256.test(String(evidence.rubricDigest))
  && Array.isArray(evidence.artifactDigests) && evidence.artifactDigests.every((digest) => SHA256.test(String(digest)))
  && Array.isArray(evidence.checks) && evidence.checks.every((value) => {
    if (!value || typeof value !== 'object') return false
    const check = value as Record<string, unknown>
    return ['correctness', 'freshness', 'source-validity'].includes(String(check.kind))
      && typeof check.verifierId === 'string' && ['passed', 'failed', 'blocked'].includes(String(check.verdict))
      && SHA256.test(String(check.reasonDigest)) && typeof check.freshContextProof === 'string'
      && Number.isSafeInteger(check.tokens) && Number(check.tokens) >= 0
      && typeof check.costUsd === 'number' && Number.isFinite(check.costUsd) && Number(check.costUsd) >= 0
  })
  && Number.isSafeInteger(evidence.totalTokens) && Number(evidence.totalTokens) >= 0
  && typeof evidence.totalCostUsd === 'number' && Number.isFinite(evidence.totalCostUsd) && Number(evidence.totalCostUsd) >= 0

export function isAcceptanceEvidence(value: unknown): value is AcceptanceEvidence {
  if (!value || typeof value !== 'object') return false
  const evidence = value as Record<string, unknown>
  if (!validEvidenceBase(evidence)) return false
  if (evidence.kind === 'assistant-answer-present') return validAnswerEvidence(evidence)
  if (evidence.kind === 'file-content') return validFileEvidence(evidence)
  if (evidence.kind === 'registered-command' || evidence.kind === 'test-suite') return validCommandEvidence(evidence)
  if (evidence.kind === 'artifact-exists' || evidence.kind === 'json-schema') return validArtifactEvidence(evidence)
  if (evidence.kind === 'review-verification') return validReviewEvidence(evidence)
  return evidence.kind === 'semantic-verifier' && validSemanticEvidence(evidence)
}

export function isAcceptanceSnapshot(value: unknown): value is AcceptanceSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>
  return snapshot.schemaVersion === 1
    && typeof snapshot.runId === 'string'
    && Number.isSafeInteger(snapshot.iteration) && Number(snapshot.iteration) >= 0
    && SHA256.test(String(snapshot.goalContractDigest))
    && (snapshot.workflowRevision === undefined || (Number.isSafeInteger(snapshot.workflowRevision) && Number(snapshot.workflowRevision) >= 0))
    && Array.isArray(snapshot.verdicts) && snapshot.verdicts.every(isCriterionVerdict)
    && ['passed', 'unmet', 'blocked', 'unverifiable', 'failed'].includes(String(snapshot.overall))
    && (snapshot.weakestCriterionId === undefined || typeof snapshot.weakestCriterionId === 'string')
    && Array.isArray(snapshot.impactedNodeIds) && snapshot.impactedNodeIds.every((id) => typeof id === 'string')
    && SHA256.test(String(snapshot.digest))
    && typeof snapshot.evaluatedAt === 'number'
}

export async function verifyAcceptanceSnapshot(value: unknown): Promise<boolean> {
  if (!isAcceptanceSnapshot(value)) return false
  const { digest, ...body } = value
  return digest === await sha256(canonicalJson(body))
}

export async function createAcceptanceSnapshot(input: {
  runId: string
  iteration: number
  goalContract: GoalContractSnapshot
  verdicts: readonly CriterionVerdict[]
  workflowRevision?: number
  /** Host-resolved graph nodes; non-graph callers retain criterion-id fallback. */
  impactedNodeIds?: readonly string[]
}): Promise<AcceptanceSnapshot> {
  const failed = input.verdicts.find((verdict) => verdict.status === 'failed' || verdict.status === 'invalidated')
  const blocked = input.verdicts.find((verdict) => verdict.status === 'blocked')
  const overall = input.verdicts.length === 0 ? 'unverifiable'
    : failed ? 'unmet'
      : blocked ? 'blocked'
        : input.verdicts.every((verdict) => verdict.status === 'passed') ? 'passed' : 'failed'
  const evaluatedAt = Date.now()
  const body = {
    schemaVersion: 1 as const,
    runId: input.runId,
    iteration: input.iteration,
    goalContractDigest: input.goalContract.digest,
    ...(input.workflowRevision === undefined ? {} : { workflowRevision: input.workflowRevision }),
    verdicts: input.verdicts.map(serializableCriterionVerdict),
    overall,
    ...((failed || blocked) ? { weakestCriterionId: (failed || blocked)?.criterionId } : {}),
    impactedNodeIds: (failed || blocked)
      ? [...new Set(input.impactedNodeIds || [(failed || blocked)!.criterionId])].sort()
      : [],
    evaluatedAt,
  }
  const snapshot = { ...body, digest: await sha256(canonicalJson(body)) }
  return freezeDeep(snapshot) as AcceptanceSnapshot
}
