import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

/**
 * Issue 01 — the Host extension-tool seam, proven end to end with http_fetch.
 *
 * A loopback model scripts real turns that CALL extension tools mid-turn, so
 * what gets proven is not "the tool is listed" but "the tool executed inside
 * a Pi turn, its result reached the model, its denial fails closed, and its
 * tool-call / tool-result pair lands in the Turn Record with coordinates".
 */

type Message = {
  id?: number
  event?: string
  payload?: Record<string, any>
  result?: Record<string, any>
  error?: { code: string; message: string }
}

const agentDir = await mkdtemp(join(tmpdir(), 'pi-pack-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-pack-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-pack-cwd-'))

let requests: string[] = []
// Each turn hands the loopback model one scripted first-round tool call.
let pendingScript: { tool: string; args: Record<string, unknown> } | undefined
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const chunk = (delta: unknown, finish: string | null) => sse({
  id: `pack-${requests.length}`,
  object: 'chat.completion.chunk',
  model: 'smoke-model',
  choices: [{ index: 0, delta, finish_reason: finish }],
})
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  const body = await new Promise<string>((done) => {
    let raw = ''
    request.on('data', (part) => { raw += part })
    request.on('end', () => done(raw))
  })
  requests.push(body)
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (pendingScript) {
    const script = pendingScript
    pendingScript = undefined
    response.write(chunk({ role: 'assistant', content: '我先呼叫工具。' }, null))
    response.write(chunk({ tool_calls: [{
      index: 0,
      id: `call_${script.tool}`,
      type: 'function',
      function: { name: script.tool, arguments: JSON.stringify(script.args) },
    }] }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: '結論：完成。' }, null))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((resolveListen) => modelServer.listen(0, '127.0.0.1', resolveListen))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('Loopback model server did not bind')

// What http_fetch will actually fetch: a tiny local HTTP endpoint.
let fetchHits = 0
let webUrl = ''
const webServer = createServer(async (_request, response) => {
  fetchHits += 1
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end(`pack smoke page hit ${fetchHits}`)
})
await new Promise<void>((resolveListen) => webServer.listen(0, '127.0.0.1', resolveListen))
webUrl = `http://127.0.0.1:${(webServer.address() as { port: number }).port}/page`

await writeFile(join(agentDir, 'models.json'), JSON.stringify({
  providers: {
    loopback: {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      api: 'openai-completions',
      apiKey: 'test-key-placeholder',
      models: [{ id: 'smoke-model', name: 'Smoke Model', reasoning: false, input: ['text'], contextWindow: 128_000 }],
    },
  },
}))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: {
    ...process.env,
    SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'),
    SUBAGENTS_PI_AGENT_DIR: agentDir,
    // The interactive ask budget is shrunk for the timeout scenario only.
    SUBAGENTS_PI_APPROVAL_TIMEOUT_MS: '700',
  },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as Message))
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((item) => item.id === id)
    if (message) return message
    await Promise.race([
      once(output, 'line'),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for host response ${id}`)), 20_000)),
    ])
  }
}
const waitForEvent = async (event: string, predicate: (payload: Record<string, any>) => boolean = () => true) => {
  for (;;) {
    const found = messages.find((item) => item.event === event && predicate(item.payload || {}))
    if (found) return found
    await Promise.race([
      once(output, 'line'),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for event ${event}`)), 20_000)),
    ])
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
const submitTurn = (id: number, runId: string, prompt: string, profile: Record<string, unknown>, sessionId: string, script?: { tool: string; args: Record<string, unknown> }) => {
  if (script) pendingScript = script
  send(id, 'turn/submit', { sessionId, runId, cwd: workspace, prompt, profile })
}

