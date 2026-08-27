/**
 * Verified Working State（已驗證工作狀態）shared vocabulary.
 *
 * The Pi Core Host owns creation and future commits. This module deliberately
 * contains no bridge or mutation API, so renderer code can validate and
 * project a state without gaining a way to author canonical progress.
 */

export type WorkingGoalStatus = 'pending' | 'done' | 'blocked'

export type WorkingFileContentPredicate = {
  kind: 'file-content'
  path: string
  sha256: string
}

export type WorkingGoalCompletionPredicate = WorkingFileContentPredicate

export type WorkingEvidenceRef = {
  seq: number
  evidenceId: string
  runId: string
  goalId: string
  tool: string
  callId: string
  contractDigest: string
  schemaDigest: string
  receiptDigest: string
  /** Present when a child effect is adopted by its parent Host Checker. */
  parentRunId?: string
  delegationId?: string
  childSessionId?: string
  childRecordSeq?: number
}

export type DelegatedGoalAssignment = {
  schemaVersion: 1
  delegationId: string
  parentRunId: string
  parentSessionId: string
  childSessionId: string
  baseRevision: number
  constraints: string[]
  goal: {
    id: string
    description: string
    completionPredicate: WorkingGoalCompletionPredicate
  }
}

export type DelegatedGoalObservation = {
  schemaVersion: 1
  delegationId: string
  parentRunId: string
  parentSessionId: string
  childSessionId: string
  childRunId: string
  goalId: string
  baseRevision: number
  status: 'verified' | 'unverified' | 'invalidated'
  summary: string
  resource?: WorkingGoalCompletionPredicate
  evidenceRef?: WorkingEvidenceRef
}

export type DelegatedGoalCheck = {
  schemaVersion: 1
  delegationId: string
  parentRunId: string
  goalId: string
  baseRevision: number
  currentRevision: number
  verdict: 'accepted' | 'rejected' | 'rebased'
  reason: string
  committedRevision?: number
}

export type WorkingGoal = {
  id: string
  description: string
  status: WorkingGoalStatus
  evidence: WorkingEvidenceRef[]
  completionPredicate?: WorkingGoalCompletionPredicate
  blocker?: string
  assignedSessionId?: string
}

export type WorkingState = {
  schemaVersion: 1
  runId: string
  revision: number
  objective: string
  constraints: string[]
  goals: WorkingGoal[]
}

export type WorkingGoalSeed = {
  description: string
  completionPredicate?: WorkingGoalCompletionPredicate
}

type WorkingStateProposalBase = {
  schemaVersion: 1
  proposalId: string
  source: 'model' | 'host'
  baseRevision: number
  runId: string
  goalId: string
  tool: string
  callId: string
}

export type WorkingStateCompletionProposal = WorkingStateProposalBase & {
  proposedStatus: 'done'
  file: { path: string; sha256: string }
  modelEvidenceClaimed?: boolean
}

export type WorkingStateBlockedProposal = WorkingStateProposalBase & {
  proposedStatus: 'blocked'
  blocker: string
}

export type WorkingStateProposal = WorkingStateCompletionProposal | WorkingStateBlockedProposal

export type WorkingExecutionEvidence = {
  schemaVersion: 1
  evidenceId: string
  runId: string
  tool: string
  callId: string
  contractDigest: string
  schemaDigest: string
  receiptDigest: string
  resource: WorkingFileContentPredicate
  issuedBy: 'adapter'
  attestation: 'non-model'
}

export type WorkingToolSettlement = 'success' | 'denied' | 'failed' | 'cancelled' | 'interrupted' | 'not-executed'

export type WorkingStateCheck = {
  schemaVersion: 1
  runId: string
  baseRevision: number
  goalId: string
  proposalId: string
  tool: string
  callId: string
  verdict: 'accepted' | 'rejected' | 'rebased'
  reason: string
  /** Host revision checked; absent only on legacy Turn Record v3 entries. */
  currentRevision?: number
  committedRevision?: number
  evidenceRef?: WorkingEvidenceRef
}

