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

export type WorkingStateProposal = {
  schemaVersion: 1
  proposalId: string
  source: 'model'
  baseRevision: number
  runId: string
  goalId: string
  proposedStatus: 'done'
  tool: string
  callId: string
  file: { path: string; sha256: string }
  modelEvidenceClaimed?: boolean
}

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
  verdict: 'accepted' | 'rejected'
  reason: string
  evidenceRef?: WorkingEvidenceRef
}

const boundedString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max

const isSha256 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

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
}): WorkingState {
  const objective = input.objective.replace(/\s+/g, ' ').trim().slice(0, 800)
  const constraints = [...new Set((input.constraints || [])
    .map((constraint) => constraint.replace(/\s+/g, ' ').trim().slice(0, 400))
    .filter(Boolean))]
    .slice(0, 100)
  return {
    schemaVersion: 1,
    runId: input.runId,
    revision: 1,
    objective,
    constraints,
    goals: [{
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
    'schemaVersion', 'proposalId', 'source', 'baseRevision', 'runId', 'goalId', 'proposedStatus', 'tool', 'callId', 'file', 'modelEvidenceClaimed',
  ].includes(key))) return false
  return proposal.schemaVersion === 1
    && proposal.source === 'model'
    && Number.isSafeInteger(proposal.baseRevision)
    && Number(proposal.baseRevision) > 0
    && boundedString(proposal.proposalId, 1_024)
    && boundedString(proposal.runId, 512)
    && boundedString(proposal.goalId, 1_024)
    && proposal.proposedStatus === 'done'
    && boundedString(proposal.tool, 256)
    && boundedString(proposal.callId, 512)
    && isWorkingGoalCompletionPredicate({ kind: 'file-content', ...(proposal.file as object) })
    && (proposal.modelEvidenceClaimed === undefined || typeof proposal.modelEvidenceClaimed === 'boolean')
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
    'schemaVersion', 'runId', 'baseRevision', 'goalId', 'proposalId', 'tool', 'callId', 'verdict', 'reason', 'evidenceRef',
  ].includes(key))) return false
  return check.schemaVersion === 1
    && boundedString(check.runId, 512)
    && Number.isSafeInteger(check.baseRevision)
    && Number(check.baseRevision) > 0
    && boundedString(check.goalId, 1_024)
    && boundedString(check.proposalId, 1_024)
    && boundedString(check.tool, 256)
    && boundedString(check.callId, 512)
    && (check.verdict === 'accepted' || check.verdict === 'rejected')
    && boundedString(check.reason, 800)
    && (check.evidenceRef === undefined || isWorkingEvidenceRef(check.evidenceRef))
}

function rejected(input: {
  state: WorkingState
  proposal: WorkingStateProposal
  reason: string
}): { verdict: 'rejected'; reason: string; check: WorkingStateCheck; state?: undefined } {
  return {
    verdict: 'rejected',
    reason: input.reason,
    check: {
      schemaVersion: 1,
      runId: input.state.runId,
      baseRevision: input.state.revision,
      goalId: input.proposal.goalId,
      proposalId: input.proposal.proposalId,
      tool: input.proposal.tool,
      callId: input.proposal.callId,
      verdict: 'rejected',
      reason: input.reason,
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
}):
  | { verdict: 'accepted'; reason: string; check: WorkingStateCheck; state: WorkingState }
  | { verdict: 'rejected'; reason: string; check: WorkingStateCheck; state?: undefined } {
  if (!isWorkingState(input.state)) return rejected({ state: input.state, proposal: input.proposal, reason: 'working-state-malformed' })
  if (!isWorkingStateProposal(input.proposal)) return rejected({ state: input.state, proposal: input.proposal, reason: 'proposal-malformed' })
  if (input.proposal.modelEvidenceClaimed) return rejected({ state: input.state, proposal: input.proposal, reason: 'model-attested-evidence-refused' })
  if (input.settlement !== 'success') return rejected({ state: input.state, proposal: input.proposal, reason: `tool-${input.settlement}` })
  if (input.proposal.baseRevision !== input.state.revision) return rejected({ state: input.state, proposal: input.proposal, reason: 'stale-base-revision' })
  if (input.proposal.runId !== input.state.runId) return rejected({ state: input.state, proposal: input.proposal, reason: 'proposal-run-mismatch' })
  const goal = input.state.goals.find((candidate) => candidate.id === input.proposal.goalId)
  if (!goal) return rejected({ state: input.state, proposal: input.proposal, reason: 'proposal-goal-mismatch' })
  if (goal.status !== 'pending') return rejected({ state: input.state, proposal: input.proposal, reason: 'goal-not-pending' })
  if (goal.completionPredicate?.kind !== 'file-content') return rejected({ state: input.state, proposal: input.proposal, reason: 'unsupported-goal-predicate' })
  if (input.proposal.tool !== 'write') return rejected({ state: input.state, proposal: input.proposal, reason: 'unsupported-goal-tool' })
  if (!Number.isSafeInteger(input.evidenceSeq) || input.evidenceSeq < 1) return rejected({ state: input.state, proposal: input.proposal, reason: 'evidence-sequence-malformed' })
  if (!isWorkingExecutionEvidence(input.evidence)) return rejected({ state: input.state, proposal: input.proposal, reason: 'execution-evidence-malformed' })
  const evidence = input.evidence
  if (evidence.evidenceId !== `execution:${evidence.receiptDigest}`) return rejected({ state: input.state, proposal: input.proposal, reason: 'evidence-identity-mismatch' })
  if (evidence.runId !== input.state.runId || evidence.runId !== input.proposal.runId) return rejected({ state: input.state, proposal: input.proposal, reason: 'evidence-run-mismatch' })
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
  const state: WorkingState = {
    ...input.state,
    revision: input.state.revision + 1,
    constraints: [...input.state.constraints],
    goals: input.state.goals.map((candidate) => candidate.id === goal.id
      ? { ...candidate, status: 'done', evidence: [...candidate.evidence, evidenceRef] }
      : { ...candidate, evidence: [...candidate.evidence] }),
  }
  const reason = 'goal-predicate-verified'
  return {
    verdict: 'accepted',
    reason,
    state,
    check: {
      schemaVersion: 1,
      runId: state.runId,
      baseRevision: input.state.revision,
      goalId: goal.id,
      proposalId: input.proposal.proposalId,
      tool: input.proposal.tool,
      callId: input.proposal.callId,
      verdict: 'accepted',
      reason,
      evidenceRef,
    },
  }
}
