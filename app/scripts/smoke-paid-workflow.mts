import assert from 'node:assert/strict'
import {
  approveWorkflowSpec,
  buildWorkflowStageDeliverables,
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
  rejectWorkflowDeliverable,
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
  runner: 'claude',
  runnerCapabilities: resolveWorkflowRunner('claude').capabilities,
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

const deliverables = buildWorkflowStageDeliverables(reviewed, '2026-07-19T01:07:30.000Z')
assert.deepEqual(deliverables.map((item) => item.stage), ['spec', 'tickets', 'tdd', 'review', 'final-output'])
// every stage must expose readable evidence and a stable address — that is
// what makes it inspectable, rather than a field asserting that it is
assert.ok(deliverables.every((item) => item.id.startsWith('deliverable:')))
assert.ok(deliverables.every((item) => Array.isArray(item.evidence)))
assert.ok(deliverables.some((item) => item.evidence.length > 0))
const rejected = rejectWorkflowDeliverable(deliverables[0], 'Spec needs a clearer acceptance boundary', '2026-07-19T01:08:00.000Z')
assert.equal(rejected.ok, true)
if (!rejected.ok) throw new Error(rejected.reason)
assert.equal(rejected.deliverable.status, 'rejected')
const rejectedAgain = rejectWorkflowDeliverable(rejected.deliverable, 'again')
assert.equal(rejectedAgain.ok, false)
if (rejectedAgain.ok) throw new Error('already rejected deliverable was accepted')
assert.match(rejectedAgain.reason, /already rejected/i)

assert.deepEqual(resolveWorkflowRunner('codex').capabilities, {
  parseDoD: false,
  iterate: false,
  continueGoal: false,
  runScopedProgress: true,
})
assert.equal(resolveWorkflowRunner('claude').displayName, 'Claude Code')

assert.equal(recordReviewFindings(reviewed, [], '2026-07-19T01:08:00.000Z').status, 'ready-for-approval')
assert.throws(() => approveWorkflowSpec({ ...draft.spec, status: 'approved' }, '2026-07-19T01:09:00.000Z'), /already approved/i)

// ── ticket 17: deliverables persist and can be sent back ───────
{
  const {
  buildStageDeliverablesFromIndex,
  rejectWorkflowDeliverable,
  approveWorkflowDeliverable,
  workflowRejectionEvidence,
  workflowApprovalEvidence,
  REJECTION_PREFIX,
  } = await import('../src/agent/paidWorkflow.ts')
  const { recordArtifactEvidence } = await import('../src/agent/artifactIndex.ts')

  let index = {
    id: 'artifact:t1:r1',
    threadId: 't1',
    runId: 'r1',
    status: 'active' as const,
    currentStatus: 'review',
    decisions: [],
    blockers: [],
    suggestedNextSkills: [],
    updatedAt: '2026-08-17T00:00:00.000Z',
    entries: [],
  }
  for (const evidence of [
    { type: 'spec' as const, source: 'workflow/spec', status: 'complete' as const, title: 'Approved Spec', revision: 2 },
    { type: 'ticket' as const, source: 'workflow/ticket/1', status: 'complete' as const, title: 'Ticket 1' },
    { type: 'test' as const, source: 'workflow/test/1', status: 'pending' as const, title: 'TDD test' },
  ]) {
    index = recordArtifactEvidence(index, evidence, '2026-08-17T00:00:00.000Z')
  }

  // deliverables are addressable off the persisted index, not a live session
  const deliverables = buildStageDeliverablesFromIndex(index)
  assert.ok(deliverables.length >= 3)
  const spec = deliverables.find((item) => item.stage === 'spec')
  assert.ok(spec)
  assert.equal(spec.status, 'ready')
  assert.equal(spec.id, 'deliverable:artifact:t1:r1:spec')
  assert.ok(spec.evidence.length > 0, 'stage must expose readable evidence')

  // the blocking gate is visible: tdd is still pending
  const tdd = deliverables.find((item) => item.stage === 'tdd')
  assert.equal(tdd?.status, 'pending')

  // reject-and-return: a reason is required, and it is recorded in history
  assert.equal(rejectWorkflowDeliverable(spec, '   ').ok, false)
  const rejected = rejectWorkflowDeliverable(spec, '缺少驗收準則')
  assert.equal(rejected.ok, true)
  if (rejected.ok) {
    assert.equal(rejected.deliverable.status, 'rejected')
    assert.equal(rejected.deliverable.rejectionReason, '缺少驗收準則')
    // rejecting twice is refused
    assert.equal(rejectWorkflowDeliverable(rejected.deliverable, '再次').ok, false)

    const persisted = recordArtifactEvidence(
      index,
      workflowRejectionEvidence(rejected.deliverable, '缺少驗收準則'),
      '2026-08-17T01:00:00.000Z',
    )
    const after = buildStageDeliverablesFromIndex(persisted)
    const specAfter = after.find((item) => item.stage === 'spec')
    assert.equal(specAfter?.status, 'rejected', 'rejection must survive a reload of the index')
    assert.equal(specAfter?.rejectionReason, '缺少驗收準則')
    assert.ok(
      persisted.entries.some((entry) => entry.detail?.startsWith(REJECTION_PREFIX)),
      'rejection must be visible in the workflow history',
    )

    // approval: only a ready, unapproved deliverable can be approved
    const pendingTdd = after.find((item) => item.stage === 'tdd')
    assert.ok(pendingTdd)
    assert.equal(approveWorkflowDeliverable(pendingTdd).ok, false, 'a pending stage cannot be approved')
    assert.equal(approveWorkflowDeliverable(specAfter!).ok, false, 'a rejected stage cannot be approved')

    const tickets = after.find((item) => item.stage === 'tickets')
    assert.ok(tickets)
    const approved = approveWorkflowDeliverable(tickets, '2026-08-25T02:00:00.000Z')
    assert.equal(approved.ok, true)
    assert.equal(approveWorkflowDeliverable(approved.ok ? approved.deliverable : tickets).ok, false, 'approving twice is refused')

    const persistedApproval = recordArtifactEvidence(
      persisted,
      workflowApprovalEvidence(approved.ok ? approved.deliverable : tickets),
      '2026-08-25T02:00:00.000Z',
    )
    const afterApproval = buildStageDeliverablesFromIndex(persistedApproval)
    const ticketsAfter = afterApproval.find((item) => item.stage === 'tickets')
    assert.equal(ticketsAfter?.approvedAt, '2026-08-25T02:00:00.000Z', 'approval must survive a reload of the index')
    assert.equal(ticketsAfter?.status, 'ready', 'approval does not change the readiness status')
    assert.ok(
      ticketsAfter?.evidence.every((item) => !item.title?.includes('已核准')),
      'the approval marker is lifecycle history, not stage evidence',
    )

    // lifecycle markers route by deliverable source, not by evidence type —
    // a decision-type marker for tickets must never leak into the spec stage
    const specAfterApproval = afterApproval.find((item) => item.stage === 'spec')
    assert.ok(specAfterApproval)
    assert.equal(specAfterApproval.approvedAt, undefined)
    assert.ok(
      specAfterApproval.evidence.every((item) => !item.source.includes('/approval') && !item.source.includes('/rejection')),
      'lifecycle markers must not appear as another stage’s evidence',
    )
  }
}

console.log('paid-workflow smoke: 12 + ticket-17 deliverable assertions passed')
