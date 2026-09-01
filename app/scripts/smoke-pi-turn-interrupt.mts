import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const agentDir = await mkdtemp(join(tmpdir(), 'pi-interrupt-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-interrupt-state-'))
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  for await (const _chunk of request) {
    // Consume the request before intentionally holding the model response open.
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 700))
  if (response.writableEnded) return
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((resolveListen) => modelServer.listen(0, '127.0.0.1', resolveListen))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('Loopback model server did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: {
  baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'test-key',
  models: [{ id: 'interrupt-model', name: 'Interrupt Model', reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 256 }],
} } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'interrupt-model', defaultThinkingLevel: 'off' }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir },
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
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
try {
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor(1)
  send(2, 'sessions/create', { title: 'Interrupt smoke' })
  const created = await waitFor(2)
  const sessionId = String(created.result.sessionId)
  send(3, 'turn/submit', { sessionId, runId: 'interrupt-run', cwd: process.cwd(), prompt: 'wait forever' })
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 80))
  send(30, 'turn/submit', {
    sessionId,
    runId: 'queued-after-interrupt',
    cwd: process.cwd(),
    prompt: 'continue only when explicitly started',
    mode: 'queue',
    clientMessageId: 'queued-after-interrupt',
    expectedActiveRunId: 'interrupt-run',
    profile: { threadId: 'interrupt-thread', runner: 'builtin' },
  })
  const queued = await waitFor(30)
  assert.equal(queued.result?.queued, 'queue')
  send(4, 'turn/interrupt', { runId: 'interrupt-run', reason: 'user' })
  const interruptAck = await waitFor(4)
  // The acknowledgement is immediate: the UI must not wait for settlement.
  assert.equal(interruptAck.result?.settlement, 'interrupted')
  assert.equal(interruptAck.result?.interruptReason, 'user')
  const settled = await waitFor(3)
  // A stop the user pressed is `interrupted`, never `failed` and never `cancelled`.
  assert.equal(settled.result?.settlement, 'interrupted')
  assert.equal(settled.result?.interruptReason, 'user')

  send(31, 'runs/list')
  const paused = await waitFor(31)
  const pausedItem = paused.result?.queue?.find((item: Record<string, unknown>) => item.runId === 'queued-after-interrupt')
  assert.equal(pausedItem?.status, 'queued')
  assert.equal(pausedItem?.autoStartPaused, true, 'interruption pauses automatic queue draining')
  send(32, 'runs/claim')
  assert.match(String((await waitFor(32)).error?.message || ''), /No claimable/)
  const queueRevision = Math.max(...paused.result.queue.map((item: Record<string, unknown>) => Number(item.revision || 0)))
  send(33, 'runs/start', { runId: 'queued-after-interrupt', expectedRevision: queueRevision })
  const started = await waitFor(33)
  assert.equal(started.error, undefined)
  send(34, 'runs/claim')
  assert.equal((await waitFor(34)).result?.run?.runId, 'queued-after-interrupt')

  // Interrupting a run the Host does not know is refused, not acknowledged.
  send(5, 'turn/interrupt', { runId: 'no-such-run' })
  const unknown = await waitFor(5)
  assert.equal(unknown.result, undefined)
  assert.match(String(unknown.error?.message || ''), /Unknown Pi run/)
} finally {
  host.stdin.end()
  await once(host, 'exit')
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi turn interrupt settles as interrupted(by user) through the Host Protocol')
