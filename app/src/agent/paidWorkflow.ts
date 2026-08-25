/**
 * Paid flagship workflow contract:
 * Goal → Spec → Tickets → TDD → Review → user approval.
 *
 * This module owns the state machine and evidence shape. Runner adapters and
 * delivery tools remain separate; merge/push/deploy never become autonomous
 * side effects of this workflow.
 */

import type { LoopType } from './types.ts'
import { isFeatureEntitled, type EntitlementSnapshot, type FeatureId } from './entitlement.ts'
import { recordArtifactEvidence, type ArtifactEvidence, type ArtifactEvidenceType, type ArtifactIndex } from './artifactIndex.ts'
import { requireSideEffectEvidence, type SideEffectEvidence } from './evidence/sideEffectEvidence.ts'

export const PAID_WORKFLOW_FEATURE_ID = 'paid-spec-ticket-tdd-review' as FeatureId

export type WorkflowRunner = 'codex' | 'claude' | 'opencode'
export type WorkflowSpecStatus = 'draft' | 'approved'
export type WorkflowStatus =
  | 'spec-draft'
  | 'ticketed'
  | 'tdd'
  | 'review'
  | 'needs-correction'
  | 'ready-for-approval'
  | 'blocked'

export type WorkflowSpec = {
  id: string
  threadId: string
  runId: string
  objective: string
  loopType: 'Goal-based'
  status: WorkflowSpecStatus
  revision: number
  acceptanceCriteria: string[]
  createdAt: string
  approvedAt?: string
}

export type TddPhase = 'not-started' | 'red' | 'red-observed' | 'green' | 'blocked'

export type TddState = {
  testSource: string
  failingFirst: true
  phase: TddPhase
  retryBudget: number
  attempts: number
  testRuns: Array<{ passed: boolean; output: string; at: string }>
}

export type WorkflowTicket = {
  id: string
  specId: string
  title: string
  acceptanceCriteria: string
  blockedBy: string[]
  status: 'ready' | 'blocked' | 'tdd' | 'green' | 'needs-correction' | 'done'
  tdd: TddState
}

export type ReviewFinding = {
  id: string
  severity: 'blocker' | 'major' | 'minor' | 'note'
  title: string
  detail: string
  source: string
}

export type RunnerCapabilities = {
  parseDoD: boolean
  iterate: boolean
  continueGoal: boolean
  runScopedProgress: boolean
}

export type WorkflowRunnerResolution = {
  runner: WorkflowRunner
  displayName: string
  executionKind: 'external'
  capabilities: RunnerCapabilities
  limitation: string
}

export type WorkflowSession = {
  id: string
  threadId: string
  runId: string
  status: WorkflowStatus
  runner: WorkflowRunner
  runnerCapabilities: RunnerCapabilities
  spec: WorkflowSpec
  tickets: WorkflowTicket[]
  reviewFindings: ReviewFinding[]
  remainingRisks: string[]
  correctionBudget: number
  correctionsUsed: number
  userApprovalRequired: true
}

export type ReviewableResult = {
  status: WorkflowStatus
  spec: { id: string; revision: number; status: WorkflowSpecStatus }
  ticketIds: string[]
  greenTickets: string[]
  failedOrOpenTickets: string[]
  reviewFindings: ReviewFinding[]
  remainingRisks: string[]
  evidenceTypes: ArtifactEvidenceType[]
  handoffAvailable: boolean
  userApprovalRequired: true
  deliveryActions: { merge: 'approval-required'; push: 'approval-required'; deploy: 'approval-required' }
}

export type WorkflowDeliverableStage = 'spec' | 'tickets' | 'tdd' | 'review' | 'final-output'
export type WorkflowDeliverableStatus = 'pending' | 'ready' | 'failed' | 'rejected'

/** User-facing projection of the evidence produced by one workflow stage. */
export type WorkflowStageDeliverable = {
  id: string
  sessionId: string
  stage: WorkflowDeliverableStage
  title: string
  status: WorkflowDeliverableStatus
  revision: number
  producedAt: string
  evidence: ArtifactEvidence[]
  rejectedAt?: string
  rejectionReason?: string
  approvedAt?: string
}

type Result<T> = ({ ok: true } & T) | { ok: false; reason: string }

