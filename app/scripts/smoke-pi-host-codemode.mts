import { strict as assert } from 'node:assert'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

const root = await mkdtemp(join(tmpdir(), 'pi-codemode-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-codemode-state-'))
const agentDir = await mkdtemp(join(tmpdir(), 'pi-codemode-agent-'))
await writeFile(join(root, 'note.txt'), 'hello from codemode')

/**
 * A model that says one word.
 *
 * Direct-protocol Code Mode binds to a published TOOL CONTRACT, and a contract
 * is only published inside a turn (piHostProtocol → toolContracts.publish). So
 * one trivial turn runs first purely to establish it; the assertions below are
 * still about the direct `tools/code` path.
 */
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') return response.writeHead(404).end()
  request.on('data', () => undefined)
  await once(request, 'end')
  const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({
    id: 'codemode', object: 'chat.completion.chunk', model: 'smoke-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  response.write(chunk({ role: 'assistant', content: 'ready' }, null))
  response.write(chunk({}, 'stop'))
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const modelAddress = modelServer.address()
if (!modelAddress || typeof modelAddress === 'string') throw new Error('model fixture did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: {
  baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`, api: 'openai-completions',
  models: [{ id: 'smoke-model', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 128_000 }],
} } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'smoke' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

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
    await once(output, 'line')
  }
}
const waitForEvent = async (event: string, runId: string) => {
  for (;;) {
    const message = messages.find((item) => item.event === event && item.payload?.runId === runId)
    if (message) return message
    await once(output, 'line')
  }
}
const send = (id: number, method: string, params: Record<string, unknown>) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
try {
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor(1)

  // Code Mode runs model-authored JS, so it requires a session: the frozen run
  // policy — approval mode, denied tools, outbound posture, Restricted Project
  // View — hangs off the session, and there is nothing to bind a sessionless
  // call to. `tools/bash` still has a detached fallback; Code Mode deliberately
  // does not, because "arbitrary model code with no policy attached" is the one
  // case that must not have an exception.
  send(90, 'tools/code', { cwd: root, runId: 'code-no-session', approval: 'allow', code: 'return 1' })
  const sessionless = await waitFor(90)
  assert.equal(sessionless.error?.code, 'tool_contract_not_found', 'Code Mode without a contract is refused')
  assert.equal(sessionless.result, undefined, 'and nothing executed')

  send(91, 'sessions/create', { title: 'Code Mode' })
  const sessionId = String((await waitFor(91)).result?.sessionId)
  assert.ok(sessionId)
  // A session is necessary but not sufficient: what Code Mode binds to is a
  // published TOOL CONTRACT (revision + schema digests), so a call can be
  // described by exactly the tools the contract carries. `tools/list` with
  // requireContract publishes one for this session.
  send(92, 'turn/submit', {
    sessionId, runId: 'codemode-contract', cwd: root, prompt: '就緒',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false },
  })
  assert.equal((await waitFor(92)).error, undefined, 'one turn publishes the contract Code Mode binds to')
  send(2, 'tools/code', { cwd: root, sessionId, runId: 'code-isolation', approval: 'allow', code: 'return 2 + 2' })
  const isolated = await waitFor(2)
  assert.equal(isolated.result?.tool, 'code')
  assert.match(String(isolated.result?.content?.[0]?.text || ''), /4/)

  send(3, 'tools/code', { cwd: root, sessionId, runId: 'code-isolation-blocked', approval: 'allow', code: 'return typeof process' })
  const blockedGlobal = await waitFor(3)
  assert.equal(blockedGlobal.result?.settlement, 'failed')
  send(4, 'settings/update', { activeTools: ['read'], approvalMode: 'full' })
  await waitFor(4)
  send(5, 'tools/code', { cwd: root, sessionId, runId: 'code-nested', approval: 'allow', code: "const r = await tools.read({ path: 'note.txt' }); return r" })
  const nested = await waitFor(5)
  assert.equal(nested.result?.tool, 'code')
  assert.match(String(nested.result?.content?.[0]?.text || ''), /hello from codemode/)
  assert.ok(messages.some((item) => item.event === 'host/tool-start' && item.payload?.runId === 'code-nested' && item.payload?.callId?.includes(':code:') && item.payload?.parentRunId === 'code-nested'))
  assert.ok(messages.some((item) => item.event === 'host/tool-result' && item.payload?.runId === 'code-nested' && item.payload?.settlement === 'success'))

  send(6, 'tools/code', { cwd: root, sessionId, runId: 'code-blocked', approval: 'allow', code: "return await tools.write({ path: 'blocked.txt', content: 'nope' })" })
  const blocked = await waitFor(6)
  assert.equal(blocked.result?.settlement, 'failed')
  send(7, 'settings/update', { activeTools: ['bash'], approvalMode: 'full' })
  await waitFor(7)
  send(8, 'tools/code', { cwd: root, sessionId, runId: 'code-cancel', approval: 'allow', code: "return await tools.bash({ command: 'sleep 2' })" })
  await waitForEvent('host/tool-start', 'code-cancel')
  send(9, 'turn/cancel', { runId: 'code-cancel' })
  assert.equal((await waitFor(9)).result?.settlement, 'cancelled')
  assert.equal((await waitFor(8)).result?.settlement, 'cancelled')

  send(10, 'settings/update', { activeTools: ['read'], approvalMode: 'full' })
  await waitFor(10)
  send(11, 'tools/code', {
    cwd: root,
    sessionId,
    runId: 'code-timeout',
    approval: 'allow',
    timeoutMs: 5_000,
    code: "while (true) { await new Promise((resolve) => setTimeout(resolve, 10)); await tools.read({ path: 'note.txt' }) }",
  })
  const timedOut = await waitFor(11)
  assert.equal(timedOut.result?.settlement, 'failed')
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(messages.some((item) => item.event === 'host/tool-start' && item.payload?.runId === 'code-timeout'), false)
} finally {
  host.stdin.end()
  if (host.exitCode === null) await once(host, 'exit').catch(() => host.kill())
  output.close()
  // The loopback model holds the event loop open; without closing it the
  // process never exits and the smoke looks like a hang rather than a pass.
  await new Promise<void>((done) => modelServer.close(() => done()))
  await rm(root, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(agentDir, { recursive: true, force: true })
}
console.log('Pi Host CodeMode isolates globals and gates nested calls by active tools')
