import { createHash, randomUUID } from 'node:crypto'
import {
  createAcceptanceEvidence,
  type AcceptanceEvidence,
  type CriterionVerdict,
} from '../../src/agent/acceptanceContract.ts'
import type { GoalCriterion } from '../../src/agent/goalContract.ts'
import {
  inspectOutbound,
  type BuildFlavor,
  type OutboundGuardMode,
  type OutboundInspectRequest,
  type OutboundInspectResult,
} from '../../src/agent/outbound/outboundGate.ts'

export const FRESH_SEMANTIC_VERIFIER_CAPABILITY = 'fresh-semantic-verifier-v1' as const
export const SEMANTIC_VERIFIER_CHECKS = ['correctness', 'freshness', 'source-validity'] as const
export type SemanticVerifierCheck = (typeof SEMANTIC_VERIFIER_CHECKS)[number]

export type SanitizedVerifierArtifact = Readonly<{
  artifactId: string
  schemaId: string
  digest: string
  sanitized: true
  content: unknown
}>

export type SemanticRubric = Readonly<{
  id: string
  digest: string
  instructions: string
}>

export type FreshSemanticVerifierRequest = Readonly<{
  schemaVersion: 1
  requestId: string
  runId: string
  check: SemanticVerifierCheck
  criterion: Readonly<{ id: string; rubricId: string }>
  rubric: SemanticRubric
  artifacts: readonly SanitizedVerifierArtifact[]
  evidenceRefs: readonly string[]
  freshContext: Readonly<{
    nonce: string
    workerContextExcluded: true
    providerHistoryExcluded: true
    reasoningExcluded: true
  }>
}>

export type FreshSemanticVerifierResult = Readonly<{
  verifierId: string
  check: SemanticVerifierCheck
  verdict: 'passed' | 'failed' | 'blocked'
  reason: string
  freshContextProof: string
  usage: Readonly<{ tokens: number; costUsd: number }>
}>

export type SemanticVerifierBudget = Readonly<{
  remainingTokens?: number
  remainingCostUsd?: number
}>

export type SemanticVerifierCheckResult = Readonly<{
  evidence: AcceptanceEvidence
  verdict: CriterionVerdict
  usage: Readonly<{ tokens: number; costUsd: number }>
}>

export type SemanticVerifierGate = (request: OutboundInspectRequest) => OutboundInspectResult
export type FreshSemanticVerifierRunner = (request: FreshSemanticVerifierRequest) => Promise<FreshSemanticVerifierResult>
type CheckEvidence = Extract<AcceptanceEvidence, { kind: 'semantic-verifier' }>['checks'][number]

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const SHA256 = /^[a-f0-9]{64}$/
const FORBIDDEN_CONTEXT_KEY = /^(workerTranscript|transcript|providerHistory|reasoning|messages|conversation|prompt)$/i

const digestText = (value: string): string => createHash('sha256').update(value).digest('hex')

function containsWorkerContext(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(containsWorkerContext)
  return Object.entries(value as Record<string, unknown>)
    .some(([key, child]) => FORBIDDEN_CONTEXT_KEY.test(key) || containsWorkerContext(child))
}

function validArtifact(value: unknown): value is SanitizedVerifierArtifact {
  if (!value || typeof value !== 'object') return false
  const artifact = value as Record<string, unknown>
  return Object.keys(artifact).every((key) => ['artifactId', 'schemaId', 'digest', 'sanitized', 'content'].includes(key))
    && ID.test(String(artifact.artifactId)) && ID.test(String(artifact.schemaId))
    && SHA256.test(String(artifact.digest)) && artifact.sanitized === true
    && !containsWorkerContext(artifact.content)
}

export function isFreshSemanticVerifierRequest(value: unknown): value is FreshSemanticVerifierRequest {
  if (!value || typeof value !== 'object' || containsWorkerContext(value)) return false
  const request = value as Record<string, unknown>
  if (!Object.keys(request).every((key) => [
    'schemaVersion', 'requestId', 'runId', 'check', 'criterion', 'rubric', 'artifacts', 'evidenceRefs', 'freshContext',
  ].includes(key))) return false
  const criterion = request.criterion as Record<string, unknown>
  const rubric = request.rubric as Record<string, unknown>
  const fresh = request.freshContext as Record<string, unknown>
  return request.schemaVersion === 1 && ID.test(String(request.requestId)) && ID.test(String(request.runId))
    && SEMANTIC_VERIFIER_CHECKS.includes(request.check as SemanticVerifierCheck)
    && Boolean(criterion) && ID.test(String(criterion.id)) && ID.test(String(criterion.rubricId))
    && Boolean(rubric) && ID.test(String(rubric.id)) && SHA256.test(String(rubric.digest)) && typeof rubric.instructions === 'string'
    && Array.isArray(request.artifacts) && request.artifacts.length > 0 && request.artifacts.every(validArtifact)
    && Array.isArray(request.evidenceRefs) && request.evidenceRefs.every((ref) => ID.test(String(ref)))
    && Boolean(fresh) && ID.test(String(fresh.nonce)) && fresh.workerContextExcluded === true
    && fresh.providerHistoryExcluded === true && fresh.reasoningExcluded === true
}