const boundedString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max

const isSha256 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

function isDelegatedEvidenceIdentity(ref: Record<string, unknown>): boolean {
  return (ref.parentRunId === undefined || boundedString(ref.parentRunId, 512))
    && (ref.delegationId === undefined || boundedString(ref.delegationId, 2_048))
    && (ref.childSessionId === undefined || boundedString(ref.childSessionId, 512))
    && (ref.childRecordSeq === undefined || (Number.isSafeInteger(ref.childRecordSeq) && Number(ref.childRecordSeq) > 0))
}

export function isWorkingGoalCompletionPredicate(value: unknown): value is WorkingGoalCompletionPredicate {
  if (!value || typeof value !== 'object') return false
  const predicate = value as Record<string, unknown>
  return Object.keys(predicate).every((key) => ['kind', 'path', 'sha256'].includes(key))
    && predicate.kind === 'file-content'
    && boundedString(predicate.path, 1_024)
    && isSha256(predicate.sha256)
}

function isWorkingEvidenceRef(value: unknown): value is WorkingEvidenceRef {
  if (!value || typeof value !== 'object') return false
  const ref = value as Record<string, unknown>
  if (Object.keys(ref).some((key) => ![
    'seq', 'evidenceId', 'runId', 'goalId', 'tool', 'callId', 'contractDigest', 'schemaDigest', 'receiptDigest',
    'parentRunId', 'delegationId', 'childSessionId', 'childRecordSeq',
  ].includes(key))) return false
  if (!Number.isSafeInteger(ref.seq) || Number(ref.seq) < 1) return false
  return boundedString(ref.evidenceId, 512)
    && boundedString(ref.runId, 512)
    && boundedString(ref.goalId, 1_024)
    && boundedString(ref.tool, 256)
    && boundedString(ref.callId, 512)
    && isSha256(ref.contractDigest)
    && isSha256(ref.schemaDigest)
    && isSha256(ref.receiptDigest)
    && isDelegatedEvidenceIdentity(ref)
}

function isWorkingGoal(value: unknown): value is WorkingGoal {
  if (!value || typeof value !== 'object') return false
  const goal = value as Record<string, unknown>
  if (Object.keys(goal).some((key) => !['id', 'description', 'status', 'evidence', 'completionPredicate', 'blocker', 'assignedSessionId'].includes(key))) return false
  if (!boundedString(goal.id, 1_024) || !boundedString(goal.description, 800)) return false
  if (goal.status !== 'pending' && goal.status !== 'done' && goal.status !== 'blocked') return false
  if (!Array.isArray(goal.evidence) || goal.evidence.length > 100 || !goal.evidence.every(isWorkingEvidenceRef)) return false
  if (goal.completionPredicate !== undefined && !isWorkingGoalCompletionPredicate(goal.completionPredicate)) return false
  if (goal.blocker !== undefined && !boundedString(goal.blocker, 800)) return false
  if (goal.status === 'blocked' && (typeof goal.blocker !== 'string' || !goal.blocker.trim())) return false
  if (goal.status !== 'blocked' && goal.blocker !== undefined) return false
  if (goal.status === 'done' && goal.evidence.length === 0) return false
  if (goal.assignedSessionId !== undefined && !boundedString(goal.assignedSessionId, 512)) return false
  return true
}

/** Runtime format guard for persisted Host records and IPC payloads. */
export function isWorkingState(value: unknown): value is WorkingState {
  if (!value || typeof value !== 'object') return false
  const state = value as Record<string, unknown>
  if (Object.keys(state).some((key) => !['schemaVersion', 'runId', 'revision', 'objective', 'constraints', 'goals'].includes(key))) return false
  if (state.schemaVersion !== 1 || !boundedString(state.runId, 512)) return false
  if (!Number.isSafeInteger(state.revision) || Number(state.revision) < 1) return false
  if (!boundedString(state.objective, 800)) return false
  if (!Array.isArray(state.constraints) || state.constraints.length > 100) return false
  if (!state.constraints.every((constraint) => boundedString(constraint, 400))) return false
  if (!Array.isArray(state.goals) || state.goals.length < 1 || state.goals.length > 100) return false
  if (!state.goals.every(isWorkingGoal)) return false
  return new Set(state.goals.map((goal) => goal.id)).size === state.goals.length
}

