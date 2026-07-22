export const PI_HOST_PROTOCOL_VERSION = 1 as const
export const PI_HOST_CAPABILITIES = ['health', 'settings', 'sessions', 'turns'] as const

export type PiHostCapability = (typeof PI_HOST_CAPABILITIES)[number]

export type PiHostRequest = {
  id: string | number
  method: 'initialize' | 'health/get' | 'runtime/status' | 'tools/read' | 'tools/grep' | 'tools/find' | 'tools/ls' | 'state/snapshot' | 'settings/get' | 'settings/update' | 'settings/profile' | 'sessions/create' | 'sessions/list' | 'sessions/fork' | 'sessions/archive' | 'sessions/compact' | 'turn/submit'
  params: Record<string, unknown>
}

export type PiHostResponse = {
  id: string | number
  result?: {
    protocolVersion?: number
    capabilities?: PiHostCapability[]
    status?: 'ready'
    cursor?: number
    sessions?: unknown[]
    settings?: PiSettings
    profile?: PiSettings
    sessionId?: string
    runId?: string
    settlement?: 'success' | 'failed' | 'cancelled' | 'interrupted'
    items?: unknown[]
    tool?: string
    content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
    loaded?: boolean
    package?: string
    version?: string
    builtinTools?: string[]
  }
  error?: {
    code: 'invalid_request' | 'protocol_mismatch' | 'not_initialized' | 'unknown_method'
    message: string
  }
}

export type PiHostEvent =
  | {
      event: 'host/ready'
      payload: { protocolVersion: number; capabilities: PiHostCapability[] }
    }
  | {
      event: 'host/turn-item'
      payload: { runId: string; sessionId: string; item: unknown }
    }

export type PiHostMessage = PiHostResponse | PiHostEvent

import { compileEffectiveAgentProfile, validatePiSettingsPatch, DEFAULT_PI_SETTINGS, type PiSettings } from './piAgentProfile.ts'
import { executePiTool, piCoreRuntimeStatus, runPiTurn, type PiBuiltinToolName } from './piCoreRuntime.ts'

type HostState = {
  initialized: boolean
  snapshot: { cursor: number; sessions: SessionRecord[]; settings: PiSettings }
}

export type SessionRecord = { id: string; title: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; archived?: boolean }

const readyResult = (): PiHostResponse['result'] => ({
  protocolVersion: PI_HOST_PROTOCOL_VERSION,
  capabilities: [...PI_HOST_CAPABILITIES],
  status: 'ready',
})

const errorResponse = (
  id: string | number,
  code: NonNullable<PiHostResponse['error']>['code'],
  message: string,
): PiHostResponse => ({ id, error: { code, message } })