function validRunnerResult(value: unknown, request: FreshSemanticVerifierRequest): value is FreshSemanticVerifierResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  const usage = result.usage as Record<string, unknown>
  return ID.test(String(result.verifierId)) && result.check === request.check
    && ['passed', 'failed', 'blocked'].includes(String(result.verdict)) && typeof result.reason === 'string'
    && result.freshContextProof === request.freshContext.nonce && Boolean(usage)
    && Number.isSafeInteger(usage.tokens) && Number(usage.tokens) >= 0
    && typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd) && Number(usage.costUsd) >= 0
}

function buildRequest(input: {
  runId: string
  criterion: Extract<GoalCriterion, { kind: 'semantic-rubric' }>
  rubric: SemanticRubric
  artifacts: readonly SanitizedVerifierArtifact[]
  evidenceRefs: readonly string[]
  check: SemanticVerifierCheck
}): FreshSemanticVerifierRequest {
  const nonce = `fresh:${randomUUID()}`
  return Object.freeze({
    schemaVersion: 1 as const,
    requestId: `semantic:${input.criterion.id}:${input.check}:${randomUUID()}`,
    runId: input.runId,
    check: input.check,
    criterion: Object.freeze({ id: input.criterion.id, rubricId: input.criterion.rubricId }),
    rubric: Object.freeze({ ...input.rubric }),
    artifacts: Object.freeze(input.artifacts.map((artifact) => Object.freeze(structuredClone(artifact)))),
    evidenceRefs: Object.freeze([...input.evidenceRefs]),
    freshContext: Object.freeze({
      nonce,
      workerContextExcluded: true as const,
      providerHistoryExcluded: true as const,
      reasoningExcluded: true as const,
    }),
  })
}

async function runCheck(input: {
  request: FreshSemanticVerifierRequest
  runner: FreshSemanticVerifierRunner
  gate: SemanticVerifierGate
  effectiveMode: OutboundGuardMode
  buildFlavor: BuildFlavor
  providerConnectionId?: string
}): Promise<CheckEvidence> {
  const inspected = input.gate({
    channel: 'llm',
    runId: input.request.runId,
    payload: input.request,
    effectiveMode: input.effectiveMode,
    buildFlavor: input.buildFlavor,
    ...(input.providerConnectionId ? { providerConnectionId: input.providerConnectionId } : {}),
  })
  if (inspected.action === 'block') return {
    kind: input.request.check,
    verifierId: `gate:${input.request.check}`,
    verdict: 'blocked',
    reasonDigest: digestText(inspected.reason),
    freshContextProof: input.request.freshContext.nonce,
    tokens: 0,
    costUsd: 0,
  }
  try {
    if (!isFreshSemanticVerifierRequest(inspected.payload)) throw new Error('Outbound gate returned an invalid verifier payload')
    const result = await input.runner(inspected.payload)
    if (!validRunnerResult(result, input.request)) throw new Error('Verifier result failed fresh-context validation')
    return {
      kind: result.check,
      verifierId: result.verifierId,
      verdict: result.verdict,
      reasonDigest: digestText(result.reason),
      freshContextProof: result.freshContextProof,
      tokens: result.usage.tokens,
      costUsd: result.usage.costUsd,
    }
  } catch (error) {
    return {
      kind: input.request.check,
      verifierId: `unavailable:${input.request.check}`,
      verdict: 'blocked',
      reasonDigest: digestText(error instanceof Error ? error.message : 'Verifier unavailable'),
      freshContextProof: input.request.freshContext.nonce,
      tokens: 0,
      costUsd: 0,
    }
  }
}

function policyPassed(policy: Extract<GoalCriterion, { kind: 'semantic-rubric' }>['verifierPolicy'], checks: readonly CheckEvidence[]): boolean {
  const passed = checks.filter((check) => check.verdict === 'passed').length
  if (policy === 'all') return passed === SEMANTIC_VERIFIER_CHECKS.length
  if (policy === 'majority') return passed >= 2
  return checks.find((check) => check.kind === 'correctness')?.verdict === 'passed' && passed >= 2
}

function exceedsBudget(usage: { tokens: number; costUsd: number }, budget: SemanticVerifierBudget): boolean {
  return budget.remainingTokens !== undefined && usage.tokens > budget.remainingTokens
    || budget.remainingCostUsd !== undefined && usage.costUsd > budget.remainingCostUsd
}

