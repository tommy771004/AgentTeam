import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverMcpServers } from '../electron/mcpDiscover.ts'

const home = mkdtempSync(path.join(os.tmpdir(), 'agentstudio-mcp-discover-'))

try {
  mkdirSync(path.join(home, '.codex'), { recursive: true })
  writeFileSync(path.join(home, '.codex', 'config.toml'), `
[mcp_servers.codebase-memory-mcp]
command = "/opt/tools/codebase-memory-mcp"
args = ["--stdio"]
env = { API_TOKEN = "must-not-copy" }

[mcp_servers.codebase-memory-mcp.tools.search_graph]
approval_mode = "approve"
`)

  writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: {
      'codebase-memory-mcp': {
        command: '/opt/tools/codebase-memory-mcp',
        args: ['--stdio'],
        env: { API_TOKEN: 'must-not-copy' },
      },
      'remote-docs': {
        type: 'http',
        url: 'https://mcp.example.test/api',
        headers: { Authorization: 'must-not-copy' },
      },
    },
  }))

  const discovered = discoverMcpServers(undefined, { home, appData: path.join(home, 'AppData') })
  assert.deepEqual(
    discovered.servers.map(({ name, transport }) => [name, transport]),
    [
      ['codebase-memory-mcp', 'stdio'],
      ['remote-docs', 'http'],
    ],
    'Codex and Claude Code global MCP settings are imported and duplicate endpoints collapse',
  )
  assert.deepEqual(discovered.servers[0].args, ['--stdio'])
  assert.equal(JSON.stringify(discovered.servers).includes('must-not-copy'), false)
  assert.deepEqual(discovered.sources, [
    path.join(home, '.codex', 'config.toml'),
    path.join(home, '.claude.json'),
  ])
} finally {
  rmSync(home, { recursive: true, force: true })
}

console.log('MCP discovery imports Codex and Claude Code globals without secrets')
