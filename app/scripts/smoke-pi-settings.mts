import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
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
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json') },
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
  send(1, 'initialize', { protocolVersion: 1 })
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
    unattended: false,
  })

  send(3, 'settings/update', { thinkingLevel: 'extreme' })
  const invalid = await waitFor((message) => message.id === 3)
  assert.equal(invalid.error?.code, 'invalid_request')

  send(4, 'settings/update', { model: 'pi-test-model', thinkingLevel: 'high', activeTools: ['read'], approvalMode: 'full', unattended: true })
  const updated = await waitFor((message) => message.id === 4)
  assert.equal(updated.result?.settings?.model, 'pi-test-model')
  assert.equal(updated.result?.settings?.approvalMode, 'full')
  assert.equal(updated.result?.settings?.unattended, true)

  send(5, 'settings/profile', {
    role: { model: 'pi-writer-model', thinkingLevel: 'low', activeTools: ['write'] },
    taskOverride: { thinkingLevel: 'high' },
  })
  const profile = await waitFor((message) => message.id === 5)
  assert.deepEqual(profile.result?.profile, {
    provider: '',
    model: 'pi-writer-model',
    thinkingLevel: 'high',
    activeTools: ['write'],
    compaction: 'auto',
    approvalMode: 'full',
    unattended: true,
  })
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(stateDir, { recursive: true, force: true })
}

console.log('pi settings and effective profile are valid')
