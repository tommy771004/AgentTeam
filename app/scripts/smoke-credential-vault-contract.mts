import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import {
  createCredentialVaultAuthority,
  type CredentialVaultDriver,
} from '../electron/credentialVaultAuthority.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0

async function test(name: string, fn: () => void | Promise<void>) {
  await fn()
  console.log(`  ✓ ${name}`)
  passed += 1
}

function memoryDriver(secureStorageAvailable = true): CredentialVaultDriver & {
  records: Map<string, { secret: string; updatedAt: string }>
} {
  const records = new Map<string, { secret: string; updatedAt: string }>()
  return {
    records,
    secureStorageAvailable: () => secureStorageAvailable,
    list: () => [...records].map(([ref, record]) => ({
      ref,
      tokenHint: `…${record.secret.slice(-4)}`,
      updatedAt: record.updatedAt,
      encrypted: secureStorageAvailable,
    })),
    readForUse: (ref) => records.get(ref)?.secret || null,
    store: (ref, secret) => {
      const record = { secret, updatedAt: '2026-08-31T03:00:00.000Z' }
      records.set(ref, record)
      return { ref, tokenHint: `…${secret.slice(-4)}`, updatedAt: record.updatedAt, encrypted: true }
    },
    clear: (ref) => { records.delete(ref) },
  }
}

console.log('Credential vault contract smoke\n')

await test('store, main-only use, rotate, list, clear, and restart preserve one stable reference', () => {
  const driver = memoryDriver()
  const first = createCredentialVaultAuthority(driver)
  const original = 'telegram-token-SHOULD-NOT-LEAK'
  const stored = first.handleIntent({
    action: 'store',
    kind: 'telegram',
    ownerId: 'primary',
    secret: original,
  })
  assert.equal(stored.ok, true)
  if (!stored.ok) return
  assert.equal(stored.metadata[0]?.ref, 'credential:telegram:primary')
  assert.equal(stored.metadata[0]?.configured, true)
  assert.doesNotMatch(JSON.stringify(stored), /SHOULD-NOT-LEAK/)
  assert.equal(first.use('credential:telegram:primary', (secret) => secret.length), original.length)

  const rotated = first.handleIntent({
    action: 'rotate',
    ref: 'credential:telegram:primary',
    secret: 'rotated-telegram-9876',
  })
  assert.equal(rotated.ok, true)
  assert.doesNotMatch(JSON.stringify(rotated), /rotated-telegram/)

  const restarted = createCredentialVaultAuthority(driver)
  const listed = restarted.handleIntent({ action: 'list' })
  assert.equal(listed.ok, true)
  if (!listed.ok) return
  assert.equal(listed.metadata[0]?.tokenHint, '…9876')
  assert.equal(restarted.use('credential:telegram:primary', (secret) => secret), 'rotated-telegram-9876')

  const cleared = restarted.handleIntent({ action: 'clear', ref: 'credential:telegram:primary' })
  assert.equal(cleared.ok, true)
  assert.throws(() => restarted.use('credential:telegram:primary', () => undefined), /not configured/)
})

await test('secure-storage unavailability refuses persistence with renderer-safe reason', () => {
  const driver = memoryDriver(false)
  const vault = createCredentialVaultAuthority(driver)
  const result = vault.handleIntent({
    action: 'store',
    kind: 'webhook',
    ownerId: 'primary',
    secret: 'webhook-raw-secret',
  })
  assert.deepEqual(result, {
    ok: false,
    code: 'SECURE_STORAGE_UNAVAILABLE',
    error: 'OS 安全儲存不可用，憑證未保存',
    availability: {
      secureStorageAvailable: false,
      persistence: 'unavailable',
      reason: 'OS 安全儲存不可用，憑證未保存',
    },
  })
  assert.equal(driver.records.size, 0)
})

