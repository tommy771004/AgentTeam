/** Discover common local MCP config files without copying env vars or auth headers. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type ImportedMcpServer = {
  id: string; name: string; enabled: boolean; transport: 'http' | 'stdio'; url?: string; command?: string; args?: string[]
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    return JSON.parse(raw) as Record<string, unknown>
  } catch { return null }
}

function safeId(value: string, used: Set<string>) {
  const base = `mcp_${value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 36) || 'server'}`
  let id = base; let suffix = 2
  while (used.has(id)) id = `${base}_${suffix++}`
  used.add(id); return id
}

export function discoverMcpServers(projectRoot?: string): { servers: ImportedMcpServer[]; sources: string[] } {
  const home = os.homedir()
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
  const paths = [
    path.join(home, '.claude', 'claude_desktop_config.json'),
    path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    path.join(appData, 'Claude', 'claude_desktop_config.json'),
    projectRoot ? path.join(projectRoot, '.mcp.json') : '',
  ].filter(Boolean)
  const servers: ImportedMcpServer[] = []; const used = new Set<string>(); const sources: string[] = []
  for (const file of paths) {
    const data = readJson(file); if (!data) continue
    const raw = (data.mcpServers || data.mcp) as Record<string, unknown> | undefined
    if (!raw || typeof raw !== 'object') continue
    sources.push(file)
    for (const [name, value] of Object.entries(raw)) {
      if (!value || typeof value !== 'object') continue
      const config = value as { command?: unknown; args?: unknown; url?: unknown; type?: unknown }
      const url = typeof config.url === 'string' ? config.url : ''
      const command = typeof config.command === 'string' ? config.command : ''
      const args = Array.isArray(config.args) ? config.args.filter((x): x is string => typeof x === 'string') : []
      if (!url && !command) continue
      servers.push({ id: safeId(name, used), name, enabled: true, transport: url ? 'http' : 'stdio', ...(url ? { url } : { command, args }) })
    }
  }
  return { servers, sources }
}