const RUNNER_DETAILS: Record<WorkflowRunner, Omit<WorkflowRunnerResolution, 'runner'>> = {
  codex: {
    displayName: 'Codex',
    executionKind: 'external',
    capabilities: { parseDoD: false, iterate: false, continueGoal: false, runScopedProgress: true },
    limitation: '外部 CLI 不回報內建 DoD／iterate／continueGoal 語意；需在本工作流層保留證據。',
  },
  claude: {
    displayName: 'Claude Code',
    executionKind: 'external',
    capabilities: { parseDoD: false, iterate: false, continueGoal: false, runScopedProgress: true },
    limitation: '外部 CLI 不回報內建 DoD／iterate／continueGoal 語意；需在本工作流層保留證據。',
  },
  opencode: {
    displayName: 'OpenCode',
    executionKind: 'external',
    capabilities: { parseDoD: false, iterate: false, continueGoal: false, runScopedProgress: true },
    limitation: '外部 CLI 不回報內建 DoD／iterate／continueGoal 語意；需在本工作流層保留證據。',
  },
}

function compact(value: unknown, max = 600): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function criteriaFor(objective: string): string[] {
  const clauses = objective
    .split(/[\n。！？!?；;]+/)
    .map((item) => compact(item, 240))
    .filter(Boolean)
  const criteria = clauses.length ? clauses : [compact(objective, 240)]
  criteria.push('每一項結果都必須有可重現的測試或 review evidence。')
  criteria.push('merge、push、deploy 只能在使用者明確核准後執行。')
  return [...new Set(criteria)].slice(0, 12)
}

export function canStartPaidWorkflow(
  entitlement: EntitlementSnapshot,
  featureId: FeatureId = PAID_WORKFLOW_FEATURE_ID,
): boolean {
  return isFeatureEntitled(entitlement, featureId)
}

export function createGoalWorkflowSpec(input: {
  threadId: string
  runId: string
  objective: string
  loopType: LoopType
  generatedAt?: string
}): Result<{ spec: WorkflowSpec }> {
  const objective = compact(input.objective)
  if (!objective) return { ok: false, reason: 'workflow objective cannot be empty' }
  if (input.loopType !== 'Goal-based') {
    return { ok: false, reason: 'paid workflow requires a Goal-based objective' }
  }
  return {
    ok: true,
    spec: {
      id: `spec:${input.threadId}:${input.runId}`,
      threadId: input.threadId,
      runId: input.runId,
      objective,
      loopType: 'Goal-based',
      status: 'draft',
      revision: 1,
      acceptanceCriteria: criteriaFor(objective),
      createdAt: input.generatedAt || new Date().toISOString(),
    },
  }
}

export function approveWorkflowSpec(spec: WorkflowSpec, at = new Date().toISOString()): WorkflowSpec {
  if (spec.status !== 'draft') throw new Error('workflow spec already approved')
  return { ...spec, status: 'approved', revision: spec.revision + 1, approvedAt: at }
}

export function createTicketsFromSpec(
  spec: WorkflowSpec,
  at = new Date().toISOString(),
): Result<{ tickets: WorkflowTicket[]; createdAt: string }> {
  if (spec.status !== 'approved') return { ok: false, reason: 'workflow spec must be approved before tickets' }
  const tickets = spec.acceptanceCriteria.map((criterion, index) => ({
    id: `ticket:${spec.id}:${index + 1}`,
    specId: spec.id,
    title: `Ticket ${index + 1}: ${criterion.slice(0, 120)}`,
    acceptanceCriteria: criterion,
    blockedBy: index === 0 ? [] : [`ticket:${spec.id}:${index}`],
    status: index === 0 ? ('ready' as const) : ('blocked' as const),
    tdd: {
      testSource: '',
      failingFirst: true as const,
      phase: 'not-started' as const,
      retryBudget: 2,
      attempts: 0,
      testRuns: [],
    },
  }))
  return { ok: true, tickets, createdAt: at }
}

