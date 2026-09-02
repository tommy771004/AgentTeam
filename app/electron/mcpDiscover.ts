/** Discover common local MCP config files without copying env vars or auth headers. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type ImportedMcpServer = {
  id: string
  name: string
  enabled: boolean
  transport: 'http' | 'stdio'
  url?: string
  command?: string
  args?: string[]
}

type DiscoveryLocations = {
  home?: string
  appData?: string
}

type RawMcpConfig = {
  command?: unknown
  args?: unknown
  url?: unknown
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function parseTomlString(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      return typeof parsed === 'string' ? parsed : ''
    } catch {
      return ''
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1)
  return ''
}

function parseTomlStringArray(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return []
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return [...trimmed.matchAll(/(?:^|,)\s*(['"])(.*?)\1\s*(?=,|$)/g)]
      .map((match) => match[2])
  }
}

function readCodexToml(file: string): Record<string, RawMcpConfig> | null {
  let body = ''
  try {
    body = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }

  const servers: Record<string, RawMcpConfig> = {}
  let active: RawMcpConfig | null = null
  for (const line of body.split(/\r?\n/)) {
    const table = line.match(/^\s*\[mcp_servers\.(?:"([^"]+)"|'([^']+)'|([^\].]+))\]\s*(?:#.*)?$/)
    if (table) {
      const name = (table[1] || table[2] || table[3] || '').trim()
      active = name ? (servers[name] ||= {}) : null
      continue
    }
    if (/^\s*\[/.test(line)) {
      active = null
      continue
    }
    if (!active) continue
    const field = line.match(/^\s*(command|url|args)\s*=\s*(.*?)\s*(?:#.*)?$/)
    if (!field) continue
    if (field[1] === 'args') active.args = parseTomlStringArray(field[2])
    else active[field[1] as 'command' | 'url'] = parseTomlString(field[2])
  }
  return Object.keys(servers).length ? servers : null
}

function safeId(value: string, used: Set<string>): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const base = `mcp_${normalized.slice(0, 36) || 'server'}`
  let id = base
  let suffix = 2
  while (used.has(id)) id = `${base}_${suffix++}`
  used.add(id)
  return id
}

function importedConfig(name: string, config: RawMcpConfig, used: Set<string>): ImportedMcpServer | null {
  const url = typeof config.url === 'string' ? config.url.trim() : ''
  const command = typeof config.command === 'string' ? config.command.trim() : ''
  const args = Array.isArray(config.args)
    ? config.args.filter((item): item is string => typeof item === 'string')
    : []
  if (!url && !command) return null
  return {
    id: safeId(name, used),
    name,
    enabled: true,
    transport: url ? 'http' : 'stdio',
    ...(url ? { url } : { command, args }),
  }
}

function identity(server: ImportedMcpServer): string {
  return `${server.transport}:${server.url || server.command || ''}:${(server.args || []).join('\u0000')}`
}

function readJsonServers(file: string): Record<string, RawMcpConfig> | null {
  const data = readJson(file)
  if (!data) return null
  const raw = data.mcpServers || data.mcp
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, RawMcpConfig>
    : null
}

export function discoverMcpServers(
  projectRoot?: string,
  locations: DiscoveryLocations = {},
): { servers: ImportedMcpServer[]; sources: string[] } {
  const home = locations.home || os.homedir()
  const appData = locations.appData || process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
  const sourcesToRead: Array<{
    file: string
    read: (file: string) => Record<string, RawMcpConfig> | null
  }> = [
    { file: path.join(home, '.codex', 'config.toml'), read: readCodexToml },
    { file: path.join(home, '.claude.json'), read: readJsonServers },
    { file: path.join(home, '.claude', 'claude_desktop_config.json'), read: readJsonServers },
    { file: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), read: readJsonServers },
    { file: path.join(appData, 'Claude', 'claude_desktop_config.json'), read: readJsonServers },
    ...(projectRoot ? [{ file: path.join(projectRoot, '.mcp.json'), read: readJsonServers }] : []),
  ]

  const servers: ImportedMcpServer[] = []
  const usedIds = new Set<string>()
  const usedServers = new Set<string>()
  const sources: string[] = []
  for (const source of sourcesToRead) {
    const raw = source.read(source.file)
    if (!raw) continue
    sources.push(source.file)
    for (const [name, config] of Object.entries(raw)) {
      const server = importedConfig(name, config, usedIds)
      if (!server) continue
      const key = identity(server)
      if (usedServers.has(key)) continue
      usedServers.add(key)
      servers.push(server)
    }
  }
  return { servers, sources }
}
