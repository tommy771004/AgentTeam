/**
 * Self-registering tool module: mcp_call
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "mcp_call",
  toolset: "mcp-bridge",
  description: "Call a tool on an MCP server",
  keywords: ["mcp","call tool","external"],
  schemaParams: {"type":"object","properties":{"serverId":{"type":"string"},"toolName":{"type":"string"},"arguments":{"type":"object"}},"required":["serverId","toolName"]} as Record<string, unknown>,
  owningCapability: "mcp-bridge",
  handler: async (toolArgs, ctx) => {
    const input = toolArgs
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { mcpCallTool } = await import('../../hermes/mcp.ts')
    const { useSettingsStore } = await import('../../../store/settingsStore.ts')
    const { isMcpServerAllowedForAgent } = await import('../../opencode/mcpAccess.ts')
    const settings = useSettingsStore.getState().settings
    if (!settings.mcpEnabled) {
      return { ok: false, output: 'MCP 未啟用' }
    }
    const serverId = String(input.serverId || '')
    const toolName = String(input.toolName || '')
    const args =
      input.arguments && typeof input.arguments === 'object'
        ? (input.arguments as Record<string, unknown>)
        : {}
    const server = (settings.mcpServers || []).find((s) => s.id === serverId)
    if (!server) return { ok: false, output: `找不到 MCP 伺服器：${serverId}` }
    if (!isMcpServerAllowedForAgent(settings, context?.mcpAgentId, serverId)) {
      return { ok: false, output: `MCP 伺服器未授權給 agent：${serverId}` }
    }
    const r = await mcpCallTool(server, toolName, args, settings)
    return {
      ok: r.ok,
      output: r.ok ? r.content : r.error || 'MCP call failed',
      data: r,
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})
