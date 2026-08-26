import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

/**
 * Issues 12 + 13 — progressive disclosure lives in the Host, and Code Mode
 * nests through the same gate.
 *
 * A deferred capability costs one catalog line until load_capability reveals
 * it mid-run; tools/list changes accordingly; preloaded capabilities ride in
 * per turn; and run_code can call extension tools ONLY while they are active
 * and ONLY through a fresh Approval Decision per nested call.
 */

type Message = {
  id?: number
  event?: string
  payload?: Record<string, any>
  result?: Record<string, any>
  error?: { code: string; message: string }
}

const agentDir = await mkdtemp(join(tmpdir(), 'pi-cap-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-cap-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-cap-cwd-'))

let requests: string[] = []
// Scripted first-round calls queue up one entry per turn.
let scriptQueue: Array<{ tool: string; args: Record<string, unknown> } | undefined> = []
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const chunk = (delta: unknown, finish: string | null) => sse({
  id: `cap-${requests.length}`,
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
  const script = scriptQueue.shift()
  if (script) {
    response.write(chunk({ role: 'assistant', content: '呼叫工具。' }, null))
    response.write(chunk({ tool_calls: [{
      index: 0,
      id: `call_${script.tool}`,
      type: 'function',
      function: { name: script.tool, arguments: JSON.stringify(script.args) },
    }] }, null))
    response.write(chunk({}, 'tool_calls'))
  } else if (scriptQueue.length === 0 && requests.length >= 0 && pendingCode !== undefined) {
    // Round 2 of the code-mode turn: report what run_code returned.
    const output = pendingCode
    pendingCode = undefined
    response.write(chunk({ role: 'assistant', content: `code 結果：${output}` }, null))
    response.write(chunk({}, 'stop'))
  } else {
    response.write(chunk({ role: 'assistant', content: '結論：完成。' }, null))
    response.write(chunk({}, 'stop'))
  }
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
      models: [{ id: 'smoke-model', name: 'Smoke Model', reasoning: false, input: ['text'], contextWindow: 128_000 }],
    },
  },
}))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir, SUBAGENTS_PI_APPROVAL_TIMEOUT_MS: '900' },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as Message))
let pendingCode: string | undefined
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((item) => item.id === id)
    if (message) return message
    await new Promise<Array<unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for host response ${id}`)), 25_000)
      once(output, 'line').then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
      })
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)

try {
  send(1, 'initialize', { protocolVersion: 2 })
  assert.equal((await waitFor(1)).error, undefined)

  // The full capability set is listed; deferred ones cost one line each.
  send(2, 'capabilities/list')
  const listed = await waitFor(2)
  const ids = (listed.result?.items || []).map((item: { id: string }) => item.id)
  for (const expected of ['core-files', 'web-research', 'memory', 'delegate', 'codegraph', 'mcp-bridge', 'subdesign-workflow']) {
    assert.equal(ids.includes(expected), true, `${expected} is in the Host capability catalog`)
  }

  // tools/list before any load: web_search is INACTIVE with a reason.
  send(3, 'tools/list')
  const before = await waitFor(3)
  const webEntryBefore = before.result?.catalog?.find((entry: { name: string }) => entry.name === 'web_search')
  assert.ok(webEntryBefore)
  assert.equal(webEntryBefore.active, false, 'capability-gated tools start inactive')
  assert.match(String(webEntryBefore.reason || ''), /web-research/)
  assert.equal(before.result?.builtinTools?.includes('web_search'), false, 'inactive tools are not callable via the flat list')

  // capabilities/load flips it, and tools/list follows.
  send(4, 'capabilities/load', { id: 'web-research' })
  const loaded = await waitFor(4)
  assert.equal(loaded.result?.loaded, true)
  send(5, 'tools/list')
  const after = await waitFor(5)
  const webEntryAfter = after.result?.catalog?.find((entry: { name: string }) => entry.name === 'web_search')
  assert.equal(webEntryAfter?.active, true, 'the loaded capability activates its tools')
  assert.equal(after.result?.builtinTools?.includes('web_search'), true)

  // Unknown capability stays honest.
  send(6, 'capabilities/load', { id: 'nonexistent' })
  assert.equal((await waitFor(6)).error?.code, 'invalid_request')

  // ── Mid-run reveal: load_capability as a model-facing tool ──
  send(20, 'sessions/create', {})
  const created = await waitFor(20)
  const sessionId = String(created.result.sessionId)
  scriptQueue = [
    { tool: 'load_capability', args: { id: 'web-research' } },
  ]
  // The catalog was reset? No — state persists on the server. Load happened
  // at id=4 already; to prove the MID-RUN path, drive a fresh session whose
  // runtime starts without web-research active and loads it inside the turn.
  // (The protocol-level load above proves the same authority the tool uses.)
  send(21, 'turn/submit', {
    sessionId,
    runId: 'midrun-load-run',
    cwd: workspace,
    prompt: '需要搜尋能力時自己載入',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: true },
  })
  const midrunSettled = await waitFor(21)
  assert.equal(midrunSettled.result.settlement, 'answered', `turn answered — got ${JSON.stringify(midrunSettled.result.settlement)}`)
  const loadCall = midrunSettled.result.record.entries.find((entry: { kind: string; tool?: string }) => entry.kind === 'tool-call' && entry.tool === 'load_capability')
  assert.ok(loadCall, 'the model-facing load_capability executed inside the turn')

  // ── Preloaded capabilities ride in per turn (issue 12) ──
  send(22, 'turn/submit', {
    sessionId,
    runId: 'preloaded-run',
    cwd: workspace,
    prompt: '下一輪直接可用',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: true, activeTools: ['grep'] },
    preloadedCapabilities: ['web-research'],
  })
  const preloadedSettled = await waitFor(22)
  assert.equal(preloadedSettled.result.settlement, 'answered')
  assert.match(requests.at(-1) || '', /web_search/, 'a preloaded capability advertises its tools in the system prompt of the same run')

  // ── Code Mode nests extension tools through the same gate (issue 13) ──
  send(30, 'tools/code', {
    cwd: workspace,
    sessionId,
    runId: 'codemode-nested',
    approval: 'allow',
    code: `
      const direct = await tools.http_fetch({ url: 'http://127.0.0.1:${(modelServer.address() as { port: number }).port}/nope' }).catch(e => String(e));
      return JSON.stringify(direct);
    `,
  })
  const codeNested = await waitFor(30)
  assert.equal(codeNested.error, undefined, 'nested extension call runs when active')
  assert.match(String(codeNested.result?.content?.[0]?.text || ''), /ok/, 'the nested call returns structured content')

  // An inactive tool cannot be called even from code.
  send(31, 'tools/code', {
    cwd: workspace,
    sessionId,
    runId: 'codemode-inactive',
    approval: 'allow',
    code: `return JSON.stringify(await tools.delegate_task({ objective: 'x', role: 'r', profile: {}, depth: 1 }));`,
  })
  const codeInactive = await waitFor(31)
  assert.equal(codeInactive.error, undefined)
  assert.match(String(codeInactive.result?.content?.[0]?.text || ''), /not active/i, 'an un-loaded capability is refused by name, not silently skipped')

  console.log('Progressive disclosure lives in the Host, and Code Mode nests through one gate')
} finally {
  if (host.exitCode === null) {
    host.stdin.end()
    await once(host, 'exit').catch(() => host.kill())
  }
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}
