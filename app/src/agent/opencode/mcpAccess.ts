import type { LlmSettings, McpServerConfig } from '../types.ts'

/**
 * Per-agent MCP access is opt-in only when a mapping exists for that agent.
 * Missing mapping preserves the pre-existing global enable behavior; an empty
 * mapping intentionally means the agent receives no MCP servers.
 */
export function isMcpServerAllowedForAgent(
  settings: Pick<LlmSettings, 'mcpAgentServers'>,
  agentId: string | undefined,
  serverId: string,
): boolean {
  if (!agentId) return true
  const map = settings.mcpAgentServers || {}
  if (!Object.prototype.hasOwnProperty.call(map, agentId)) return true
  return (map[agentId] || []).includes(serverId)
}

export function mcpServersForAgent(
  settings: Pick<LlmSettings, 'mcpServers' | 'mcpAgentServers'>,
  agentId?: string,
): McpServerConfig[] {
  return (settings.mcpServers || []).filter(
    (server) => server.enabled && isMcpServerAllowedForAgent(settings, agentId, server.id),
  )
}