await test('driver failures cannot reflect raw credential material to the renderer', () => {
  const driver = memoryDriver()
  driver.store = (_ref, secret) => { throw new Error(`disk failure while writing ${secret}`) }
  const raw = 'custom-tool-secret-MUST-STAY-MAIN'
  const result = createCredentialVaultAuthority(driver).handleIntent({
    action: 'store',
    kind: 'custom-tool',
    ownerId: 'deploy',
    secret: raw,
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, 'VAULT_ERROR')
  assert.doesNotMatch(JSON.stringify(result), /MUST-STAY-MAIN/)
})

await test('typed renderer intents expose metadata only and have no raw getter', async () => {
  const driver = memoryDriver()
  const vault = createCredentialVaultAuthority(driver)
  const invalid = vault.handleIntent({ action: 'use', ref: 'credential:webhook:primary' } as never)
  assert.equal(invalid.ok, false)
  if (!invalid.ok) assert.equal(invalid.code, 'INVALID_INTENT')

  const preload = await fs.readFile(path.join(appRoot, 'electron/preload.ts'), 'utf8')
  const main = await fs.readFile(path.join(appRoot, 'electron/main.ts'), 'utf8')
  assert.match(preload, /credentials:\s*\{[\s\S]*intent:/)
  assert.doesNotMatch(preload, /credentials:\s*\{[\s\S]{0,1200}(?:get|read|use):/)
  assert.match(main, /credentials:intent/)

  const hostOwners = (await fs.readdir(path.join(appRoot, 'electron')))
    .filter((name) => /^pi.*\.ts$/.test(name)).map((name) => `electron/${name}`)
  const recordOwners = (await fs.readdir(path.join(appRoot, 'src/agent')))
    .filter((name) => /^turnRecord.*\.ts$/.test(name)).map((name) => `src/agent/${name}`)
  for (const relative of [...hostOwners, ...recordOwners]) {
    const source = await fs.readFile(path.join(appRoot, relative), 'utf8')
    assert.doesNotMatch(source, /getVaultSecret|readForUse|credentialVaultAuthority|withIntegrationCredential|integrationCredentialVault/, relative)
  }

  const settingsTypes = await fs.readFile(path.join(appRoot, 'src/agent/types.ts'), 'utf8')
  assert.match(settingsTypes, /telegramBotToken: string/)
  assert.match(settingsTypes, /webhookToken: string/)
  assert.match(settingsTypes, /customToolSecrets: Record<string, string>/)
})

await test('shipped vault survives fresh module restarts without downgrading remaining credentials', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'credential-vault-smoke-'))
  try {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { electron: path.join(appRoot, 'scripts/fixtures/credential-vault-electron.mts') } },
      build: {
        ssr: path.join(appRoot, 'scripts/fixtures/credential-vault-entry.mts'),
        write: false,
        minify: false,
      },
    })
    assert.ok(!Array.isArray(result) && 'output' in result)
    const chunk = result.output.find((item) => item.type === 'chunk' && item.isEntry)
    assert.ok(chunk && chunk.type === 'chunk')
    const bundle = path.join(directory, 'vault.mjs')
    await fs.writeFile(bundle, chunk.code)
    let revision = 0
    const restart = async (secure = true) => {
      const vault = await import(`${pathToFileURL(bundle).href}?restart=${revision++}`) as typeof import('./fixtures/credential-vault-entry.mts')
      vault.configureVaultTestEnvironment(directory, secure)
      return vault
    }
    const first = await restart()
    assert.equal(first.handleCredentialVaultIntent({ action: 'store', kind: 'telegram', ownerId: 'primary', secret: 'telegram-persistent-CANARY' }).ok, true)
    assert.equal(first.handleCredentialVaultIntent({ action: 'store', kind: 'webhook', ownerId: 'primary', secret: 'webhook-persistent-CANARY' }).ok, true)
    const second = await restart()
    const projected = second.handleCredentialVaultIntent({ action: 'list' })
    assert.equal(projected.ok, true)
    assert.doesNotMatch(JSON.stringify(projected), /telegram-persistent-CANARY|webhook-persistent-CANARY/)
    if (projected.ok) {
      assert.equal(projected.metadata.length, 2)
      assert.ok(projected.metadata.every((item) => item.configured && item.encrypted))
      assert.deepEqual(Object.keys(projected.metadata[0]).sort(), ['configured', 'encrypted', 'kind', 'ownerId', 'ref', 'tokenHint', 'updatedAt'])
    }
    assert.equal(second.withIntegrationCredential('credential:telegram:primary', (secret) => secret), 'telegram-persistent-CANARY')
    assert.equal(second.handleCredentialVaultIntent({ action: 'rotate', ref: 'credential:telegram:primary', secret: 'rotated-persistent-CANARY' }).ok, true)
    const third = await restart()
    assert.equal(third.withIntegrationCredential('credential:telegram:primary', (secret) => secret), 'rotated-persistent-CANARY')
    third.configureVaultTestEnvironment(directory, false)
    const cachedMetadata = third.handleCredentialVaultIntent({ action: 'list' })
    assert.ok(cachedMetadata.ok && cachedMetadata.metadata.every((item) => item.encrypted), 'metadata describes stored encryption, not current keychain availability')
    const cleared = third.handleCredentialVaultIntent({ action: 'clear', ref: 'credential:telegram:primary' })
    assert.equal(cleared.ok, false, 'cannot rewrite remaining credentials as plaintext when keychain goes away')
    const fourth = await restart()
    assert.equal(fourth.withIntegrationCredential('credential:telegram:primary', (secret) => secret), 'rotated-persistent-CANARY')
    assert.equal(fourth.handleCredentialVaultIntent({ action: 'clear', ref: 'credential:telegram:primary' }).ok, true)
    const fifth = await restart()
    assert.throws(() => fifth.withIntegrationCredential('credential:telegram:primary', () => undefined), /not configured/)
    assert.equal(fifth.withIntegrationCredential('credential:webhook:primary', (secret) => secret), 'webhook-persistent-CANARY')
    const locked = await restart(false)
    const lockedList = locked.handleCredentialVaultIntent({ action: 'list' })
    assert.equal(lockedList.ok, false, 'unreadable vault must not pretend it is empty')
    assert.equal(locked.handleCredentialVaultIntent({ action: 'clear', ref: 'credential:webhook:primary' }).ok, false)
    locked.configureVaultTestEnvironment(directory, true)
    assert.equal(locked.withIntegrationCredential('credential:webhook:primary', (secret) => secret), 'webhook-persistent-CANARY')
    locked.configureVaultTestEnvironment(directory, true, 'basic_text')
    const insecureBackend = locked.handleCredentialVaultIntent({ action: 'store', kind: 'custom-tool', ownerId: 'deploy', secret: 'unsafe-backend-CANARY' })
    assert.equal(insecureBackend.ok, false, 'basic_text is not OS-backed encryption')
    locked.configureVaultTestEnvironment(directory, true)
    const vaultPath = path.join(directory, 'plugin-secrets.vault')
    assert.equal((await fs.readFile(vaultPath)).includes(Buffer.from('CANARY')), false)
    const savedPath = path.join(directory, 'saved.vault')
    await fs.rename(vaultPath, savedPath)
    await fs.mkdir(vaultPath) // OS write refusal; no replacement cache may be published.
    const failedWrite = locked.handleCredentialVaultIntent({ action: 'rotate', ref: 'credential:webhook:primary', secret: 'failed-write-CANARY' })
    assert.equal(failedWrite.ok, false)
    assert.doesNotMatch(JSON.stringify(failedWrite), /CANARY/)
    assert.equal(locked.withIntegrationCredential('credential:webhook:primary', (secret) => secret), 'webhook-persistent-CANARY')
    await fs.rmdir(vaultPath)
    await fs.rename(savedPath, vaultPath)
    const recovered = await restart()
    assert.equal(recovered.withIntegrationCredential('credential:webhook:primary', (secret) => secret), 'webhook-persistent-CANARY')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

console.log(`\n${passed} credential vault contract tests passed`)
