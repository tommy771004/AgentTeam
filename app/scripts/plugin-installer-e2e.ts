import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  configurePluginInstallerDir,
  installPlugin,
  pluginCatalog,
  pluginHealth,
  uninstallPlugin,
} from '../electron/pluginInstaller'
import {
  OAUTH_REDIRECT_URI,
  oauthProviderForPlugin,
  PLUGIN_OAUTH_PROVIDERS,
} from '../src/agent/hermes/pluginOAuth'
import { secretNeedsRefresh, type PluginSecretRecord } from '../src/agent/hermes/pluginSecrets'
import {
  clickupConnectorTools,
  githubConnectorTools,
} from '../src/agent/hermes/connectorTools'
import {
  enrichMcpServerWithSecrets,
  resolveMcpSecretOwnerId,
} from '../src/agent/hermes/mcpSecrets'
import { setPluginSecret, clearPluginSecret } from '../src/agent/hermes/pluginSecrets'
import type { McpServerConfig } from '../src/agent/types'
import { pluginRegistry } from '../src/agent/hermes/plugins'
import { buildIntentPreloadIds } from '../src/agent/intentPreload'
import { DEFAULT_LLM_SETTINGS } from '../src/agent/llm'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subagents-plugin-e2e-'))
configurePluginInstallerDir(path.join(root, 'plugins'))