export function handlePiHostRequest(state: HostState, request: unknown): PiHostMessage[] | Promise<PiHostMessage[]> {
  if (!request || typeof request !== 'object') {
    return [errorResponse('', 'invalid_request', 'Pi Host request must be an object')]
  }

  const input = request as Partial<PiHostRequest>
  const id = typeof input.id === 'string' || typeof input.id === 'number' ? input.id : ''
  if (!input.method) return [errorResponse(id, 'invalid_request', 'Pi Host request method is required')]

  if (input.method === 'initialize') {
    const requestedVersion = (input.params as { protocolVersion?: unknown } | undefined)?.protocolVersion
    if (requestedVersion !== PI_HOST_PROTOCOL_VERSION) {
      return [
        errorResponse(
          id,
          'protocol_mismatch',
          `Unsupported Pi Host Protocol version: ${String(requestedVersion)}`,
        ),
      ]
    }
    state.initialized = true
    const result = readyResult()
    const protocolVersion = result?.protocolVersion ?? PI_HOST_PROTOCOL_VERSION
    const capabilities = result?.capabilities ?? [...PI_HOST_CAPABILITIES]
    return [
      { event: 'host/ready', payload: { protocolVersion, capabilities } },
      { id, result },
    ]
  }

  if (!state.initialized) return [errorResponse(id, 'not_initialized', 'Pi Host must be initialized first')]
  if (input.method === 'health/get') return [{ id, result: readyResult() }]
  if (input.method === 'runtime/status') return [{ id, result: piCoreRuntimeStatus() }]
  if (input.method === 'tools/read' || input.method === 'tools/grep' || input.method === 'tools/find' || input.method === 'tools/ls') {
    const params = input.params || {}
    if (typeof params.cwd !== 'string') return [errorResponse(id, 'invalid_request', 'cwd is required')]
    const toolName = input.method.slice('tools/'.length) as PiBuiltinToolName
    if ((toolName === 'read' && typeof params.path !== 'string') || (toolName === 'grep' && (typeof params.path !== 'string' || typeof params.pattern !== 'string')) || (toolName === 'find' && typeof params.pattern !== 'string')) {
      return [errorResponse(id, 'invalid_request', `${toolName} parameters are invalid`)]
    }
    const args = { ...params }
    delete args.cwd
    return executePiTool(toolName, params.cwd, args)
      .then((result) => [{ id, result: { tool: toolName, content: result.content } }])
      .catch((error) => [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : `Pi ${toolName} failed`)])
  }
  if (input.method === 'state/snapshot') {
    return [{ id, result: { cursor: state.snapshot.cursor, sessions: [...state.snapshot.sessions] } }]
  }
  if (input.method === 'sessions/list') return [{ id, result: { sessions: state.snapshot.sessions.map((session) => ({ ...session, messages: [...session.messages] })) } }]
  if (input.method === 'sessions/create') {
    const session: SessionRecord = {
      id: `pi-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: typeof input.params?.title === 'string' ? input.params.title : 'New Pi session',
      messages: [],
    }
    state.snapshot.sessions = [...state.snapshot.sessions, session]
    state.snapshot.cursor += 1
    return [{ id, result: { sessionId: session.id, sessions: [session] } }]
  }
  if (input.method === 'sessions/fork') {
    const sourceId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : ''
    const source = state.snapshot.sessions.find((candidate) => candidate.id === sourceId)
    if (!source) return [errorResponse(id, 'invalid_request', 'sessionId is required')]
    const fork: SessionRecord = { id: `pi-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: `${source.title} (fork)`, messages: source.messages.map((message) => ({ ...message })) }
    state.snapshot.sessions = [...state.snapshot.sessions, fork]; state.snapshot.cursor += 1
    return [{ id, result: { sessionId: fork.id, sessions: [fork] } }]
  }
  if (input.method === 'sessions/archive' || input.method === 'sessions/compact') {
    const sessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : ''
    const session = state.snapshot.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) return [errorResponse(id, 'invalid_request', 'sessionId is required')]
    if (input.method === 'sessions/archive') session.archived = true
    else if (session.messages.length > 4) session.messages = session.messages.slice(-4)
    state.snapshot.cursor += 1
    return [{ id, result: { sessionId, sessions: [session] } }]
  }
  if (input.method === 'turn/submit') {
    const sessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : ''
    const prompt = typeof input.params?.prompt === 'string' ? input.params.prompt : ''
    const session = state.snapshot.sessions.find((candidate) => candidate.id === sessionId)
    if (!session || !prompt.trim()) return [errorResponse(id, 'invalid_request', 'sessionId and prompt are required')]
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : `pi-run-${Date.now()}`
    const cwd = typeof input.params?.cwd === 'string' ? input.params.cwd : process.cwd()
    const turnEvents: PiHostEvent[] = []
    return runPiTurn(sessionId, cwd, prompt, (event) => {
      /* Events are collected below so the response remains ordered after them. */
      turnEvents.push({ event: 'host/turn-item', payload: { runId, sessionId, item: event } } as PiHostEvent)
    }).then((turn) => {
      state.snapshot.cursor += 1
      return [...turnEvents, { id, result: { sessionId, runId, settlement: turn.settlement, items: turn.items } }]
    })
  }
  if (input.method === 'settings/get') return [{ id, result: { settings: { ...state.snapshot.settings } } }]
  if (input.method === 'settings/update') {
    try {
      const patch = validatePiSettingsPatch(input.params || {})
      state.snapshot.settings = {
        ...state.snapshot.settings,
        ...patch,
        activeTools: patch.activeTools || state.snapshot.settings.activeTools,
      }
      state.snapshot.cursor += 1
      return [{ id, result: { settings: { ...state.snapshot.settings } } }]
    } catch (error) {
      return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Invalid settings')]
    }
  }
  if (input.method === 'settings/profile') {
    const params = input.params || {}
    return [{
      id,
      result: {
        profile: compileEffectiveAgentProfile(
          state.snapshot.settings as never,
          (params.role || {}) as never,
          (params.taskOverride || {}) as never,
        ),
      },
    }]
  }
  return [errorResponse(id, 'unknown_method', `Unknown Pi Host method: ${input.method}`)]
}

export function createPiHostServer(
  send: (message: PiHostMessage) => void,
  initialSnapshot: { cursor: number; sessions: SessionRecord[]; settings: PiSettings } = {
    cursor: 0,
    sessions: [],
    settings: { ...DEFAULT_PI_SETTINGS },
  },
  onStateChange?: (snapshot: { cursor: number; sessions: SessionRecord[]; settings: PiSettings }) => void,
) {
  const state: HostState = { initialized: false, snapshot: initialSnapshot }
  return {
    async handle(request: unknown) {
      const messages = await handlePiHostRequest(state, request)
      const method = (request as { method?: string } | null)?.method
      if (method?.startsWith('settings/') || method?.startsWith('sessions/') || method === 'turn/submit') onStateChange?.(state.snapshot)
      for (const message of messages) send(message)
    },
  }
}
