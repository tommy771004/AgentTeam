import type { ExternalCliConnectorRequirement } from './externalCliRunSession.ts'
import type { LlmSettings, RuntimeOverrides } from './types.ts'

/**
 * Admission-time connector capability snapshot for external adapters.
 *
 * The producer is the configured/selected MCP capability set, not provider
 * stderr text. Explicit per-run requirements remain authoritative (including
 * an explicit empty list), while a missing override is derived from enabled
 * servers allowed for the selected OpenCode agent.
 */
export function resolveExternalCliRequiredConnectors(
  settings: Pick<LlmSettings, 'mcpEnabled' | 'mcpServers' | 'mcpAgentServers'>,
  overrides?: Pick<RuntimeOverrides, 'externalCliRequiredConnectors' | 'mcpAgentId' | 'agentMode'>,
): ExternalCliConnectorRequirement[] {
  if (Array.isArray(overrides?.externalCliRequiredConnectors)) {
    return overrides.externalCliRequiredConnectors.map((requirement) => ({
      connector: requirement.connector?.trim().slice(0, 120),
      server: requirement.server?.trim().slice(0, 160),
      operation: requirement.operation?.trim().slice(0, 160),
    }))
  }
  if (settings.mcpEnabled !== true) return []
  // agentMode is the selected OpenCode capability when callers have not
  // supplied the more explicit MCP id. This keeps the admission producer in
  // lockstep with the same per-agent access mapping used by the tool loop.
  const agentId = overrides?.mcpAgentId || overrides?.agentMode
  const allowed = agentId ? settings.mcpAgentServers?.[agentId] : undefined
  return (settings.mcpServers || [])
    .filter((server) => server.enabled && (!agentId || !allowed || allowed.includes(server.id)))
    .map((server) => ({
      connector: (server.secretPluginId || server.pluginId || server.id).trim().slice(0, 120),
      server: server.name.trim().slice(0, 160),
    }))
}

export function snapshotExternalCliConnectorRequirements(
  settings: Pick<LlmSettings, 'mcpEnabled' | 'mcpServers' | 'mcpAgentServers'>,
  overrides?: Pick<RuntimeOverrides, 'externalCliRequiredConnectors' | 'mcpAgentId' | 'agentMode'>,
): ExternalCliConnectorRequirement[] {
  return resolveExternalCliRequiredConnectors(settings, overrides).map((requirement) => ({ ...requirement }))
}
