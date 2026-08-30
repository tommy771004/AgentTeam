import type { TurnRecordEntry } from './turnRecord.ts'
import { isWorkingState, type WorkingState } from './workingState.ts'

export const WORKING_STATE_EVIDENCE_LIMIT = 3

export type WorkingStateVerification = 'verified' | 'unverified' | 'unavailable'

export type WorkingStateEvidenceView = {
  seq: number
  evidenceId: string
  tool: string
  callId: string
}

export type WorkingStateGoalView = {
  id: string
  description: string
  status: 'pending' | 'done' | 'blocked'
  blocker?: string
  evidence: WorkingStateEvidenceView[]
  hiddenEvidenceCount: number
}

/** Disposable, renderer-safe reading of Host-owned Working State. */
export type WorkingStateProjection = {
  runId: string
  revision?: number
  verification: WorkingStateVerification
  unavailabilityReason?: 'host-unavailable' | 'not-recorded' | 'legacy-unrecorded' | 'invalid'
  objective?: string
  constraints: string[]
  goals: WorkingStateGoalView[]
  tombstoned: boolean
}

function evidenceView(state: WorkingState): WorkingStateGoalView[] {
  return state.goals.map((goal) => {
    const bounded = [...goal.evidence]
      .sort((left, right) => left.seq - right.seq)
      .slice(-WORKING_STATE_EVIDENCE_LIMIT)
      .map((reference) => ({
        seq: reference.seq,
        evidenceId: reference.evidenceId.slice(0, 120),
        tool: reference.tool.slice(0, 80),
        callId: reference.callId.slice(0, 120),
      }))
    return {
      id: goal.id,
      description: goal.description,
      status: goal.status,
      ...(goal.blocker ? { blocker: goal.blocker } : {}),
      evidence: bounded,
      hiddenEvidenceCount: Math.max(0, goal.evidence.length - bounded.length),
    }
  })
}

export function projectWorkingState(
  state: WorkingState,
  verification: Exclude<WorkingStateVerification, 'unavailable'>,
): WorkingStateProjection {
  if (!isWorkingState(state)) return unavailableWorkingStateProjection('invalid-working-state')
  return {
    runId: state.runId,
    revision: state.revision,
    verification,
    objective: state.objective,
    constraints: [...state.constraints],
    goals: evidenceView(state),
    tombstoned: false,
  }
}

/** Latest canonical snapshot in recorded order, shared by live and replay. */
export function projectWorkingStateEntries(
  entries: readonly TurnRecordEntry[],
  hostAvailable: boolean,
): WorkingStateProjection {
  let latest: WorkingState | undefined
  for (const entry of [...entries].sort((left, right) => left.seq - right.seq)) {
    if (entry.kind !== 'working-state' || entry.source !== 'host' || !isWorkingState(entry.state)) continue
    if (!latest || entry.state.revision >= latest.revision) latest = entry.state
  }
  if (!latest) return unavailableWorkingStateProjection('working-state-unavailable', false, 'not-recorded')
  return projectWorkingState(latest, hostAvailable ? 'verified' : 'unverified')
}

export function unavailableWorkingStateProjection(
  runId: string,
  tombstoned = false,
  unavailabilityReason: WorkingStateProjection['unavailabilityReason'] = 'host-unavailable',
): WorkingStateProjection {
  return {
    runId,
    verification: 'unavailable',
    unavailabilityReason,
    constraints: [],
    goals: [],
    tombstoned,
  }
}

/** Monotonic renderer reducer: revisions only advance and tombstones are final. */
export function mergeWorkingStateProjection(
  current: WorkingStateProjection | undefined,
  incoming: WorkingStateProjection,
): WorkingStateProjection {
  if (!current) return incoming
  if (current.tombstoned) return current
  if (incoming.tombstoned) return incoming
  const currentRevision = current.revision || 0
  const incomingRevision = incoming.revision || 0
  if (incomingRevision < currentRevision) return current
  if (incomingRevision === currentRevision
    && current.verification === 'verified'
    && incoming.verification !== 'verified') return current
  return incoming
}