/** Create the first immutable snapshot for one admitted builtin Task run. */
export function createInitialWorkingState(input: {
  runId: string
  objective: string
  constraints?: readonly string[]
  completionPredicate?: WorkingGoalCompletionPredicate
  goals?: readonly WorkingGoalSeed[]
}): WorkingState {
  const objective = input.objective.replace(/\s+/g, ' ').trim().slice(0, 800)
  const constraints = [...new Set((input.constraints || [])
    .map((constraint) => constraint.replace(/\s+/g, ' ').trim().slice(0, 400))
    .filter(Boolean))]
    .slice(0, 100)
  const seededGoals = (input.goals || []).slice(0, 100).map((goal, index) => ({
    id: `${input.runId}:goal:${index + 1}`,
    description: goal.description.replace(/\s+/g, ' ').trim().slice(0, 800) || objective,
    status: 'pending' as const,
    evidence: [],
    ...(goal.completionPredicate ? { completionPredicate: { ...goal.completionPredicate } } : {}),
  }))
  return {
    schemaVersion: 1,
    runId: input.runId,
    revision: 1,
    objective,
    constraints,
    goals: seededGoals.length ? seededGoals : [{
      id: `${input.runId}:goal:1`,
      description: objective,
      status: 'pending',
      evidence: [],
      ...(input.completionPredicate ? { completionPredicate: { ...input.completionPredicate } } : {}),
    }],
  }
}

export function isWorkingStateProposal(value: unknown): value is WorkingStateProposal {
  if (!value || typeof value !== 'object') return false
  const proposal = value as Record<string, unknown>
  if (Object.keys(proposal).some((key) => ![
    'schemaVersion', 'proposalId', 'source', 'baseRevision', 'runId', 'goalId', 'proposedStatus', 'tool', 'callId', 'file', 'modelEvidenceClaimed', 'blocker',
  ].includes(key))) return false
  const baseValid = proposal.schemaVersion === 1
    && (proposal.source === 'model' || proposal.source === 'host')
    && Number.isSafeInteger(proposal.baseRevision)
    && Number(proposal.baseRevision) > 0
    && boundedString(proposal.proposalId, 1_024)
    && boundedString(proposal.runId, 512)
    && boundedString(proposal.goalId, 1_024)
    && boundedString(proposal.tool, 256)
    && boundedString(proposal.callId, 512)
  if (!baseValid) return false
  if (proposal.proposedStatus === 'done') {
    return proposal.blocker === undefined
      && isWorkingGoalCompletionPredicate({ kind: 'file-content', ...(proposal.file as object) })
      && (proposal.modelEvidenceClaimed === undefined || typeof proposal.modelEvidenceClaimed === 'boolean')
  }
  return proposal.proposedStatus === 'blocked'
    && proposal.source === 'host'
    && proposal.file === undefined
    && proposal.modelEvidenceClaimed === undefined
    && boundedString(proposal.blocker, 800)
    && Boolean((proposal.blocker as string).trim())
}

