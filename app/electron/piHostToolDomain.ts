import { ensurePiPacksRegistered } from './piExtensionPacks/index.ts'
import { isPiMcpInputSchema, piMcpModelToolName, piMcpModelToolNames } from './piExtensionPacks/mcpBridgePack.ts'
import { listPiMcpTools } from './piMcpClient.ts'
import { piCoreRuntimeToolCatalog } from './piCoreRuntime.ts'
import { piPackCatalogEntries, resolvePiApproval, type PiCatalogEntry } from './piToolHost.ts'
import { schemaDigest, type PiToolContractStore } from './piToolContract.ts'
import type { PiCapabilityCatalog } from './piCapabilityExtension.ts'
import type { PiExtensionRegistry } from './piExtensionRegistry.ts'
import {
  isWorkspaceTextSearchTool,
  workspaceTextSearchAvailability,
} from './piWorkspaceTextSearchRuntime.ts'
import type { PiHostMessage, SessionRecord } from './piHostProtocol.ts'

type ToolDomainState = {
  toolContractNegotiated: boolean
  extensions: PiExtensionRegistry
  capabilities: PiCapabilityCatalog
  toolContracts: PiToolContractStore
  catalogProjection: Map<string, PiCatalogEntry>
  snapshot: {
    settings: { activeTools: string[]; workspaceTextSearch?: boolean }
    sessions: SessionRecord[]
  }
}

type ToolDomainInput = {
  method: string
  params?: Record<string, unknown>
  id: string | number
  state: ToolDomainState
  execute: () => PiHostMessage[] | Promise<PiHostMessage[]>
}

const EXECUTION_METHODS = new Set([
  'tools/pack', 'tools/mcp', 'tools/code',
  'tools/read', 'tools/grep', 'tools/find', 'tools/ls',
  'tools/write', 'tools/edit', 'tools/bash',
])

function errorResponse(id: string | number, code: 'invalid_request' | 'unknown_method', message: string): PiHostMessage {
  return { id, error: { code, message } }
}

/**
 * Owns the public tools/approvals protocol capability. Tool execution crosses
 * one Host-only port so policy, approval and evidence mechanics stay shared;
 * deleting this module removes every callable protocol route.
 */
export function handlePiHostToolDomain(input: ToolDomainInput): PiHostMessage[] | Promise<PiHostMessage[]> | undefined {
  if (input.method === 'tools/list') return listTools(input)
  if (input.method === 'tools/contract') return readToolContract(input)
  if (input.method === 'approvals/resolve') return resolveApproval(input)
  if (EXECUTION_METHODS.has(input.method)) return input.execute()
  if (input.method.startsWith('tools/') || input.method.startsWith('approvals/')) {
    return [errorResponse(input.id, 'unknown_method', `Unknown Pi Host method: ${input.method}`)]
  }
  return undefined
}

function readToolContract(input: ToolDomainInput): PiHostMessage[] {
  if (!input.state.toolContractNegotiated) return [errorResponse(input.id, 'invalid_request', 'Client did not negotiate tool-contract-v1')]
  const sessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : ''
  const revision = typeof input.params?.revision === 'number' ? input.params.revision : Number(input.params?.revision)
  const toolName = typeof input.params?.toolName === 'string' ? input.params.toolName : ''
  const lookup = input.state.toolContracts.lookup(sessionId, revision, toolName)
  if (!lookup.ok) return [{ id: input.id, error: { code: lookup.code, message: lookup.message } }]
  return [{ id: input.id, result: { contract: lookup.contract, contractTool: lookup.tool, revisionStatus: lookup.status } }]
}

function resolveApproval(input: ToolDomainInput): PiHostMessage[] {
  const resolved = resolvePiApproval(input.params || {})
  return resolved
    ? [{ id: input.id, result: { resolved: true } }]
    : [errorResponse(input.id, 'invalid_request', 'No pending Pi approval matches runId and callId')]
}