export async function checkFreshSemanticCriterion(input: {
  runId: string
  criterion: Extract<GoalCriterion, { kind: 'semantic-rubric' }>
  rubric: SemanticRubric
  artifacts: readonly SanitizedVerifierArtifact[]
  evidenceRefs: readonly string[]
  budget: SemanticVerifierBudget
  effectiveMode: OutboundGuardMode
  buildFlavor: BuildFlavor
  providerConnectionId?: string
  runner: FreshSemanticVerifierRunner
  gate?: SemanticVerifierGate
  observedAt?: number
}): Promise<SemanticVerifierCheckResult> {
  if (input.rubric.id !== input.criterion.rubricId || input.rubric.digest !== digestText(input.rubric.instructions)) {
    throw new Error('Semantic verifier rubric identity/digest mismatch')
  }
  if (!input.artifacts.every(validArtifact)) throw new Error('Semantic verifier requires sanitized artifact projections')
  const requests = SEMANTIC_VERIFIER_CHECKS.map((check) => buildRequest({ ...input, check }))
  if (!requests.every(isFreshSemanticVerifierRequest)) throw new Error('Fresh verifier request contains forbidden worker context')
  const checks = await Promise.all(requests.map((request) => runCheck({
    request,
    runner: input.runner,
    gate: input.gate || inspectOutbound,
    effectiveMode: input.effectiveMode,
    buildFlavor: input.buildFlavor,
    providerConnectionId: input.providerConnectionId,
  })))
  const usage = {
    tokens: checks.reduce((total, check) => total + check.tokens, 0),
    costUsd: checks.reduce((total, check) => total + check.costUsd, 0),
  }
  const budgetExceeded = exceedsBudget(usage, input.budget)
  const unavailable = checks.some((check) => check.verdict === 'blocked')
  const passed = !budgetExceeded && !unavailable && policyPassed(input.criterion.verifierPolicy, checks)
  const state = budgetExceeded ? 'budget-exceeded' as const
    : unavailable ? 'blocked' as const
      : passed ? 'matched' as const : 'mismatched' as const
  const observedAt = input.observedAt ?? Date.now()
  const evidence = await createAcceptanceEvidence({
    schemaVersion: 1,
    id: `acceptance-evidence:${input.criterion.id}:${observedAt}`,
    criterionId: input.criterion.id,
    issuedBy: 'host-checker',
    observedAt,
    kind: 'semantic-verifier',
    state,
    rubricId: input.rubric.id,
    rubricDigest: input.rubric.digest,
    artifactDigests: input.artifacts.map((artifact) => artifact.digest).sort(),
    checks,
    totalTokens: usage.tokens,
    totalCostUsd: usage.costUsd,
  })
  return {
    evidence,
    verdict: {
      criterionId: input.criterion.id,
      status: state === 'matched' ? 'passed' : state === 'blocked' ? 'blocked' : 'failed',
      evidenceRefs: [evidence.id],
      reason: state === 'matched' ? `Fresh verifier policy ${input.criterion.verifierPolicy} passed`
        : state === 'budget-exceeded' ? 'Fresh verifier exceeded the remaining Goal budget'
          : state === 'blocked' ? 'Fresh verifier or Outbound Data Gate was unavailable'
            : `Fresh verifier policy ${input.criterion.verifierPolicy} did not pass`,
      repairHint: state === 'mismatched' ? 'Repair the artifact against the semantic rubric and re-verify in fresh context' : undefined,
      retryable: state === 'mismatched' || state === 'blocked',
    },
    usage,
  }
}

export async function unavailableFreshSemanticCriterion(input: {
  criterion: Extract<GoalCriterion, { kind: 'semantic-rubric' }>
  reason: string
  observedAt?: number
}): Promise<SemanticVerifierCheckResult> {
  const observedAt = input.observedAt ?? Date.now()
  const evidence = await createAcceptanceEvidence({
    schemaVersion: 1,
    id: `acceptance-evidence:${input.criterion.id}:${observedAt}`,
    criterionId: input.criterion.id,
    issuedBy: 'host-checker',
    observedAt,
    kind: 'semantic-verifier',
    state: 'unavailable',
    rubricId: input.criterion.rubricId,
    rubricDigest: '0'.repeat(64),
    artifactDigests: [],
    checks: [],
    totalTokens: 0,
    totalCostUsd: 0,
  })
  return {
    evidence,
    verdict: {
      criterionId: input.criterion.id,
      status: 'blocked',
      evidenceRefs: [evidence.id],
      reason: input.reason,
      retryable: true,
    },
    usage: { tokens: 0, costUsd: 0 },
  }
}
