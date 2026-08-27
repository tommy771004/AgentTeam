import { strict as assert } from 'node:assert'
import { createServer, type ServerResponse } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { conversationAnswer, projectConversationRows } from '../src/agent/conversationProjection.ts'
import { buildExternalCliRecord } from '../src/agent/externalCliRecord.ts'
import { projectPiSession } from '../src/agent/piHostProjection.ts'
import { piTurnOutcome, PI_TURN_SETTLEMENTS } from '../src/agent/piHostRun.ts'
import { projectProducedFiles, projectRunOperations } from '../src/agent/runOperationsProjection.ts'
import {
  derivePiHistory,
  recordRunnerDeclaration,
  turnRecordEntries,
  type TurnRecord,
} from '../src/agent/turnRecord.ts'
import { BUILTIN_RUNNER_CAPABILITIES, EXTERNAL_CLI_RUNNER_CAPABILITIES } from '../src/agent/runners/types.ts'

/**
 * Qualification for the Turn Record effort.
 *
 * Not new behaviour — proof that the eleven tickets before it hold together:
 * the six settlements stay distinguishable, history survives a Host restart
 * and a renderer reload, an external run records the same shape while still
 * declaring what it did not do, a long run stays readable past the old memory
 * caps, and the defect that started all of this cannot come back.
 *
 * Everything imports the shipped modules. Nothing here re-implements what it
 * checks; a green run means the shipped path is correct.
 */

const NARRATION = '我先探索本地專案結構。'
const CONCLUSION = '結論：Host 擁有迴圈。'

const agentDir = await mkdtemp(join(tmpdir(), 'record-qual-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'record-qual-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'record-qual-cwd-'))
await writeFile(join(workspace, 'notes.md'), '# Notes\nPi Core is active\n')
const statePath = join(stateDir, 'state.json')