export function isWorkingExecutionEvidence(value: unknown): value is WorkingExecutionEvidence {
  if (!value || typeof value !== 'object') return false
  const evidence = value as Record<string, unknown>
  if (Object.keys(evidence).some((key) => ![
    'schemaVersion', 'evidenceId', 'runId', 'tool', 'callId', 'contractDigest', 'schemaDigest', 'receiptDigest', 'resource', 'issuedBy', 'attestation',
  ].includes(key))) return false
  return evidence.schemaVersion === 1
    && boundedString(evidence.evidenceId, 512)
    && boundedString(evidence.runId, 512)
    && boundedString(evidence.tool, 256)
    && boundedString(evidence.callId, 512)
    && isSha256(evidence.contractDigest)
    && isSha256(evidence.schemaDigest)
    && isSha256(evidence.receiptDigest)
    && isWorkingGoalCompletionPredicate(evidence.resource)
    && evidence.issuedBy === 'adapter'
    && evidence.attestation === 'non-model'
}

export function isWorkingStateCheck(value: unknown): value is WorkingStateCheck {
  if (!value || typeof value !== 'object') return false
  const check = value as Record<string, unknown>
  if (Object.keys(check).some((key) => ![
    'schemaVersion', 'runId', 'baseRevision', 'goalId', 'proposalId', 'tool', 'callId', 'verdict', 'reason', 'currentRevision', 'committedRevision', 'evidenceRef',
  ].includes(key))) return false
  return check.schemaVersion === 1
    && boundedString(check.runId, 512)
    && Number.isSafeInteger(check.baseRevision)
    && Number(check.baseRevision) > 0
    && boundedString(check.goalId, 1_024)
    && boundedString(check.proposalId, 1_024)
    && boundedString(check.tool, 256)
    && boundedString(check.callId, 512)
    && (check.verdict === 'accepted' || check.verdict === 'rejected' || check.verdict === 'rebased')
    && boundedString(check.reason, 800)
    && (check.currentRevision === undefined || (Number.isSafeInteger(check.currentRevision) && Number(check.currentRevision) > 0))
    && (check.committedRevision === undefined || (Number.isSafeInteger(check.committedRevision)
      && Number(check.committedRevision) > Number(check.currentRevision || check.baseRevision)))
    && (check.evidenceRef === undefined || isWorkingEvidenceRef(check.evidenceRef))
}

function rejected(input: {
  state: WorkingState
  proposal: Partial<WorkingStateProposal>
  reason: string
}): { verdict: 'rejected'; reason: string; check: WorkingStateCheck; state?: undefined } {
  return {
    verdict: 'rejected',
    reason: input.reason,
    check: {
      schemaVersion: 1,
      runId: input.state.runId,
      baseRevision: Number.isSafeInteger(input.proposal.baseRevision) && Number(input.proposal.baseRevision) > 0
        ? Number(input.proposal.baseRevision)
        : input.state.revision,
      goalId: boundedString(input.proposal.goalId, 1_024) ? input.proposal.goalId : 'unknown-goal',
      proposalId: boundedString(input.proposal.proposalId, 1_024) ? input.proposal.proposalId : 'unknown-proposal',
      tool: boundedString(input.proposal.tool, 256) ? input.proposal.tool : 'unknown-tool',
      callId: boundedString(input.proposal.callId, 512) ? input.proposal.callId : 'unknown-call',
      verdict: 'rejected',
      reason: input.reason,
      currentRevision: input.state.revision,
    },
  }
}

/**
 * Goal-specific fail-closed Checker. Its caller supplies the trusted result
 * envelope received directly from Pi; model text and arguments can only make
 * the proposal on the other side of this boundary.
 */