function listTools(input: ToolDomainInput): Promise<PiHostMessage[]> | PiHostMessage[] {
  if (input.params?.requireContract === true && !input.state.toolContractNegotiated) {
    return [errorResponse(input.id, 'invalid_request', 'Pi Host tool catalog requires tool-contract-v1 negotiation')]
  }
  ensurePiPacksRegistered()
  const requestedSessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : undefined
  const workspaceTextSearch = workspaceTextSearchAvailability({
    sessionId: requestedSessionId,
    enabled: input.state.snapshot.settings.workspaceTextSearch === true,
    workspaceRoot: typeof input.params?.cwd === 'string' ? input.params.cwd : undefined,
  })
  const activeTools = input.state.snapshot.settings.activeTools
  const unlocked = input.state.capabilities.activeTools(requestedSessionId)
    .filter((tool) => workspaceTextSearch.available || !isWorkspaceTextSearchTool(tool))
  const mcpCapabilityActive = input.state.capabilities.catalog(requestedSessionId)
    .find((capability) => capability.id === 'mcp-bridge')?.deferred === false
  const packEntries = piPackCatalogEntries({ activeTools, unlockedTools: [...unlocked] })
    .filter((entry) => workspaceTextSearch.available || !isWorkspaceTextSearchTool(entry.name))
  const builtinEntries = builtinCatalog(activeTools)
  const latestContract = latestToolContract(input.state, requestedSessionId)
  const mcpExtensions = input.state.extensions.list().filter((extension) => extension.kind === 'mcp' && extension.mcp)
  return Promise.all(mcpExtensions.map(async (extension): Promise<PiCatalogEntry[]> => {
    const unavailable = unavailableMcpEntry(extension.id, extension.tools)
    if (!extension.enabled) return extension.tools.map((name) => unavailable(name, 'disabled', `extension ${extension.id} is disabled`))
    try {
      const tools = await listPiMcpTools(extension.id, extension.mcp!)
      return projectMcpTools(extension.id, extension.tools, tools, unavailable)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'MCP server did not provide a trusted schema'
      return extension.tools.map((name) => unavailable(name, 'transport-failed', reason))
    }
  })).then((discovered) => publishCatalog(input, {
    entries: [...builtinEntries, ...packEntries, ...activateMcpEntries(discovered.flat(), mcpCapabilityActive, activeTools)],
    latestContract,
  }))
}

function builtinCatalog(activeTools: string[]): PiCatalogEntry[] {
  return piCoreRuntimeToolCatalog().map((definition) => {
    const active = activeTools.length === 0 || activeTools.includes(definition.name)
    return {
      name: definition.name,
      description: definition.description,
      pack: 'builtin',
      source: 'discovered' as const,
      active,
      available: true,
      schemaDigest: schemaDigest(definition.parameters),
      ...(active ? {} : { reason: `${definition.name} is disabled by Pi active tools settings` }),
    }
  })
}

function latestToolContract(state: ToolDomainState, sessionId?: string) {
  const sessions = sessionId ? state.snapshot.sessions.filter((session) => session.id === sessionId) : state.snapshot.sessions
  return sessions.flatMap((session) => state.toolContracts.list(session.id)).sort((left, right) => right.revision - left.revision)[0]
}

function unavailableMcpEntry(extensionId: string, _declared: string[]) {
  return (toolName: string, category: 'disabled' | 'missing' | 'schema-invalid' | 'transport-failed', detail: string): PiCatalogEntry => ({
    name: piMcpModelToolName(extensionId, toolName),
    description: 'Tool provided by an installed MCP extension',
    pack: 'mcp',
    source: 'installed',
    active: false,
    available: false,
    schemaDigest: schemaDigest({ unavailable: true, category, extensionId, tool: toolName }),
    reason: `MCP ${category}: ${detail}`,
    extensionId,
    upstreamToolName: toolName,
  })
}

