import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'

export const PI_HOST_PROTOCOL_VERSION = 1 as const
export const PI_HOST_CAPABILITIES = ['health', 'settings', 'sessions', 'turns', 'runtime', 'tools', 'events', 'automation', 'resources', 'memory', 'capabilities'] as const

export type PiHostCapability = (typeof PI_HOST_CAPABILITIES)[number]

/** Non-secret provenance exposed to the renderer so users can verify bootstrap behavior. */
export type PiHostConfigStatus = {
  settingsSource: 'native' | 'managed' | 'default'
  settingsLoaded: boolean
  oauthSources: Array<'codex-cli' | 'claude-cli'>
  oauthImportedProviders: string[]
  oauthSkippedProviders: string[]
  oauthConflicts: string[]
}

export type PiHostRequest = {
  id: string | number
  method: 'initialize' | 'health/get' | 'runtime/status' | 'tools/list' | 'tools/read' | 'tools/grep' | 'tools/find' | 'tools/ls' | 'tools/write' | 'tools/edit' | 'tools/bash' | 'tools/code' | 'tools/mcp' | 'state/snapshot' | 'settings/get' | 'settings/update' | 'settings/profile' | 'resources/list' | 'resources/reload' | 'memory/list' | 'memory/add' | 'memory/recall' | 'capabilities/list' | 'capabilities/load' | 'capabilities/search' | 'extensions/list' | 'extensions/install' | 'extensions/update' | 'extensions/reload' | 'extensions/set-enabled' | 'extensions/uninstall' | 'sessions/create' | 'sessions/list' | 'sessions/fork' | 'sessions/archive' | 'sessions/compact' | 'runs/enqueue' | 'runs/claim' | 'runs/settle' | 'runs/list' | 'runs/cancel' | 'turn/submit' | 'turn/cancel'
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
    config?: PiHostConfigStatus
    profile?: PiSettings
    sessionId?: string
    runId?: string
    settlement?: 'success' | 'failed' | 'cancelled' | 'interrupted'
    items?: unknown[]
    queue?: PiQueuedRun[]
    run?: PiQueuedRun
    resources?: PiResource[]
    memories?: PiMemory[]
    tool?: string
    code?: string
    content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
    loaded?: boolean
    package?: string
    version?: string
    builtinTools?: string[]
    orchestration?: { pattern: PiLoopPattern; iterations: number; maxIterations: number; definitionOfDone?: string; dodMet?: boolean }
    queued?: 'steer' | 'queue'
    extension?: PiExtension
    extensions?: PiExtension[]
    removed?: boolean
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
      payload: { runId: string; sessionId: string; item: unknown; iteration?: number }
    }
  | {
      event: 'host/tool-update'
      payload: { runId: string; tool: string; item: unknown; callId?: string }
    }
  | {
      event: 'host/tool-start' | 'host/tool-decision' | 'host/tool-result'
      payload: { runId: string; tool: string; callId?: string; parentRunId?: string; decision?: 'allow' | 'ask' | 'deny'; settlement?: 'success' | 'failed' | 'cancelled' | 'denied'; reason?: string; item?: unknown }
    }
  | {
      event: 'host/orchestration'
      payload: { runId: string; sessionId: string; phase: 'parse' | 'iterate' | 'dod' | 'replan' | 'settlement' | 'cancelled'; iteration?: number; pattern?: PiLoopPattern; detail?: string }
    }
  | {
      event: 'host/extension'
      payload: { action: 'installed' | 'updated' | 'enabled' | 'disabled' | 'uninstalled'; extension: PiExtension }
    }

export type PiHostMessage = PiHostResponse | PiHostEvent

import { compileEffectiveAgentProfile, validatePiSettingsPatch, DEFAULT_PI_SETTINGS, type PiSettings } from './piAgentProfile.ts'
import { cancelPiTool, cancelPiTurn, compactPiSession, disposePiSession, executePiTool, forkPiSession, getPiSessionFile, piCoreRuntimeStatus, runPiTurn, steerPiTurn, type PiBuiltinToolName } from './piCoreRuntime.ts'
import { cancelPiCodeMode, runPiCodeMode } from './piCodeMode.ts'
import { PiRunQueue, type PiQueuedRun } from './piRunQueue.ts'
import { PiResourceRegistry, type PiResource } from './piResourceRegistry.ts'
import { createPiChildSession, type PiContextPacket } from './piDelegationExtension.ts'
import { isPiMemory, PiMemoryExtension, type PiMemory } from './piMemoryExtension.ts'
import { DEFAULT_PI_CAPABILITIES, PiCapabilityCatalog } from './piCapabilityExtension.ts'
import { runPiOrchestration, type PiLoopPattern } from './piOrchestrationExtension.ts'
import { decideBashAction } from '../src/agent/tools/shellCommandParser.ts'
import { PiExtensionRegistry, type PiExtension } from './piExtensionRegistry.ts'
import { callPiMcpTool, listPiMcpTools, stopPiMcp } from './piMcpClient.ts'