export function checkWorkingStateProposal(input: {
  state: WorkingState
  proposal: WorkingStateProposal
  settlement: WorkingToolSettlement
  evidence: unknown
  evidenceSeq: number
  /** False when a later sibling effect changed the verified resource. */
  evidenceStillApplicable?: boolean
  /** Current continuation run; state.runId remains the stable lineage id. */
  executionRunId?: string
}):
  | { verdict: 'accepted' | 'rebased'; reason: string; check: WorkingStateCheck; state: WorkingState }
  | { verdict: 'rejected'; reason: string; check: WorkingStateCheck; state?: undefined } {
  if (!isWorkingState(input.state)) return rejected({ state: input.state, proposal: input.proposal, reason: 'working-state-malformed' })
  if (!isWorkingStateProposal(input.proposal)) return rejected({ state: input.state, proposal: input.proposal, reason: 'proposal-malformed' })
  if (input.proposal.baseRevision > input.state.revision) return rejected({ state: input.state, proposal: input.proposal, reason: 'future-base-revision' })
  if (input.proposal.runId !== input.state.runId) return rejected({ state: input.state, proposal: input.proposal, reason: 'proposal-run-mismatch' })
  const goal = input.state.goals.find((candidate) => candidate.id === input.proposal.goalId)
  if (!goal) return rejected({ state: input.state, proposal: input.proposal, reason: 'proposal-goal-mismatch' })
  const stale = input.proposal.baseRevision < input.state.revision
  if (stale && goal.status !== 'pending') return rejected({ state: input.state, proposal: input.proposal, reason: 'stale-goal-conflict' })
  if (goal.status === 'done') return rejected({ state: input.state, proposal: input.proposal, reason: 'illegal-done-transition' })
  if (input.proposal.proposedStatus === 'blocked') {
    if (input.settlement === 'success') return rejected({ state: input.state, proposal: input.proposal, reason: 'blocked-without-failed-action' })
    if (goal.status !== 'pending') return rejected({ state: input.state, proposal: input.proposal, reason: 'illegal-blocked-transition' })
    const state = commitGoalState(input.state, goal.id, {
      status: 'blocked',
      blocker: input.proposal.blocker.replace(/\s+/g, ' ').trim().slice(0, 800),
    })
    return acceptedStateCheck(input.state, input.proposal, state, stale, `goal-blocked:tool-${input.settlement}`)
  }
  if (input.proposal.modelEvidenceClaimed) return rejected({ state: input.state, proposal: input.proposal, reason: 'model-attested-evidence-refused' })
  if (input.settlement !== 'success') return rejected({ state: input.state, proposal: input.proposal, reason: `tool-${input.settlement}` })
  if (input.evidenceStillApplicable === false) return rejected({ state: input.state, proposal: input.proposal, reason: 'execution-evidence-invalidated' })
  if (goal.completionPredicate?.kind !== 'file-content') return rejected({ state: input.state, proposal: input.proposal, reason: 'unsupported-goal-predicate' })
  if (input.proposal.tool !== 'write') return rejected({ state: input.state, proposal: input.proposal, reason: 'unsupported-goal-tool' })
  if (!Number.isSafeInteger(input.evidenceSeq) || input.evidenceSeq < 1) return rejected({ state: input.state, proposal: input.proposal, reason: 'evidence-sequence-malformed' })
  if (!isWorkingExecutionEvidence(input.evidence)) return rejected({ state: input.state, proposal: input.proposal, reason: 'execution-evidence-malformed' })
  const evidence = input.evidence
  if (evidence.evidenceId !== `execution:${evidence.receiptDigest}`) return rejected({ state: input.state, proposal: input.proposal, reason: 'evidence-identity-mismatch' })
  const executionRunId = input.executionRunId || input.state.runId
  if (evidence.runId !== executionRunId) return rejected({ state: input.state, proposal: input.proposal, reason: 'evidence-run-mismatch' })
  if (evidence.tool !== input.proposal.tool) return rejected({ state: input.state, proposal: input.proposal, reason: 'evidence-tool-mismatch' })
  if (evidence.callId !== input.proposal.callId) return rejected({ state: input.state, proposal: input.proposal, reason: 'evidence-call-mismatch' })
  if (evidence.resource.path !== input.proposal.file.path || evidence.resource.sha256 !== input.proposal.file.sha256) {
    return rejected({ state: input.state, proposal: input.proposal, reason: 'evidence-proposal-resource-mismatch' })
  }
  if (evidence.resource.path !== goal.completionPredicate.path || evidence.resource.sha256 !== goal.completionPredicate.sha256) {
    return rejected({ state: input.state, proposal: input.proposal, reason: 'goal-predicate-unmet' })
  }
  const evidenceRef: WorkingEvidenceRef = {
    seq: input.evidenceSeq,
    evidenceId: evidence.evidenceId,
    runId: evidence.runId,
    goalId: goal.id,
    tool: evidence.tool,
    callId: evidence.callId,
    contractDigest: evidence.contractDigest,
    schemaDigest: evidence.schemaDigest,
    receiptDigest: evidence.receiptDigest,
  }
  const state = commitGoalState(input.state, goal.id, { status: 'done', evidenceRef })
  const reason = 'goal-predicate-verified'
  return acceptedStateCheck(input.state, input.proposal, state, stale, reason, evidenceRef)
}

