import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

type Message = { id?: number; result?: { sessionId?: string; queue?: Array<{ runId: string; status: string; revision?: number; createdAt?: number; updatedAt?: number; [key: string]: unknown }> }; error?: { code: string; message: string } }
const stateDir = await mkdtemp(join(tmpdir(), 'pi-host-queue-'))
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
  await waitFor(1)
  send(2, 'sessions/create', { title: 'scheduled queue' })
  const sessionId = String((await waitFor(2)).result?.sessionId)
  send(3, 'runs/enqueue', { runId: 'queued-run-1', sessionId, prompt: 'queued prompt', trigger: 'time', evidence: 'schedule-claim', profile: { model: 'm1' } })
  const enqueued = await waitFor(3)
  assert.equal(enqueued.error, undefined)
  const accepted = enqueued.result?.queue?.[0]
  assert.deepEqual({ ...accepted, revision: undefined, createdAt: undefined, updatedAt: undefined }, { runId: 'queued-run-1', sessionId, prompt: 'queued prompt', trigger: 'time', evidence: 'schedule-claim', profile: { model: 'm1' }, status: 'queued', revision: undefined, createdAt: undefined, updatedAt: undefined })
  assert.equal(typeof accepted?.revision, 'number')
  assert.equal(typeof accepted?.createdAt, 'number')
  assert.equal(typeof accepted?.updatedAt, 'number')
  send(4, 'runs/enqueue', { runId: 'queued-run-1', sessionId, prompt: 'duplicate', trigger: 'interactive', profile: {} })
  assert.equal((await waitFor(4)).error?.code, 'invalid_request')
  send(5, 'runs/cancel', { runId: 'queued-run-1' })
  assert.equal((await waitFor(5)).result?.queue?.[0]?.status, 'interrupted')
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(stateDir, { recursive: true, force: true })
}

console.log('Pi Host Automation Extension owns durable queued-run admission')
