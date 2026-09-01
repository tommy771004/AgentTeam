import type { AcceptanceEvidence, AcceptanceSnapshot, CriterionVerdict } from './acceptanceContract.ts'
import { selectReadyContinuationItems, type ContinuationItem } from './continuation.ts'

export type RepairTarget = Readonly<{
  criterionId: string
  reason: string
  evidenceRefs: readonly string[]
  impactedArtifactIds: readonly string[]
  impactedNodeIds: readonly string[]
  retryable: boolean
  instruction: string
}>

export type RepairPlan = Readonly<{
  schemaVersion: 1
  runId: string
  iteration: number
  goalContractDigest: string
  acceptanceDigest: string
  targets: readonly RepairTarget[]
  proposalHintIds: readonly string[]
  rejectedProposalIds: readonly string[]
  progressIdentity: string
  digest: string
}>

const SHA256 = /^[a-f0-9]{64}$/

export function isRepairPlan(value: unknown): value is RepairPlan {
  if (!value || typeof value !== 'object') return false
  const plan = value as Record<string, unknown>
  return plan.schemaVersion === 1 && typeof plan.runId === 'string'
    && Number.isSafeInteger(plan.iteration) && Number(plan.iteration) >= 1
    && SHA256.test(String(plan.goalContractDigest)) && SHA256.test(String(plan.acceptanceDigest))
    && SHA256.test(String(plan.progressIdentity)) && SHA256.test(String(plan.digest))
    && Array.isArray(plan.targets) && plan.targets.every((target) => {
      if (!target || typeof target !== 'object') return false
      const item = target as Record<string, unknown>
      return typeof item.criterionId === 'string' && typeof item.reason === 'string'
        && Array.isArray(item.evidenceRefs) && item.evidenceRefs.every((ref) => typeof ref === 'string')
        && Array.isArray(item.impactedArtifactIds) && item.impactedArtifactIds.every((id) => typeof id === 'string')
        && Array.isArray(item.impactedNodeIds) && item.impactedNodeIds.every((id) => typeof id === 'string')
        && typeof item.retryable === 'boolean' && typeof item.instruction === 'string'
    })
    && Array.isArray(plan.proposalHintIds) && plan.proposalHintIds.every((id) => typeof id === 'string')
    && Array.isArray(plan.rejectedProposalIds) && plan.rejectedProposalIds.every((id) => typeof id === 'string')
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
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

function artifactIds(evidence: readonly AcceptanceEvidence[]): string[] {
  return [...new Set(evidence.flatMap((item) => item.kind === 'artifact-exists' || item.kind === 'json-schema'
    ? [item.artifactId] : item.kind === 'file-content' ? [item.path] : []))].sort()
}

function evidenceProgressIdentity(evidence: AcceptanceEvidence): unknown {
  if (evidence.kind === 'assistant-answer-present') return [evidence.kind, evidence.state, evidence.answerSha256]
  if (evidence.kind === 'file-content') return [evidence.kind, evidence.state, evidence.path, evidence.actualSha256]
  if (evidence.kind === 'registered-command' || evidence.kind === 'test-suite') {
    return [evidence.kind, evidence.state, evidence.registryId, evidence.workspaceRevision,
      evidence.finalWorkspaceRevision, evidence.exitCode, evidence.outputSha256]
  }
  if (evidence.kind === 'artifact-exists' || evidence.kind === 'json-schema') {
    return [evidence.kind, evidence.state, evidence.artifactId, evidence.schemaId, evidence.actualSha256, evidence.validationErrorSha256]
  }
  if (evidence.kind === 'review-verification') {
    return [evidence.kind, evidence.state, evidence.snapshotId, evidence.expectedRevision,
      evidence.snapshotRevision, evidence.verificationId, evidence.verifiedRevision, evidence.exitCode]
  }
  return [evidence.kind, evidence.state]
}

const failedVerdicts = (snapshot: AcceptanceSnapshot): CriterionVerdict[] => snapshot.verdicts
  .filter((verdict) => verdict.status !== 'passed')
  .sort((left, right) => left.criterionId.localeCompare(right.criterionId))

export async function createRepairPlan(input: {
  snapshot: AcceptanceSnapshot
  evidence: readonly AcceptanceEvidence[]
  modelProposals?: readonly ContinuationItem[]
}): Promise<RepairPlan> {
  const verdicts = failedVerdicts(input.snapshot)
  const disposition = selectReadyContinuationItems(input.modelProposals || [], verdicts.map((verdict) => verdict.criterionId))
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]))
  const targets = verdicts.map((verdict) => {
    const supporting = verdict.evidenceRefs.map((ref) => evidenceById.get(ref)).filter((item): item is AcceptanceEvidence => Boolean(item))
    return {
      criterionId: verdict.criterionId,
      reason: verdict.reason,
      evidenceRefs: [...verdict.evidenceRefs],
      impactedArtifactIds: artifactIds(supporting),
      impactedNodeIds: [...input.snapshot.impactedNodeIds],
      retryable: verdict.retryable,
      instruction: verdict.repairHint || (verdict.retryable
        ? `Repair criterion ${verdict.criterionId} using only its Host evidence`
        : `Criterion ${verdict.criterionId} is non-retryable; stop or escalate`),
    }
  })
  const progressBody = {
    goalContractDigest: input.snapshot.goalContractDigest,
    verdicts: verdicts.map((verdict) => [verdict.criterionId, verdict.status, verdict.reason, verdict.retryable]),
    evidence: input.evidence.slice().sort((left, right) => left.criterionId.localeCompare(right.criterionId)).map(evidenceProgressIdentity),
    artifacts: artifactIds(input.evidence),
  }
  const progressIdentity = await sha256(canonicalJson(progressBody))
  const body = {
    schemaVersion: 1 as const,
    runId: input.snapshot.runId,
    iteration: input.snapshot.iteration,
    goalContractDigest: input.snapshot.goalContractDigest,
    acceptanceDigest: input.snapshot.digest,
    targets,
    proposalHintIds: disposition.accepted.map((item) => item.id),
    rejectedProposalIds: [...disposition.rejectedIds],
    progressIdentity,
  }
  return freezeDeep({ ...body, digest: await sha256(canonicalJson(body)) }) as RepairPlan
}

export function isRepairNoProgress(previousProgressIdentity: string | undefined, current: RepairPlan): boolean {
  return Boolean(previousProgressIdentity) && previousProgressIdentity === current.progressIdentity
}

export function repairPlanPrompt(originalPrompt: string, plan: RepairPlan): string {
  return [
    originalPrompt,
    '## Host canonical RepairPlan',
    `Acceptance: ${plan.acceptanceDigest}`,
    ...plan.targets.map((target) => [
      `- Criterion ${target.criterionId}: ${target.instruction}`,
      `  Reason: ${target.reason}`,
      `  Evidence: ${target.evidenceRefs.join(', ') || 'none'}`,
      `  Impacted artifacts: ${target.impactedArtifactIds.join(', ') || 'none'}`,
    ].join('\n')),
    plan.proposalHintIds.length ? `Model proposal hints retained (non-authoritative): ${plan.proposalHintIds.join(', ')}` : '',
    '只修復上述 Host targets，完成後讓 Host 重新驗收。record_continuation_items 僅是 proposal，不會自行決定下一輪。',
  ].filter(Boolean).join('\n')
}