function commitGoalState(
  state: WorkingState,
  goalId: string,
  update: { status: 'blocked'; blocker: string } | { status: 'done'; evidenceRef: WorkingEvidenceRef },
): WorkingState {
  return {
    ...state,
    revision: state.revision + 1,
    constraints: [...state.constraints],
    goals: state.goals.map((goal) => {
      if (goal.id !== goalId) return { ...goal, evidence: [...goal.evidence] }
      if (update.status === 'blocked') return { ...goal, status: 'blocked', blocker: update.blocker, evidence: [...goal.evidence] }
      const { blocker: _blocker, ...withoutBlocker } = goal
      return { ...withoutBlocker, status: 'done', evidence: [...goal.evidence, update.evidenceRef] }
    }),
  }
}

function acceptedStateCheck(
  before: WorkingState,
  proposal: WorkingStateProposal,
  state: WorkingState,
  rebased: boolean,
  reason: string,
  evidenceRef?: WorkingEvidenceRef,
): { verdict: 'accepted' | 'rebased'; reason: string; check: WorkingStateCheck; state: WorkingState } {
  const verdict = rebased ? 'rebased' as const : 'accepted' as const
  return {
    verdict,
    reason,
    state,
    check: {
      schemaVersion: 1,
      runId: state.runId,
      baseRevision: proposal.baseRevision,
      currentRevision: before.revision,
      committedRevision: state.revision,
      goalId: proposal.goalId,
      proposalId: proposal.proposalId,
      tool: proposal.tool,
      callId: proposal.callId,
      verdict,
      reason,
      ...(evidenceRef ? { evidenceRef } : {}),
    },
  }
}

export function createDelegatedGoalAssignment(input: {
  state: WorkingState
  goalId: string
  parentSessionId: string
  childSessionId: string
}): DelegatedGoalAssignment {
  if (!isWorkingState(input.state)) throw new Error('parent Working State is malformed')
  const goal = input.state.goals.find((candidate) => candidate.id === input.goalId)
  if (!goal || goal.status !== 'pending') throw new Error('delegated goal must be pending')
  if (!goal.completionPredicate) throw new Error('delegated goal requires a verifiable completion predicate')
  if (!boundedString(input.parentSessionId, 512) || !boundedString(input.childSessionId, 512)) {
    throw new Error('delegated session identity is malformed')
  }
  return {
    schemaVersion: 1,
    delegationId: `${input.state.runId}:delegation:${goal.id}:${input.childSessionId}`.slice(0, 2_048),
    parentRunId: input.state.runId,
    parentSessionId: input.parentSessionId,
    childSessionId: input.childSessionId,
    baseRevision: input.state.revision,
    constraints: [...input.state.constraints],
    goal: {
      id: goal.id,
      description: goal.description,
      completionPredicate: { ...goal.completionPredicate },
    },
  }
}

