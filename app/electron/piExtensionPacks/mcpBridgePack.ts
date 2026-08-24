import { registerPiExtensionPack, type PiPackTool } from '../piToolHost.ts'

/**
 * MCP bridge pack（MCP 橋接包）— the model-facing door to configured servers.
 *
 * `mcp_list_tools` / `mcp_call` ride the Host's own MCP client — the same
 * clients whose tools are flattened into tools/list. One source of truth: the
 * list a model sees is the list the catalog flattens, never a second inventory.
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

function jsonOk(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], details: { ok: true, ...data } }
}

function structuredFailure(error: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error }) }], details: { ok: false, error } }
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
