import { strict as assert } from 'node:assert'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = await mkdtemp(join(tmpdir(), 'pi-bash-stream-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-bash-stream-state-'))
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json') },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, any>> = []
output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, any>))
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((item) => item.id === id)
    if (message) return message
    await once(output, 'line')
  }
}
const waitForEvent = async (event: string) => {
  for (;;) {
    const message = messages.find((item) => item.event === event)
    if (message) return message
    await once(output, 'line')
  }
}
const send = (id: number, method: string, params: Record<string, unknown>) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
try {
  send(1, 'initialize', { protocolVersion: 1 })
  await waitFor(1)
  send(2, 'tools/bash', { cwd: root, runId: 'bash-cancel-run', command: 'printf first; sleep 1; printf never', approval: 'allow' })
  await Promise.race([
    waitForEvent('host/tool-update'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('bash update was not streamed before completion')), 500)),
  ])
  send(4, 'tools/bash', { cwd: root, runId: 'bash-cancel-run', command: 'printf second; sleep 1; printf never', approval: 'allow' })
  send(3, 'turn/cancel', { runId: 'bash-cancel-run' })
  const cancelAck = await waitFor(3)
  assert.equal(cancelAck.result?.settlement, 'cancelled')
  const settled = await waitFor(2)
  assert.equal(settled.result?.settlement, 'cancelled')
  const secondSettled = await waitFor(4)
  assert.equal(secondSettled.result?.settlement, 'cancelled')
  assert.ok(messages.some((item) => item.event === 'host/tool-update' && item.payload?.runId === 'bash-cancel-run'))
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(root, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi bash streams bounded updates and cancels through the Host Protocol')
