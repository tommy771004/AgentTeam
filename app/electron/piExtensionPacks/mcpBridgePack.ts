import { registerPiExtensionPack, type PiExtensionPack, type PiPackTool } from '../piToolHost.ts'
import { registerPiMcpToolProvenance, schemaDigest } from '../piToolContract.ts'
import { jsonOk, structuredFailure } from './packResults.ts'

/**
 * MCP bridge pack（MCP 橋接包）— compatibility-only access to configured servers.
 *
 * `mcp_list_tools` / `mcp_call` ride the Host's own MCP client — the same
 * clients whose native tools are flattened into tools/list. These generic
 * verbs remain registered for an explicit qualification allowlist, but the
 * ordinary mcp-bridge capability activates only native namespaced tools.
 */

type PiExtension = {
  id: string
  kind: 'package' | 'mcp'
  enabled: boolean
  mcp?: { command: string; args: string[]; env?: Record<string, string> }
}
type PiMcpConfig = NonNullable<PiExtension['mcp']>

type McpLookup = () => PiExtension[]

let mcpExtensions: McpLookup = () => []

/** The protocol installs this so the pack reads the live extension registry. */
export function setPiMcpExtensionsLookup(lookup: McpLookup): void {
  mcpExtensions = lookup
}

function findEnabled(extensionId: string): { extension: PiExtension; config: PiMcpConfig } | undefined {
  const extension = mcpExtensions().find((candidate) => candidate.id === extensionId && candidate.kind === 'mcp' && candidate.enabled)
  return extension?.mcp ? { extension, config: extension.mcp } : undefined
}

function modelSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '')
  return normalized || 'tool'
}

/** Stable, collision-safe model name for one exact extension/upstream pair. */
export function piMcpModelToolName(extensionId: string, upstreamToolName: string, collision = false): string {
  const base = `mcp_${modelSegment(extensionId)}_${modelSegment(upstreamToolName)}`
  return collision ? `${base}_${schemaDigest({ extensionId, upstreamToolName }).slice(0, 8)}` : base
}

export type PiMcpToolCoordinate = { extensionId: string; upstreamToolName: string }

/**
 * Assign names for a complete discovery set. Every normalized collision is
 * disambiguated, so the result never depends on server/extension iteration
 * order and no source gets a privileged unsuffixed name by arriving first.
 */
export function piMcpModelToolNames(coordinates: readonly PiMcpToolCoordinate[]): Map<string, string> {
  const unique = [...new Map(coordinates.map((coordinate) => [
    `${coordinate.extensionId}\u0000${coordinate.upstreamToolName}`,
    coordinate,
  ])).values()]
  const groups = new Map<string, PiMcpToolCoordinate[]>()
  for (const coordinate of unique) {
    const base = piMcpModelToolName(coordinate.extensionId, coordinate.upstreamToolName)
    groups.set(base, [...(groups.get(base) || []), coordinate])
  }
  const names = new Map<string, string>()
  for (const [base, group] of groups) {
    for (const coordinate of group) {
      const key = `${coordinate.extensionId}\u0000${coordinate.upstreamToolName}`
      names.set(key, group.length === 1
        ? base
        : `${base}_${schemaDigest(coordinate).slice(0, 8)}`)
    }
  }
  return names
}

export function isPiMcpInputSchema(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const schema = value as Record<string, unknown>
  if (schema.type !== 'object') return false
  if (schema.properties !== undefined && (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties))) return false
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((entry) => typeof entry !== 'string'))) return false
  return true
}

export type PiMcpDynamicToolSnapshot = {
  extensionId: string
  upstreamToolName: string
  modelName: string
  description: string
  inputSchema: Record<string, unknown>
  generation: number
}

/**
 * Discover enabled MCP tools once while the Pi session is being constructed.
 * The returned pack definitions are that turn's frozen schema snapshot; their
 * execution closures still reuse the existing cached Host MCP client.
 */
