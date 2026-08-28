import type { PiCapabilityCatalog } from './piCapabilityExtension.ts'
import {
  isWorkspaceTextSearchCapability,
  workspaceTextSearchAvailability,
} from './piWorkspaceTextSearchRuntime.ts'
import type { PiHostMessage } from './piHostProtocol.ts'

export type PiHostCapabilityDomainState = {
  capabilities: PiCapabilityCatalog
  workspaceTextSearchEnabled: boolean
}

function errorResponse(id: string | number, message: string): PiHostMessage {
  return { id, error: { code: 'invalid_request', message } }
}

/** Owns the complete capabilities/list, search and load protocol capability. */
export function handlePiHostCapabilityDomain(input: {
  state: PiHostCapabilityDomainState
  method: string
  params?: Record<string, unknown>
  id: string | number
}): PiHostMessage[] | undefined {
  if (!input.method.startsWith('capabilities/')) return undefined
  const sessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : undefined
  const gate = workspaceTextSearchAvailability({
    sessionId,
    enabled: input.state.workspaceTextSearchEnabled,
    workspaceRoot: typeof input.params?.cwd === 'string' ? input.params.cwd : undefined,
  })
  const visible = (capability: { id: string }) => gate.available || !isWorkspaceTextSearchCapability(capability.id)
  if (input.method === 'capabilities/list') {
    return [{ id: input.id, result: { items: input.state.capabilities.catalog(sessionId).filter(visible) } }]
  }
  if (input.method === 'capabilities/search') {
    const query = typeof input.params?.query === 'string' ? input.params.query : ''
    if (!query.trim()) return [errorResponse(input.id, 'query is required')]
    return [{ id: input.id, result: { items: input.state.capabilities.search(query, sessionId, visible) } }]
  }
  const capabilityId = typeof input.params?.id === 'string' ? input.params.id : ''
  if (!capabilityId) return [errorResponse(input.id, 'capability id is required')]
  if (isWorkspaceTextSearchCapability(capabilityId) && !gate.available) {
    return [errorResponse(input.id, gate.reason || 'Workspace text search is unavailable')]
  }
  try {
    return [{ id: input.id, result: { items: [input.state.capabilities.load(capabilityId, sessionId)], loaded: true } }]
  } catch (error) {
    return [errorResponse(input.id, error instanceof Error ? error.message : 'Unknown Pi capability')]
  }
}
