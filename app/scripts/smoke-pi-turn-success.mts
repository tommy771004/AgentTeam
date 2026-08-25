import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const agentDir = await mkdtemp(join(tmpdir(), 'pi-turn-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-turn-success-state-'))
let requestSeen = false
let requestBody: { tools?: unknown[] } | undefined
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  requestSeen = true
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { tools?: unknown[] }
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  response.write(`data: ${JSON.stringify({ id: 'smoke-completion', object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'hello from Pi' }, finish_reason: null }] })}\n\n`)
  response.write(`data: ${JSON.stringify({ id: 'smoke-completion', object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((resolveListen) => modelServer.listen(0, '127.0.0.1', resolveListen))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('Loopback model server did not bind')
const baseUrl = `http://127.0.0.1:${address.port}/v1`
await writeFile(join(agentDir, 'models.json'), JSON.stringify({
  providers: {
    loopback: {
      baseUrl,
      api: 'openai-completions',
      apiKey: 'test-key',
      models: [{ id: 'smoke-model', name: 'Smoke Model', reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 256 }],
    },
  },
}))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, any>> = []
output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, any>))
const waitFor = async (predicate: (message: Record<string, any>) => boolean) => {
  for (;;) {
    const current = messages.find(predicate)
    if (current) return current
    await once(output, 'line')
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)

try {
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor((message) => message.id === 1)
  send(2, 'sessions/create', { title: 'Success smoke' })
  const created = await waitFor((message) => message.id === 2)
  const sessionId = String(created.result.sessionId)
  send(3, 'settings/update', { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: ['read'] })
  await waitFor((message) => message.id === 3)
  send(4, 'turn/submit', {
    sessionId,
    runId: 'smoke-success-run',
    cwd: process.cwd(),
    prompt: 'say hello',
    profile: {
      provider: 'loopback',
      model: 'smoke-model',
      thinkingLevel: 'off',
      activeTools: ['grep'],
      compaction: 'auto',
      approvalMode: 'full',
      unattended: false,
    },
  })
  const settled = await waitFor((message) => message.id === 4)
  assert.equal(settled.result.settlement, 'answered')
  assert.equal(settled.result.items[0].type, 'assistant_message')
  assert.equal(settled.result.items[0].content, 'hello from Pi')
  assert.equal(requestSeen, true)
  // A restricted allowlist exposes grep plus the ALWAYS-ON pack tools —
  // and never a capability-gated tool whose capability has not loaded.
  const names = (requestBody?.tools || []).map((tool: { function?: { name?: string } }) => tool?.function?.name)
  const ALWAYS_ON = ['ask_user', 'update_plan', 'datetime_now', 'table_parse', 'json_extract_lite', 'tool_output_read', 'load_capability', 'tool_search', 'run_code']
  assert.equal(names.includes('grep'), true)
  assert.ok(names.every((name: string) => name === 'grep' || ALWAYS_ON.includes(name)), `unexpected tools in restricted turn: ${names.join(', ')}`)
  assert.equal(names.includes('http_fetch'), false, 'capability-gated tools stay out until loaded')
  send(5, 'sessions/list')
  const listed = await waitFor((message) => message.id === 5)
  const projected = listed.result.sessions.find((candidate: { id: string }) => candidate.id === sessionId)
  assert.deepEqual(projected.messages, [
    { role: 'user', content: 'say hello' },
    { role: 'assistant', content: 'hello from Pi' },
  ])
} finally {
  host.stdin.end()
  await once(host, 'exit')
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi successful turn uses the configured Pi model through the Host Protocol')
