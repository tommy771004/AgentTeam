import { agentLifecycleEventFor, projectAgentTree } from '../src/agent/agentTree.ts'
import { isAgentLifecycleEvent, isLegalAgentLifecycleTransition, type AgentLifecycleEvent, type AgentLifecycleState } from '../src/agent/agentLifecycle.ts'
import { appendTurnRecord, turnRecordEntries, type TurnRecordEntry } from '../src/agent/turnRecord.ts'
import { isAgentCollaborationEvent, type AgentCollaborationEvent } from '../src/agent/agentCollaboration.ts'
import type { SessionRecord } from './piHostProtocol.ts'

type LifecycleCarrier = { kind: string; event?: unknown }

/** True when this run already carries the exact Host-authored lifecycle fact. */
export function hasRecordedAgentLifecycle(
  sessions: readonly SessionRecord[],
  sessionId: string,
  state: AgentLifecycleState,
  runId?: string,
): boolean {
  const session = sessions.find((candidate) => candidate.id === sessionId)
  if (!session) return false
  return turnRecordEntries(session.record).some((entry) => entry.kind === 'agent-lifecycle'
    && isAgentLifecycleEvent(entry.event)
    && entry.event.state === state
    && entry.event.runId === runId)
}

export function agentLifecycleEventForSession(
  sessions: readonly SessionRecord[],
  sessionId: string,
  state: AgentLifecycleState,
  runId?: string,
  reason?: string,
  pendingEntries: readonly LifecycleCarrier[] = [],
) {
  const session = sessions.find((candidate) => candidate.id === sessionId)
  const snapshot = projectAgentTree({ sessions, agentId: sessionId })
  const node = snapshot?.agents.find((candidate) => candidate.agentId === sessionId)
  if (!session || !node) return undefined
  const event = agentLifecycleEventFor(node, state, runId, reason)
  if (!event) return undefined
  const lifecycleEntries = [...turnRecordEntries(session.record), ...pendingEntries]
    .filter((entry): entry is LifecycleCarrier & { event: AgentLifecycleEvent } => entry.kind === 'agent-lifecycle' && isAgentLifecycleEvent(entry.event))
  const latestForRun = runId
    ? [...lifecycleEntries].reverse().find((entry) => entry.event.runId === runId)
    : undefined
  const latest = latestForRun || lifecycleEntries.at(-1)
  return isLegalAgentLifecycleTransition(latest?.event, event) ? event : undefined
}

/** Appends one Host-authored lifecycle event to the affected session record. */
export function recordAgentLifecycle(
  sessions: readonly SessionRecord[],
  sessionId: string,
  state: AgentLifecycleState,
  runId?: string,
  reason?: string,
  publish?: (entry: TurnRecordEntry) => void,
): boolean {
  const session = sessions.find((candidate) => candidate.id === sessionId)
  const event = agentLifecycleEventForSession(sessions, sessionId, state, runId, reason)
  if (!session || !event) return false

  const entries = turnRecordEntries(session.record)
  const turn = entries.reduce(
    (highest, entry) => entry.kind === 'agent-lifecycle' ? highest : Math.max(highest, entry.turn),
    0,
  ) + 1
  session.record = appendTurnRecord(session.record, [{
    kind: 'agent-lifecycle',
    source: 'host',
    event,
    turn,
    step: 0,
    at: Date.now(),
  }])
  const committed = session.record.entries.at(-1)
  if (!committed) return false
  publish?.(committed)
  return true
}

/** Appends a bounded Host-authored collaboration event at the upcoming turn coordinate. */
export function recordAgentCollaborationEvent(
  sessions: readonly SessionRecord[],
  sessionId: string,
  event: AgentCollaborationEvent,
  publish?: (entry: TurnRecordEntry) => void,
): boolean {
  const session = sessions.find((candidate) => candidate.id === sessionId)
  if (!session || !isAgentCollaborationEvent(event)) return false
  const entries = turnRecordEntries(session.record)
  const turn = entries.reduce(
    (highest, entry) => entry.kind === 'agent-lifecycle' || entry.kind === 'agent-collaboration' ? highest : Math.max(highest, entry.turn),
    0,
  ) + 1
  session.record = appendTurnRecord(session.record, [{
    kind: 'agent-collaboration', source: 'host', event, turn, step: 0, at: Date.now(),
  }])
  const committed = session.record.entries.at(-1)
  if (!committed) return false
  publish?.(committed)
  return true
}
