import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { migrateLocalIntegrationSettings, INTEGRATION_SETTINGS_KEY } from '../src/agent/integrationCredentialSettings.ts'
import { withoutIntegrationCredentials } from '../src/agent/integrationCredentials.ts'
import { redactSettingsForExport } from '../src/agent/settingsExport.ts'
import { buildMessagingPack } from '../electron/piExtensionPacks/integrations.ts'
import { configurePiHostServiceTransport, resolvePiHostServiceResponse } from '../electron/piHostServices.ts'

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'integration-migration-'))
try {
  const result = await build({
    configFile: false, logLevel: 'silent',
    resolve: { alias: { electron: path.resolve('scripts/fixtures/credential-vault-electron.mts') } },
    build: { ssr: path.resolve('scripts/fixtures/integration-migration-entry.mts'), write: false, minify: false },
  })
  assert.ok(!Array.isArray(result) && 'output' in result)
  const chunk = result.output.find((item) => item.type === 'chunk' && item.isEntry)
  assert.ok(chunk?.type === 'chunk')
  const bundle = path.join(directory, 'migration.mjs')
  await fs.writeFile(bundle, chunk.code)
  const api = await import(pathToFileURL(bundle).href) as typeof import('./fixtures/integration-migration-entry.mts')
  api.configureVaultTestEnvironment(directory, true)
  const customLegacy = {
    encryptedCustomToolSecrets: api.safeStorage.encryptString(JSON.stringify({ deploy: 'custom-MIGRATION-CANARY' })).toString('base64'),
    webhookPort: 8787,
  }
  const customFile = path.join(directory, 'custom-settings.json')
  await fs.writeFile(customFile, JSON.stringify(customLegacy))
  assert.deepEqual(api.migrateIntegrationSettingsFile(customFile), { webhookPort: 8787 })
  assert.equal(api.withIntegrationCredential('credential:custom-tool:deploy', (secret) => secret), 'custom-MIGRATION-CANARY')
  assert.doesNotMatch(await fs.readFile(customFile, 'utf8'), /CustomToolSecrets|CANARY/)
  assert.deepEqual(api.resolveSecretPlaceholders('Bearer {{secret:deploy}}'), { text: 'Bearer custom-MIGRATION-CANARY', missing: [] })
  assert.equal(api.handleCredentialVaultIntent({ action: 'rotate', ref: 'credential:custom-tool:deploy', secret: 'custom-ROTATED-CANARY' }).ok, true)
  api.migrateIntegrationCredentials(customLegacy)
  assert.equal(api.resolveSecretPlaceholders('{{secret:deploy}}').text, 'custom-ROTATED-CANARY')
  const customRestart = await import(`${pathToFileURL(bundle).href}?customRestart`) as typeof api
  customRestart.configureVaultTestEnvironment(directory, true)
  assert.equal(customRestart.resolveSecretPlaceholders('{{secret:deploy}}').text, 'custom-ROTATED-CANARY')
  assert.equal(api.handleCredentialVaultIntent({ action: 'clear', ref: 'credential:custom-tool:deploy' }).ok, true)
  assert.deepEqual(api.resolveSecretPlaceholders('{{secret:deploy}}'), { text: '', missing: ['deploy'] })
  api.handleCredentialVaultIntent({ action: 'store', kind: 'custom-tool', ownerId: 'deploy', secret: 'mcp-ARG-CANARY' })
  const shellResult = await api.credentialBash({ command: 'printf %s {{secret:deploy}}', cwd: directory, timeoutMs: 1000 })
  assert.equal(shellResult.ok, true)
  assert.equal(shellResult.stdout, '[REDACTED]')
  const cappedShell = await api.credentialBash({ command: "printf '%79995s' x; printf %s {{secret:deploy}}", cwd: directory, timeoutMs: 1000 })
  assert.equal(cappedShell.ok, true)
  assert.doesNotMatch(cappedShell.stdout, /mcp-/)
  const mcpInput = {
    id: 'credential-mcp', command: process.execPath,
    args: ['-e', `require('readline').createInterface({input:process.stdin}).on('line',line=>{const msg=JSON.parse(line);if(msg.id)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:msg.method==='initialize'?{}:{count:12345,enabled:true,content:[{type:'text',text:process.argv[1]}]}})+'\\n')})`, '{{secret:deploy}}'],
  }
  try {
    const status = await api.mcpStdioEnsure(mcpInput)
    assert.doesNotMatch(JSON.stringify(status), /mcp-ARG-CANARY/)
    const called = await api.mcpStdioCallTool({ ...mcpInput, toolName: 'echo', arguments: {} })
    assert.equal(called.ok, true)
    assert.doesNotMatch(JSON.stringify(called), /mcp-ARG-CANARY/)
  } finally { api.mcpStdioStopAll() }
  for (const secret of ['12345', 'true', '"']) {
    api.handleCredentialVaultIntent({ action: 'rotate', ref: 'credential:custom-tool:deploy', secret })
    try {
      const result = await api.mcpStdioCallTool({ ...mcpInput, toolName: 'echo', arguments: {} })
      assert.deepEqual(result, { ok: true, content: '[REDACTED]' }, 'credential redaction must preserve JSON grammar')
    } finally { api.mcpStdioStopAll() }
  }
  api.handleCredentialVaultIntent({ action: 'rotate', ref: 'credential:custom-tool:deploy', secret: '12345' })
  const scalarScope = api.createToolCredentialScope()
  scalarScope.resolve('{{secret:deploy}}')
  assert.deepEqual(scalarScope.redactValue({ number: 12345, boolean: true }), { number: '[REDACTED]', boolean: true })
  const legacy = { telegramBotToken: 'telegram-MIGRATION-CANARY', webhookToken: 'webhook-MIGRATION-CANARY', customToolSecrets: { deploy: 'custom-LOCAL-CANARY' }, webhookPort: 8787 }
  const safe = api.migrateIntegrationCredentials(legacy)
  assert.deepEqual(safe, { webhookPort: 8787 })
  assert.equal(api.withIntegrationCredential('credential:telegram:primary', (secret) => secret), legacy.telegramBotToken)
  api.handleCredentialVaultIntent({ action: 'rotate', ref: 'credential:telegram:primary', secret: 'rotated-CANARY' })
  api.migrateIntegrationCredentials(legacy)
  assert.equal(api.withIntegrationCredential('credential:telegram:primary', (secret) => secret), 'rotated-CANARY', 'retry must not overwrite a rotated vault credential')
  assert.doesNotMatch(JSON.stringify(api.handleCredentialVaultIntent({ action: 'list' })), /MIGRATION-CANARY|rotated-CANARY/)
  const locked = await import(`${pathToFileURL(bundle).href}?locked`) as typeof api
  locked.configureVaultTestEnvironment(directory, false)
  assert.throws(() => locked.migrateIntegrationCredentials(legacy), /憑證/)
  await fs.writeFile(customFile, JSON.stringify(customLegacy))
  assert.throws(() => locked.migrateIntegrationSettingsFile(customFile), /憑證/)
  assert.deepEqual(JSON.parse(await fs.readFile(customFile, 'utf8')), customLegacy)
  assert.equal(legacy.telegramBotToken, 'telegram-MIGRATION-CANARY', 'failed migration leaves source intact for retry')
  const settingsFile = path.join(directory, 'settings.json')
  await fs.writeFile(settingsFile, JSON.stringify(legacy))
  assert.throws(() => locked.migrateIntegrationSettingsFile(settingsFile), /憑證/)
  assert.match(await fs.readFile(settingsFile, 'utf8'), /MIGRATION-CANARY/)
  assert.deepEqual(api.migrateIntegrationSettingsFile(settingsFile), { webhookPort: 8787 })
  assert.doesNotMatch(await fs.readFile(settingsFile, 'utf8'), /Token|CANARY/)
  assert.doesNotMatch(await fs.readFile(`${settingsFile}.last-good`, 'utf8'), /Token|CANARY/)
  assert.deepEqual(api.migrateIntegrationSettingsFile(settingsFile), { webhookPort: 8787 })
  await fs.writeFile(`${settingsFile}.last-good`, JSON.stringify({ webhookPort: 7000 }))
  await fs.writeFile(settingsFile, '{"webhookPort":')
  assert.deepEqual(api.migrateIntegrationSettingsFile(settingsFile), { webhookPort: 7000 })
  assert.deepEqual(JSON.parse(await fs.readFile(settingsFile, 'utf8')), { webhookPort: 7000 })

  const local = new Map([[INTEGRATION_SETTINGS_KEY, JSON.stringify(legacy)]])
  const storage = { getItem: (key: string) => local.get(key) || null, setItem: (key: string, value: string) => { local.set(key, value) } }
  await assert.rejects(migrateLocalIntegrationSettings(storage, async () => ({ ok: false, error: 'locked' })), /locked/)
  assert.match(local.get(INTEGRATION_SETTINGS_KEY)!, /MIGRATION-CANARY/)
  await migrateLocalIntegrationSettings(storage, async (value) => { api.migrateIntegrationCredentials(value); return { ok: true } })
  assert.doesNotMatch(local.get(INTEGRATION_SETTINGS_KEY)!, /Token|CANARY/)
  await migrateLocalIntegrationSettings(storage, async () => { throw new Error('clean migration must not resubmit') })
  assert.doesNotMatch(JSON.stringify(withoutIntegrationCredentials(legacy)), /Token|CANARY/)
  assert.doesNotMatch(JSON.stringify(redactSettingsForExport(legacy)), /MIGRATION-CANARY/)
  let inbound: unknown
  api.setWebhookHandler((payload) => { inbound = payload })
  try {
    const status = await api.startWebhookServer({ port: 0 })
    assert.doesNotMatch(JSON.stringify(status), /CANARY/)
    const request = (token: string) => fetch(status.url!, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-Webhook-Token': token }, body: JSON.stringify({ source: 'smoke', body: 'hello' }) })
    assert.equal((await request('wrong')).status, 401)
    assert.equal((await request(legacy.webhookToken)).status, 202)
    assert.doesNotMatch(JSON.stringify(inbound), /CANARY|Bearer/)
    api.handleCredentialVaultIntent({ action: 'rotate', ref: 'credential:webhook:primary', secret: 'rotated-webhook-CANARY' })
    assert.equal((await request(legacy.webhookToken)).status, 401)
    assert.equal((await request('rotated-webhook-CANARY')).status, 202)
    api.handleCredentialVaultIntent({ action: 'clear', ref: 'credential:webhook:primary' })
    assert.equal((await request('rotated-webhook-CANARY')).status, 401, 'clearing a credential must not disable authentication')
  } finally { await api.stopWebhookServer() }
  const originalFetch = globalThis.fetch
  try {
    api.handleCredentialVaultIntent({ action: 'store', kind: 'custom-tool', ownerId: 'deploy', secret: 'custom-HTTP-CANARY' })
    globalThis.fetch = (async (_url, options) => {
      assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer custom-HTTP-CANARY')
      return new Response('echo custom-HTTP-CANARY')
    }) as typeof fetch
    const customSent = await api.credentialHttpRequest({ url: 'https://example.invalid', headers: { Authorization: 'Bearer {{secret:deploy}}' } })
    assert.equal(customSent.ok, true)
    assert.equal(customSent.text, 'echo [REDACTED]')
    globalThis.fetch = (async () => { throw new Error('echo custom-HTTP-CANARY') }) as typeof fetch
    const customFailed = await api.credentialHttpRequest({ url: 'https://example.invalid', headers: { Authorization: '{{secret:deploy}}' } })
    assert.equal(customFailed.ok, false)
    assert.doesNotMatch(JSON.stringify(customFailed), /CANARY/)
    api.handleCredentialVaultIntent({ action: 'clear', ref: 'credential:custom-tool:deploy' })
    globalThis.fetch = (async () => { assert.fail('missing credentials must not perform a request') }) as typeof fetch
    assert.equal((await api.credentialHttpRequest({ url: 'https://example.invalid', headers: { Authorization: '{{secret:deploy}}' } })).ok, false)
    globalThis.fetch = (async (url) => {
      assert.match(String(url), /botrotated-CANARY\/sendMessage$/)
      return new Response(JSON.stringify({ ok: true, result: {} }))
    }) as typeof fetch
    const sent = await api.gatewaySendMessage({ channel: 'telegram', chatId: '123', text: 'hello', runId: 'smoke' })
    assert.equal(sent.ok, true)
    assert.doesNotMatch(JSON.stringify(sent), /CANARY/)
    const servicePackets: unknown[] = []
    configurePiHostServiceTransport((packet) => {
      servicePackets.push(packet)
      assert.equal(packet.payload.service, 'messaging/send')
      const input = packet.payload.input
      void api.gatewaySendMessage({ channel: 'telegram', chatId: String(input.chatId), text: String(input.text), runId: String(input.runId) }).then((result) => {
        servicePackets.push(result)
        resolvePiHostServiceResponse({ event: 'host/service-response', payload: { id: packet.payload.id, result } })
      })
    })
    const packResult = await buildMessagingPack().tools[0].execute({ chatId: '123', text: 'hello', botToken: 'model-supplied-ignored' }, { sessionId: 'smoke', cwd: directory, runId: 'smoke' })
    assert.equal((packResult.details as { ok: boolean }).ok, true)
    assert.doesNotMatch(JSON.stringify({ servicePackets, packResult }), /CANARY|model-supplied-ignored/)
    globalThis.fetch = (async (url) => { throw new Error(String(url)) }) as typeof fetch
    const failed = await api.gatewaySendMessage({ channel: 'telegram', chatId: '123', text: 'hello' })
    assert.equal(failed.ok, false)
    assert.doesNotMatch(JSON.stringify(failed), /CANARY/)
    let downloading!: () => void
    const startedDownload = new Promise<void>((resolve) => { downloading = resolve })
    globalThis.fetch = (async (url, options) => {
      if (String(url).endsWith('/getMe')) return new Response(JSON.stringify({ ok: true, result: { username: 'smoke' } }))
      if (String(url).endsWith('/getUpdates')) return new Response(JSON.stringify({ ok: true, result: [{ update_id: 1, message: { message_id: 1, chat: { id: 123 }, document: { file_id: 'file1', file_name: 'smoke.txt' } } }] }))
      if (String(url).endsWith('/getFile')) return new Response(JSON.stringify({ ok: true, result: { file_path: 'smoke.txt' } }))
      downloading()
      return new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    }) as typeof fetch
    await api.startTelegramGateway({ allowedChatIds: '123' })
    await startedDownload
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([api.stopTelegramGateway(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('stop did not abort attachment download')), 1000) })])
    } finally { clearTimeout(timer) }
  } finally { globalThis.fetch = originalFetch }
  const clean = await import(`${pathToFileURL(bundle).href}?restart`) as typeof api
  clean.configureVaultTestEnvironment(directory, true)
  assert.equal(clean.withIntegrationCredential('credential:telegram:primary', (secret) => secret), 'rotated-CANARY')
  const blockedDirectory = path.join(directory, 'write-blocked')
  await fs.mkdir(blockedDirectory)
  const blocked = await import(`${pathToFileURL(bundle).href}?write-blocked`) as typeof api
  blocked.configureVaultTestEnvironment(blockedDirectory, true)
  assert.equal(blocked.handleCredentialVaultIntent({ action: 'list' }).ok, true)
  await fs.mkdir(path.join(blockedDirectory, 'plugin-secrets.vault'))
  const blockedFile = path.join(blockedDirectory, 'settings.json')
  await fs.writeFile(blockedFile, JSON.stringify(legacy))
  assert.throws(() => blocked.migrateIntegrationSettingsFile(blockedFile), /憑證/)
  assert.match(await fs.readFile(blockedFile, 'utf8'), /MIGRATION-CANARY/)
  const empty = blocked.handleCredentialVaultIntent({ action: 'list' })
  assert.ok(empty.ok && empty.metadata.length === 0)
  const corruptFile = path.join(directory, 'corrupt-settings.json')
  await fs.writeFile(corruptFile, 'MALFORMED-CANARY')
  assert.throws(() => api.migrateIntegrationSettingsFile(corruptFile), (error: unknown) => {
    assert.doesNotMatch(String(error), /MALFORMED-CANARY/)
    return true
  })
  // Exercise actual renderer store hydration/persistence/export with the IPC/Storage boundaries substituted.
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const previousBridge = Object.getOwnPropertyDescriptor(globalThis, 'subagents')
  local.set(INTEGRATION_SETTINGS_KEY, JSON.stringify(legacy))
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { subagents: {
    settings: { get: async () => api.migrateIntegrationSettingsFile(settingsFile), set: async (value: unknown) => { assert.doesNotMatch(JSON.stringify(value), /CANARY/); return { ok: true } } },
    credentials: { migrateLegacy: async (value: unknown) => { api.migrateIntegrationCredentials(value); return { ok: true } } },
    secrets: { list: async () => api.listVaultMeta() },
    tools: { httpRequest: async (input: { headers: Record<string, string> }) => {
      assert.equal(input.headers.Authorization, '{{secret:imported}}')
      return { ok: true, text: 'ok', status: 200 }
    } },
    piHost: { memoryProjection: { exportBundle: async () => ({ entries: [] }) } },
  } } })
  Object.defineProperty(globalThis, 'subagents', { configurable: true, value: window.subagents })
  try {
    const { useSettingsStore, mergeSettings } = await import('../src/store/settingsStore.ts')
    const rawPatch = { telegramBotToken: 'forbidden-state-CANARY', webhookToken: 'forbidden-state-CANARY', customToolSecrets: { deploy: 'forbidden-state-CANARY' } }
    assert.doesNotMatch(JSON.stringify(mergeSettings(rawPatch as never)), /customToolSecrets|telegramBotToken|webhookToken|CANARY/)
    assert.doesNotMatch(JSON.stringify(useSettingsStore.getState().settings), /CANARY/)
    await useSettingsStore.getState().load()
    assert.equal(useSettingsStore.getState().credentialMigrationError, null)
    assert.doesNotMatch(JSON.stringify(useSettingsStore.getState().settings), /CANARY/)
    await useSettingsStore.getState().update(rawPatch as never)
    assert.doesNotMatch(JSON.stringify(useSettingsStore.getState().settings), /CANARY/)
    assert.doesNotMatch(local.get(INTEGRATION_SETTINGS_KEY)!, /CANARY/)
    assert.doesNotMatch(await useSettingsStore.getState().exportBundle(), /CANARY/)
    assert.equal((await useSettingsStore.getState().importBundle(JSON.stringify({ settings: legacy }))).ok, true)
    assert.doesNotMatch(JSON.stringify(useSettingsStore.getState().settings), /customToolSecrets|telegramBotToken|webhookToken|CANARY/)
    assert.doesNotMatch(local.get(INTEGRATION_SETTINGS_KEY)!, /CANARY/)
    const imported = { customToolSecrets: { imported: 'IMPORT-CANARY' } }
    assert.equal((await useSettingsStore.getState().importBundle(JSON.stringify({ settings: imported }))).ok, true)
    const { executeCustomTool } = await import('../src/agent/tools/customTools.ts')
    const executed = await executeCustomTool({ name: 'import_test', ownerId: 'settings', kind: 'http_template', description: 'test import', params: {}, template: { url: 'https://example.invalid', headers: { Authorization: '{{secret:imported}}' } } }, {}, useSettingsStore.getState().settings)
    assert.equal(executed.ok, true, 'imported credentials must be usable immediately, without reload')
  } finally {
    if (previousBridge) Object.defineProperty(globalThis, 'subagents', previousBridge)
    else Reflect.deleteProperty(globalThis, 'subagents')
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
  console.log('Integration credential migration: vault-first, idempotent, failure-safe projection passed')
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
