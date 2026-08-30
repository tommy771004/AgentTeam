import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

type Message = { id?: number; event?: string; payload?: Record<string, any>; result?: Record<string, any>; error?: { code: string; message: string } }
type ModelRequest = { tools?: Array<{ function?: { name?: string; description?: string; parameters?: Record<string, unknown> } }>; messages?: unknown[] }

const agentDir = await mkdtemp(join(tmpdir(), 'pi-mcp-native-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-mcp-native-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-mcp-native-workspace-'))
const fixtureLog = join(stateDir, 'fixture-calls.jsonl')
const requests: ModelRequest[] = []
const dynamicName = 'mcp_fixture-mcp_inspect-item'
const sceneActiveTools = ['load_capability', 'tool_search']
const turnProfile = {
  provider: 'loopback',
  model: 'smoke-model',
  thinkingLevel: 'off',
  activeTools: sceneActiveTools,
  approvalMode: 'full',
  unattended: false,
  compaction: 'manual',
} as const
const scripts: Array<{ name: string; args: Record<string, unknown> } | undefined> = [
  { name: 'tool_search', args: { query: 'inspect controlled MCP' } },
  { name: 'load_capability', args: { id: 'mcp-bridge' } },
  { name: dynamicName, args: { itemId: 'alpha', options: { limit: 4 } } },
  { name: dynamicName, args: { itemId: 'bravo', mode: 'expected' } },
  { name: dynamicName, args: { itemId: 'crash', mode: 'transport' } },
  undefined,
]