/** Held open so a turn can be stopped while the model is still "thinking". */
const hanging = new Set<ServerResponse>()
let toolRounds = 0
const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({
  id: 'qual',
  object: 'chat.completion.chunk',
  model: 'smoke-model',
  choices: [{ index: 0, delta, finish_reason: finish }],
})}\n\n`

const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  let body = ''
  for await (const part of request) body += String(part)

  if (body.includes('REJECT')) {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'qualification rejected this request', type: 'invalid_request_error' } }))
    return
  }
  if (body.includes('HANG')) {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    hanging.add(response)
    response.on('close', () => hanging.delete(response))
    return
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (body.includes('SILENT')) {
    response.write(chunk({ role: 'assistant' }, null))
    response.write(chunk({}, 'stop'))
  } else if (body.includes('TOOLS') && toolRounds++ % 2 === 0) {
    // First round of a tool-using turn: narrate, then call a tool.
    response.write(chunk({ role: 'assistant', content: NARRATION }, null))
    response.write(chunk({
      tool_calls: [{ index: 0, id: 'call_grep_1', type: 'function', function: { name: 'grep', arguments: JSON.stringify({ pattern: 'Pi Core', path: '.' }) } }],
    }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: body.includes('TOOLS') ? CONCLUSION : '好的。' }, null))
    response.write(chunk({}, 'stop'))
  }
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

const env = { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: statePath, SUBAGENTS_PI_AGENT_DIR: agentDir }
const hostPath = resolve(import.meta.dirname, '../dist-electron/pi-host.js')
const profile = {
  provider: 'loopback',
  model: 'smoke-model',
  thinkingLevel: 'off',
  activeTools: ['grep'],
  compaction: 'manual',
  approvalMode: 'full',
  unattended: true,
}

async function startHost() {
  const host = spawn(process.execPath, [hostPath], { env, stdio: ['pipe', 'pipe', 'inherit'] })
  const output = createInterface({ input: host.stdout })
  const messages: Array<Record<string, any>> = []
  output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, any>))
  const waitFor = async (id: number, label: string, timeoutMs = 30_000) => {
    for (;;) {
      const found = messages.find((message) => message.id === id)
      if (found) return found
      await new Promise<Array<unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs)
        once(output, 'line').then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
        })
    }
  }
  const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor(1, 'initialize')
  const stop = async () => {
    host.stdin.end()
    await once(host, 'exit')
  }
  const session = async (id: number, title: string) => {
    send(id, 'sessions/create', { title })
    return String((await waitFor(id, `session ${title}`)).result.sessionId)
  }
  const recordOf = async (id: number, sessionId: string, limit = 100): Promise<TurnRecord> => {
    send(id, 'sessions/record', { sessionId, limit })
    const page = (await waitFor(id, 'record page')).result.page
    return { version: 1, entries: page.entries }
  }
  return { send, waitFor, stop, session, recordOf, messages }
}

const settlements = new Map<string, string>()
let answeredRecord: TurnRecord = { version: 1, entries: [] }
let longSessionId = ''

try {
  const host = await startHost()

  // ── The originating defect: a tool-using turn settles on its CONCLUSION ──
  const answered = await host.session(10, 'answered')
  host.send(11, 'turn/submit', { sessionId: answered, runId: 'q-answered', cwd: workspace, prompt: 'TOOLS 分析這個專案', profile })
  const answeredResult = (await host.waitFor(11, 'answered turn')).result
  settlements.set('answered', answeredResult.settlement)
  answeredRecord = await host.recordOf(12, answered)
  assert.equal(conversationAnswer(answeredRecord), CONCLUSION, 'the answer is the conclusion, never the opening narration')
  assert.ok(
    projectConversationRows(answeredRecord).some((row) => row.kind === 'assistant' && row.content === NARRATION),
    'the narration is still on the record as its own row',
  )
  // History carries what the agent did, not only what it said.
  const history = derivePiHistory(answeredRecord)
  assert.ok(history.some((message) => message.role === 'tool'), 'the tool trace is in the model history')
  assert.equal(history[history.length - 1]?.content, CONCLUSION)
  assert.ok(projectRunOperations(answeredRecord).length > 0)

  // ── Renderer reload rebuilds the conversation from the Host ──────────────
  host.send(13, 'sessions/list')
  const listed = (await host.waitFor(13, 'sessions')).result.sessions.find((candidate: { id: string }) => candidate.id === answered)
  const rebuilt = projectPiSession({ ...listed, threadId: listed.threadId || 'thread-q' })
  assert.ok(rebuilt, 'an unarchived session projects a thread')
  assert.equal(rebuilt?.bubbles[rebuilt.bubbles.length - 1]?.content, CONCLUSION, 'a reload shows the same answer the Host settled on')
  assert.ok(!rebuilt?.bubbles.some((bubble) => bubble.role === 'tool' as never), 'the tool trace is history, not a chat bubble')

  // ── The other four model-reachable settlements ──────────────────────────
  const silent = await host.session(20, 'empty')
  host.send(21, 'turn/submit', { sessionId: silent, runId: 'q-empty', cwd: workspace, prompt: 'SILENT', profile })
  settlements.set('empty', (await host.waitFor(21, 'empty turn')).result.settlement)

  const broken = await host.session(30, 'failed')
  host.send(31, 'turn/submit', { sessionId: broken, runId: 'q-failed', cwd: workspace, prompt: 'REJECT', profile })
  settlements.set('failed', (await host.waitFor(31, 'failed turn')).result.settlement)

  const stopped = await host.session(40, 'interrupted')
  host.send(41, 'turn/submit', { sessionId: stopped, runId: 'q-stopped', cwd: workspace, prompt: 'HANG', profile })
  await new Promise((wait) => setTimeout(wait, 300))
  host.send(42, 'turn/interrupt', { runId: 'q-stopped', reason: 'user' })
  await host.waitFor(42, 'interrupt ack')
  const stoppedResult = (await host.waitFor(41, 'stopped turn')).result
  settlements.set('interrupted:user', `${stoppedResult.settlement}:${stoppedResult.interruptReason}`)

  const cancelled = await host.session(50, 'cancelled')
  host.send(51, 'turn/submit', { sessionId: cancelled, runId: 'q-cancelled', cwd: workspace, prompt: 'HANG', profile })
  await new Promise((wait) => setTimeout(wait, 300))
  host.send(52, 'turn/cancel', { runId: 'q-cancelled' })
  await host.waitFor(52, 'cancel ack')
  settlements.set('cancelled', (await host.waitFor(51, 'cancelled turn')).result.settlement)

  // A turn budget stops a stuck turn the same way a user does, with its own reason.
  const timedOut = await host.session(60, 'timeout')
  host.send(61, 'turn/submit', { sessionId: timedOut, runId: 'q-timeout', cwd: workspace, prompt: 'HANG', profile, timeoutMs: 10_000 })
  const timedOutResult = (await host.waitFor(61, 'timed out turn', 60_000)).result
  settlements.set('interrupted:timeout', `${timedOutResult.settlement}:${timedOutResult.interruptReason}`)

  // ── A long run stays readable past the old in-memory caps ───────────────
  longSessionId = await host.session(70, 'long')
  for (let turn = 1; turn <= 24; turn += 1) {
    host.send(100 + turn, 'turn/submit', { sessionId: longSessionId, runId: `q-long-${turn}`, cwd: workspace, prompt: `第 ${turn} 題`, profile })
    await host.waitFor(100 + turn, `long turn ${turn}`)
  }
  host.send(80, 'sessions/list')
  const longSummary = (await host.waitFor(80, 'long session'))
    .result.sessions.find((candidate: { id: string }) => candidate.id === longSessionId).recordSummary
  assert.ok(longSummary.entries > 120, `the run must exceed the old 120-event cap, saw ${longSummary.entries}`)

  const collected: TurnRecord = { version: 1, entries: [] }
  let before: number | undefined
  for (;;) {
    host.send(200 + collected.entries.length, 'sessions/record', { sessionId: longSessionId, before, limit: 40 })
    const page = (await host.waitFor(200 + collected.entries.length, 'long page')).result.page
    collected.entries = [...page.entries, ...collected.entries]
    if (!page.hasOlder) break
    before = page.nextBefore
  }
  assert.equal(collected.entries.length, longSummary.entries, 'paging back reads the whole run, cap or no cap')
  assert.deepEqual(
    turnRecordEntries(collected).map((entry) => entry.seq),
    collected.entries.map((_, index) => index + 1),
    'no gap and no repeat across page boundaries',
  )
  await host.stop()

  // ── History survives a Host restart ─────────────────────────────────────
  const restarted = await startHost()
  const after = await restarted.recordOf(90, longSessionId, 100)
  assert.ok(after.entries.length > 0, 'the record is still there after a restart')
  restarted.send(91, 'turn/submit', { sessionId: longSessionId, runId: 'q-after-restart', cwd: workspace, prompt: '重啟後再問', profile })
  await restarted.waitFor(91, 'turn after restart')
  restarted.send(92, 'sessions/list')
  const continued = (await restarted.waitFor(92, 'sessions after restart'))
    .result.sessions.find((candidate: { id: string }) => candidate.id === longSessionId).recordSummary
  assert.ok(continued.entries > longSummary.entries, 'the turn after a restart appended rather than replaced')
  assert.ok(continued.latestSeq > longSummary.latestSeq, 'sequence continues across the process boundary')
  await restarted.stop()
} finally {
  for (const response of hanging) response.destroy()
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}

// ── The six settlements are distinguishable, and none collapses ────────────
assert.deepEqual([...settlements.entries()].sort(), [
  ['answered', 'answered'],
  ['cancelled', 'cancelled'],
  ['empty', 'empty'],
  ['failed', 'failed'],
  ['interrupted:timeout', 'interrupted:timeout'],
  ['interrupted:user', 'interrupted:user'],
].sort())
// And each reads differently to the user.
const readings = PI_TURN_SETTLEMENTS.map((settlement) => JSON.stringify(piTurnOutcome(settlement, { answer: '' })))
assert.equal(new Set(readings).size, readings.length, 'no two settlements read the same')

// ── An external run records the same shape, declaring what it did not do ──
const external = buildExternalCliRecord({
  runner: 'codex',
  prompt: '修好那個測試',
  events: [{ kind: 'file', tool: 'write', path: 'src/fix.ts', ok: true }],
  answer: '修好了。',
  settlement: 'answered',
})
const kindsOf = (record: TurnRecord) => new Set(turnRecordEntries(record).map((entry) => entry.kind))
for (const kind of ['turn-start', 'step-start', 'user-text', 'assistant-text', 'tool-call', 'tool-result', 'step-end', 'turn-end']) {
  assert.ok(kindsOf(external).has(kind as never), `an external run records ${kind}`)
}
assert.equal(conversationAnswer(external), '修好了。')
assert.deepEqual(projectProducedFiles(external).map((file) => file.path), ['src/fix.ts'])
assert.deepEqual(recordRunnerDeclaration(external)?.capabilities, EXTERNAL_CLI_RUNNER_CAPABILITIES)
assert.deepEqual(recordRunnerDeclaration(answeredRecord), {
  runner: 'builtin',
  capabilities: BUILTIN_RUNNER_CAPABILITIES,
}, 'the builtin Host freezes its verified Memory control guarantees')

console.log('Turn Record fidelity qualified: settlements, restart, reload, paging, external parity, and the original defect')
