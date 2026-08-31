import { projectAgentTree, type AgentTreeSnapshot } from '../src/agent/agentTree.ts'
import type { PiQueuedRun } from './piRunQueue.ts'
import type { PiHostMessage, SessionRecord } from './piHostProtocol.ts'

type AgentDomainInput = {
  method: string
  params?: Record<string, unknown>
  id: string | number
  sessions: readonly SessionRecord[]
  queue: readonly PiQueuedRun[]
  activeSessionIds: ReadonlySet<string>
  activeRunIds?: ReadonlyMap<string, string>
}

function errorResponse(id: string | number, message: string): PiHostMessage {
  return { id, error: { code: 'invalid_request', message } }
}

/** Owns the root-scoped public agent tree read capability. */
export function handlePiHostAgentDomain(input: AgentDomainInput): PiHostMessage[] | undefined {
  if (input.method !== 'agents/list') return undefined
  const rootAgentId = typeof input.params?.rootAgentId === 'string' ? input.params.rootAgentId : undefined
  const agentId = typeof input.params?.agentId === 'string' ? input.params.agentId : undefined
  if (!rootAgentId && !agentId) return [errorResponse(input.id, 'rootAgentId or agentId is required')]
  const snapshot: AgentTreeSnapshot | undefined = projectAgentTree({
    sessions: input.sessions,
    queue: input.queue,
    activeSessionIds: input.activeSessionIds,
    activeRunIds: input.activeRunIds,
    rootAgentId,
    agentId,
  })
  if (!snapshot) return [errorResponse(input.id, rootAgentId ? 'rootAgentId must identify a known root agent' : 'Unknown agentId')]
  return [{ id: input.id, result: snapshot }]
}
