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
