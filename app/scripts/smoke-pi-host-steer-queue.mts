import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const agentDir = await mkdtemp(join(tmpdir(), 'pi-steer-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-steer-state-'))
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') return response.writeHead(404).end()
  for await (const _chunk of request) { /* drain */ }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000))
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(`data: ${JSON.stringify({ id: 'steer', object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
})
await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('model server did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'test', models: [{ id: 'smoke-model', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 64 }] } } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test' } }))
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], { env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir }, stdio: ['pipe', 'pipe', 'inherit'] })
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, any>> = []
output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, any>))
const waitFor = async (predicate: (message: Record<string, any>) => boolean) => { for (;;) { const found = messages.find(predicate); if (found) return found; await once(output, 'line') } }
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
try {
  send(1, 'initialize', { protocolVersion: 5, capabilities: ['agent-tree-v1'] }); await waitFor((m) => m.id === 1)
  send(2, 'sessions/create', { title: 'steer queue' }); const sessionId = String((await waitFor((m) => m.id === 2)).result.sessionId)
  send(3, 'settings/update', { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full' }); await waitFor((m) => m.id === 3)
  send(4, 'turn/submit', { sessionId, runId: 'active-run', cwd: process.cwd(), prompt: 'long task', profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full' } })
  await waitFor((m) => m.event === 'host/orchestration' && m.payload?.runId === 'active-run' && m.payload?.phase === 'iterate')
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 750))
  send(5, 'turn/submit', { sessionId, runId: 'steer-request', cwd: process.cwd(), prompt: 'stop and focus', mode: 'steer' })
  const steered = await waitFor((m) => m.id === 5)
  assert.equal(steered.result?.queued, 'steer'); assert.equal(steered.result?.runId, 'active-run')
  send(6, 'turn/submit', { sessionId, runId: 'queued-request', cwd: process.cwd(), prompt: 'run this later', mode: 'queue' })
  const queued = await waitFor((m) => m.id === 6)
  assert.equal(queued.result?.queued, 'queue'); assert.ok(queued.result?.queue?.some((item: any) => item.runId === 'queued-request'))
  assert.equal((await waitFor((m) => m.id === 4)).result?.settlement, 'answered')
  send(7, 'sessions/record', { sessionId })
  const queuedEntry = (await waitFor((m) => m.id === 7)).result?.page?.entries
    ?.find((entry: any) => entry.kind === 'agent-lifecycle' && entry.event?.runId === 'queued-request')
  assert.equal(queuedEntry?.event?.state, 'queued')
  assert.equal(queuedEntry?.turn, 2, 'an active follow-up is attributed to the upcoming turn')
  send(8, 'agents/list', { agentId: sessionId })
  assert.equal((await waitFor((m) => m.id === 8)).result?.agents?.[0]?.lifecycle, 'queued')
} finally {
  host.stdin.end(); await once(host, 'exit'); modelServer.close(); await rm(agentDir, { recursive: true, force: true }); await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi Host serializes active sessions and supports steer plus queued follow-up runs')
