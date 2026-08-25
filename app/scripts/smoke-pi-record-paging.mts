import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

/**
 * Seam 1: the Host serves its record a bounded page at a time.
 *
 * Enough turns that no one page holds them, so the boundaries are real:
 * the first page, a middle page, the oldest page, and a cursor past the
 * beginning.
 */

const TURNS = 6
const agentDir = await mkdtemp(join(tmpdir(), 'pi-paging-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-paging-state-'))

let completions = 0
const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({
  id: 'paging-completion',
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
  response.write(chunk({ role: 'assistant', content: `回答 ${completions}` }, null))
  response.write(chunk({}, 'stop'))
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((listening) => modelServer.listen(0, '127.0.0.1', listening))
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
const waitFor = async (id: number, label = 'message') => {
  for (;;) {
    const current = messages.find((message) => message.id === id)
    if (current) return current
    await Promise.race([
      once(output, 'line'),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 20_000)),
    ])
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
const profile = { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: [], compaction: 'manual', approvalMode: 'full', unattended: true }

try {
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor(1, 'initialize')
  send(2, 'sessions/create', { title: 'Paging smoke' })
  const sessionId = String((await waitFor(2, 'session')).result.sessionId)
  for (let turn = 1; turn <= TURNS; turn += 1) {
    send(10 + turn, 'turn/submit', { sessionId, runId: `paging-${turn}`, cwd: process.cwd(), prompt: `問題 ${turn}`, profile })
    assert.equal((await waitFor(10 + turn, `turn ${turn}`)).result?.settlement, 'answered')
  }

  // The first read opens at the newest end and is bounded by the limit asked for.
  send(30, 'sessions/record', { sessionId, limit: 5 })
  const first = (await waitFor(30, 'first page')).result.page
  assert.equal(first.entries.length, 5)
  assert.equal(first.hasOlder, true)
  assert.ok(first.total > first.entries.length, 'the page says how much it did not carry')
  assert.equal(first.entries[first.entries.length - 1].seq, first.total, 'the tail is the newest entry')

  // A middle page is addressed by the cursor the page before it handed back.
  send(31, 'sessions/record', { sessionId, before: first.nextBefore, limit: 5 })
  const middle = (await waitFor(31, 'middle page')).result.page
  assert.equal(middle.entries.length, 5)
  assert.ok(middle.entries[middle.entries.length - 1].seq < first.entries[0].seq, 'pages do not overlap')
  assert.equal(middle.hasOlder, true)

  // Paging back reaches the beginning, and stops offering a cursor there.
  let page = middle
  let guard = 0
  while (page.hasOlder && guard < 50) {
    send(40 + guard, 'sessions/record', { sessionId, before: page.nextBefore, limit: 5 })
    page = (await waitFor(40 + guard, 'older page')).result.page
    guard += 1
  }
  assert.equal(page.entries[0].seq, 1, 'the oldest page starts at the first entry')
  assert.equal(page.hasOlder, false)
  assert.equal(page.nextBefore, undefined)

  // A cursor before the beginning is an empty page, not an error.
  send(90, 'sessions/record', { sessionId, before: 1, limit: 5 })
  const beyond = (await waitFor(90, 'page past the beginning')).result.page
  assert.deepEqual(beyond.entries, [])
  assert.equal(beyond.hasOlder, false)

  // An unknown session is refused rather than answered with an empty page.
  send(91, 'sessions/record', { sessionId: 'no-such-session' })
  assert.ok((await waitFor(91, 'unknown session')).error, 'an unknown session is an error, not an empty record')
} finally {
  host.stdin.end()
  await once(host, 'exit')
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('The Host serves its Turn Record a bounded page at a time')