export function createPaidWorkflowSession(input: {
  entitlement: EntitlementSnapshot
  spec: WorkflowSpec
  tickets: WorkflowTicket[]
  runner: WorkflowRunner
  correctionBudget?: number
}): Result<{ session: WorkflowSession }> {
  if (!canStartPaidWorkflow(input.entitlement)) {
    return { ok: false, reason: 'paid workflow entitlement is required' }
  }
  if (input.spec.status !== 'approved') {
    return { ok: false, reason: 'workflow spec must be approved before autonomous implementation' }
  }
  const runner = resolveWorkflowRunner(input.runner)
  return {
    ok: true,
    session: {
      id: `workflow:${input.spec.threadId}:${input.spec.runId}`,
      threadId: input.spec.threadId,
      runId: input.spec.runId,
      status: 'ticketed',
      runner: input.runner,
      runnerCapabilities: runner.capabilities,
      spec: input.spec,
      tickets: input.tickets,
      reviewFindings: [],
      remainingRisks: [],
      correctionBudget: Math.max(0, Math.min(5, Math.floor(input.correctionBudget ?? 2))),
      correctionsUsed: 0,
      userApprovalRequired: true,
    },
  }
}

export function startTicketTdd(
  ticket: WorkflowTicket,
  input: { testSource: string; retryBudget?: number; at?: string },
): Result<{ ticket: WorkflowTicket }> {
  if (ticket.blockedBy.length) return { ok: false, reason: `ticket is blocked by ${ticket.blockedBy.join(', ')}` }
  if (!input.testSource.trim()) return { ok: false, reason: 'TDD requires a test source before implementation' }
  return {
    ok: true,
    ticket: {
      ...ticket,
      status: 'tdd',
      tdd: {
        testSource: compact(input.testSource, 1200),
        failingFirst: true,
        phase: 'red',
        retryBudget: Math.max(1, Math.min(5, Math.floor(input.retryBudget || 2))),
        attempts: 0,
        testRuns: [],
      },
    },
  }
}

export function recordTddResult(
  ticket: WorkflowTicket,
  result: { passed: boolean; output: string; at?: string },
): Result<{ ticket: WorkflowTicket; correctionAvailable: boolean }> {
  if (ticket.tdd.phase === 'not-started') return { ok: false, reason: 'TDD has not started' }
  if (ticket.tdd.phase === 'blocked') return { ok: false, reason: 'TDD retry budget is exhausted' }
  if (ticket.tdd.phase === 'red' && result.passed) {
    return { ok: false, reason: 'failing-first requires an observed failing test before green' }
  }
  const at = result.at || new Date().toISOString()
  const testRuns = [...ticket.tdd.testRuns, { passed: result.passed, output: compact(result.output, 800), at }].slice(-12)
  if (ticket.tdd.phase === 'red' && !result.passed) {
    return {
      ok: true,
      correctionAvailable: true,
      ticket: { ...ticket, tdd: { ...ticket.tdd, phase: 'red-observed', attempts: ticket.tdd.attempts + 1, testRuns } },
    }
  }
  if (ticket.tdd.phase === 'red-observed' && result.passed) {
    return { ok: true, correctionAvailable: false, ticket: { ...ticket, status: 'green', tdd: { ...ticket.tdd, phase: 'green', testRuns } } }
  }
  const attempts = ticket.tdd.attempts + 1
  const exhausted = attempts >= ticket.tdd.retryBudget
  return {
    ok: true,
    correctionAvailable: !exhausted,
    ticket: {
      ...ticket,
      status: exhausted ? 'blocked' : 'needs-correction',
      tdd: { ...ticket.tdd, phase: exhausted ? 'blocked' : 'red-observed', attempts, testRuns },
    },
  }
}

export function requestBoundedCorrection(
  session: WorkflowSession,
  reason: string,
): { session: WorkflowSession; accepted: boolean; remainingRetries: number } {
  const remainingRetries = Math.max(0, session.correctionBudget - session.correctionsUsed)
  if (remainingRetries === 0) return { session: { ...session, status: 'blocked' }, accepted: false, remainingRetries: 0 }
  return {
    session: {
      ...session,
      status: 'needs-correction',
      correctionsUsed: session.correctionsUsed + 1,
      remainingRisks: [...new Set([...session.remainingRisks, compact(reason, 240)])],
    },
    accepted: true,
    remainingRetries: remainingRetries - 1,
  }
}

