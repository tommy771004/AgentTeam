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
  const legacy = { telegramBotToken: 'telegram-MIGRATION-CANARY', webhookToken: 'webhook-MIGRATION-CANARY', webhookPort: 8787 }
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
  assert.equal(legacy.telegramBotToken, 'telegram-MIGRATION-CANARY', 'failed migration leaves source intact for retry')
  const settingsFile = path.join(directory, 'settings.json')
  await fs.writeFile(settingsFile, JSON.stringify(legacy))
  assert.throws(() => locked.migrateIntegrationSettingsFile(settingsFile), /憑證/)
  assert.match(await fs.readFile(settingsFile, 'utf8'), /MIGRATION-CANARY/)
  assert.deepEqual(api.migrateIntegrationSettingsFile(settingsFile), { webhookPort: 8787 })
  assert.doesNotMatch(await fs.readFile(settingsFile, 'utf8'), /Token|CANARY/)
  assert.deepEqual(api.migrateIntegrationSettingsFile(settingsFile), { webhookPort: 8787 })

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
  local.set(INTEGRATION_SETTINGS_KEY, JSON.stringify(legacy))
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { subagents: {
    settings: { get: async () => api.migrateIntegrationSettingsFile(settingsFile), set: async (value: unknown) => { assert.doesNotMatch(JSON.stringify(value), /CANARY/); return { ok: true } } },
    credentials: { migrateLegacy: async (value: unknown) => { api.migrateIntegrationCredentials(value); return { ok: true } } },
    piHost: { memoryProjection: { exportBundle: async () => ({ entries: [] }) } },
  } } })
  try {
    const { useSettingsStore } = await import('../src/store/settingsStore.ts')
    assert.doesNotMatch(JSON.stringify(useSettingsStore.getState().settings), /CANARY/)
    await useSettingsStore.getState().load()
    assert.equal(useSettingsStore.getState().credentialMigrationError, null)
    assert.doesNotMatch(JSON.stringify(useSettingsStore.getState().settings), /CANARY/)
    await useSettingsStore.getState().update({ telegramBotToken: 'forbidden-state-CANARY', webhookToken: 'forbidden-state-CANARY' })
    assert.doesNotMatch(JSON.stringify(useSettingsStore.getState().settings), /CANARY/)
    assert.doesNotMatch(local.get(INTEGRATION_SETTINGS_KEY)!, /CANARY/)
    assert.doesNotMatch(await useSettingsStore.getState().exportBundle(), /CANARY/)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
  console.log('Integration credential migration: vault-first, idempotent, failure-safe projection passed')
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
