import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { createServer } from 'node:http'
import type { ResolvedCustomTool } from '../src/agent/tools/customTools.ts'
import { redactSettingsForExport } from '../src/agent/settingsExport.ts'
import { BUILTIN_CAPABILITIES } from '../src/agent/capabilities/builtins.ts'

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'custom-tool-credential-'))
try {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { electron: path.resolve('scripts/fixtures/credential-vault-electron.mts') } },
    build: { ssr: path.resolve('scripts/fixtures/custom-tool-credential-entry.mts'), write: false, minify: false },
  })
  assert.ok(!Array.isArray(result) && 'output' in result)
  const chunk = result.output.find((item) => item.type === 'chunk' && item.isEntry)
  assert.ok(chunk?.type === 'chunk')
  const bundle = path.join(directory, 'custom-tool.mjs')
  await fs.writeFile(bundle, chunk.code)
  const api = await import(pathToFileURL(bundle).href) as typeof import('./fixtures/custom-tool-credential-entry.mts')
  api.configureVaultTestEnvironment(directory, true)

  const legacy = { customToolSecrets: { deploy: 'deploy-MIGRATION-CANARY' }, theme: 'dark' }
  assert.deepEqual(api.migrateCustomToolCredentials(legacy), { theme: 'dark' })
  assert.equal(api.resolveSecretPlaceholders('Bearer {{secret:deploy}}').text, 'Bearer deploy-MIGRATION-CANARY')
  assert.deepEqual(api.resolveSecretPlaceholders('{{secret:missing}}').missing, ['missing'])
  assert.doesNotMatch(JSON.stringify(api.handleCredentialVaultIntent({ action: 'list' })), /MIGRATION-CANARY/)

  api.handleCredentialVaultIntent({ action: 'rotate', ref: 'credential:custom-tool:deploy', secret: 'rotated-CANARY' })
  api.migrateCustomToolCredentials(legacy)
  assert.equal(api.resolveSecretPlaceholders('{{secret:deploy}}').text, 'rotated-CANARY', 'vault wins on retry')

  const encrypted = api.encryptLegacyCustomToolSecrets({ deploy: 'encrypted-MIGRATION-CANARY' })
  const settingsFile = path.join(directory, 'settings.json')
  await fs.writeFile(settingsFile, JSON.stringify({ encryptedCustomToolSecrets: encrypted, language: 'zh-TW' }))
  assert.deepEqual(api.migrateCustomToolSettingsFile(settingsFile), { language: 'zh-TW' })
  assert.doesNotMatch(await fs.readFile(settingsFile, 'utf8'), /encryptedCustomToolSecrets|MIGRATION-CANARY/)
  assert.deepEqual(api.migrateCustomToolSettingsFile(settingsFile), { language: 'zh-TW' })

  const lockedFile = path.join(directory, 'locked.json')
  await fs.writeFile(lockedFile, JSON.stringify({ customToolSecrets: { deploy2: 'locked-MIGRATION-CANARY' } }))
  const locked = await import(`${pathToFileURL(bundle).href}?locked`) as typeof api
  locked.configureVaultTestEnvironment(directory, false)
  assert.throws(() => locked.migrateCustomToolSettingsFile(lockedFile), /安全儲存|遷移/)
  assert.match(await fs.readFile(lockedFile, 'utf8'), /locked-MIGRATION-CANARY/, 'failed migration preserves the source for retry')
  for (const name of await fs.readdir(directory)) {
    if (name === 'locked.json') continue
    const candidate = path.join(directory, name)
    if ((await fs.stat(candidate)).isFile()) assert.doesNotMatch(await fs.readFile(candidate, 'utf8'), /locked-MIGRATION-CANARY/)
  }

  const restarted = await import(`${pathToFileURL(bundle).href}?restart`) as typeof api
  restarted.configureVaultTestEnvironment(directory, true)
  assert.equal(restarted.resolveSecretPlaceholders('{{secret:deploy}}').text, 'rotated-CANARY')
  assert.doesNotMatch(JSON.stringify(redactSettingsForExport(legacy)), /MIGRATION-CANARY/)

  const bash = await restarted.executeBashTemplate({ command: `printf '%s' '{{secret:deploy}}'` }, directory)
  assert.equal(bash.ok, true)
  assert.match(bash.stdout, /\[REDACTED\]/)
  assert.doesNotMatch(JSON.stringify(bash), /rotated-CANARY/)
  const missingBash = await restarted.executeBashTemplate({ command: `printf '%s' '{{secret:missing}}'` }, directory)
  assert.equal(missingBash.ok, false)

  const server = createServer((request, response) => {
    if (request.url === '/mcp-error') response.statusCode = 500
    response.end(request.headers.authorization || '')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const http = await restarted.executeHttpTemplate({
      url: `http://127.0.0.1:${address.port}`,
      headers: { Authorization: 'Bearer {{secret:deploy}}' },
    })
    assert.equal(http.ok, true)
    assert.match(http.text, /Bearer \[REDACTED\]/)
    assert.doesNotMatch(JSON.stringify(http), /rotated-CANARY/)
    await assert.rejects(restarted.mcpHttpRpcWithSecretPlaceholders({
      url: `http://127.0.0.1:${address.port}/mcp-error`,
      headers: { Authorization: 'Bearer {{secret:deploy}}' },
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    }), (error: unknown) => {
      assert.match(String(error), /\[REDACTED\]/)
      assert.doesNotMatch(String(error), /rotated-CANARY/)
      return true
    })
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
  const bashTool = {
    id: 'smoke', ownerId: 'smoke', name: 'deploy', description: 'deploy', kind: 'bash_template',
    inputSchema: [], template: { command: `printf '%s' '{{secret:deploy}}'` },
  } as ResolvedCustomTool
  restarted.configurePiHostServiceTransport((packet) => {
    assert.equal(packet.payload.service, 'custom-tool/execute')
    const selected = packet.payload.input.toolName === 'missing'
      ? { ...bashTool, template: { command: `printf '%s' '{{secret:missing}}'` } }
      : bashTool
    void restarted.executeConfiguredCustomTool(selected, packet.payload.input.input as Record<string, unknown>, directory)
      .then((result) => restarted.resolvePiHostServiceResponse({
        event: 'host/service-response',
        payload: { id: packet.payload.id, result },
      }))
  })
  const hostResult = await restarted.buildCustomToolsPack().tools[0].execute(
    { toolName: 'deploy', input: {} },
    { sessionId: 'smoke', cwd: directory, runId: 'smoke' },
  )
  assert.equal((hostResult.details as { ok: boolean }).ok, true)
  assert.doesNotMatch(JSON.stringify(hostResult), /rotated-CANARY/)
  assert.equal(restarted.buildCustomToolsPack().capability, 'custom-tools')
  const customCapability = BUILTIN_CAPABILITIES.find((capability) => capability.id === 'custom-tools')
  assert.equal(customCapability?.deferLoading, true)
  assert.deepEqual(customCapability?.toolNames, ['custom_tool_execute'])
  const hostFailure = await restarted.buildCustomToolsPack().tools[0].execute(
    { toolName: 'missing', input: {} },
    { sessionId: 'smoke', cwd: directory, runId: 'smoke' },
  )
  assert.equal((hostFailure.details as { ok: boolean }).ok, false)
  assert.match(String(hostFailure.content[0]?.text), /"ok":false/)
  const cleared = restarted.handleCredentialVaultIntent({ action: 'clear', ref: 'credential:custom-tool:deploy' })
  assert.equal(cleared.ok, true)
  assert.deepEqual(restarted.resolveSecretPlaceholders('{{secret:deploy}}').missing, ['deploy'])
  console.log('Custom-tool credential migration: main-only resolution and failure-safe scrub passed')
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