export function isDelegatedGoalAssignment(value: unknown): value is DelegatedGoalAssignment {
  if (!value || typeof value !== 'object') return false
  const assignment = value as Record<string, unknown>
  if (Object.keys(assignment).some((key) => ![
    'schemaVersion', 'delegationId', 'parentRunId', 'parentSessionId', 'childSessionId', 'baseRevision', 'constraints', 'goal',
  ].includes(key))) return false
  if (assignment.schemaVersion !== 1
    || !boundedString(assignment.delegationId, 2_048)
    || !boundedString(assignment.parentRunId, 512)
    || !boundedString(assignment.parentSessionId, 512)
    || !boundedString(assignment.childSessionId, 512)
    || !Number.isSafeInteger(assignment.baseRevision)
    || Number(assignment.baseRevision) < 1
    || !Array.isArray(assignment.constraints)
    || assignment.constraints.length > 100
    || !assignment.constraints.every((constraint) => boundedString(constraint, 400))
    || !assignment.goal
    || typeof assignment.goal !== 'object') return false
  const goal = assignment.goal as Record<string, unknown>
  return Object.keys(goal).every((key) => ['id', 'description', 'completionPredicate'].includes(key))
    && boundedString(goal.id, 1_024)
    && boundedString(goal.description, 800)
    && isWorkingGoalCompletionPredicate(goal.completionPredicate)
}

export function isDelegatedGoalObservation(value: unknown): value is DelegatedGoalObservation {
  if (!value || typeof value !== 'object') return false
  const observation = value as Record<string, unknown>
  if (Object.keys(observation).some((key) => ![
    'schemaVersion', 'delegationId', 'parentRunId', 'parentSessionId', 'childSessionId', 'childRunId', 'goalId',
    'baseRevision', 'status', 'summary', 'resource', 'evidenceRef',
  ].includes(key))) return false
  return observation.schemaVersion === 1
    && boundedString(observation.delegationId, 2_048)
    && boundedString(observation.parentRunId, 512)
    && boundedString(observation.parentSessionId, 512)
    && boundedString(observation.childSessionId, 512)
    && boundedString(observation.childRunId, 512)
    && boundedString(observation.goalId, 1_024)
    && Number.isSafeInteger(observation.baseRevision)
    && Number(observation.baseRevision) > 0
    && (observation.status === 'verified' || observation.status === 'unverified' || observation.status === 'invalidated')
    && boundedString(observation.summary, 800)
    && (observation.resource === undefined || isWorkingGoalCompletionPredicate(observation.resource))
    && (observation.evidenceRef === undefined || isWorkingEvidenceRef(observation.evidenceRef))
}

export function isDelegatedGoalCheck(value: unknown): value is DelegatedGoalCheck {
  if (!value || typeof value !== 'object') return false
  const check = value as Record<string, unknown>
  if (Object.keys(check).some((key) => ![
    'schemaVersion', 'delegationId', 'parentRunId', 'goalId', 'baseRevision', 'currentRevision', 'verdict', 'reason', 'committedRevision',
  ].includes(key))) return false
  return check.schemaVersion === 1
    && boundedString(check.delegationId, 2_048)
    && boundedString(check.parentRunId, 512)
    && boundedString(check.goalId, 1_024)
    && Number.isSafeInteger(check.baseRevision)
    && Number(check.baseRevision) > 0
    && Number.isSafeInteger(check.currentRevision)
    && Number(check.currentRevision) > 0
    && (check.verdict === 'accepted' || check.verdict === 'rejected' || check.verdict === 'rebased')
    && boundedString(check.reason, 800)
    && (check.committedRevision === undefined
      || (Number.isSafeInteger(check.committedRevision) && Number(check.committedRevision) > Number(check.currentRevision)))
}

function delegatedRejected(
  state: WorkingState,
  assignment: DelegatedGoalAssignment,
  reason: string,
): { check: DelegatedGoalCheck; state?: undefined } {
  return {
    check: {
      schemaVersion: 1,
      delegationId: assignment.delegationId,
      parentRunId: state.runId,
      goalId: assignment.goal.id,
      baseRevision: assignment.baseRevision,
      currentRevision: state.revision,
      verdict: 'rejected',
      reason,
    },
  }
}

