import { agentLifecycleEventFor, projectAgentTree } from '../src/agent/agentTree.ts'
import { isAgentLifecycleEvent, isLegalAgentLifecycleTransition, type AgentLifecycleEvent, type AgentLifecycleState } from '../src/agent/agentLifecycle.ts'
import { appendTurnRecord, turnRecordEntries, type TurnRecordEntry } from '../src/agent/turnRecord.ts'
import type { SessionRecord } from './piHostProtocol.ts'

type LifecycleCarrier = { kind: string; event?: unknown }

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
  const latest = [...turnRecordEntries(session.record), ...pendingEntries]
    .reverse()
    .find((entry): entry is LifecycleCarrier & { event: AgentLifecycleEvent } => entry.kind === 'agent-lifecycle' && isAgentLifecycleEvent(entry.event))
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
