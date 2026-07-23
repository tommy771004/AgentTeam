import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const agentDir = await mkdtemp(join(tmpdir(), 'pi-orchestration-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-orchestration-state-'))
let requests = 0
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') return response.writeHead(404).end()
  let body = ''
  for await (const chunk of request) body += String(chunk)
  requests += 1
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const content = body.includes('never complete') ? '' : requests === 1 ? '' : `iteration-${requests}`
  response.end(`data: ${JSON.stringify({ id: `orch-${requests}`, object: 'chat.completion.chunk', model: 'orchestration-model', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: `orch-${requests}`, object: 'chat.completion.chunk', model: 'orchestration-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
})
await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('model server did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: {
  baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'test-key',
  models: [{ id: 'orchestration-model', name: 'Orchestration Model', reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 256 }],
} } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'orchestration-model', defaultThinkingLevel: 'off' }))

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
    await Promise.race([
      once(output, 'line'),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for host response ${id}: ${JSON.stringify(messages)}`)), 5_000)),
    ])
  }
}
try {
  host.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { protocolVersion: 1 } })}\n`)
  await waitFor(1)
  host.stdin.write(`${JSON.stringify({ id: 2, method: 'sessions/create', params: { title: 'Orchestration smoke' } })}\n`)
  const created = await waitFor(2)
  const sessionId = String(created.result.sessionId)
  host.stdin.write(`${JSON.stringify({ id: 3, method: 'turn/submit', params: { sessionId, runId: 'orchestration-run', cwd: process.cwd(), prompt: 'complete the goal', pattern: 'Goal-based', maxIterations: 2, definitionOfDone: 'two successful Pi turns', profile: { provider: 'loopback', model: 'orchestration-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false } } })}\n`)
  const settled = await waitFor(3)
  assert.equal(settled.result.settlement, 'success')
  assert.deepEqual(settled.result.orchestration, { pattern: 'Goal-based', iterations: 2, maxIterations: 2, definitionOfDone: 'two successful Pi turns', dodMet: true })
  assert.equal(requests, 2)
  assert.equal(messages.filter((item) => item.event === 'host/turn-item').length > 0, true)
  assert.deepEqual(
    messages.filter((item) => item.event === 'host/orchestration').map((item) => item.payload.phase),
    ['parse', 'iterate', 'dod', 'replan', 'iterate', 'dod', 'settlement'],
  )
  host.stdin.write(`${JSON.stringify({ id: 4, method: 'sessions/create', params: { title: 'Unmet DoD smoke' } })}\n`)
  const unmetSession = await waitFor(4)
  host.stdin.write(`${JSON.stringify({ id: 5, method: 'turn/submit', params: { sessionId: String(unmetSession.result.sessionId), runId: 'unmet-run', cwd: process.cwd(), prompt: 'never complete', pattern: 'Goal-based', maxIterations: 2, definitionOfDone: 'non-empty assistant result', profile: { provider: 'loopback', model: 'orchestration-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false } } })}\n`)
  const unmet = await waitFor(5)
  assert.equal(unmet.result.settlement, 'failed')
  assert.deepEqual(unmet.result.orchestration, { pattern: 'Goal-based', iterations: 2, maxIterations: 2, definitionOfDone: 'non-empty assistant result', dodMet: false })
  assert.deepEqual(messages.filter((item) => item.event === 'host/orchestration' && item.payload?.runId === 'unmet-run').map((item) => item.payload.phase), ['parse', 'iterate', 'dod', 'replan', 'iterate', 'dod', 'settlement'])
} finally {
  host.stdin.end()
  await once(host, 'exit')
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi Host owns bounded Goal-based orchestration and exposes iteration settlement')
