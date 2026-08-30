import {
  agentLifecycleFromTurnSettlement,
  createAgentLifecycleEvent,
  isTerminalAgentLifecycle,
  type AgentLifecycleEvent,
  type AgentLifecycleState,
} from './agentLifecycle.ts'
import { turnRecordEntries, type TurnRecord } from './turnRecord.ts'

export type AgentTreeSession = {
  id: string
  title: string
  threadId?: string
  parentSessionId?: string
  role?: string
  depth?: number
  archived?: boolean
  record?: TurnRecord
}

export type AgentTreeRun = {
  runId: string
  sessionId: string
  status: 'queued' | 'running' | 'interrupted' | 'settled'
}

export type AgentTreeNode = {
  agentId: string
  rootAgentId: string
  parentAgentId?: string
  taskPath: string
  title: string
  role?: string
  threadId?: string
  depth: number
  lifecycle: AgentLifecycleState
  archived: boolean
  legacy: boolean
  runId?: string
}

export type AgentTreeSnapshot = {
  rootAgentId: string
  selectedAgentId?: string
  agents: AgentTreeNode[]
}

type ProjectionInput = {
  sessions: readonly AgentTreeSession[]
  queue?: readonly AgentTreeRun[]
  activeSessionIds?: ReadonlySet<string>
  rootAgentId?: string
  agentId?: string
}

type Identity = {
  rootAgentId: string
  parentAgentId?: string
  taskPath: string
  depth: number
  legacy: boolean
}

const bounded = (value: string, max: number) => value.trim().slice(0, max)
const stableSuffix = (id: string) => bounded(id.replace(/[^a-zA-Z0-9]/g, ''), 64).slice(-6).toLowerCase() || 'legacy'
const pathSegment = (session: AgentTreeSession) => {
  const label = bounded(session.role || session.title || 'agent', 80)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'agent'
  return `${label}-${stableSuffix(session.id)}`
}

function identityFor(session: AgentTreeSession, byId: ReadonlyMap<string, AgentTreeSession>, cache: Map<string, Identity>, visiting = new Set<string>()): Identity {
  const cached = cache.get(session.id)
  if (cached) return cached
  if (visiting.has(session.id)) {
    const cyclic = { rootAgentId: session.id, taskPath: `/legacy/${stableSuffix(session.id)}`, depth: 0, legacy: true }
    cache.set(session.id, cyclic)
    return cyclic
  }
  visiting.add(session.id)
  const parent = session.parentSessionId ? byId.get(session.parentSessionId) : undefined
  let identity: Identity
  if (!session.parentSessionId) {
    identity = { rootAgentId: session.id, taskPath: '/root', depth: 0, legacy: false }
  } else if (!parent) {
    identity = { rootAgentId: session.id, parentAgentId: session.parentSessionId, taskPath: `/legacy/${pathSegment(session)}`, depth: 0, legacy: true }
  } else {
    const parentIdentity = identityFor(parent, byId, cache, visiting)
    identity = {
      rootAgentId: parentIdentity.rootAgentId,
      parentAgentId: parent.id,
      taskPath: `${parentIdentity.taskPath}/${pathSegment(session)}`,
      depth: parentIdentity.depth + 1,
      legacy: parentIdentity.legacy || (session.depth !== undefined && session.depth !== parentIdentity.depth + 1),
    }
  }
  visiting.delete(session.id)
  cache.set(session.id, identity)
  return identity
}

function recordedLifecycle(session: AgentTreeSession): { state: AgentLifecycleState; runId?: string } | undefined {
  const entries = turnRecordEntries(session.record)
  let settlementFallback: AgentLifecycleState | undefined
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.kind === 'agent-lifecycle' && entry.event.agentId === session.id) {
      return { state: entry.event.state, runId: entry.event.runId }
    }
    if (entry.kind === 'turn-end' && !settlementFallback) settlementFallback = agentLifecycleFromTurnSettlement(entry.settlement)
  }
  return settlementFallback ? { state: settlementFallback } : undefined
}

function lifecycleFor(session: AgentTreeSession, queue: readonly AgentTreeRun[], active: ReadonlySet<string>): { state: AgentLifecycleState; runId?: string; legacy: boolean } {
  const latestRun = [...queue].reverse().find((run) => run.sessionId === session.id)
  if (active.has(session.id)) return { state: 'running', runId: latestRun?.runId, legacy: false }
  if (latestRun?.status === 'queued' || latestRun?.status === 'running' || latestRun?.status === 'interrupted') {
    return { state: latestRun.status, runId: latestRun.runId, legacy: false }
  }
  const recorded = recordedLifecycle(session)
  if (session.archived && (!recorded || !isTerminalAgentLifecycle(recorded.state))) {
    return { state: 'unknown', runId: recorded?.runId, legacy: true }
  }
  if (recorded) return { state: recorded.state, runId: recorded.runId, legacy: false }
  return { state: session.archived ? 'unknown' : 'admitted', legacy: true }
}

/** Projects one root-scoped immutable snapshot; it never mutates or caches Host state. */
export function projectAgentTree(input: ProjectionInput): AgentTreeSnapshot | undefined {
  const byId = new Map(input.sessions.map((session) => [session.id, session]))
  const selected = input.agentId ? byId.get(input.agentId) : undefined
  const requestedRoot = input.rootAgentId ? byId.get(input.rootAgentId) : undefined
  if ((input.agentId && !selected) || (input.rootAgentId && !requestedRoot)) return undefined

  const identities = new Map<string, Identity>()
  const anchor = selected || requestedRoot
  if (!anchor) return undefined
  const anchorIdentity = identityFor(anchor, byId, identities)
  if (input.rootAgentId && anchorIdentity.rootAgentId !== input.rootAgentId) return undefined

  const rootAgentId = anchorIdentity.rootAgentId
  const agents = input.sessions
    .map((session) => ({ session, identity: identityFor(session, byId, identities) }))
    .filter(({ identity }) => identity.rootAgentId === rootAgentId)
    .map(({ session, identity }) => {
      const lifecycle = lifecycleFor(session, input.queue || [], input.activeSessionIds || new Set())
      return {
        agentId: session.id,
        rootAgentId,
        ...(identity.parentAgentId ? { parentAgentId: identity.parentAgentId } : {}),
        taskPath: identity.taskPath,
        title: bounded(session.title || 'Untitled agent', 160),
        ...(session.role ? { role: bounded(session.role, 80) } : {}),
        ...(session.threadId ? { threadId: bounded(session.threadId, 512) } : {}),
        depth: identity.depth,
        lifecycle: lifecycle.state,
        archived: Boolean(session.archived),
        legacy: identity.legacy || lifecycle.legacy,
        ...(lifecycle.runId ? { runId: lifecycle.runId } : {}),
      } satisfies AgentTreeNode
    })
    .sort((left, right) => left.depth - right.depth || left.taskPath.localeCompare(right.taskPath))

  return { rootAgentId, ...(input.agentId ? { selectedAgentId: input.agentId } : {}), agents }
}

export function agentLifecycleEventFor(node: AgentTreeNode, state: AgentLifecycleState, runId?: string, reason?: string): AgentLifecycleEvent | undefined {
  return createAgentLifecycleEvent({
    agentId: node.agentId,
    rootAgentId: node.rootAgentId,
    ...(node.parentAgentId ? { parentAgentId: node.parentAgentId } : {}),
    taskPath: node.taskPath,
    state,
    ...(runId ? { runId } : {}),
    ...(reason ? { reason } : {}),
  })
}