type HostState = {
  initialized: boolean
  snapshot: { cursor: number; sessions: SessionRecord[]; settings: PiSettings; settingsOrigin?: 'native' | 'managed'; config?: PiHostConfigStatus; queue: PiQueuedRun[]; resources: PiResource[]; memories: PiMemory[]; extensions: PiExtension[] }
  capabilities: PiCapabilityCatalog
  extensions: PiExtensionRegistry
}

export type PiToolAuditRecord = {
  runId: string
  callId: string
  tool: string
  phase: 'start' | 'decision' | 'result'
  decision?: 'allow' | 'ask' | 'deny'
  settlement?: 'success' | 'failed' | 'cancelled' | 'denied'
  reason?: string
  path?: string
  at: number
}

export type SessionRecord = { id: string; title: string; threadId?: string; parentSessionId?: string; role?: string; profile?: Record<string, unknown>; context?: PiContextPacket; depth?: number; messages: Array<{ role: 'user' | 'assistant'; content: string }>; toolAudit?: PiToolAuditRecord[]; archived?: boolean; piSessionFile?: string }

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

/** A session is the serialization boundary for Pi turns. */
const activeSessionRuns = new Map<string, { runId: string; cancelled: boolean }>()
const PI_HOST_TOOL_UPDATE_MAX_BYTES = 16_384

function isWithinProject(cwd: string, target: string): boolean {
  const projectRoot = resolveExistingPath(resolve(cwd))
  const resolvedTarget = resolve(cwd, target)
  const targetPath = resolveExistingPath(resolvedTarget)
  const rel = relative(projectRoot, targetPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Resolve symlinks for existing ancestors while retaining a safe lexical tail for new files. */
function resolveExistingPath(path: string): string {
  let cursor = path
  const tail: string[] = []
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) break
    tail.unshift(cursor.slice(parent.length + 1))
    cursor = parent
  }
  let resolved = cursor
  try {
    resolved = realpathSync.native(cursor)
  } catch {
    resolved = resolve(cursor)
  }
  return tail.reduce((current, part) => resolve(current, part), resolved)
}

function recordToolAudit(state: HostState, sessionId: unknown, event: PiHostEvent): void {
  if (typeof sessionId !== 'string') return
  const session = state.snapshot.sessions.find((candidate) => candidate.id === sessionId)
  if (!session || (event.event !== 'host/tool-start' && event.event !== 'host/tool-decision' && event.event !== 'host/tool-result')) return
  const payload = event.payload
  const record: PiToolAuditRecord = {
    runId: payload.runId,
    callId: payload.callId || payload.runId,
    tool: payload.tool,
    phase: event.event === 'host/tool-start' ? 'start' : event.event === 'host/tool-decision' ? 'decision' : 'result',
    ...(payload.decision ? { decision: payload.decision } : {}),
    ...(payload.settlement ? { settlement: payload.settlement } : {}),
    ...(payload.reason ? { reason: payload.reason.slice(0, 500) } : {}),
    ...(typeof (payload.item as { path?: unknown } | undefined)?.path === 'string' ? { path: (payload.item as { path: string }).path } : {}),
    at: Date.now(),
  }
  session.toolAudit = [...(session.toolAudit || []), record].slice(-200)
}

function approvalOutcome(params: Record<string, unknown>, requiresApproval: boolean): { decision: 'allow' | 'ask' | 'deny'; reason?: string; settlement?: 'denied' | 'cancelled' } {
  const approval = params.approval
  if (requiresApproval && params.unattended === true) return { decision: 'deny', reason: 'Unattended approval denied after timeout', settlement: 'denied' }
  if (approval === 'deny') return { decision: 'deny', reason: 'Approval denied by user', settlement: 'denied' }
  if (approval === 'timeout') return { decision: 'deny', reason: 'Approval timed out', settlement: 'denied' }
  if (approval === 'cancel' || approval === 'cancelled') return { decision: 'deny', reason: 'Approval cancelled', settlement: 'cancelled' }
  if (requiresApproval && approval !== 'allow') {
    return { decision: 'ask', reason: 'Tool requires approval before execution' }
  }
  return { decision: 'allow', reason: 'Pi approval policy' }
}

