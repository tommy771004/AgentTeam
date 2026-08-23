import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

type Message = { id?: number; result?: { run?: { runId: string; status: string }; queue?: Array<{ runId: string; status: string }> }; error?: { code: string; message: string } }
const stateDir = await mkdtemp(join(tmpdir(), 'pi-host-queue-settlement-'))
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
  for (const [id, runId] of [[2, 'run-a'], [3, 'run-b']] as const) {
    send(id, 'runs/enqueue', { runId, sessionId: 'session-1', prompt: runId, trigger: 'interactive', profile: {} })
    assert.equal((await waitFor(id)).error, undefined)
  }
  send(4, 'runs/claim')
  const claimed = (await waitFor(4)).result?.run
  assert.equal(claimed?.runId, 'run-a')
  assert.equal(claimed?.status, 'running')
  send(5, 'runs/settle', { runId: 'run-a', settlement: 'answered' })
  assert.equal((await waitFor(5)).result?.queue?.find((item) => item.runId === 'run-a')?.status, 'settled')
  send(6, 'runs/claim', { runId: 'run-b' })
  assert.equal((await waitFor(6)).result?.run?.status, 'running')
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi Host Automation Extension owns queue claim and settlement')
