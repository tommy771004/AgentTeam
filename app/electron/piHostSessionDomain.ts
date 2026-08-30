import { createPiChildSession, type PiContextPacket } from './piDelegationExtension.ts'
import { disposePiSession, forkPiSession } from './piCoreRuntime.ts'
import { pageTurnRecord, workingStateFromTurnRecord } from '../src/agent/turnRecord.ts'
import type { PiHostMessage, SessionRecord } from './piHostProtocol.ts'

type SessionDomainState = {
  sessions: SessionRecord[]
  isActive: (sessionId: string) => boolean
  nextToolContractRevision: (sessionId: string) => number
  clearToolContracts: (sessionId: string) => void
  clearCapabilities: (sessionId: string) => void
  commit: (sessions: SessionRecord[]) => void
}

function errorResponse(id: string | number, message: string): PiHostMessage {
  return { id, error: { code: 'invalid_request', message } }
}

function projectSessionSummary(session: SessionRecord) {
  const { record, toolContracts: _toolContracts, toolContractRevisionFloor: _toolContractRevisionFloor, ...summary } = session
  const workingState = workingStateFromTurnRecord(record)
  return {
    ...summary,
    messages: [...session.messages],
    ...(session.toolAudit ? { toolAudit: [...session.toolAudit] } : {}),
    ...(record ? { recordSummary: { version: record.version, entries: record.entries.length, latestSeq: record.entries.at(-1)?.seq ?? 0 } } : {}),
    ...(workingState ? { workingState } : {}),
  }
}

/** Owns the complete `sessions/*` protocol capability and its mutations. */
export function handlePiHostSessionDomain(input: {
  method: string
  params?: Record<string, unknown>
  id: string | number
  state: SessionDomainState
  compact: (session: SessionRecord) => PiHostMessage[] | Promise<PiHostMessage[]>
}): PiHostMessage[] | Promise<PiHostMessage[]> | undefined {
  if (!input.method.startsWith('sessions/')) return undefined
  const { sessions } = input.state
  if (input.method === 'sessions/list') return [{ id: input.id, result: { sessions: sessions.map(projectSessionSummary) } }]
  if (input.method === 'sessions/record') {
    const sessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : ''
    const session = sessions.find((candidate) => candidate.id === sessionId)
    if (!session) return [errorResponse(input.id, 'Unknown Pi session')]
    const before = typeof input.params?.before === 'number' ? input.params.before : undefined
    const limit = typeof input.params?.limit === 'number' ? input.params.limit : undefined
    return [{ id: input.id, result: { sessionId, page: pageTurnRecord(session.record, { before, limit }) } }]
  }
  if (input.method === 'sessions/create') return createSession(input, sessions)
  if (input.method === 'sessions/fork') return forkSession(input, sessions)

  const sessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : ''
  const session = sessions.find((candidate) => candidate.id === sessionId)
  if (!session) return [errorResponse(input.id, 'sessionId is required')]
  if (input.method === 'sessions/reset') {
    if (input.state.isActive(sessionId)) return [errorResponse(input.id, 'Cannot reset an active Pi session')]
    return disposePiSession(sessionId).then(() => {
      session.messages = []
      session.profile = undefined
      session.context = undefined
      session.piSessionFile = undefined
      session.toolAudit = []
      session.toolContractRevisionFloor = input.state.nextToolContractRevision(sessionId)
      session.toolContracts = []
      input.state.clearToolContracts(sessionId)
      input.state.clearCapabilities(sessionId)
      session.archived = false
      input.state.commit(sessions)
      return [{ id: input.id, result: { sessionId, sessions: [session] } }]
    })
  }
  if (input.method === 'sessions/archive') {
    return disposePiSession(sessionId).then(() => {
      session.archived = true
      input.state.commit(sessions)
      return [{ id: input.id, result: { sessionId, sessions: [session] } }]
    })
  }
  if (input.method === 'sessions/compact') return input.compact(session)
  return [errorResponse(input.id, `Unknown session method: ${input.method}`)]
}

function createSession(input: Parameters<typeof handlePiHostSessionDomain>[0], sessions: SessionRecord[]): PiHostMessage[] {
  const params = input.params || {}
  const parentSessionId = typeof params.parentSessionId === 'string' ? params.parentSessionId : undefined
  let sessionId = `pi-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let childMetadata: Pick<SessionRecord, 'parentSessionId' | 'role' | 'profile' | 'context' | 'depth'> = {}
  if (parentSessionId) {
    if (!sessions.some((candidate) => candidate.id === parentSessionId)) return [errorResponse(input.id, 'parentSessionId is unknown')]
    if (typeof params.role !== 'string' || !params.profile || typeof params.profile !== 'object'
      || !params.context || typeof params.context !== 'object' || typeof params.depth !== 'number') {
      return [errorResponse(input.id, 'Child Pi session requires role, profile, context, and depth')]
    }
    try {
      const child = createPiChildSession({ role: params.role, profile: params.profile as Record<string, unknown>, context: params.context as PiContextPacket, depth: params.depth })
      sessionId = child.id
      childMetadata = { parentSessionId, role: child.role, profile: child.profile, context: child.context, depth: child.depth }
    } catch (error) {
      return [errorResponse(input.id, error instanceof Error ? error.message : 'Invalid child Pi session')]
    }
  }
  const session: SessionRecord = {
    id: sessionId,
    title: typeof params.title === 'string' ? params.title : 'New Pi session',
    threadId: typeof params.threadId === 'string' ? params.threadId : undefined,
    ...childMetadata,
    messages: [],
  }
  input.state.commit([...sessions, session])
  return [{ id: input.id, result: { sessionId: session.id, sessions: [session] } }]
}

function forkSession(input: Parameters<typeof handlePiHostSessionDomain>[0], sessions: SessionRecord[]): PiHostMessage[] {
  const sourceId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : ''
  const source = sessions.find((candidate) => candidate.id === sourceId)
  if (!source) return [errorResponse(input.id, 'sessionId is required')]
  const fork: SessionRecord = {
    id: `pi-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: `${source.title} (fork)`,
    parentSessionId: source.id,
    role: source.role,
    profile: source.profile ? { ...source.profile } : undefined,
    context: source.context ? { objective: source.context.objective, facts: [...source.context.facts], constraints: [...source.context.constraints] } : undefined,
    depth: source.depth,
    messages: source.messages.map((message) => ({ ...message })),
    piSessionFile: forkPiSession(sourceId),
  }
  input.state.commit([...sessions, fork])
  return [{ id: input.id, result: { sessionId: fork.id, sessions: [fork] } }]
}