export async function buildPiMcpDynamicPacks(): Promise<{ packs: PiExtensionPack[]; tools: PiMcpDynamicToolSnapshot[] }> {
  const snapshots: PiMcpDynamicToolSnapshot[] = []
  const enabled = mcpExtensions().filter((candidate) => candidate.enabled && candidate.kind === 'mcp' && candidate.mcp)
  const discovered: Array<Omit<PiMcpDynamicToolSnapshot, 'modelName'>> = []
  for (const extension of enabled) {
    try {
      const { listPiMcpTools, piMcpGeneration } = await import('../piMcpClient.ts')
      const generation = piMcpGeneration(extension.id)
      const tools = await listPiMcpTools(extension.id, extension.mcp!, generation)
      for (const tool of tools) {
        if (typeof tool.name !== 'string' || !tool.name.trim() || !isPiMcpInputSchema(tool.inputSchema)) continue
        discovered.push({
          extensionId: extension.id,
          upstreamToolName: tool.name,
          description: typeof tool.description === 'string' ? tool.description : `MCP tool ${tool.name}`,
          inputSchema: tool.inputSchema,
          generation,
        })
      }
    } catch {
      // One unavailable server reduces only its own catalog. It cannot prevent
      // a Pi session from starting or weaken the other MCP snapshots.
    }
  }
  const assignedNames = piMcpModelToolNames(discovered)
  for (const candidate of discovered) {
    const modelName = assignedNames.get(`${candidate.extensionId}\u0000${candidate.upstreamToolName}`)
    if (!modelName) continue
    const snapshot = { ...candidate, modelName }
    registerPiMcpToolProvenance(modelName, { extensionId: candidate.extensionId, upstreamToolName: candidate.upstreamToolName })
    snapshots.push(snapshot)
  }
  const packs = enabled
    .filter((extension) => snapshots.some((snapshot) => snapshot.extensionId === extension.id))
    .map((extension): PiExtensionPack => ({
      id: `mcp-${extension.id}`,
      name: `MCP ${extension.id}`,
      description: `Native dynamic tools from MCP extension ${extension.id}`,
      capability: 'mcp-bridge',
      tools: snapshots.filter((snapshot) => snapshot.extensionId === extension.id).map((snapshot): PiPackTool => ({
        name: snapshot.modelName,
        label: snapshot.upstreamToolName,
        description: snapshot.description,
        promptSnippet: `invoke ${snapshot.upstreamToolName} from MCP extension ${extension.id}`,
        parameters: snapshot.inputSchema,
        policyMigration: {
          outbound: true,
          approvalRequired: `MCP ${extension.id}/${snapshot.upstreamToolName} requires approval`,
          sideEffect: true,
        },
        execute: async (args) => {
          try {
            const { callPiMcpToolResult } = await import('../piMcpClient.ts')
            const result = await callPiMcpToolResult(extension.id, extension.mcp!, snapshot.upstreamToolName, args, snapshot.generation)
            if (result.isError) {
              const businessFailure = {
                ok: false,
                expectedFailure: true,
                extensionId: extension.id,
                upstreamToolName: snapshot.upstreamToolName,
                arguments: args,
                content: result.content,
              }
              // Upstream's declared tool failure is recoverable model content,
              // not a Host transport crash. `details.ok` therefore describes
              // successful delivery while the visible business envelope says
              // `ok:false` explicitly.
              return {
                content: [{ type: 'text', text: JSON.stringify(businessFailure) }],
                details: { ...businessFailure, ok: true, upstreamOk: false },
              }
            }
            return jsonOk({
              extensionId: extension.id,
              upstreamToolName: snapshot.upstreamToolName,
              arguments: args,
              content: result.content,
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : 'MCP transport failed'
            return {
              content: [{ type: 'text', text: JSON.stringify({ ok: false, transportFailure: true, error: message }) }],
              details: { ok: false, transportFailure: true, error: message },
            }
          }
        },
      })),
    }))
  return { packs, tools: snapshots }
}

const mcpListTools: PiPackTool = {
  name: 'mcp_list_tools',
  label: 'MCP List Tools',
  description: 'List the tools an enabled MCP server exposes',
  promptSnippet: 'list tools provided by a configured MCP server',
  parameters: {
    type: 'object',
    properties: { extensionId: { type: 'string', description: 'The MCP extension id' } },
    required: ['extensionId'],
  },
  policyMigration: { outbound: true },
  execute: async (args) => {
    const extensionId = String(args.extensionId || '').trim()
    const found = findEnabled(extensionId)
    if (!found) return structuredFailure(`未啟用或不存在的 MCP extension：${extensionId}`)
    try {
      // Imported lazily so the pack module itself stays cheap to load.
      const { listPiMcpTools } = await import('../piMcpClient.ts')
      const tools = await listPiMcpTools(extensionId, found.config)
      return jsonOk({ extensionId, tools: tools.map((tool) => ({ name: tool.name, description: tool.description })) })
    } catch (error) {
      return structuredFailure(error instanceof Error ? error.message : 'MCP list failed')
    }
  },
}

const mcpCall: PiPackTool = {
  name: 'mcp_call',
  label: 'MCP Call',
  description: 'Call one tool on an enabled MCP server',
  promptSnippet: 'invoke a tool on a configured MCP server',
  parameters: {
    type: 'object',
    properties: {
      extensionId: { type: 'string', description: 'The MCP extension id' },
      toolName: { type: 'string', description: 'Tool name on that server' },
      arguments: { type: 'object', description: 'Arguments for the tool' },
    },
    required: ['extensionId', 'toolName'],
  },
  approval: (args) => ({
    need: true,
    reason: `mcp_call 會呼叫外部伺服器工具（${String(args.extensionId || '')}/${String(args.toolName || '')}）`,
  }),
  policyMigration: { outbound: true, sideEffect: true },
  execute: async (args) => {
    const extensionId = String(args.extensionId || '').trim()
    const toolName = String(args.toolName || '').trim()
    const callArgs = (args.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments)) ? args.arguments as Record<string, unknown> : {}
    const found = findEnabled(extensionId)
    if (!found) return structuredFailure(`未啟用或不存在的 MCP extension：${extensionId}`)
    if (!toolName) return structuredFailure('toolName 必填')
    try {
      const { callPiMcpTool } = await import('../piMcpClient.ts')
      const content = await callPiMcpTool(extensionId, found.config, toolName, callArgs)
      return jsonOk({ extensionId, toolName, content })
    } catch (error) {
      return structuredFailure(error instanceof Error ? error.message : 'MCP call failed')
    }
  },
}



export function buildMcpBridgePack() {
  return {
    id: 'mcp-bridge',
    name: 'MCP Bridge',
    description: 'Model access to configured MCP servers through the Host client',
    capability: 'mcp-bridge',
    tools: [mcpListTools, mcpCall],
  }
}

let registered = false
export function ensureMcpBridgePackRegistered(): void {
  if (registered) return
  registered = true
  registerPiExtensionPack(buildMcpBridgePack())
}
