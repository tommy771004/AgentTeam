import { strict as assert } from 'node:assert'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const stateDir = await mkdtemp(`${tmpdir()}/pi-runtime-`)
const entry = resolve(import.meta.dirname, '../dist-electron/pi-host.js')
const host = spawn(process.execPath, [entry], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: `${stateDir}/state.json` },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, unknown>> = []
output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, unknown>))
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((item) => item.id === id)
    if (message) return message
    await once(output, 'line')
  }
}
try {
  host.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { protocolVersion: 2 } })}\n`)
  await waitFor(1)
  host.stdin.write(`${JSON.stringify({ id: 2, method: 'runtime/status', params: {} })}\n`)
  const response = await waitFor(2)
  assert.deepEqual(response.result, {
    loaded: true,
    package: '@earendil-works/pi-coding-agent',
    version: '0.81.1',
    builtinTools: ['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write'],
  })
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi Core runtime is loaded by the Host')
