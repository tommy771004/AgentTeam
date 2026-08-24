import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { piTurnFinalAnswer, piTurnOutcome } from '../src/agent/piHostRun.ts'

/**
 * A stopped turn hands back the answer so far, not a weld of everything the
 * model ever said. The opening narration belongs to the execution feed; the
 * answer position holds only the last thing the assistant was actually
 * writing. Both survive — as two different things.
 */

const NARRATION = '我先探索本地專案結構。'
const PARTIAL = '部分結論：Host 擁有迴圈'

// ── The boundary rule, as a pure derivation ────────────────────────────────
// Streamed deltas belong to the message that produced them. A tool call ends
// one assistant message, so deltas after it are a new message — never an
// extension of the narration before it.
assert.equal(
  piTurnFinalAnswer([
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: NARRATION } },
    { type: 'tool_execution_start', toolName: 'grep', toolCallId: 'call_1' },
    { type: 'tool_execution_end', toolName: 'grep', isError: false },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: PARTIAL } },
  ]),
  PARTIAL,
)
// An explicit message boundary separates them just as well.
assert.equal(
  piTurnFinalAnswer([
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: NARRATION } },
    { type: 'message_start' },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '第二段' } },
  ]),
  '第二段',
)
// Deltas of ONE message still assemble into that whole message.
assert.equal(
  piTurnFinalAnswer([
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '部分' } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '結論' } },
  ]),
  '部分結論',
)
// Completed assistant messages keep their own rule: the last one wins.
assert.equal(
  piTurnFinalAnswer([
    { type: 'assistant_message', content: NARRATION },
    { type: 'assistant_message', content: PARTIAL },
  ]),
  PARTIAL,
)

// A stop that caught nothing at all is still a stop — never an empty turn's
// wording, and never a success.
const stoppedWithNothing = piTurnOutcome('interrupted', { answer: '', interruptReason: 'user' })
const timedOutWithNothing = piTurnOutcome('interrupted', { answer: '', interruptReason: 'timeout' })
assert.equal(stoppedWithNothing.status, 'halted')
assert.equal(timedOutWithNothing.status, 'halted')
assert.notEqual(stoppedWithNothing.text, timedOutWithNothing.text)
assert.ok(!/沒有產出任何內容/.test(stoppedWithNothing.text), 'a stop never borrows the empty-turn wording')

// ── The Host keeps that boundary through a real stop ───────────────────────
const agentDir = await mkdtemp(join(tmpdir(), 'pi-boundary-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-boundary-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-boundary-cwd-'))
await writeFile(join(workspace, 'notes.md'), '# Notes\nPi Core is active\n')

let completions = 0
const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({
  id: 'boundary-completion',
  object: 'chat.completion.chunk',
  model: 'smoke-model',
  choices: [{ index: 0, delta, finish_reason: finish }],
})}\n\n`
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  for await (const part of request) void part
  completions += 1
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (completions === 1) {
    response.write(chunk({ role: 'assistant', content: NARRATION }, null))
    response.write(chunk({
      tool_calls: [{ index: 0, id: 'call_grep_1', type: 'function', function: { name: 'grep', arguments: JSON.stringify({ pattern: 'Pi Core', path: '.' }) } }],
    }, null))
    response.write(chunk({}, 'tool_calls'))
    response.end('data: [DONE]\n\n')
    return
  }
  // The second round streams the answer the user is watching, then hangs so
  // the stop lands while it is mid-sentence.
  response.write(chunk({ role: 'assistant', content: PARTIAL }, null))
})
await new Promise<void>((resolveListen) => modelServer.listen(0, '127.0.0.1', resolveListen))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('Loopback model server did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({
  providers: {
    loopback: {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
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
const waitFor = async (predicate: (message: Record<string, any>) => boolean, label = 'message') => {
  for (;;) {
    const current = messages.find(predicate)
    if (current) return current
    await Promise.race([
      once(output, 'line'),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 15_000)),
    ])
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
const feedText = () => messages
  .filter((item) => item.event === 'host/turn-item')
  .map((item) => JSON.stringify(item.payload?.item ?? ''))
  .join('\n')

try {
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor((message) => message.id === 1, 'initialize')
  send(2, 'sessions/create', { title: 'Interrupt boundary smoke' })
  const created = await waitFor((message) => message.id === 2, 'session')
  const sessionId = String(created.result.sessionId)
  send(3, 'settings/update', { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: ['grep'] })
  await waitFor((message) => message.id === 3, 'settings')

  send(4, 'turn/submit', {
    sessionId,
    runId: 'boundary-run',
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
  // Stop only once the answer has actually started streaming.
  await waitFor(() => feedText().includes(PARTIAL.slice(0, 4)), 'the streamed partial answer')
  send(5, 'turn/interrupt', { runId: 'boundary-run', reason: 'user' })
  await waitFor((message) => message.id === 5, 'interrupt ack')

  const settled = await waitFor((message) => message.id === 4, 'settlement')
  assert.equal(settled.result?.settlement, 'interrupted')
  assert.equal(settled.result?.interruptReason, 'user')

  const kept = piTurnFinalAnswer(settled.result?.items || [])
  assert.ok(kept.includes(PARTIAL), `the stopped turn keeps what it was writing, got: ${JSON.stringify(kept)}`)
  assert.ok(!kept.includes(NARRATION), `the opening narration is not welded onto the answer, got: ${JSON.stringify(kept)}`)

  // The narration is not lost — it stayed in the execution feed.
  assert.ok(feedText().includes(NARRATION), 'the feed still shows what the run said before it worked')
} finally {
  host.stdin.end()
  await once(host, 'exit')
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}
console.log('A stopped Pi turn keeps its answer separate from its narration')