async function main() {
  const catalog = pluginCatalog()
  assert.ok(catalog.some((item) => item.id === 'web-reader'))
  assert.ok(catalog.some((item) => item.id === 'filesystem-mcp'))
  const ghMcp = catalog.find((item) => item.id === 'github-mcp')
  assert.ok(ghMcp, 'github-mcp catalog entry')
  assert.equal((ghMcp as { secretPluginId?: string }).secretPluginId, 'github-connector')
  for (const id of [
    'notion-mcp',
    'figma-mcp',
    'brave-search-mcp',
    'puppeteer-mcp',
    'postgres-mcp',
    'brave-search',
    'postgres-dsn',
  ]) {
    assert.ok(
      catalog.some((item) => item.id === id),
      `missing catalog entry ${id}`,
    )
  }
  console.log('✓ expanded one-click MCP catalog')

  const bundled = await installPlugin({ id: 'web-reader' })
  assert.equal(bundled.ok, true)
  assert.equal(bundled.installed, true)
  const bundledHealth = await pluginHealth('web-reader')
  assert.equal(bundledHealth.healthy, true)
  await uninstallPlugin('web-reader')
  console.log('✓ bundled plugin install / health / uninstall')

  // OAuth provider map sanity
  assert.ok(PLUGIN_OAUTH_PROVIDERS['github-connector']?.flow === 'device')
  assert.ok(PLUGIN_OAUTH_PROVIDERS['notion-connector']?.flow === 'code')
  assert.ok(oauthProviderForPlugin('github-connector')?.deviceCodeUrl)
  assert.match(OAUTH_REDIRECT_URI, /^http:\/\/127\.0\.0\.1:19789\/oauth\/callback$/)
  // refresh heuristics
  const withRefresh: PluginSecretRecord = {
    token: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 60_000,
    updatedAt: new Date().toISOString(),
  }
  assert.equal(secretNeedsRefresh(withRefresh, 5 * 60_000), true) // within 5m skew
  assert.equal(
    secretNeedsRefresh({ ...withRefresh, expiresAt: Date.now() + 20 * 60_000 }, 5 * 60_000),
    false,
  )
  assert.equal(secretNeedsRefresh({ token: 'a', updatedAt: '' }, 0), false)
  console.log('✓ oauth provider configs + refresh heuristics')

  // Connector tools must exist in catalog surface
  assert.ok(githubConnectorTools().some((t) => t.name === 'github_list_issues'))
  assert.ok(clickupConnectorTools().some((t) => t.name === 'clickup_list_tasks'))
  console.log('✓ connector HTTP tools defined')

  // MCP configuration carries references; main resolves them at process spawn.
  setPluginSecret('github-connector', 'ghp_test_secret_token')
  const enriched = enrichMcpServerWithSecrets({
    id: 'mcp-github',
    name: 'GitHub MCP',
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    pluginId: 'github-connector',
    env: { ELECTRON_RUN_AS_NODE: '1' },
  })
  assert.equal(enriched.env?.GITHUB_PERSONAL_ACCESS_TOKEN, '{{secret:github-connector}}')
  assert.equal(enriched.env?.GITHUB_TOKEN, '{{secret:github-connector}}')
  clearPluginSecret('github-connector')
  // Postgres-style args placeholder
  setPluginSecret('postgres-dsn', 'postgresql://readonly@localhost/db')
  const pg = enrichMcpServerWithSecrets({
    id: 'plugin-postgres-mcp',
    name: 'PostgreSQL MCP',
    enabled: true,
    transport: 'stdio',
    command: 'node',
    args: ['${secret}'],
    pluginId: 'postgres-dsn',
  })
  assert.equal(pg.args?.[0], '{{secret:postgres-dsn}}')
  clearPluginSecret('postgres-dsn')
  console.log('✓ MCP credential-reference env injection + args ${secret}')

  // Regression: package pluginId must not steal secret ownership after "sync"
  setPluginSecret('github-connector', 'ghp_sync_regression_token')
  const afterSyncLike: McpServerConfig = {
    id: 'plugin-github-mcp',
    name: 'GitHub MCP',
    enabled: true,
    transport: 'stdio',
    command: 'node',
    args: [],
    pluginId: 'github-mcp', // package owner (learningStore sets this)
    secretPluginId: 'github-connector', // must be preserved
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      GITHUB_PERSONAL_ACCESS_TOKEN: '',
      GITHUB_TOKEN: '',
    },
  }
  assert.equal(resolveMcpSecretOwnerId(afterSyncLike), 'github-connector')
  const filled = enrichMcpServerWithSecrets(afterSyncLike)
  assert.equal(filled.env?.GITHUB_TOKEN, '{{secret:github-connector}}')
  assert.equal(filled.env?.GITHUB_PERSONAL_ACCESS_TOKEN, '{{secret:github-connector}}')
  // Legacy broken shape: only pluginId=package, no secretPluginId — guess still works
  const legacyBroken: McpServerConfig = {
    ...afterSyncLike,
    secretPluginId: undefined,
    pluginId: 'github-mcp',
  }
  assert.equal(resolveMcpSecretOwnerId(legacyBroken), 'github-connector')
  clearPluginSecret('github-connector')
  console.log('✓ secretPluginId survives package pluginId (sync regression)')

  // Connector → setup-required stub on disk (with tools on manifest)
  const connector = await installPlugin({ id: 'notion-connector' })
  assert.equal(connector.ok, true)
  assert.equal(connector.installed, true)
  assert.equal(connector.requiresSetup, true)
  assert.ok(connector.manifest?.id === 'notion-connector')
  assert.ok(
    Array.isArray(connector.manifest?.customTools) && connector.manifest.customTools.length > 0,
    'connector stub should ship customTools',
  )
  const connectorHealth = await pluginHealth('notion-connector')
  assert.equal(connectorHealth.installed, true)
  assert.equal(connectorHealth.healthy, false)
  assert.equal(connectorHealth.status, 'setup-required')
  await uninstallPlugin('notion-connector')
  const after = await pluginHealth('notion-connector')
  assert.equal(after.installed, false)
  console.log('✓ connector setup stub / tools / health / uninstall')

  // Intent preload includes plugin user: id when enabled
  pluginRegistry.add({
    id: 'github-connector',
    name: 'GitHub',
    enabled: true,
    customTools: githubConnectorTools(),
  })
  const preload = buildIntentPreloadIds(
    'List open GitHub pull requests for my repo',
    { ...DEFAULT_LLM_SETTINGS, functionCalling: true },
    null,
  )
  assert.ok(preload.includes('user:github-connector'), `preload=${preload.join(',')}`)
  console.log('✓ intent preload v2 scores connector plugins')

  if (process.argv.includes('--network')) {
    const mcp = await installPlugin({
      id: 'filesystem-mcp',
      projectRoot: process.cwd(),
    })
    if (!mcp.ok) console.error(mcp.log || mcp.health || mcp.error)
    assert.equal(mcp.installed, true)
    assert.equal(mcp.ok, true)
    assert.ok(Array.isArray(mcp.health?.tools) && mcp.health.tools.length > 0)
    await uninstallPlugin('filesystem-mcp')
    console.log(`✓ npm MCP install / handshake / ${mcp.health.tools.length} tools / uninstall`)
  }
}

try {
  await main()
  console.log('Plugin installer E2E passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
