import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { appendTurnRecord, stepTimings, turnRecordEntries } from '../src/agent/turnRecord.ts'

/**
 * Waiting for the first token and writing the answer are two different things,
 * and one total number cannot tell a stalled provider from a long answer.
 */

// ── Seam 2: a running step reports no duration at all ──────────────────────
const running = appendTurnRecord(undefined, [
  { kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'step-start', source: 'host', turn: 1, step: 1, at: 2 },
  { kind: 'user-text', source: 'user', content: '在跑', turn: 1, step: 1, at: 3 },
])
assert.deepEqual(stepTimings(running), [{ turn: 1, step: 1, running: true }])
const inFlight = stepTimings(running)[0]
assert.equal(inFlight.totalMs, undefined, 'a running step never gets an invented duration')
assert.equal(inFlight.waitingMs, undefined)
assert.equal(inFlight.generatingMs, undefined)

// A finished step reports what was measured, split at the first token.
const finished = appendTurnRecord(running, [
  {
    kind: 'step-end',
    source: 'host',
    turn: 1,
    step: 1,
    at: 9,
    timing: { requestAt: 1_000, firstTokenAt: 1_700, completedAt: 2_000, usage: { input: 12, output: 34, total: 46 } },
  },
])
assert.deepEqual(stepTimings(finished), [{
  turn: 1,
  step: 1,
  running: false,
  waitingMs: 700,
  generatingMs: 300,
  totalMs: 1_000,
  usage: { input: 12, output: 34, total: 46 },
}])

// A step that produced no text has no split to report, but still has a total.
const silent = appendTurnRecord(undefined, [
  { kind: 'step-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'step-end', source: 'host', turn: 1, step: 1, at: 2, timing: { requestAt: 10, completedAt: 60 } },
])
assert.deepEqual(stepTimings(silent), [{ turn: 1, step: 1, running: false, totalMs: 50 }])

// Timing is measured, not inferred: an entry with none reports none, rather
// than a difference between neighbouring timestamps.
const untimed = appendTurnRecord(undefined, [
  { kind: 'step-start', source: 'host', turn: 1, step: 1, at: 1_000 },
  { kind: 'step-end', source: 'host', turn: 1, step: 1, at: 5_000 },
])
assert.deepEqual(stepTimings(untimed), [{ turn: 1, step: 1, running: false }])

// ── Seam 1: a real turn with a deliberately slow first token ───────────────
const FIRST_TOKEN_DELAY_MS = 700
const agentDir = await mkdtemp(join(tmpdir(), 'pi-timing-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-timing-state-'))

const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({
  id: 'timing-completion',
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
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  // The model thinks for a while, then writes quickly.
  await new Promise((wait) => setTimeout(wait, FIRST_TOKEN_DELAY_MS))
  response.write(chunk({ role: 'assistant', content: '結論。' }, null))
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
const waitFor = async (predicate: (message: Record<string, any>) => boolean, label = 'message') => {
  for (;;) {
    const current = messages.find(predicate)
    if (current) return current
    await Promise.race([
      once(output, 'line'),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 20_000)),
    ])
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)

try {
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor((message) => message.id === 1, 'initialize')
  send(2, 'sessions/create', { title: 'Timing smoke' })
  const sessionId = String((await waitFor((message) => message.id === 2, 'session')).result.sessionId)
  send(3, 'turn/submit', {
    sessionId,
    runId: 'timing-run',
    cwd: process.cwd(),
    prompt: '慢慢想',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: [], compaction: 'manual', approvalMode: 'full', unattended: true },
  })
  const settled = await waitFor((message) => message.id === 3, 'settlement')
  assert.equal(settled.result?.settlement, 'answered')

  const [timing] = stepTimings(settled.result?.record)
  assert.ok(timing, 'the turn recorded a step')
  assert.equal(timing.running, false)
  assert.ok(typeof timing.waitingMs === 'number', 'waiting for the first token is measured')
  assert.ok(typeof timing.generatingMs === 'number', 'so is writing the answer')
  assert.ok(
    timing.waitingMs >= FIRST_TOKEN_DELAY_MS * 0.5,
    `waiting should reflect the ${FIRST_TOKEN_DELAY_MS}ms the model spent thinking, got ${timing.waitingMs}ms`,
  )
  assert.ok(
    timing.waitingMs > timing.generatingMs,
    `a slow first token must read as waiting, not as writing (waited ${timing.waitingMs}ms, wrote ${timing.generatingMs}ms)`,
  )
  assert.equal(timing.waitingMs + timing.generatingMs, timing.totalMs)

  // The measurement rides on the step's own entry, not on a neighbour's clock.
  const stepEnd = turnRecordEntries(settled.result?.record).find((entry) => entry.kind === 'step-end')
  assert.ok(stepEnd && 'timing' in stepEnd && stepEnd.timing?.requestAt, 'the step carries its own measurement')
} finally {
  host.stdin.end()
  await once(host, 'exit')
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Each step measures waiting for the first token apart from writing the answer')
