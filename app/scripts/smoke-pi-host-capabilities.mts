import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

type Message = { id?: number; result?: { items?: Array<{ id: string; tools?: string[]; deferred?: boolean }>; loaded?: boolean }; error?: { code: string; message: string } }
const stateDir = await mkdtemp(join(tmpdir(), 'pi-host-capabilities-'))
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json') },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as Message))
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((item) => item.id === id)
    if (message) return message
    await once(output, 'line')
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
try {
  send(1, 'initialize', { protocolVersion: 2 })
  assert.equal((await waitFor(1)).error, undefined)
  send(2, 'capabilities/list')
  const listed = await waitFor(2)
  assert.equal(listed.result?.items?.some((item) => item.id === 'core-files' && item.deferred), true)
  send(3, 'capabilities/load', { id: 'core-files' })
  const loaded = await waitFor(3)
  assert.equal(loaded.result?.loaded, true)
  assert.deepEqual(loaded.result?.items?.[0]?.tools, ['find', 'grep', 'ls', 'read'])
  send(4, 'capabilities/search', { query: 'shell' })
  assert.deepEqual((await waitFor(4)).result?.items?.map((item) => item.id), ['shell'])
  send(5, 'capabilities/load', { id: 'unknown' })
  assert.equal((await waitFor(5)).error?.code, 'invalid_request')
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi Host Capability Extension owns progressive capability activation')
