/**
 * Inject connector secrets into MCP server config at call time.
 * Env keys match common official MCP server conventions.
 *
 * Ownership model:
 * - server.pluginId = package that owns the process (github-mcp)
 * - server.secretPluginId = where tokens live (github-connector)
 */

import type { LlmSettings, McpServerConfig } from '../types'
import { getPluginSecret } from './pluginSecrets'

/** secret owner id → env vars to fill when secret is present */
export const MCP_SECRET_ENV_KEYS: Record<string, string[]> = {
  'github-connector': ['GITHUB_PERSONAL_ACCESS_TOKEN', 'GITHUB_TOKEN'],
  'notion-connector': ['NOTION_TOKEN', 'NOTION_API_KEY'],
  'linear-connector': ['LINEAR_API_KEY', 'LINEAR_TOKEN'],
  'figma-connector': [
    'FIGMA_ACCESS_TOKEN',
    'FIGMA_PERSONAL_ACCESS_TOKEN',
    'FIGMA_API_KEY',
  ],
  'dropbox-connector': ['DROPBOX_ACCESS_TOKEN', 'DROPBOX_TOKEN'],
  'calendar-connector': ['GOOGLE_ACCESS_TOKEN', 'GOOGLE_TOKEN'],
  'spreadsheets-connector': ['GOOGLE_ACCESS_TOKEN', 'GOOGLE_TOKEN'],
  'clickup-connector': ['CLICKUP_API_TOKEN', 'CLICKUP_TOKEN'],
  'asana-connector': ['ASANA_ACCESS_TOKEN', 'ASANA_TOKEN'],
  'canva-connector': ['CANVA_ACCESS_TOKEN'],
  'adobe-connector': ['ADOBE_ACCESS_TOKEN'],
  'brave-search': ['BRAVE_API_KEY'],
  'postgres-dsn': ['POSTGRES_CONNECTION_STRING', 'DATABASE_URL'],
}

function secretForPlugin(pluginId: string, settings?: Partial<LlmSettings> | null): string {
  const fromPlugin = getPluginSecret(pluginId)?.token
  if (fromPlugin) return fromPlugin
  const fromSettings = settings?.customToolSecrets?.[pluginId]
  return fromSettings ? String(fromSettings) : ''
}

/** Resolve which id to use for secret lookup */
export function resolveMcpSecretOwnerId(server: McpServerConfig): string | undefined {
  if (server.secretPluginId) return server.secretPluginId
  if (server.pluginId && MCP_SECRET_ENV_KEYS[server.pluginId]) return server.pluginId
  return guessSecretOwnerFromServer(server) || server.pluginId
}

function guessSecretOwnerFromServer(server: McpServerConfig): string | undefined {
  const hay = `${server.id} ${server.name} ${server.pluginId || ''} ${server.secretPluginId || ''}`.toLowerCase()
  if (hay.includes('github')) return 'github-connector'
  if (hay.includes('notion')) return 'notion-connector'
  if (hay.includes('linear')) return 'linear-connector'
  if (hay.includes('figma')) return 'figma-connector'
  if (hay.includes('dropbox')) return 'dropbox-connector'
  if (hay.includes('clickup')) return 'clickup-connector'
  if (hay.includes('asana')) return 'asana-connector'
  if (hay.includes('brave')) return 'brave-search'
  if (hay.includes('postgres') || hay.includes('postgresql')) return 'postgres-dsn'
  if (hay.includes('calendar')) return 'calendar-connector'
  return undefined
}

/**
 * Return a shallow-copied server with env/authToken filled from secrets.
 * Does not mutate the stored settings object.
 */
export function enrichMcpServerWithSecrets(
  server: McpServerConfig,
  settings?: Partial<LlmSettings> | null,
): McpServerConfig {
  const secretOwner = resolveMcpSecretOwnerId(server)
  if (!secretOwner) return server

  const token = secretForPlugin(secretOwner, settings)
  if (!token) return server

  const envKeys =
    MCP_SECRET_ENV_KEYS[secretOwner] ||
    [`${secretOwner.toUpperCase().replace(/-/g, '_')}_TOKEN`]
  const env = { ...(server.env || {}) }
  let envChanged = false
  for (const key of envKeys) {
    if (!env[key]) {
      env[key] = token
      envChanged = true
    }
  }

  const authToken =
    server.transport === 'http' && !server.authToken ? token : server.authToken

  let argsChanged = false
  const args = (server.args || []).map((arg) => {
    if (arg === '${secret}' || arg === '${secretToken}' || arg === '${accessToken}') {
      argsChanged = true
      return token
    }
    return arg
  })

  if (!envChanged && !argsChanged && authToken === server.authToken) return server
  return {
    ...server,
    env: envChanged ? env : server.env,
    args: argsChanged ? args : server.args,
    authToken,
  }
}

/** True when server expects secrets but none are available */
export function mcpServerMissingSecret(
  server: McpServerConfig,
  settings?: Partial<LlmSettings> | null,
): string | null {
  const secretOwner = resolveMcpSecretOwnerId(server)
  if (!secretOwner) return null
  const needsEnv = Boolean(MCP_SECRET_ENV_KEYS[secretOwner])
  const needsArgSecret = (server.args || []).some(
    (a) => a === '${secret}' || a === '${secretToken}' || a === '${accessToken}',
  )
  if (!needsEnv && !needsArgSecret) return null
  if (secretForPlugin(secretOwner, settings)) return null
  return secretOwner
}

export function enrichMcpServers(
  servers: McpServerConfig[],
  settings?: Partial<LlmSettings> | null,
): McpServerConfig[] {
  return servers.map((s) => enrichMcpServerWithSecrets(s, settings))
}