export function recordReviewFindings(
  session: WorkflowSession,
  findings: ReviewFinding[],
  _at = new Date().toISOString(),
): WorkflowSession {
  const normalized = findings.map((finding) => ({
    ...finding,
    title: compact(finding.title, 180),
    detail: compact(finding.detail, 500),
    source: compact(finding.source, 600),
  }))
  const risks = normalized
    .filter((finding) => finding.severity === 'blocker' || finding.severity === 'major')
    .map((finding) => finding.title)
  return {
    ...session,
    status: normalized.length ? 'needs-correction' : 'ready-for-approval',
    reviewFindings: normalized,
    remainingRisks: [...new Set([...session.remainingRisks, ...risks])],
  }
}

export function resolveWorkflowRunner(runner: WorkflowRunner): WorkflowRunnerResolution {
  return { runner, ...RUNNER_DETAILS[runner] }
}

export function workflowActionRequiresApproval(action: 'merge' | 'push' | 'deploy' | 'review'): boolean {
  return action === 'merge' || action === 'push' || action === 'deploy'
}

/** Delivery adapters must call this after the user approval and real effect. */
export function acceptWorkflowDeliveryEvidence(
  action: 'merge' | 'push' | 'deploy',
  value: unknown,
): Result<{ action: typeof action; evidence: SideEffectEvidence }> {
  try {
    const evidence = requireSideEffectEvidence(value)
    if (evidence.kind !== action) return { ok: false, reason: `evidence kind ${evidence.kind} does not match ${action}` }
    return { ok: true, action, evidence }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export type WorkflowDelivery = {
  action: 'merge' | 'push' | 'deploy'
  sessionId: string
  approvedBy: 'user'
  recordedAt: string
  evidence: SideEffectEvidence
}

/**
 * The only way a delivery action is recorded as performed. Two independent
 * gates, per ADR-0048 and the paid-workflow rule that delivery is never an
 * automatic side effect: explicit user approval (authorisation) and
 * adapter-issued evidence (execution credential). Approval mode `full` reaches
 * the first gate only — it cannot manufacture the second, and an unattended run
 * that times out produces no evidence and so records nothing.
 */
export function recordWorkflowDelivery(
  session: WorkflowSession,
  input: {
    action: 'merge' | 'push' | 'deploy'
    userApproved: boolean
    evidence: unknown
    at?: string
  },
): Result<{ session: WorkflowSession; delivery: WorkflowDelivery }> {
  if (!workflowActionRequiresApproval(input.action)) {
    return { ok: false, reason: `${input.action} is not a delivery action` }
  }
  if (!input.userApproved) {
    return { ok: false, reason: `${input.action} requires explicit user approval before delivery` }
  }
  const accepted = acceptWorkflowDeliveryEvidence(input.action, input.evidence)
  if (!accepted.ok) return { ok: false, reason: accepted.reason }
  if (accepted.evidence.runId && accepted.evidence.runId !== session.runId) {
    return { ok: false, reason: 'delivery evidence is scoped to a different run' }
  }
  const at = input.at || new Date().toISOString()
  return {
    ok: true,
    session,
    delivery: {
      action: input.action,
      sessionId: session.id,
      approvedBy: 'user',
      recordedAt: at,
      evidence: accepted.evidence,
    },
  }
}

function evidence(
  type: ArtifactEvidenceType,
  source: string,
  status: ArtifactEvidence['status'],
  revision: number,
  title: string,
  detail?: string,
): ArtifactEvidence {
  return { type, source, status, revision, title, detail: detail ? compact(detail, 360) : undefined }
}

export function collectWorkflowArtifactEvidence(session: WorkflowSession, at = new Date().toISOString()): ArtifactEvidence[] {
  const result: ArtifactEvidence[] = [
    evidence('spec', `workflow:${session.id}/spec`, 'complete', session.spec.revision, 'Approved Spec'),
    evidence('decision', `workflow:${session.id}/spec-approval`, 'complete', session.spec.revision, 'Spec approval'),
  ]
  for (const ticket of session.tickets) {
    result.push(evidence('ticket', `workflow:${session.id}/ticket/${ticket.id}`, ticket.status === 'blocked' ? 'failed' : 'complete', 1, ticket.title))
    if (ticket.tdd.testSource) {
      result.push(evidence('test', ticket.tdd.testSource, ticket.tdd.phase === 'green' ? 'complete' : ticket.tdd.phase === 'blocked' ? 'failed' : 'pending', Math.max(1, ticket.tdd.attempts), 'TDD test', ticket.tdd.testRuns.at(-1)?.output))
    }
  }
  for (const finding of session.reviewFindings) {
    result.push(evidence('review', finding.source, 'failed', 1, finding.title, finding.detail))
  }
  result.push(evidence('final-output', `workflow:${session.id}/result`, session.status === 'ready-for-approval' ? 'complete' : 'pending', 1, 'Reviewable result', `status=${session.status} at=${at}`))
  return result
}

const DELIVERABLE_STAGES: Array<{
  stage: WorkflowDeliverableStage
  title: string
  types: ArtifactEvidenceType[]
}> = [
  { stage: 'spec', title: 'Approved Spec', types: ['spec', 'decision'] },
  { stage: 'tickets', title: 'Ticket breakdown', types: ['ticket'] },
  { stage: 'tdd', title: 'TDD evidence', types: ['test'] },
  { stage: 'review', title: 'Review findings', types: ['review'] },
  { stage: 'final-output', title: 'Reviewable final output', types: ['final-output'] },
]

function deliverableStatus(evidence: ArtifactEvidence[]): WorkflowDeliverableStatus {
  if (evidence.some((item) => item.status === 'failed')) return 'failed'
  if (evidence.length > 0 && evidence.every((item) => item.status === 'complete')) return 'ready'
  return 'pending'
}

/**
 * Turn internal ArtifactEvidence into stage-level deliverables. A stage has a
 * stable id, bounded evidence references, and an explicit rejection state so
 * UI approval is about the artifact rather than an opaque state transition.
 */
export function buildWorkflowStageDeliverables(
  session: WorkflowSession,
  at = new Date().toISOString(),
): WorkflowStageDeliverable[] {
  const evidence = collectWorkflowArtifactEvidence(session, at)
  return DELIVERABLE_STAGES.map((definition) => {
    const stageEvidence = evidence.filter((item) => definition.types.includes(item.type))
    const revision = Math.max(1, ...stageEvidence.map((item) => item.revision || 1))
    return {
      id: `deliverable:${session.id}:${definition.stage}`,
      sessionId: session.id,
      stage: definition.stage,
      title: definition.title,
      status: deliverableStatus(stageEvidence),
      revision,
      producedAt: at,
      evidence: stageEvidence,
    }
  })
}

/**
 * The same five stages, derived from the persisted artifact index rather than
 * from a live session. This is what makes a deliverable addressable after the
 * run settles, and it deliberately reuses the index instead of adding a second
 * workflow store.
 */
export function buildStageDeliverablesFromIndex(
  index: Pick<ArtifactIndex, 'id' | 'entries'>,
  at = new Date().toISOString(),
): WorkflowStageDeliverable[] {
  const lifecycleEntries = index.entries.filter((entry) => /\/(approval|rejection)$/.test(entry.source))
  return DELIVERABLE_STAGES.map((definition) => {
    const stagePrefix = `deliverable:${index.id}:${definition.stage}/`
    const markers = lifecycleEntries.filter((entry) => entry.source.startsWith(stagePrefix))
    const entries = index.entries.filter(
      (entry) => definition.types.includes(entry.type) && !lifecycleEntries.includes(entry),
    )
    const stageEvidence: ArtifactEvidence[] = entries
      .map((entry) => ({
        type: entry.type,
        source: entry.source,
        status: entry.status,
        title: entry.title,
        detail: entry.detail,
        revision: entry.revision,
        digest: entry.digest,
      }))
    const rejection = markers.find((entry) => entry.detail?.startsWith(REJECTION_PREFIX))
    const approval = markers.find((entry) => entry.detail?.startsWith(APPROVAL_PREFIX) || entry.source.endsWith('/approval'))
    return {
      id: `deliverable:${index.id}:${definition.stage}`,
      sessionId: index.id,
      stage: definition.stage,
      title: definition.title,
      status: rejection ? 'rejected' : deliverableStatus(stageEvidence),
      revision: Math.max(1, ...stageEvidence.map((item) => item.revision || 1)),
      producedAt: entries.at(-1)?.at || at,
      evidence: stageEvidence,
      rejectedAt: rejection?.at,
      rejectionReason: rejection?.detail?.slice(REJECTION_PREFIX.length),
      approvedAt: approval?.at,
    }
  }).filter((deliverable) => deliverable.evidence.length > 0)
}

/** Marker that keeps a rejection in the run's own history, not a new store. */
export const REJECTION_PREFIX = '退回：'

/** Marker that keeps a user approval in the run's own history, not a new store. */
export const APPROVAL_PREFIX = '核准：'

/** Persistable evidence describing a user rejection of one stage. */
export function workflowRejectionEvidence(
  deliverable: WorkflowStageDeliverable,
  reason: string,
): ArtifactEvidence {
  return {
    type: deliverable.stage === 'final-output' ? 'final-output' : 'decision',
    source: `${deliverable.id}/rejection`,
    status: 'failed',
    revision: deliverable.revision,
    title: `${deliverable.title} 已退回`,
    detail: `${REJECTION_PREFIX}${compact(reason, 300)}`,
  }
}

/** Persistable evidence describing a user approval of one stage. */
export function workflowApprovalEvidence(
  deliverable: WorkflowStageDeliverable,
): ArtifactEvidence {
  return {
    type: deliverable.stage === 'final-output' ? 'final-output' : 'decision',
    source: `${deliverable.id}/approval`,
    status: 'complete',
    revision: deliverable.revision,
    title: `${deliverable.title} 已核准`,
    detail: APPROVAL_PREFIX,
  }
}

export function rejectWorkflowDeliverable(
  deliverable: WorkflowStageDeliverable,
  reason: string,
  at = new Date().toISOString(),
): Result<{ deliverable: WorkflowStageDeliverable }> {
  const normalized = compact(reason, 360)
  if (!normalized) return { ok: false, reason: 'rejection reason is required' }
  if (deliverable.status === 'rejected') return { ok: false, reason: 'deliverable is already rejected' }
  return {
    ok: true,
    deliverable: {
      ...deliverable,
      status: 'rejected',
      rejectedAt: at,
      rejectionReason: normalized,
    },
  }
}

export function approveWorkflowDeliverable(
  deliverable: WorkflowStageDeliverable,
  at = new Date().toISOString(),
): Result<{ deliverable: WorkflowStageDeliverable }> {
  if (deliverable.status === 'rejected') return { ok: false, reason: 'a rejected deliverable must be re-produced before approval' }
  if (deliverable.status !== 'ready') return { ok: false, reason: 'only a ready deliverable can be approved' }
  if (deliverable.approvedAt) return { ok: false, reason: 'deliverable is already approved' }
  return {
    ok: true,
    deliverable: { ...deliverable, approvedAt: at },
  }
}

export function recordWorkflowArtifacts(
  index: ArtifactIndex,
  session: WorkflowSession,
  at = new Date().toISOString(),
): ArtifactIndex {
  return collectWorkflowArtifactEvidence(session, at).reduce(
    (current, item) => recordArtifactEvidence(current, item, at),
    index,
  )
}

export function buildReviewableResult(session: WorkflowSession): ReviewableResult {
  const greenTickets = session.tickets.filter((ticket) => ticket.status === 'green' || ticket.status === 'done').map((ticket) => ticket.id)
  const failedOrOpenTickets = session.tickets.filter((ticket) => !greenTickets.includes(ticket.id)).map((ticket) => ticket.id)
  return {
    status: session.status,
    spec: { id: session.spec.id, revision: session.spec.revision, status: session.spec.status },
    ticketIds: session.tickets.map((ticket) => ticket.id),
    greenTickets,
    failedOrOpenTickets,
    reviewFindings: session.reviewFindings,
    remainingRisks: session.remainingRisks,
    evidenceTypes: ['spec', 'ticket', 'test', 'review', 'decision', 'final-output'],
    handoffAvailable: session.spec.status === 'approved',
    userApprovalRequired: true,
    deliveryActions: { merge: 'approval-required', push: 'approval-required', deploy: 'approval-required' },
  }
}
