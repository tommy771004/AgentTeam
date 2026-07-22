import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

type Message = {
  id?: number
  result?: { memories?: Array<{ id: string; text: string; tags: string[]; project?: string }> }
  error?: { code: string; message: string }
}

const stateDir = await mkdtemp(join(tmpdir(), 'pi-host-memory-'))
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
  send(1, 'initialize', { protocolVersion: 1 })
  assert.equal((await waitFor(1)).error, undefined)
  send(2, 'memory/add', { memory: { id: 'pref-language', project: 'demo', text: 'Use Traditional Chinese UI copy', tags: ['preference'], createdAt: '2026-07-22T00:00:00.000Z' } })
  assert.equal((await waitFor(2)).error, undefined)
  send(3, 'memory/recall', { query: 'traditional', project: 'demo' })
  assert.deepEqual((await waitFor(3)).result?.memories, [{ id: 'pref-language', project: 'demo', text: 'Use Traditional Chinese UI copy', tags: ['preference'], createdAt: '2026-07-22T00:00:00.000Z' }])
  send(4, 'memory/list')
  assert.equal((await waitFor(4)).result?.memories?.length, 1)
  send(5, 'memory/add', { memory: { id: 'pref-language', project: 'demo', text: 'Use Traditional Chinese UI copy', tags: ['preference', 'ui'], createdAt: '2026-07-22T00:00:00.000Z' } })
  assert.equal((await waitFor(5)).error, undefined)
  send(6, 'memory/recall', { query: 'ui' })
  assert.equal((await waitFor(6)).result?.memories?.[0]?.tags.includes('ui'), true)
  host.stdin.end()
  await once(host, 'exit')
  const restarted = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
    env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json') },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const restartedOutput = createInterface({ input: restarted.stdout })
  const restartedMessages: Message[] = []
  restartedOutput.on('line', (line) => restartedMessages.push(JSON.parse(line) as Message))
  const restartedWaitFor = async (id: number) => {
    for (;;) {
      const message = restartedMessages.find((item) => item.id === id)
      if (message) return message
      await once(restartedOutput, 'line')
    }
  }
  restarted.stdin.write(`${JSON.stringify({ id: 7, method: 'initialize', params: { protocolVersion: 1 } })}\n`)
  assert.equal((await restartedWaitFor(7)).error, undefined)
  restarted.stdin.write(`${JSON.stringify({ id: 8, method: 'memory/list', params: {} })}\n`)
  assert.equal((await restartedWaitFor(8)).result?.memories?.[0]?.id, 'pref-language')
  restarted.stdin.end()
  await once(restarted, 'exit')
} finally {
  if (host.exitCode === null) {
    host.stdin.end()
    await once(host, 'exit')
  }
  await rm(stateDir, { recursive: true, force: true })
}

console.log('Pi Host Memory Extension owns durable recall')