const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') return response.writeHead(404).end()
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (part) => { body += part })
  await once(request, 'end')
  requests.push(JSON.parse(body) as ModelRequest)
  const script = scripts.shift()
  const chunk = (delta: unknown, finish: string | null) => sse({ id: `mcp-native-${requests.length}`, object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta, finish_reason: finish }] })
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (script) {
    response.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${requests.length}`, type: 'function', function: { name: script.name, arguments: JSON.stringify(script.args) } }] }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: 'MCP native dynamic qualification complete.' }, null))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})

await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('model fixture did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', models: [{ id: 'smoke-model', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 128_000 }] } } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'smoke' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as Message))
const hostExited = new Promise<void>((resolveExit) => host.once('exit', () => resolveExit()))
const wait = async (id: number, timeoutMs = 25_000) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = messages.find((message) => message.id === id)
    if (found) return found
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error(`timeout waiting for ${id}: ${JSON.stringify(messages.slice(-5))}`)
    await new Promise<Array<unknown>>((resolve, reject) => {
      let timer: NodeJS.Timeout
      const onLine = (...value: Array<unknown>) => { clearTimeout(timer); output.off('line', onLine); resolve(value) }
      timer = setTimeout(() => { output.off('line', onLine); reject(new Error(`timeout waiting for ${id}: ${JSON.stringify(messages.slice(-5))}`)) }, remaining)
      output.once('line', onLine)
    })
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
  if (host.exitCode !== null || host.stdin.destroyed || host.stdin.writableEnded) return false
  return host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
}
let turnStarted = false
let turnSettled = false

try {
  send(1, 'initialize', { protocolVersion: 2, capabilities: ['tool-contract-v1'] })
  assert.equal((await wait(1)).error, undefined)
  send(2, 'extensions/install', {
    id: 'fixture-mcp', name: 'Fixture MCP', version: '1.0.0', kind: 'mcp', source: 'controlled-fixture', trusted: true,
    tools: ['inspect-item'],
    mcp: { command: process.execPath, args: [resolve(import.meta.dirname, 'fixtures/pi-mcp-native-fixture.mjs')], env: { PI_MCP_NATIVE_FIXTURE_LOG: fixtureLog } },
  })
  assert.equal((await wait(2)).error, undefined)
  send(3, 'sessions/create', { title: 'MCP native dynamic' })
  const sessionId = String((await wait(3)).result?.sessionId)
  send(4, 'tools/list', { sessionId, requireContract: true })
  const before = await wait(4)
  const beforeEntry = before.result?.catalog?.find((entry: any) => entry.name === dynamicName)
  assert.equal(beforeEntry?.active, false)
  assert.equal(beforeEntry?.extensionId, 'fixture-mcp')
  assert.equal(beforeEntry?.upstreamToolName, 'inspect-item')

  send(5, 'settings/update', turnProfile)
  const settingsAck = await wait(5)
  assert.equal(settingsAck.error, undefined, `settings/update failed: ${settingsAck.error?.message}`)
  const acknowledgedSettings = settingsAck.result?.settings
  assert.equal(acknowledgedSettings?.provider, turnProfile.provider)
  assert.equal(acknowledgedSettings?.model, turnProfile.model)
  assert.equal(acknowledgedSettings?.thinkingLevel, turnProfile.thinkingLevel)
  assert.deepEqual(acknowledgedSettings?.activeTools, turnProfile.activeTools)
  assert.equal(acknowledgedSettings?.approvalMode, turnProfile.approvalMode)
  assert.equal(acknowledgedSettings?.unattended, turnProfile.unattended)
  assert.equal(acknowledgedSettings?.compaction, turnProfile.compaction)

  turnStarted = true
  send(6, 'turn/submit', {
    sessionId, runId: 'mcp-native-run', cwd: workspace, prompt: 'Load and exercise the MCP native tool.',
    profile: turnProfile,
  })
  const settled = await wait(6)
  turnSettled = settled.result?.settlement !== undefined
  assert.equal(settled.error, undefined)
  assert.equal(settled.result?.settlement, 'answered', 'expected and transport failures remain recoverable tool results')
  assert.equal(requests.length, 6)
  assert.ok(!(requests[0]?.tools || []).some((tool) => tool.function?.name === dynamicName), 'MCP schema is not active before capability load')
  const activeDefinition = (requests[2]?.tools || []).find((tool) => tool.function?.name === dynamicName)?.function
  assert.ok(activeDefinition, `dynamic MCP definition missing from request 3: ${JSON.stringify({ tools: requests.map((request) => (request.tools || []).map((tool) => tool.function?.name)), messages: requests[2]?.messages })}`)
  assert.equal(activeDefinition?.description, 'Inspect one controlled MCP fixture item')
  assert.deepEqual(activeDefinition?.parameters, {
    type: 'object',
    properties: {
      itemId: { type: 'string', minLength: 3 },
      mode: { type: 'string', enum: ['success', 'expected', 'transport'], default: 'success' },
      options: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 5, default: 2 } }, additionalProperties: false },
    },
    required: ['itemId'],
    additionalProperties: false,
  })
  assert.match(JSON.stringify(requests[3]?.messages), /fixture ok:alpha:4/)
  assert.match(JSON.stringify(requests[4]?.messages), /fixture rejected:bravo/)
  assert.match(JSON.stringify(requests[4]?.messages), /ok\\?":false/, 'expected upstream failure is explicit structured business content')
  assert.match(JSON.stringify(requests[5]?.messages), /transportFailure/)

  const fixtureCalls = (await readFile(fixtureLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(fixtureCalls.slice(0, 2).map((call) => call.arguments), [
    { itemId: 'alpha', options: { limit: 4 } },
    { itemId: 'bravo', mode: 'expected' },
  ])
  const entries = settled.result?.record?.entries || []
  const calls = entries.filter((entry: any) => entry.kind === 'tool-call' && entry.tool === dynamicName)
  const results = entries.filter((entry: any) => entry.kind === 'tool-result' && entry.tool === dynamicName)
  assert.equal(calls.length, 3)
  assert.equal(results.length, 3)
  assert.equal(results[1]?.settlement, 'success', 'expected upstream failure is delivered without aborting Pi')
  assert.equal(results.at(-1)?.settlement, 'failed', 'transport/runtime failure has a failed settlement')
  for (const call of calls) {
    const result = results.find((entry: any) => entry.callId === call.callId)
    assert.ok(result)
    assert.equal(call.toolSource, 'mcp')
    assert.equal(call.toolPack, 'mcp-fixture-mcp')
    assert.equal(call.invocationOrigin, 'model')
    assert.match(String(call.contractDigest), /^[a-f0-9]{64}$/)
    assert.equal(result.contractDigest, call.contractDigest)
    assert.equal(result.schemaDigest, call.schemaDigest)
  }
  const evidence = entries.filter((entry: any) => entry.kind === 'tool-evidence' && entry.tool === dynamicName)
  assert.equal(messages.some((message) => message.event === 'host/approval-requested'), false, 'full attended MCP run should not request interactive approval')
  assert.equal(evidence.filter((entry: any) => entry.phase === 'decision' && entry.decision === 'allow').length, 3, 'each MCP call has one Host allow decision')
  assert.ok(evidence.every((entry: any) => entry.runId === 'mcp-native-run' && typeof entry.callId === 'string'))
  const preflights = entries.filter((entry: any) => entry.kind === 'skill-invocation'
    && entry.invocation?.toolIdentity?.tool === dynamicName)
  assert.equal(preflights.length, 3, 'every model-originated MCP mutation crosses the Host Skill preflight seam')
  for (const entry of preflights) {
    const invocation = entry.invocation
    const call = calls.find((candidate: any) => candidate.callId === invocation.callId)
    assert.ok(call)
    assert.equal(invocation.decision, 'pass-through')
    assert.equal(invocation.matchCount, 0)
    assert.equal(invocation.toolIdentity.toolSource, 'mcp')
    assert.equal(invocation.toolIdentity.contractDigest, call.contractDigest)
    assert.equal(invocation.toolIdentity.schemaDigest, call.schemaDigest)
  }

  const revision = calls[0].contractRevision
  send(7, 'tools/contract', { sessionId, revision, toolName: dynamicName })
  const described = await wait(7)
  assert.equal(described.error, undefined)
  assert.equal(described.result?.contract?.contractDigest, calls[0].contractDigest)
  assert.equal(described.result?.contractTool?.schemaDigest, calls[0].schemaDigest)
  assert.equal(described.result?.contractTool?.extensionId, 'fixture-mcp')
  assert.equal(described.result?.contractTool?.upstreamToolName, 'inspect-item')
  console.log('MCP native dynamic tool freezes schema, activates same-turn, reuses Host transport, and records policy identity')
} finally {
  if (turnStarted && !turnSettled) {
    send(90, 'turn/cancel', { runId: 'mcp-native-run' })
    await wait(90, 2_000).catch(() => undefined)
  }
  if (host.exitCode === null && !host.stdin.destroyed) host.stdin.end()
  if (host.exitCode === null) {
    await Promise.race([hostExited, new Promise((resolveExit) => setTimeout(resolveExit, 4_000))])
    if (host.exitCode === null) host.kill()
    await Promise.race([hostExited, new Promise((resolveExit) => setTimeout(resolveExit, 2_000))])
    if (host.exitCode === null) host.kill('SIGKILL')
  }
  output.close()
  await new Promise<void>((resolveClose) => modelServer.close(() => resolveClose()))
  await Promise.all([rm(agentDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })])
}