export function handlePiHostRequest(state: HostState, request: unknown, emit?: (message: PiHostMessage) => void): PiHostMessage[] | Promise<PiHostMessage[]> {
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
  if (input.method === 'tools/list') {
    const extensionTools = state.extensions.list().filter((extension) => extension.enabled).flatMap((extension) => extension.tools.map((tool) => `mcp_${extension.id}_${tool}`))
    const mcpExtensions = state.extensions.list().filter((extension) => extension.enabled && extension.kind === 'mcp' && extension.mcp)
    return Promise.all(mcpExtensions.map(async (extension) => {
      try {
        const tools = await listPiMcpTools(extension.id, extension.mcp!)
        return tools.map((tool) => `mcp_${extension.id}_${tool.name}`)
      } catch {
        return []
      }
    })).then((discovered) => [{ id, result: { builtinTools: [...piCoreRuntimeStatus().builtinTools, ...extensionTools, ...discovered.flat()].sort() } }])
  }
  if (input.method === 'tools/mcp') {
    const extensionId = typeof input.params?.extensionId === 'string' ? input.params.extensionId : ''
    const toolName = typeof input.params?.toolName === 'string' ? input.params.toolName : ''
    const args = input.params?.arguments
    const extension = state.extensions.list().find((candidate) => candidate.id === extensionId && candidate.kind === 'mcp' && candidate.enabled)
    if (!extension?.mcp || !toolName || !args || typeof args !== 'object' || Array.isArray(args)) return [errorResponse(id, 'invalid_request', 'enabled MCP extensionId, toolName, and arguments are required')]
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : String(id)
    const callId = typeof input.params?.callId === 'string' ? input.params.callId : runId
    const updates: PiHostEvent[] = []
    const publish = (event: PiHostEvent) => {
      recordToolAudit(state, input.params?.sessionId, event)
      if (emit) emit(event); else updates.push(event)
    }
    const tool = `mcp_${extension.id}_${toolName}`
    publish({ event: 'host/tool-start', payload: { runId, tool, callId } })
    const approvalNeeded = state.snapshot.settings.approvalMode !== 'full' || state.snapshot.settings.unattended
    const approval = approvalOutcome({ ...(input.params || {}), unattended: state.snapshot.settings.unattended }, approvalNeeded)
    if (approval.decision !== 'allow') {
      publish({ event: 'host/tool-decision', payload: { runId, tool, callId, decision: approval.decision, settlement: approval.settlement, reason: approval.reason } })
      if (approval.settlement) publish({ event: 'host/tool-result', payload: { runId, tool, callId, settlement: approval.settlement, reason: approval.reason } })
      return [...updates, errorResponse(id, 'invalid_request', approval.reason || 'MCP tool requires approval before execution')]
    }
    publish({ event: 'host/tool-decision', payload: { runId, tool, callId, decision: 'allow', reason: 'Pi MCP extension policy' } })
    return callPiMcpTool(extension.id, extension.mcp, toolName, args as Record<string, unknown>).then((content) => {
      publish({ event: 'host/tool-result', payload: { runId, tool, callId, settlement: 'success', item: { content } } })
      return [...updates, { id, result: { tool, content: [{ type: 'text', text: content }] } }]
    }).catch((error) => {
      const reason = error instanceof Error ? error.message : 'MCP tool failed'
      publish({ event: 'host/tool-result', payload: { runId, tool, callId, settlement: 'failed', reason } })
      return [...updates, errorResponse(id, 'invalid_request', reason)]
    })
  }
  if (input.method === 'tools/code') {
    const params = input.params || {}
    if (typeof params.cwd !== 'string' || typeof params.code !== 'string') return [errorResponse(id, 'invalid_request', 'cwd and code are required')]
    const runId = typeof params.runId === 'string' ? params.runId : String(id)
    const callId = typeof params.callId === 'string' ? params.callId : runId
    const requiresApproval = state.snapshot.settings.approvalMode !== 'full' || state.snapshot.settings.unattended
    if (requiresApproval && params.approval !== 'allow') return [errorResponse(id, 'invalid_request', 'code requires approval before execution')]
    const activeTools = state.snapshot.settings.activeTools.length ? [...state.snapshot.settings.activeTools] : piCoreRuntimeStatus().builtinTools
    let nestedSequence = 0
    return runPiCodeMode({
      runId,
      code: params.code,
      activeTools,
      maxToolCalls: typeof params.maxToolCalls === 'number' ? params.maxToolCalls : undefined,
      timeoutMs: typeof params.timeoutMs === 'number' ? params.timeoutMs : undefined,
      callTool: async (toolName, args) => {
        if (!piCoreRuntimeStatus().builtinTools.includes(toolName)) throw new Error(`Unknown Pi tool: ${toolName}`)
        const nestedId = `${String(id)}:code:${nestedSequence++}`
        const nested = await handlePiHostRequest(state, {
          id: nestedId,
          method: `tools/${toolName}` as PiHostRequest['method'],
          params: { ...args, cwd: params.cwd, runId, callId: nestedId, parentRunId: runId, approval: 'allow' },
        }, emit)
        const response = nested.find((message) => !('event' in message) && message.id === nestedId) as PiHostResponse | undefined
        if (!response || response.error) throw new Error(response?.error?.message || `Pi nested tool failed: ${toolName}`)
        return JSON.stringify(response.result?.content ?? response.result ?? null)
      },
    }).then((result) => [{ id, result: { tool: 'code', runId, settlement: result.settlement, content: [{ type: 'text', text: result.content }], code: result.content, items: [{ toolCallCount: result.toolCallCount, logs: result.logs }] } }])
  }
  if (input.method === 'tools/read' || input.method === 'tools/grep' || input.method === 'tools/find' || input.method === 'tools/ls' || input.method === 'tools/write' || input.method === 'tools/edit' || input.method === 'tools/bash') {
    const params = input.params || {}
    if (typeof params.cwd !== 'string') return [errorResponse(id, 'invalid_request', 'cwd is required')]
    const toolName = input.method.slice('tools/'.length) as PiBuiltinToolName
    if (state.snapshot.settings.activeTools.length > 0 && !state.snapshot.settings.activeTools.includes(toolName)) return [errorResponse(id, 'invalid_request', `${toolName} is disabled by Pi active tools settings`)]
    const runId = typeof params.runId === 'string' ? params.runId : String(id)
    const callId = typeof params.callId === 'string' ? params.callId : runId
    const updates: PiHostEvent[] = []
    const publish = (event: PiHostEvent) => {
      recordToolAudit(state, params.sessionId, event)
      if (emit) emit(event)
      else updates.push(event)
    }
    const scopedPath = typeof params.path === 'string' ? params.path : undefined
    publish({ event: 'host/tool-start', payload: { runId, tool: toolName, callId, parentRunId: typeof params.parentRunId === 'string' ? params.parentRunId : undefined, item: scopedPath ? { path: scopedPath } : undefined } })
    const sideEffect = toolName === 'write' || toolName === 'edit' || toolName === 'bash'
    const bashDecision = toolName === 'bash'
      ? decideBashAction(String(params.command || ''), () => 'allow', state.snapshot.settings.bashRequireAsk ? 'ask' : 'allow')
      : undefined
    if (bashDecision?.action === 'deny') {
      publish({ event: 'host/tool-decision', payload: { runId, tool: toolName, callId, decision: 'deny', settlement: 'denied', reason: bashDecision.reason } })
      publish({ event: 'host/tool-result', payload: { runId, tool: toolName, callId, settlement: 'denied', reason: bashDecision.reason } })
      return [...updates, errorResponse(id, 'invalid_request', `bash denied: ${bashDecision.reason}`)]
    }
    const requiresApproval = sideEffect && (state.snapshot.settings.approvalMode !== 'full' || state.snapshot.settings.unattended || bashDecision?.action === 'ask')
    const approval = approvalOutcome({ ...params, unattended: state.snapshot.settings.unattended }, requiresApproval)
    if (approval.decision !== 'allow') {
      const policyReason = bashDecision?.action === 'ask' ? bashDecision.reason : approval.reason
      const reason = approval.decision === 'ask' ? `Approval required: ${policyReason || `${toolName} requires approval before execution`}` : policyReason
      publish({ event: 'host/tool-decision', payload: { runId, tool: toolName, callId, decision: approval.decision, settlement: approval.settlement, reason } })
      if (approval.settlement) publish({ event: 'host/tool-result', payload: { runId, tool: toolName, callId, settlement: approval.settlement, reason } })
      return [...updates, errorResponse(id, 'invalid_request', reason || `${toolName} requires approval before execution`)]
    }
    if (sideEffect) publish({ event: 'host/tool-decision', payload: { runId, tool: toolName, callId, decision: 'allow', reason: bashDecision?.reason || 'Pi approval policy' } })
    if ((toolName === 'read' && typeof params.path !== 'string') || (toolName === 'grep' && (typeof params.path !== 'string' || typeof params.pattern !== 'string')) || (toolName === 'find' && typeof params.pattern !== 'string') || (toolName === 'write' && (typeof params.path !== 'string' || typeof params.content !== 'string')) || (toolName === 'edit' && (typeof params.path !== 'string' || !Array.isArray(params.edits))) || (toolName === 'bash' && typeof params.command !== 'string')) {
      const reason = `${toolName} parameters are invalid`
      publish({ event: 'host/tool-result', payload: { runId, tool: toolName, callId, settlement: 'failed', reason } })
      return [...updates, errorResponse(id, 'invalid_request', reason)]
    }
    if (scopedPath && !isWithinProject(params.cwd, scopedPath)) {
      const reason = `${toolName} path is outside the requested project scope`
      publish({ event: 'host/tool-result', payload: { runId, tool: toolName, callId, settlement: 'failed', reason } })
      return [...updates, errorResponse(id, 'invalid_request', reason)]
    }
    const args = { ...params }
    delete args.cwd
    delete args.approval
    delete args.runId
    delete args.callId
    delete args.parentRunId
    delete args.sessionId
    let updateBytes = 0
    let updateTruncated = false
    return executePiTool(toolName, params.cwd, args, {
      runId: typeof params.runId === 'string' ? params.runId : undefined,
      onUpdate: (item) => {
        if (typeof params.runId === 'string') {
          if (updateTruncated) return
          const serialized = JSON.stringify(item)
          const remaining = PI_HOST_TOOL_UPDATE_MAX_BYTES - updateBytes
          if (serialized.length <= remaining) {
            updateBytes += serialized.length
          publish({ event: 'host/tool-update', payload: { runId: params.runId, tool: toolName, callId, item } })
          } else {
            updateTruncated = true
            publish({ event: 'host/tool-update', payload: { runId: params.runId, tool: toolName, callId, item: { type: 'truncated', content: serialized.slice(0, Math.max(0, remaining)), originalBytes: serialized.length } } })
          }
        }
      },
    })
      .then((result) => {
        const settlement = result.cancelled ? 'cancelled' as const : 'success' as const
        publish({ event: 'host/tool-result', payload: { runId, tool: toolName, callId, settlement, item: result } })
        return result.cancelled
          ? [...updates, { id, result: { runId, settlement: 'cancelled' as const, tool: toolName, content: result.content } }]
          : [...updates, { id, result: { tool: toolName, content: result.content } }]
      })
      .catch((error) => {
        const reason = error instanceof Error ? error.message : `Pi ${toolName} failed`
        publish({ event: 'host/tool-result', payload: { runId, tool: toolName, callId, settlement: 'failed', reason } })
        return [...updates, errorResponse(id, 'invalid_request', reason)]
      })
  }
  if (input.method === 'state/snapshot') {
    return [{ id, result: { cursor: state.snapshot.cursor, sessions: [...state.snapshot.sessions], queue: state.snapshot.queue.map((item) => ({ ...item, profile: { ...item.profile } })), resources: state.snapshot.resources.map((resource) => ({ ...resource })), memories: new PiMemoryExtension(state.snapshot.memories).export() } }]
  }
  if (input.method === 'sessions/list') return [{ id, result: { sessions: state.snapshot.sessions.map((session) => ({ ...session, messages: [...session.messages] })) } }]
  if (input.method === 'resources/list') return [{ id, result: { resources: state.snapshot.resources.map((resource) => ({ ...resource })) } }]
  if (input.method === 'resources/reload') {
    const resources = input.params?.resources
    if (!Array.isArray(resources)) return [errorResponse(id, 'invalid_request', 'resources must be an array')]
    const registry = new PiResourceRegistry()
    try {
      registry.reload(resources as PiResource[])
    } catch (error) {
      return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Invalid Pi resources')]
    }
    state.snapshot.resources = registry.list(); state.snapshot.cursor += 1
    return [{ id, result: { resources: state.snapshot.resources.map((resource) => ({ ...resource })) } }]
  }
  if (input.method === 'memory/list') {
    const memory = new PiMemoryExtension(state.snapshot.memories)
    return [{ id, result: { memories: memory.export() } }]
  }
  if (input.method === 'memory/add') {
    const candidate = input.params?.memory
    if (!isPiMemory(candidate)) return [errorResponse(id, 'invalid_request', 'memory must include id, text, tags, and createdAt')]
    const memory = new PiMemoryExtension(state.snapshot.memories)
    memory.add(candidate)
    state.snapshot.memories = memory.export()
    state.snapshot.cursor += 1
    return [{ id, result: { memories: state.snapshot.memories } }]
  }
  if (input.method === 'memory/recall') {
    const query = typeof input.params?.query === 'string' ? input.params.query : ''
    if (!query.trim()) return [errorResponse(id, 'invalid_request', 'query is required')]
    const project = typeof input.params?.project === 'string' ? input.params.project : undefined
    const limit = typeof input.params?.limit === 'number' ? input.params.limit : 5
    const memory = new PiMemoryExtension(state.snapshot.memories)
    return [{ id, result: { memories: memory.recall(query, project, limit) } }]
  }
  if (input.method === 'capabilities/list') return [{ id, result: { items: state.capabilities.catalog() } }]
  if (input.method === 'capabilities/load') {
    const capabilityId = typeof input.params?.id === 'string' ? input.params.id : ''
    if (!capabilityId) return [errorResponse(id, 'invalid_request', 'capability id is required')]
    try {
      return [{ id, result: { items: [state.capabilities.load(capabilityId)], loaded: true } }]
    } catch (error) {
      return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Unknown Pi capability')]
    }
  }
  if (input.method === 'capabilities/search') {
    const query = typeof input.params?.query === 'string' ? input.params.query : ''
    if (!query.trim()) return [errorResponse(id, 'invalid_request', 'query is required')]
    return [{ id, result: { items: state.capabilities.search(query) } }]
  }
  if (input.method === 'extensions/list') return [{ id, result: { extensions: state.extensions.list() } }]
  if (input.method === 'extensions/install' || input.method === 'extensions/update' || input.method === 'extensions/reload') {
    try {
      const extension = input.method === 'extensions/install'
        ? state.extensions.install(input.params || {})
        : state.extensions.update(input.params || {})
      const action = input.method === 'extensions/install' ? 'installed' as const : 'updated' as const
      const event: PiHostEvent = { event: 'host/extension', payload: { action, extension } }
      if (emit) emit(event)
      state.snapshot.extensions = state.extensions.list()
      state.snapshot.cursor += 1
      return [...(emit ? [] : [event]), { id, result: { extension } }]
    } catch (error) {
      return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Invalid Pi extension')]
    }
  }
  if (input.method === 'extensions/set-enabled') {
    const extensionId = typeof input.params?.id === 'string' ? input.params.id : ''
    if (!extensionId || typeof input.params?.enabled !== 'boolean') return [errorResponse(id, 'invalid_request', 'id and enabled are required')]
    try {
      const extension = state.extensions.setEnabled(extensionId, input.params.enabled)
      const event: PiHostEvent = { event: 'host/extension', payload: { action: extension.enabled ? 'enabled' : 'disabled', extension } }
      if (emit) emit(event)
      state.snapshot.extensions = state.extensions.list(); state.snapshot.cursor += 1
      return [...(emit ? [] : [event]), { id, result: { extension } }]
    } catch (error) {
      return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Unknown Pi extension')]
    }
  }
  if (input.method === 'extensions/uninstall') {
    const extensionId = typeof input.params?.id === 'string' ? input.params.id : ''
    if (!extensionId) return [errorResponse(id, 'invalid_request', 'id is required')]
    const extension = state.extensions.list().find((candidate) => candidate.id === extensionId)
    if (!extension) return [errorResponse(id, 'invalid_request', `Unknown Pi extension: ${extensionId}`)]
    try {
      state.extensions.uninstall(extensionId)
      if (extension.kind === 'mcp') stopPiMcp(extensionId)
      const event: PiHostEvent = { event: 'host/extension', payload: { action: 'uninstalled', extension } }
      if (emit) emit(event)
      state.snapshot.extensions = state.extensions.list(); state.snapshot.cursor += 1
      return [...(emit ? [] : [event]), { id, result: { removed: true } }]
    } catch (error) {
      return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Unable to uninstall Pi extension')]
    }
  }
    if (input.method === 'runs/list') return [{ id, result: { queue: state.snapshot.queue.map((item) => ({ ...item, profile: { ...item.profile } })) } }]
  if (input.method === 'runs/claim') {
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : undefined
    const queue = new PiRunQueue(24, state.snapshot.queue)
    const run = queue.claim(runId)
    if (!run) return [errorResponse(id, 'invalid_request', runId ? 'Unknown queued Pi run' : 'No queued Pi run available')]
    state.snapshot.queue = queue.snapshot(); state.snapshot.cursor += 1
    return [{ id, result: { run, queue: state.snapshot.queue } }]
  }
  if (input.method === 'runs/settle') {
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : ''
    const settlement = input.params?.settlement
    if (!runId || !['success', 'failed', 'cancelled', 'interrupted'].includes(String(settlement))) return [errorResponse(id, 'invalid_request', 'runId and settlement are required')]
    const queue = new PiRunQueue(24, state.snapshot.queue)
    const run = queue.settle(runId)
    if (!run) return [errorResponse(id, 'invalid_request', 'Unknown active Pi run')]
    state.snapshot.queue = queue.snapshot(); state.snapshot.cursor += 1
    return [{ id, result: { run, queue: state.snapshot.queue, settlement: settlement as 'success' | 'failed' | 'cancelled' | 'interrupted' } }]
  }
  if (input.method === 'runs/enqueue') {
    const params = input.params || {}
    if (typeof params.runId !== 'string' || typeof params.sessionId !== 'string' || typeof params.prompt !== 'string' || !['interactive', 'time', 'proactive'].includes(String(params.trigger)) || !params.profile || typeof params.profile !== 'object') {
      return [errorResponse(id, 'invalid_request', 'runId, sessionId, prompt, trigger, and profile are required')]
    }
    const queue = new PiRunQueue(24, state.snapshot.queue)
    const outcome = queue.enqueue({
      runId: params.runId,
      sessionId: params.sessionId,
      prompt: params.prompt,
      trigger: params.trigger as PiQueuedRun['trigger'],
      evidence: typeof params.evidence === 'string' ? params.evidence : undefined,
      profile: { ...(params.profile as Record<string, unknown>) },
      status: 'queued',
    })
    if (!outcome.ok) return [errorResponse(id, 'invalid_request', `Pi run queue ${outcome.code}`)]
    state.snapshot.queue = queue.snapshot(); state.snapshot.cursor += 1
    return [{ id, result: { queue: state.snapshot.queue } }]
  }
  if (input.method === 'runs/cancel') {
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : ''
    if (!runId) return [errorResponse(id, 'invalid_request', 'runId is required')]
    const queue = new PiRunQueue(24, state.snapshot.queue)
    if (!queue.snapshot().some((item) => item.runId === runId)) return [errorResponse(id, 'invalid_request', 'Unknown queued Pi run')]
    queue.markInterrupted(runId); state.snapshot.queue = queue.snapshot(); state.snapshot.cursor += 1
    return [{ id, result: { queue: state.snapshot.queue } }]
  }
  if (input.method === 'sessions/create') {
    const params = input.params || {}
    const parentSessionId = typeof params.parentSessionId === 'string' ? params.parentSessionId : undefined
    let sessionId = `pi-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let childMetadata: Pick<SessionRecord, 'parentSessionId' | 'role' | 'profile' | 'context' | 'depth'> = {}
    if (parentSessionId) {
      if (!state.snapshot.sessions.some((candidate) => candidate.id === parentSessionId)) return [errorResponse(id, 'invalid_request', 'parentSessionId is unknown')]
      if (typeof params.role !== 'string' || !params.profile || typeof params.profile !== 'object' || !params.context || typeof params.context !== 'object' || typeof params.depth !== 'number') {
        return [errorResponse(id, 'invalid_request', 'Child Pi session requires role, profile, context, and depth')]
      }
      try {
        const child = createPiChildSession({
          role: params.role,
          profile: params.profile as Record<string, unknown>,
          context: params.context as PiContextPacket,
          depth: params.depth,
        })
        sessionId = child.id
        childMetadata = { parentSessionId, role: child.role, profile: child.profile, context: child.context, depth: child.depth }
      } catch (error) {
        return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Invalid child Pi session')]
      }
    }
    const session: SessionRecord = {
      id: sessionId,
      title: typeof params.title === 'string' ? params.title : 'New Pi session',
      threadId: typeof params.threadId === 'string' ? params.threadId : undefined,
      ...childMetadata,
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
    const fork: SessionRecord = { id: `pi-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: `${source.title} (fork)`, messages: source.messages.map((message) => ({ ...message })), piSessionFile: forkPiSession(sourceId) }
    state.snapshot.sessions = [...state.snapshot.sessions, fork]; state.snapshot.cursor += 1
    return [{ id, result: { sessionId: fork.id, sessions: [fork] } }]
  }
  if (input.method === 'sessions/archive' || input.method === 'sessions/compact') {
    const sessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : ''
    const session = state.snapshot.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) return [errorResponse(id, 'invalid_request', 'sessionId is required')]
    if (input.method === 'sessions/archive') {
      return disposePiSession(sessionId).then(() => {
        session.archived = true
        state.snapshot.cursor += 1
        return [{ id, result: { sessionId, sessions: [session] } }]
      })
    }
    return Promise.resolve(compactPiSession(sessionId)).then(() => {
      if (session.messages.length > 4) session.messages = session.messages.slice(-4)
      state.snapshot.cursor += 1
      return [{ id, result: { sessionId, sessions: [session] } }]
    })
  }
  if (input.method === 'turn/cancel') {
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : ''
    if (!runId) return [errorResponse(id, 'invalid_request', 'runId is required')]
    const orchestrationRun = [...activeSessionRuns.values()].find((run) => run.runId === runId)
    if (orchestrationRun) orchestrationRun.cancelled = true
    const codeCancelled = cancelPiCodeMode(runId)
    return Promise.all([cancelPiTurn(runId), Promise.resolve(cancelPiTool(runId))]).then(([turnCancelled, toolCancelled]) => (turnCancelled || toolCancelled || codeCancelled || Boolean(orchestrationRun))
      ? [{ id, result: { runId, settlement: 'cancelled' as const } }]
      : [errorResponse(id, 'invalid_request', `Unknown Pi run: ${runId}`)])
  }
  if (input.method === 'turn/submit') {
    const sessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : ''
    const prompt = typeof input.params?.prompt === 'string' ? input.params.prompt : ''
    const session = state.snapshot.sessions.find((candidate) => candidate.id === sessionId)
    if (!session || !prompt.trim()) return [errorResponse(id, 'invalid_request', 'sessionId and prompt are required')]
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : `pi-run-${Date.now()}`
    const activeRun = activeSessionRuns.get(sessionId)
    if (activeRun && activeRun.runId !== runId) {
      const mode = input.params?.followUpMode === 'steer' || input.params?.mode === 'steer'
        ? 'steer'
        : input.params?.followUpMode === 'queue' || input.params?.mode === 'queue' || input.params?.queue === true
          ? 'queue'
          : undefined
      if (mode === 'steer') {
        try {
          if (!steerPiTurn(sessionId, prompt)) return [errorResponse(id, 'invalid_request', 'Active Pi session cannot accept steering messages')]
        } catch (error) {
          return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Unable to steer active Pi session')]
        }
        return [{ id, result: { sessionId, runId: activeRun.runId, settlement: 'interrupted' as const, queued: 'steer' as const } }]
      }
      if (mode === 'queue') {
        const queue = new PiRunQueue(24, state.snapshot.queue)
        const outcome = queue.enqueue({ runId, sessionId, prompt, trigger: 'interactive', profile: {}, status: 'queued' })
        if (!outcome.ok) return [errorResponse(id, 'invalid_request', `Pi run queue ${outcome.code}`)]
        state.snapshot.queue = queue.snapshot(); state.snapshot.cursor += 1
        return [{ id, result: { sessionId, runId, settlement: 'interrupted' as const, queued: 'queue' as const, queue: state.snapshot.queue } }]
      }
      return [errorResponse(id, 'invalid_request', `Pi session already has an active run: ${activeRun.runId}`)]
    }
    const cwd = typeof input.params?.cwd === 'string' ? input.params.cwd : process.cwd()
    const patternValue = input.params?.pattern
    const pattern: PiLoopPattern = patternValue === 'Goal-based' || patternValue === 'Time-based' || patternValue === 'Proactive'
      ? patternValue
      : 'Turn-based'
    const maxIterations = typeof input.params?.maxIterations === 'number' ? input.params.maxIterations : 1
    const definitionOfDone = typeof input.params?.definitionOfDone === 'string' ? input.params.definitionOfDone.trim().slice(0, 2_000) : undefined
    const iterationLimit = Math.max(1, Math.min(8, Math.floor(maxIterations || 1)))
    let turnSettings = state.snapshot.settings
    if (input.params?.profile && typeof input.params.profile === 'object') {
      try {
        const profilePatch = validatePiSettingsPatch(input.params.profile as Record<string, unknown>)
        turnSettings = compileEffectiveAgentProfile(state.snapshot.settings, profilePatch, {})
      } catch (error) {
        return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Invalid Pi turn profile')]
      }
    }
    const turnEvents: PiHostEvent[] = []
    activeSessionRuns.set(sessionId, { runId, cancelled: false })
    const publishOrchestration = (phase: 'parse' | 'iterate' | 'dod' | 'replan' | 'settlement' | 'cancelled', iteration?: number, detail?: string) => {
      const event: PiHostEvent = { event: 'host/orchestration', payload: { runId, sessionId, phase, iteration, pattern, detail } }
      if (emit) emit(event)
      else turnEvents.push(event)
    }
    publishOrchestration('parse', undefined, definitionOfDone || 'Pi turn settlement is the default DoD')
    return runPiOrchestration({
      pattern,
      prompt,
      maxIterations,
      turn: async (iterationPrompt, iteration) => {
        if (activeSessionRuns.get(sessionId)?.cancelled) return { settlement: 'cancelled' as const, result: '' }
        publishOrchestration('iterate', iteration)
        const turn = await runPiTurn(sessionId, cwd, iterationPrompt, session.messages, (event) => {
          /* Events are collected below so the response remains ordered after them. */
          const turnEvent: PiHostEvent = { event: 'host/turn-item', payload: { runId, sessionId, item: event, iteration } }
          if (emit) emit(turnEvent)
          else turnEvents.push(turnEvent)
        }, runId, session.piSessionFile, turnSettings)
        session.piSessionFile ||= getPiSessionFile(sessionId)
        if (turn.settlement === 'success') {
          const assistant = turn.items.find((item) => Boolean(item && typeof item === 'object' && (item as { type?: unknown }).type === 'assistant_message')) as { content?: string } | undefined
          session.messages = [
            ...session.messages,
            { role: 'user', content: iterationPrompt },
            { role: 'assistant', content: assistant?.content ?? '' },
          ]
          const done = definitionOfDone ? Boolean(assistant?.content?.trim()) : undefined
          if (definitionOfDone) {
            publishOrchestration('dod', iteration, done ? 'met' : 'unmet')
            if (!done && iteration < iterationLimit) publishOrchestration('replan', iteration, 'DoD unmet; retrying the Pi turn')
          }
          return { settlement: 'success' as const, result: assistant?.content ?? '', ...(done === undefined ? {} : { done }) }
        }
        return { settlement: turn.settlement, result: turn.items.map((item) => typeof item?.content === 'string' ? item.content : '').join('\n') }
      },
    }).then((orchestration) => {
      publishOrchestration(orchestration.settlement === 'cancelled' ? 'cancelled' : 'settlement', orchestration.iterations, orchestration.settlement)
      state.snapshot.cursor += 1
      return [...turnEvents, {
        id,
        result: {
          sessionId,
          runId,
          settlement: orchestration.settlement,
          items: orchestration.result ? [{ type: 'assistant_message', content: orchestration.result }] : [],
          orchestration: {
            pattern: orchestration.pattern,
            iterations: orchestration.iterations,
            maxIterations: iterationLimit,
            definitionOfDone,
            dodMet: orchestration.dodMet,
          },
        },
      }]
    }).finally(() => {
      if (activeSessionRuns.get(sessionId)?.runId === runId) activeSessionRuns.delete(sessionId)
    })
  }
  if (input.method === 'settings/get') return [{ id, result: { settings: { ...state.snapshot.settings }, config: state.snapshot.config } }]
  if (input.method === 'settings/update') {
    try {
      const patch = validatePiSettingsPatch(input.params || {})
      state.snapshot.settings = {
        ...state.snapshot.settings,
        ...patch,
        activeTools: patch.activeTools || state.snapshot.settings.activeTools,
      }
      state.snapshot.settingsOrigin = 'managed'
      if (state.snapshot.config) state.snapshot.config = { ...state.snapshot.config, settingsSource: 'managed' }
      state.snapshot.cursor += 1
      return [{ id, result: { settings: { ...state.snapshot.settings }, config: state.snapshot.config } }]
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
  initialSnapshot: { cursor: number; sessions: SessionRecord[]; settings: PiSettings; settingsOrigin?: 'native' | 'managed'; config?: PiHostConfigStatus; queue: PiQueuedRun[]; resources: PiResource[]; memories: PiMemory[]; extensions?: PiExtension[] } = {
    cursor: 0,
    sessions: [],
    settings: { ...DEFAULT_PI_SETTINGS },
    queue: [],
    resources: [],
    memories: [],
    extensions: [],
  },
  onStateChange?: (snapshot: { cursor: number; sessions: SessionRecord[]; settings: PiSettings; settingsOrigin?: 'native' | 'managed'; config?: PiHostConfigStatus; queue: PiQueuedRun[]; resources: PiResource[]; memories: PiMemory[]; extensions: PiExtension[] }) => void,
) {
  const snapshot = { ...initialSnapshot, extensions: initialSnapshot.extensions || [] }
  const state: HostState = { initialized: false, snapshot, capabilities: new PiCapabilityCatalog(DEFAULT_PI_CAPABILITIES), extensions: new PiExtensionRegistry(snapshot.extensions) }
  return {
    async handle(request: unknown) {
      const messages = await handlePiHostRequest(state, request, send)
      const method = (request as { method?: string } | null)?.method
      if (method?.startsWith('settings/') || method?.startsWith('sessions/') || method?.startsWith('runs/') || method?.startsWith('resources/') || method?.startsWith('memory/') || method?.startsWith('extensions/') || method === 'turn/submit') onStateChange?.(state.snapshot)
      for (const message of messages) send(message)
    },
  }
}
