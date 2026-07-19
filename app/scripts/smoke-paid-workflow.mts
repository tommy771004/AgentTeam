import assert from 'node:assert/strict'
import {
  approveWorkflowSpec,
  buildReviewableResult,
  canStartPaidWorkflow,
  collectWorkflowArtifactEvidence,
  createPaidWorkflowSession,
  createGoalWorkflowSpec,
  createTicketsFromSpec,
  recordWorkflowArtifacts,
  recordReviewFindings,
  recordTddResult,
  requestBoundedCorrection,
  resolveWorkflowRunner,
  startTicketTdd,
  type WorkflowSession,
} from '../src/agent/paidWorkflow.ts'
import { resolveEntitlement } from '../src/agent/entitlement.ts'

const paid = resolveEntitlement({
  tier: 'paid',
  grantedFeatures: ['paid-spec-ticket-tdd-review'] as string[],
})
const free = resolveEntitlement(undefined)

assert.equal(canStartPaidWorkflow(paid), true)
assert.equal(canStartPaidWorkflow(free), false)

const draft = createGoalWorkflowSpec({
  threadId: 'thread-12',
  runId: 'run-12',
  objective: '重構登入流程並補齊測試',
  loopType: 'Goal-based',
  generatedAt: '2026-07-19T01:00:00.000Z',
})
assert.equal(draft.ok, true)
if (!draft.ok) throw new Error(draft.reason)
assert.equal(draft.spec.status, 'draft')
assert.ok(draft.spec.acceptanceCriteria.length >= 2)

const approved = approveWorkflowSpec(draft.spec, '2026-07-19T01:01:00.000Z')
assert.equal(approved.status, 'approved')
const tickets = createTicketsFromSpec(approved, '2026-07-19T01:02:00.000Z')
assert.equal(tickets.ok, true)
if (!tickets.ok) throw new Error(tickets.reason)
assert.equal(tickets.tickets.length, approved.acceptanceCriteria.length)
assert.deepEqual(tickets.tickets[0].blockedBy, [])
assert.equal(tickets.tickets[1].blockedBy[0], tickets.tickets[0].id)
assert.equal(createPaidWorkflowSession({ entitlement: free, spec: approved, tickets: tickets.tickets, runner: 'codex' }).ok, false)
const createdSession = createPaidWorkflowSession({ entitlement: paid, spec: approved, tickets: tickets.tickets, runner: 'codex' })
assert.equal(createdSession.ok, true)

const firstTicket = tickets.tickets[0]
const tdd = startTicketTdd(firstTicket, {
  testSource: 'app/src/auth/login.test.ts',
  retryBudget: 2,
  at: '2026-07-19T01:03:00.000Z',
})
assert.equal(tdd.ok, true)
if (!tdd.ok) throw new Error(tdd.reason)
assert.equal(tdd.ticket.tdd.phase, 'red')
assert.equal(tdd.ticket.tdd.failingFirst, true)
const red = recordTddResult(tdd.ticket, { passed: false, output: 'expected login redirect', at: '2026-07-19T01:04:00.000Z' })
assert.equal(red.ok, true)
if (!red.ok) throw new Error(red.reason)
assert.equal(red.ticket.tdd.phase, 'red-observed')
const green = recordTddResult(red.ticket, { passed: true, output: '1 passed', at: '2026-07-19T01:05:00.000Z' })
assert.equal(green.ok, true)
if (!green.ok) throw new Error(green.reason)
assert.equal(green.ticket.status, 'green')

const session: WorkflowSession = {
  id: 'workflow:thread-12:run-12',
  threadId: 'thread-12',
  runId: 'run-12',
  status: 'review',
  runner: 'opencode',
  runnerCapabilities: resolveWorkflowRunner('opencode').capabilities,
  spec: approved,
  tickets: [green.ticket],
  reviewFindings: [],
  remainingRisks: ['第二張 ticket 尚未執行'],
  correctionBudget: 2,
  correctionsUsed: 0,
  userApprovalRequired: true,
}
const reviewed = recordReviewFindings(session, [
  { id: 'finding-1', severity: 'major', title: '缺少錯誤路徑', detail: '補測試', source: 'review:run-12' },
], '2026-07-19T01:06:00.000Z')
assert.equal(reviewed.status, 'needs-correction')
assert.equal(reviewed.correctionsUsed, 0)
const result = buildReviewableResult(reviewed)
assert.equal(result.userApprovalRequired, true)
assert.equal(result.handoffAvailable, true)
assert.match(result.remainingRisks[0], /第二張|review|錯誤/i)
const correction = requestBoundedCorrection(reviewed, 'review finding requires another bounded pass')
assert.equal(correction.accepted, true)
assert.equal(correction.remainingRetries, 1)

const evidence = collectWorkflowArtifactEvidence(reviewed, '2026-07-19T01:07:00.000Z')
assert.deepEqual(new Set(evidence.map((item) => item.type)), new Set(['spec', 'ticket', 'test', 'review', 'decision', 'final-output']))
assert.ok(evidence.every((item) => item.source && (item.digest || item.revision != null)))
const indexed = recordWorkflowArtifacts({
  id: 'artifact:thread-12:run-12',
  threadId: 'thread-12',
  runId: 'run-12',
  status: 'active',
  currentStatus: 'review',
  decisions: [],
  blockers: [],
  suggestedNextSkills: [],
  updatedAt: '2026-07-19T01:07:00.000Z',
  entries: [],
}, reviewed, '2026-07-19T01:07:00.000Z')
assert.ok(indexed.entries.some((entry) => entry.type === 'test'))
assert.ok(indexed.entries.some((entry) => entry.type === 'review'))

assert.deepEqual(resolveWorkflowRunner('codex').capabilities, {
  parseDoD: false,
  iterate: false,
  continueGoal: false,
  runScopedProgress: true,
})
assert.equal(resolveWorkflowRunner('claude').displayName, 'Claude Code')
assert.equal(resolveWorkflowRunner('opencode').displayName, 'OpenCode')

assert.equal(recordReviewFindings(reviewed, [], '2026-07-19T01:08:00.000Z').status, 'ready-for-approval')
assert.throws(() => approveWorkflowSpec({ ...draft.spec, status: 'approved' }, '2026-07-19T01:09:00.000Z'), /already approved/i)

console.log('paid-workflow smoke: 12 assertions passed')
