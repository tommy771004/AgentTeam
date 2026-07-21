/**
 * Self-registering tool module: mcp_list_tools
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "mcp_list_tools",
  toolset: "mcp-bridge",
  description: "List tools from configured MCP servers",
  keywords: ["mcp","list tools","external tool"],
  schemaParams: {"type":"object","properties":{"serverId":{"type":"string","description":"Optional: filter by server id"}}} as Record<string, unknown>,
  owningCapability: "mcp-bridge",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { listAllMcpTools } = await import('../../hermes/mcp.ts')
    const { useSettingsStore } = await import('../../../store/settingsStore.ts')
    const { mcpServersForAgent } = await import('../../opencode/mcpAccess.ts')
    const settings = useSettingsStore.getState().settings
    if (!settings.mcpEnabled) {
      return { ok: false, output: 'MCP 未啟用（請至設定開啟）' }
    }
    const servers = mcpServersForAgent(settings, context?.mcpAgentId)
    const filterId = input.serverId ? String(input.serverId) : ''
    const list = await listAllMcpTools(
      filterId ? servers.filter((s) => s.id === filterId) : servers,
      settings,
    )
    if (!list.length) return { ok: true, output: '（無 MCP 工具或伺服器未啟用）' }
    return {
      ok: true,
      output: list
        .map(
          (t) =>
            `- [${t.serverName}/${t.serverId}] ${t.name}: ${t.description || ''}`,
        )
        .join('\n'),
      data: list,
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})