function delegatedIdentityFailure(
  state: WorkingState,
  assignment: DelegatedGoalAssignment,
  observation: DelegatedGoalObservation,
): string | undefined {
  if (assignment.parentRunId !== state.runId || observation.parentRunId !== state.runId) return 'delegation-run-mismatch'
  if (observation.delegationId !== assignment.delegationId
    || observation.parentSessionId !== assignment.parentSessionId
    || observation.childSessionId !== assignment.childSessionId
    || observation.baseRevision !== assignment.baseRevision) return 'delegation-identity-mismatch'
  if (observation.goalId !== assignment.goal.id) return 'delegation-goal-mismatch'
  return undefined
}

function delegatedEvidenceFailure(
  state: WorkingState,
  assignment: DelegatedGoalAssignment,
  observation: DelegatedGoalObservation,
  goal: WorkingGoal,
): string | undefined {
  if (observation.status === 'invalidated') return 'delegated-evidence-invalidated'
  if (observation.status !== 'verified' || !observation.resource || !observation.evidenceRef) return 'child-goal-not-verified'
  const evidence = observation.evidenceRef
  if (evidence.parentRunId !== state.runId
    || evidence.goalId !== goal.id
    || evidence.delegationId !== assignment.delegationId
    || evidence.childSessionId !== assignment.childSessionId
    || evidence.runId !== observation.childRunId
    || evidence.childRecordSeq !== evidence.seq) return 'delegated-evidence-identity-mismatch'
  if (!goal.completionPredicate
    || JSON.stringify(observation.resource) !== JSON.stringify(goal.completionPredicate)
    || JSON.stringify(assignment.goal.completionPredicate) !== JSON.stringify(goal.completionPredicate)) {
    return 'delegated-goal-predicate-unmet'
  }
  return undefined
}

/** Parent-only CAS Checker for one Host-observed child result. */
export function checkDelegatedGoalObservation(input: {
  state: WorkingState
  assignment: DelegatedGoalAssignment
  observation: DelegatedGoalObservation
}): { check: DelegatedGoalCheck; state?: WorkingState } {
  const { state, assignment, observation } = input
  if (!isWorkingState(state) || !isDelegatedGoalAssignment(assignment)) {
    return delegatedRejected(state, assignment, 'delegation-assignment-malformed')
  }
  if (!isDelegatedGoalObservation(observation)) return delegatedRejected(state, assignment, 'delegation-observation-malformed')
  const identityFailure = delegatedIdentityFailure(state, assignment, observation)
  if (identityFailure) return delegatedRejected(state, assignment, identityFailure)
  const goal = state.goals.find((candidate) => candidate.id === assignment.goal.id)
  if (!goal) return delegatedRejected(state, assignment, 'delegation-goal-mismatch')
  const stale = assignment.baseRevision < state.revision
  if (assignment.baseRevision > state.revision) return delegatedRejected(state, assignment, 'future-base-revision')
  if (stale && goal.status !== 'pending') return delegatedRejected(state, assignment, 'stale-goal-conflict')
  if (goal.status !== 'pending') return delegatedRejected(state, assignment, 'illegal-parent-goal-transition')
  const evidenceFailure = delegatedEvidenceFailure(state, assignment, observation, goal)
  if (evidenceFailure) return delegatedRejected(state, assignment, evidenceFailure)
  const next = commitGoalState(state, goal.id, { status: 'done', evidenceRef: observation.evidenceRef! })
  const verdict = stale ? 'rebased' as const : 'accepted' as const
  return {
    state: next,
    check: {
      schemaVersion: 1,
      delegationId: assignment.delegationId,
      parentRunId: state.runId,
      goalId: goal.id,
      baseRevision: assignment.baseRevision,
      currentRevision: state.revision,
      committedRevision: next.revision,
      verdict,
      reason: stale ? 'delegated-goal-verified-rebased' : 'delegated-goal-verified',
    },
  }
}
