import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

/**
 * A model whose reasoning consumes the entire output budget streams only
 * reasoning_content and ends with finish_reason=length — no text, no tool
 * calls. Retrying the identical prompt hits the identical wall, so this is a
 * terminal failure: the turn must settle as failed with an explanation, and
 * Goal-based orchestration must NOT spend its remaining iterations on it.
 */
const THINKING = 'The user wants an immersive grassland page. Let me plan the shader...'

const agentDir = await mkdtemp(join(tmpdir(), 'pi-length-cap-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-length-cap-state-'))

let completions = 0
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const chunk = (delta: unknown, finish: string | null) => sse({
  id: `length-cap-${completions}`,
  object: 'chat.completion.chunk',
  model: 'stealth-model',
  choices: [{ index: 0, delta, finish_reason: finish }],
})
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  for await (const part of request) void part
  completions += 1
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  response.write(chunk({ role: 'assistant', reasoning_content: THINKING }, null))
  response.write(chunk({}, 'length'))
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((resolveListen) => modelServer.listen(0, '127.0.0.1', resolveListen))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('Loopback model server did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({
  providers: {
    loopback: {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      api: 'openai-completions',
      apiKey: 'test-key-placeholder',
      models: [{ id: 'stealth-model', name: 'Stealth Model', reasoning: false, input: ['text'], contextWindow: 128_000 }],
    },
  },
}))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'stealth-model', defaultThinkingLevel: 'off' }))

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
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for host response ${id}`)), 10_000)),
    ])
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)

try {
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor(1)
  send(2, 'sessions/create', { title: 'Length cap smoke' })
  const created = await waitFor(2)
  send(3, 'turn/submit', {
    sessionId: String(created.result.sessionId),
    runId: 'length-cap-run',
    cwd: process.cwd(),
    prompt: '做一個草原網頁',
    pattern: 'Goal-based',
    maxIterations: 3,
    definitionOfDone: 'non-empty assistant result',
    profile: { provider: 'loopback', model: 'stealth-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false },
  })
  const settled = await waitFor(3)
  // Terminal failure with an explanation, not a silent empty. The notice
  // travels as the turn's result, projected back as the assistant message.
  assert.equal(settled.result.settlement, 'truncated')
  const text = String(
    settled.result.items?.find((item: { type?: string }) => item?.type === 'assistant_message')?.content
      ?? (settled.result.items?.[0]?.content || ''),
  )
  assert.match(text, /maxTokens/)
  assert.match(text, /截斷|用盡/)
  // The orchestrator must not burn its remaining iterations on the same wall.
  assert.equal(completions, 1, `expected exactly 1 model call, saw ${completions}`)
} finally {
  host.stdin.end()
  await once(host, 'exit')
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}

console.log('A length-truncated turn settles as an explained failure and stops the goal loop')
