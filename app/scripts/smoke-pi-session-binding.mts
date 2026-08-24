import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type HostMessage = {
  id?: string | number
  result?: { sessionId?: string; sessions?: Array<{ id: string; threadId?: string }> }
  error?: { code: string; message: string }
}

const hostEntry = process.env.PI_HOST_ENTRY || resolve(import.meta.dirname, '../dist-electron/pi-host.js')
const stateDir = await mkdtemp(join(tmpdir(), 'pi-session-binding-'))
const host = spawn(process.execPath, [hostEntry], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json') },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: HostMessage[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as HostMessage))
const waitFor = async (id: number) => {
  for (;;) {
    const current = messages.find((message) => message.id === id)
    if (current) return current
    await once(output, 'line')
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
}

try {
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor(1)
  send(2, 'sessions/create', { title: 'Binding smoke', threadId: 'thread-binding-smoke' })
  const created = await waitFor(2)
  assert.equal(created.error, undefined)
  assert.equal(created.result?.sessions?.[0]?.threadId, 'thread-binding-smoke')
  send(3, 'sessions/list')
  const listed = await waitFor(3)
  assert.equal(listed.result?.sessions?.find((session) => session.threadId === 'thread-binding-smoke')?.id, created.result?.sessionId)
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(stateDir, { recursive: true, force: true })
}

console.log('Pi Host keeps a durable thread-to-session binding')
