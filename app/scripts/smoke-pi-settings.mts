import assert from 'node:assert/strict'
import { resolvePiHostStateFile } from '../electron/piHostState.ts'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

type Message = {
  id?: number
  result?: { settings?: Record<string, unknown>; profile?: Record<string, unknown> }
  error?: { code: string; message: string }
  event?: string
}

const stateDir = await mkdtemp(join(tmpdir(), 'subagents-pi-settings-'))
const agentDir = join(stateDir, 'agent')
const statePath = join(stateDir, 'state.json')
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: {
    ...process.env,
    SUBAGENTS_PI_HOST_STATE_PATH: statePath,
    SUBAGENTS_PI_AGENT_DIR: agentDir,
    SUBAGENTS_PI_NATIVE_AGENT_DIR: join(stateDir, 'native-agent'),
  },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as Message))
const waitFor = async (predicate: (message: Message) => boolean) => {
  for (;;) {
    const current = messages.find(predicate)
    if (current) return current
    await once(output, 'line')
  }
}

const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
}

try {
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor((message) => message.id === 1)
  send(2, 'settings/get')
  const defaults = await waitFor((message) => message.id === 2)
  assert.deepEqual(defaults.result?.settings, {
    provider: '',
    model: '',
    thinkingLevel: 'medium',
    activeTools: [],
    compaction: 'auto',
    approvalMode: 'auto',
    bashRequireAsk: true,
    unattended: false,
    followCliOAuthAccount: true,
    workspaceTextSearch: false,
  })

  send(3, 'settings/update', { thinkingLevel: 'extreme' })
  const invalid = await waitFor((message) => message.id === 3)
  assert.equal(invalid.error?.code, 'invalid_request')

  send(4, 'settings/update', { model: 'pi-test-model', thinkingLevel: 'high', activeTools: ['read'], approvalMode: 'full', unattended: true })
  const unconfigured = await waitFor((message) => message.id === 4)
  assert.equal(unconfigured.error?.code, 'invalid_request', 'a model without a configured provider is rejected')
  send(7, 'settings/update', { provider: 'openrouter', model: 'pi-test-model', thinkingLevel: 'high', activeTools: ['read'], approvalMode: 'full', unattended: true })
  const updated = await waitFor((message) => message.id === 7)
  assert.equal(updated.error, undefined)
  assert.equal(updated.result?.settings?.model, 'pi-test-model')
  assert.equal(updated.result?.settings?.approvalMode, 'full')
  assert.equal(updated.result?.settings?.unattended, true)

  send(6, 'settings/update', {
    provider: 'openrouter',
    model: 'stealth/ox-alpha',
    apiKey: 'openrouter-smoke-secret',
  })
  const connected = await waitFor((message) => message.id === 6)
  assert.equal(connected.result?.settings?.provider, 'openrouter')
  assert.equal(connected.result?.settings?.model, 'stealth/ox-alpha')
  assert.equal('apiKey' in (connected.result?.settings || {}), false)
  const models = JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8')) as {
    providers?: Record<string, { baseUrl?: string; models?: Array<{ id?: string }> }>
  }
  assert.equal(models.providers?.openrouter?.baseUrl, 'https://openrouter.ai/api/v1')
  assert.equal(models.providers?.openrouter?.models?.some((model) => model.id === 'stealth/ox-alpha'), true)
  const auth = JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8')) as Record<string, unknown>
  assert.deepEqual(auth.openrouter, { type: 'api_key', key: 'openrouter-smoke-secret' })
  assert.doesNotMatch(await readFile(await resolvePiHostStateFile(statePath), 'utf8'), /openrouter-smoke-secret/)

  send(5, 'settings/profile', {
    role: { model: 'pi-writer-model', thinkingLevel: 'low', activeTools: ['write'] },
    taskOverride: { thinkingLevel: 'high' },
  })
  const profile = await waitFor((message) => message.id === 5)
  assert.deepEqual(profile.result?.profile, {
    provider: 'openrouter',
    model: 'pi-writer-model',
    thinkingLevel: 'high',
    activeTools: ['write'],
    compaction: 'auto',
    approvalMode: 'full',
    bashRequireAsk: true,
    unattended: true,
    followCliOAuthAccount: true,
    workspaceTextSearch: false,
  })
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(stateDir, { recursive: true, force: true })
}

console.log('pi settings and effective profile are valid')