function projectMcpTools(
  extensionId: string,
  declared: string[],
  tools: Awaited<ReturnType<typeof listPiMcpTools>>,
  unavailable: ReturnType<typeof unavailableMcpEntry>,
): PiCatalogEntry[] {
  const entries = new Map<string, PiCatalogEntry>()
  const present = new Set<string>()
  for (const tool of tools) {
    if (typeof tool.name !== 'string' || !tool.name.trim()) continue
    present.add(tool.name)
    if (!isPiMcpInputSchema(tool.inputSchema)) {
      entries.set(tool.name, unavailable(tool.name, 'schema-invalid', `tool ${tool.name} did not provide a valid object input schema`))
      continue
    }
    entries.set(tool.name, {
      name: piMcpModelToolName(extensionId, tool.name),
      description: typeof tool.description === 'string' ? tool.description : 'Tool provided by an installed MCP extension',
      pack: 'mcp',
      source: 'installed',
      active: false,
      available: true,
      schemaDigest: schemaDigest(tool.inputSchema),
      extensionId,
      upstreamToolName: tool.name,
    })
  }
  for (const toolName of declared) {
    if (!present.has(toolName)) entries.set(toolName, unavailable(toolName, 'missing', `declared tool ${toolName} was not returned by the server`))
  }
  return [...entries.values()]
}

function activateMcpEntries(entries: PiCatalogEntry[], capabilityActive: boolean, activeTools: string[]): PiCatalogEntry[] {
  const assigned = piMcpModelToolNames(entries.flatMap((entry) => entry.extensionId && entry.upstreamToolName
    ? [{ extensionId: entry.extensionId, upstreamToolName: entry.upstreamToolName }]
    : []))
  return entries.map((entry) => {
    if (!entry.extensionId || !entry.upstreamToolName) return entry
    const name = assigned.get(`${entry.extensionId}\u0000${entry.upstreamToolName}`) || entry.name
    const active = entry.available && (capabilityActive || activeTools.includes(name))
    return { ...entry, name, active, ...(entry.available && !active ? { reason: 'Inactive this turn: load the mcp-bridge capability' } : {}) }
  })
}

function publishCatalog(input: ToolDomainInput, value: {
  entries: PiCatalogEntry[]
  latestContract: ReturnType<typeof latestToolContract>
}): PiHostMessage[] {
  const catalog = applyContractFacts(value.entries, value.latestContract).sort((left, right) => left.name.localeCompare(right.name))
  input.state.catalogProjection = new Map(catalog.map((entry) => [entry.name, entry]))
  return [{ id: input.id, result: {
    builtinTools: catalog.filter((entry) => entry.available && entry.active).map((entry) => entry.name),
    catalog,
    ...(value.latestContract ? { catalogContractRevision: value.latestContract.revision, catalogContractDigest: value.latestContract.contractDigest } : {}),
  } }]
}

function applyContractFacts(entries: PiCatalogEntry[], contract: ReturnType<typeof latestToolContract>): PiCatalogEntry[] {
  if (!contract) return entries
  const facts = new Map(contract.tools.map((tool) => [tool.name, tool]))
  return entries.map((entry) => {
    const fact = facts.get(entry.name)
    if (!fact) return entry
    if (entry.pack === 'mcp' && entry.available && entry.schemaDigest !== fact.schemaDigest) {
      return { ...entry, active: false, available: false, contractRevision: contract.revision, contractDigest: contract.contractDigest,
        reason: 'MCP tool stale: upstream schema changed after the frozen turn contract; reload applies on the next turn' }
    }
    if (!entry.available) return entry
    return { ...entry, active: fact.active, schemaDigest: fact.schemaDigest, contractRevision: contract.revision,
      contractDigest: contract.contractDigest, ...(fact.active ? { reason: undefined } : { reason: entry.reason || 'Inactive in the selected Pi turn contract' }) }
  })
}
