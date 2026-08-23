import assert from 'node:assert/strict'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = await mkdtemp(join(tmpdir(), 'pi-legacy-settings-'))
const agentDir = join(root, 'agent')
const statePath = join(root, 'state.json')
const migrationPath = join(root, 'migration.json')
const legacyPath = join(root, 'legacy-settings.json')
await writeFile(legacyPath, JSON.stringify({
  apiProvider: 'custom',
  baseUrl: 'http://127.0.0.1:4318/v1',
  model: 'legacy-model',
  apiKey: 'legacy-secret',
}))
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: {
    ...process.env,
    SUBAGENTS_PI_HOST_STATE_PATH: statePath,
    SUBAGENTS_PI_AGENT_DIR: agentDir,
    SUBAGENTS_LEGACY_SETTINGS_PATH: legacyPath,
    SUBAGENTS_PI_SETTINGS_MIGRATION_PATH: migrationPath,
  },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, unknown>> = []
output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, unknown>))
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((candidate) => candidate.id === id)
    if (message) return message
    await once(output, 'line')
  }
}
try {
  host.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { protocolVersion: 1 } })}\n`)
  const initialized = await waitFor(1)
  assert.equal(initialized.result && typeof initialized.result === 'object', true)
  const models = JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8')) as { providers?: Record<string, { baseUrl?: string; models?: Array<{ id?: string; baseUrl?: string }> }> }
  assert.equal(models.providers?.custom?.baseUrl, 'http://127.0.0.1:4318/v1')
  assert.equal(models.providers?.custom?.models?.[0]?.id, 'legacy-model')
  assert.equal(models.providers?.custom?.models?.[0]?.baseUrl, 'http://127.0.0.1:4318/v1')
  const auth = JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8')) as Record<string, unknown>
  assert.deepEqual(auth.custom, { type: 'api_key', key: 'legacy-secret' })
  const migration = JSON.parse(await readFile(migrationPath, 'utf8')) as { modelConfigPersisted?: boolean; credentialPersisted?: boolean }
  assert.equal(migration.modelConfigPersisted, true)
  assert.equal(migration.credentialPersisted, true)
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(root, { recursive: true, force: true })
}
console.log('Pi legacy custom baseUrl migrates into the Host-owned models.json')
