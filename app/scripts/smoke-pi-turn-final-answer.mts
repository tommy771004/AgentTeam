import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

/**
 * A tool-using turn narrates before it works and concludes after. The turn is
 * settled by its LAST assistant message: reading the first one published the
 * preamble ("我先探索…") into the chat bubble and ate the conclusion.
 */
const PREAMBLE = '我先探索本地專案結構。'
const CONCLUSION = '結論：Pi Core 由 Host 擁有迴圈。'

const agentDir = await mkdtemp(join(tmpdir(), 'pi-final-answer-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-final-answer-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-final-answer-cwd-'))
await writeFile(join(workspace, 'notes.md'), '# Notes\nPi Core is active\n')

let completions = 0
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const chunk = (delta: unknown, finish: string | null) => sse({
  id: 'final-answer-completion',
  object: 'chat.completion.chunk',
  model: 'smoke-model',
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
  if (completions === 1) {
    response.write(chunk({ role: 'assistant', content: PREAMBLE }, null))
    response.write(chunk({
      tool_calls: [{
        index: 0,
        id: 'call_grep_1',
        type: 'function',
        function: { name: 'grep', arguments: JSON.stringify({ pattern: 'Pi Core', path: '.' }) },
      }],
    }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: CONCLUSION }, null))
    response.write(chunk({}, 'stop'))
  }
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
  send(2, 'sessions/create', { title: 'Final answer smoke' })
  const created = await waitFor((message) => message.id === 2)
  const sessionId = String(created.result.sessionId)
  send(3, 'settings/update', { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: ['grep'] })
  await waitFor((message) => message.id === 3)
  send(4, 'turn/submit', {
    sessionId,
    runId: 'smoke-final-answer-run',
    cwd: workspace,
    prompt: '分析這個專案',
    profile: {
      provider: 'loopback',
      model: 'smoke-model',
      thinkingLevel: 'off',
      activeTools: ['grep'],
      compaction: 'manual',
      approvalMode: 'full',
      unattended: true,
    },
  })
  const settled = await waitFor((message) => message.id === 4)
  if (!settled.result) throw new Error(`turn/submit failed: ${JSON.stringify(settled)}`)
  assert.equal(settled.result.settlement, 'answered')
  assert.ok(completions >= 2, `expected a tool round-trip, saw ${completions} completions`)
  const answers = settled.result.items.filter((item: { type?: string }) => item?.type === 'assistant_message')
  assert.equal(answers.length, 1)
  assert.equal(answers[0].content, CONCLUSION)
  send(5, 'sessions/list')
  const listed = await waitFor((message) => message.id === 5)
  const projected = listed.result.sessions.find((candidate: { id: string }) => candidate.id === sessionId)
  // History is derived from the Turn Record, so it carries what the agent DID
  // as well as what it said — in the order it happened.
  assert.deepEqual(projected.messages, [
    { role: 'user', content: '分析這個專案' },
    { role: 'tool', content: '→ grep(call_grep_1)' },
    { role: 'tool', content: '← grep(call_grep_1) success' },
    { role: 'assistant', content: CONCLUSION },
  ])
} finally {
  host.stdin.end()
  await once(host, 'exit')
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}
console.log('Pi turn settles on its final assistant message, not its opening narration')
