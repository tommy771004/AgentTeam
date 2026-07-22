import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'

type HostMessage = {
  id?: string | number
  result?: { protocolVersion?: number; capabilities?: string[]; status?: string }
  error?: { code: string; message: string }
  event?: string
}

const hostEntry = process.env.PI_HOST_ENTRY || resolve(import.meta.dirname, '../dist-electron/pi-host.js')
const hostArgs = hostEntry.endsWith('.ts') ? ['--experimental-strip-types', hostEntry] : [hostEntry]
const host = spawn(process.execPath, hostArgs, {
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: HostMessage[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as HostMessage))

const waitFor = async (predicate: (message: HostMessage) => boolean): Promise<HostMessage> => {
  for (;;) {
    const current = messages.find(predicate)
    if (current) return current
    await once(output, 'line')
  }
}

host.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { protocolVersion: 1, client: 'smoke' } })}\n`)
const initialized = await waitFor((message) => message.id === 1)
assert.deepEqual(initialized.result, {
  protocolVersion: 1,
  capabilities: ['health', 'settings', 'sessions', 'turns', 'runtime', 'tools', 'events', 'automation', 'resources'],
  status: 'ready',
})

host.stdin.write(`${JSON.stringify({ id: 2, method: 'health/get', params: {} })}\n`)
const health = await waitFor((message) => message.id === 2)
assert.equal(health.result?.status, 'ready')

host.stdin.write(`${JSON.stringify({ id: 3, method: 'initialize', params: { protocolVersion: 99 } })}\n`)
const rejected = await waitFor((message) => message.id === 3)
assert.deepEqual(rejected.error, {
  code: 'protocol_mismatch',
  message: 'Unsupported Pi Host Protocol version: 99',
})

host.stdin.end()
await once(host, 'exit')
console.log('pi host protocol handshake is valid')