try {
  send(1, 'initialize', { protocolVersion: 2 })
  assert.equal((await waitFor(1)).error, undefined)

  // The catalog names the extension tool with its pack and active state.
  send(2, 'tools/list')
  const listed = await waitFor(2)
  const entry = listed.result?.catalog?.find((item: { name: string }) => item.name === 'http_fetch')
  assert.ok(entry, 'http_fetch is projected into tools/list catalog')
  assert.equal(entry.pack, 'integrations')
  assert.equal(entry.source, 'discovered')
  assert.equal(typeof entry.active, 'boolean')
  // The legacy flat list still holds the Pi builtins exactly.
  assert.deepEqual([...listed.result.builtinTools].sort(), ['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write'])

  // Direct execution through tools/pack returns structured results and is
  // audited like any builtin call: start → decision → result.
  send(3, 'tools/pack', { name: 'http_fetch', arguments: { url: webUrl }, cwd: workspace, sessionId: 'direct' })
  await waitForEvent('host/tool-start', (payload) => payload.tool === 'http_fetch')
  const directDecision = await waitForEvent('host/tool-decision', (payload) => payload.tool === 'http_fetch' && payload.runId === '3')
  assert.equal(directDecision.payload.decision, 'allow')
  const directResult = await waitForEvent('host/tool-result', (payload) => payload.tool === 'http_fetch' && payload.runId === '3')
  assert.equal(directResult.payload.settlement, 'success')
  const direct = await waitFor(3)
  assert.equal(direct.error, undefined)
  assert.match(String(direct.result?.content?.[0]?.text || ''), /pack smoke page hit/)
  // The audit stream feeds the session's toolAudit only for known sessions;
  // the events themselves carried the whole account above.

  // Structured failure, not a throw: a bad scheme answers with ok:false.
  send(4, 'tools/pack', { name: 'http_fetch', arguments: { url: 'ftp://example.invalid' }, cwd: workspace })
  const failed = await waitFor(4)
  assert.equal(failed.error, undefined, 'a failing tool answers structurally instead of erroring the protocol call')
  assert.match(String(failed.result?.content?.[0]?.text || ''), /Only http\(s\) URLs are allowed/)

  // One real turn whose model calls the extension tool mid-loop.
  send(5, 'sessions/create', { title: 'Pack seam smoke' })
  const created = await waitFor(5)
  const sessionId = String(created.result.sessionId)
  submitTurn(6, 'pack-seam-run', '請抓取這個網頁並告訴我內容', { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: true }, sessionId, { tool: 'http_fetch', args: { url: webUrl } })

  const settled = await waitFor(6)
  assert.equal(settled.result.settlement, 'answered', `turn should answer — round-2 request was: ${requests[1]?.slice(0, 300)}`)
  assert.equal(fetchHits >= 1, true, 'the tool really fetched over HTTP during the turn')
  // The model's second round carries the tool result, so the fetch text
  // reached the conversation rather than dying inside the Host.
  assert.match(requests[1] || '', /pack smoke page hit/, 'the tool result travelled back to the model')

  // Turn Record: one tool-call / tool-result pair per extension call.
  const record = settled.result.record
  assert.ok(record, 'the settled turn returns its record slice')
  const kinds = record.entries.map((entry: { kind: string; tool?: string; turn?: number; step?: number }) => `${entry.kind}:${entry.tool || ''}:${entry.turn}:${entry.step}`)
  const callEntry = record.entries.find((entry: { kind: string; tool?: string }) => entry.kind === 'tool-call' && entry.tool === 'http_fetch')
  const resultEntry = record.entries.find((entry: { kind: string; tool?: string }) => entry.kind === 'tool-result' && entry.tool === 'http_fetch')
  assert.ok(callEntry, `tool-call recorded: ${kinds.join(', ')}`)
  assert.ok(resultEntry, 'tool-result recorded')
  assert.deepEqual([callEntry.turn, callEntry.step], [1, 1], 'coordinates land on turn 1 step 1')
  assert.deepEqual([resultEntry.turn, resultEntry.step], [1, 1])
  assert.equal(callEntry.seq < resultEntry.seq, true, 'result follows its call in sequence')
  assert.equal(resultEntry.settlement, 'success')

  // ── The Approval Decision on the same seam ──
  // An unattended run that asks for an OUTBOUND send is refused without an
  // approval: fail-closed, and the refusal settles as `denied`, not failed.
  submitTurn(7, 'pack-seam-unapproved', '送出訊息', { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'auto', unattended: true }, sessionId, { tool: 'message_send', args: { chatId: 'ops', text: 'hello' } })
  const deniedSettled = await waitFor(7)
  assert.equal(deniedSettled.result.settlement, 'answered', 'a denied tool does not end the turn; the loop continues and answers')
  const denyDecision = messages.find((message) => message.event === 'host/tool-decision' && message.payload?.tool === 'message_send' && message.payload?.runId === 'pack-seam-unapproved')
  assert.ok(denyDecision, 'the in-turn denial is audited like every other decision')
  assert.equal(denyDecision.payload.decision, 'deny')
  assert.match(String(denyDecision.payload.reason || ''), /Unattended approval denied/, 'unattended asks are refused without waiting')
  const deniedRecord = deniedSettled.result.record
  const deniedResult = deniedRecord.entries.find((entry: { kind: string; tool?: string }) => entry.kind === 'tool-result' && entry.tool === 'message_send')
  assert.ok(deniedResult, 'denied call still lands in the record')
  assert.equal(deniedResult.settlement, 'denied', 'a blocked call reads as denied, not failed')

  // ── Attended ask: the HITL path ──
  // An attended auto-mode run raises `host/approval-requested` and WAITS.
  submitTurn(8, 'pack-ask-allow', '送出訊息', { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'auto', unattended: false }, sessionId, { tool: 'message_send', args: { chatId: 'ops', text: 'hello' } })
  const askEvent = await waitForEvent('host/approval-requested', (payload) => payload.runId === 'pack-ask-allow')
  assert.equal(askEvent.payload.tool, 'message_send')
  assert.ok(Number(askEvent.payload.timeoutMs) > 0, 'the ask carries its own timeout budget')
  send(9, 'approvals/resolve', { runId: askEvent.payload.runId, callId: askEvent.payload.callId, decision: 'allow' })
  const allowResolved = await waitFor(9)
  assert.equal(allowResolved.error, undefined)
  const allowedSettled = await waitFor(8)
  assert.equal(allowedSettled.result.settlement, 'answered')
  const allowedCall = allowedSettled.result.record.entries.find((entry: { kind: string; tool?: string }) => entry.kind === 'tool-call' && entry.tool === 'message_send')
  const allowedResult = allowedSettled.result.record.entries.find((entry: { kind: string; tool?: string; settlement?: string }) => entry.kind === 'tool-result' && entry.tool === 'message_send')
  assert.ok(allowedCall && allowedResult, 'approved call executed and was recorded')
  assert.equal(allowedResult.settlement, 'success', 'approval lets the tool run')

  // A deny resolution blocks the same tool on the same path.
  submitTurn(10, 'pack-ask-deny', '送出訊息', { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'always', unattended: false }, sessionId, { tool: 'message_send', args: { chatId: 'ops', text: 'hello' } })
  const denyAsk = await waitForEvent('host/approval-requested', (payload) => payload.runId === 'pack-ask-deny')
  send(11, 'approvals/resolve', { runId: denyAsk.payload.runId, callId: denyAsk.payload.callId, decision: 'deny' })
  await waitFor(11)
  const denyRunSettled = await waitFor(10)
  assert.equal(denyRunSettled.result.settlement, 'answered')
  const userDeniedResult = denyRunSettled.result.record.entries.find((entry: { kind: string; tool?: string; settlement?: string }) => entry.kind === 'tool-result' && entry.tool === 'message_send')
  assert.ok(userDeniedResult, 'user-denied call recorded')
  assert.equal(userDeniedResult.settlement, 'denied')

  // An ask nobody resolves expires into a denial at the ask's own timeout.
  submitTurn(12, 'pack-ask-timeout', '送出訊息', { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'auto', unattended: false }, sessionId, { tool: 'message_send', args: { chatId: 'ops', text: 'hello' } })
  await waitForEvent('host/approval-requested', (payload) => payload.runId === 'pack-ask-timeout')
  const timeoutSettled = await waitFor(12)
  assert.equal(timeoutSettled.result.settlement, 'answered', 'an expired ask does not hang the run forever')
  const timeoutResult = timeoutSettled.result.record.entries.find((entry: { kind: string; tool?: string; settlement?: string }) => entry.kind === 'tool-result' && entry.tool === 'message_send')
  assert.ok(timeoutResult, 'timed-out ask still lands in the record')
  assert.equal(timeoutResult.settlement, 'denied')

  console.log('Pi Host extension-tool seam owns http_fetch: catalog, execution, approvals across modes, and record coordinates all hold')
} finally {
  if (host.exitCode === null) {
    host.stdin.end()
    await once(host, 'exit').catch(() => host.kill())
  }
  modelServer.close()
  webServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}
