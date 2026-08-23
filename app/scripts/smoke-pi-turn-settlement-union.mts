import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import {
  PI_TURN_SETTLEMENTS,
  classifyPiTurnSettlement,
  isCompletedModelCall,
  piTurnOutcome,
  piTurnProviderError,
} from '../src/agent/piHostRun.ts'

/**
 * A turn that called the model successfully and produced no text is not a
 * success. The settlement vocabulary is a closed union so the five outcomes
 * cannot collapse into one another on the way to the user.
 */

// ── Part A: the closed union and its projection (pure) ──────────────────────
assert.deepEqual(
  [...PI_TURN_SETTLEMENTS].sort(),
  ['answered', 'cancelled', 'empty', 'failed', 'interrupted'],
)

assert.equal(classifyPiTurnSettlement([{ type: 'assistant_message', content: '結論' }]), 'answered')
assert.equal(classifyPiTurnSettlement([{ type: 'assistant_message', content: '   ' }]), 'empty')
assert.equal(classifyPiTurnSettlement([]), 'empty')

// A rejected request arrives in-band as an empty assistant message; it is a
// failure, never a turn that merely said nothing.
assert.equal(
  piTurnProviderError([{ role: 'assistant', stopReason: 'error', errorMessage: '400: rejected' }]),
  '400: rejected',
)
assert.equal(piTurnProviderError([{ role: 'assistant', stopReason: 'stop' }]), undefined)
assert.equal(piTurnProviderError([]), undefined)
assert.ok(piTurnProviderError([{ role: 'assistant', stopReason: 'error' }]), 'an error with no text still reports')

const answered = piTurnOutcome('answered', { answer: '結論' })
const empty = piTurnOutcome('empty', { answer: '' })
const stopped = piTurnOutcome('interrupted', { answer: '半句', interruptReason: 'user' })
const timedOut = piTurnOutcome('interrupted', { answer: '半句', interruptReason: 'timeout' })
const failed = piTurnOutcome('failed', { answer: '' })
const cancelled = piTurnOutcome('cancelled', { answer: '' })

// An empty turn is not a success on any surface the user or the archive reads.
// `status` is what the coordinator archives and reports on, so it is the whole
// guarantee — an empty turn is never filed as a completed run.
assert.equal(answered.status, 'success')
assert.notEqual(empty.status, 'success')
assert.equal(empty.stepStatus, 'FAILED')
assert.equal(empty.logLevel, 'ERROR')
assert.ok(empty.confidence < answered.confidence)
assert.ok(empty.text.trim().length > 0, 'an empty turn still tells the user what happened')
assert.ok(!/完成/.test(empty.text), 'an empty turn never reads as completed')

// Five distinct outcomes: no two settlements produce the same reading.
const outcomes = { answered, empty, stopped, timedOut, failed, cancelled }
const seen = new Map<string, string>()
for (const [name, outcome] of Object.entries(outcomes)) {
  const key = JSON.stringify(outcome)
  const clash = seen.get(key)
  assert.equal(clash, undefined, `${name} reads identically to ${clash}`)
  seen.set(key, name)
}
assert.equal(stopped.status, 'halted')
assert.equal(timedOut.status, 'halted')
assert.equal(failed.status, 'failed')
assert.equal(cancelled.status, 'halted')

// A stop keeps whatever was produced; the REASON is what differs, not the text.
assert.equal(stopped.text, '半句')
assert.equal(timedOut.text, '半句')
assert.equal(stopped.interruptReason, 'user')
assert.equal(timedOut.interruptReason, 'timeout')
assert.notEqual(
  piTurnOutcome('interrupted', { answer: '', interruptReason: 'user' }).text,
  piTurnOutcome('interrupted', { answer: '', interruptReason: 'timeout' }).text,
)

// The Host's items are the only source of the answer: no renderer-side cache
// may promote an empty turn into a success (ADR-0039).
assert.equal(piTurnOutcome('empty', { answer: '   ' }).status, 'failed')

// Only a completed model call may continue a goal.
assert.equal(isCompletedModelCall('answered'), true)
assert.equal(isCompletedModelCall('empty'), true)
assert.equal(isCompletedModelCall('interrupted'), false)
assert.equal(isCompletedModelCall('failed'), false)
assert.equal(isCompletedModelCall('cancelled'), false)

// The union is closed: an unknown value is refused, never defaulted.
assert.throws(() => piTurnOutcome('done' as never, { answer: '' }))
assert.throws(() => isCompletedModelCall('done' as never))

// ── Part B: the Host settles the three model-reachable outcomes distinctly ──
const agentDir = await mkdtemp(join(tmpdir(), 'pi-settlement-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-settlement-state-'))

let completions = 0
const sse = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({
  id: 'settlement-completion',
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
  if (completions === 3) {
    // A non-retryable request failure, so the turn settles rather than retries.
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'smoke rejected this request', type: 'invalid_request_error' } }))
    return
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (completions === 1) response.write(sse({ role: 'assistant', content: '這是結論。' }, null))
  else response.write(sse({ role: 'assistant' }, null))
  response.write(sse({}, 'stop'))
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
const profile = {
  provider: 'loopback',
  model: 'smoke-model',
  thinkingLevel: 'off',
  activeTools: [],
  compaction: 'manual',
  approvalMode: 'full',
  unattended: true,
}

try {
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor((message) => message.id === 1)
  send(2, 'sessions/create', { title: 'Settlement smoke' })
  const created = await waitFor((message) => message.id === 2)
  const sessionId = String(created.result.sessionId)
  send(3, 'settings/update', { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: [] })
  await waitFor((message) => message.id === 3)

  send(4, 'turn/submit', { sessionId, runId: 'settlement-answered', cwd: process.cwd(), prompt: '說一句話', profile })
  const answeredTurn = await waitFor((message) => message.id === 4)
  assert.equal(answeredTurn.result?.settlement, 'answered')

  send(5, 'turn/submit', { sessionId, runId: 'settlement-empty', cwd: process.cwd(), prompt: '再說一次', profile })
  const emptyTurn = await waitFor((message) => message.id === 5)
  assert.equal(emptyTurn.result?.settlement, 'empty')
  // The settlement describes the items, it does not discard them: what survives
  // carries no assistant text, which is exactly what makes the turn empty.
  assert.equal(
    (emptyTurn.result?.items || [])
      .filter((item: { type?: string }) => item?.type === 'assistant_message')
      .map((item: { content?: string }) => (item.content || '').trim())
      .join(''),
    '',
  )

  send(6, 'turn/submit', { sessionId, runId: 'settlement-failed', cwd: process.cwd(), prompt: '再一次', profile })
  const failedTurn = await waitFor((message) => message.id === 6)
  assert.equal(failedTurn.result?.settlement, 'failed')

  send(7, 'sessions/list')
  const listed = await waitFor((message) => message.id === 7)
  const projected = listed.result.sessions.find((candidate: { id: string }) => candidate.id === sessionId)
  // The prompt is recorded whatever the turn settled as — it was model-visible.
  // Only the answered turn added an assistant message: an empty turn records
  // nothing claiming the model spoke, and a failed turn records nothing at all.
  assert.deepEqual(projected.messages, [
    { role: 'user', content: '說一句話' },
    { role: 'assistant', content: '這是結論。' },
    { role: 'user', content: '再說一次' },
  ])
} finally {
  host.stdin.end()
  await once(host, 'exit')
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi turn settlement is a closed union; an empty answer is not a success')
