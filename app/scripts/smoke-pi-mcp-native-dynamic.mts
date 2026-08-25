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
const wait = async (id: number) => {
  for (;;) {
    const found = messages.find((message) => message.id === id)
    if (found) return found
    await Promise.race([once(output, 'line'), new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout waiting for ${id}: ${JSON.stringify(messages.slice(-5))}`)), 25_000))])
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)

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

  send(5, 'turn/submit', {
    sessionId, runId: 'mcp-native-run', cwd: workspace, prompt: 'Load and exercise the MCP native tool.',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false },
  })
  const settled = await wait(5)
  assert.equal(settled.error, undefined)
  assert.equal(settled.result?.settlement, 'answered', 'expected and transport failures remain recoverable tool results')
  assert.equal(requests.length, 6)
  assert.ok(!(requests[0]?.tools || []).some((tool) => tool.function?.name === dynamicName), 'MCP schema is not active before capability load')
  const activeDefinition = (requests[2]?.tools || []).find((tool) => tool.function?.name === dynamicName)?.function
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
  assert.ok(evidence.some((entry: any) => entry.phase === 'decision' && entry.decision === 'allow'))
  assert.ok(evidence.every((entry: any) => entry.runId === 'mcp-native-run' && typeof entry.callId === 'string'))

  const revision = calls[0].contractRevision
  send(6, 'tools/contract', { sessionId, revision, toolName: dynamicName })
  const described = await wait(6)
  assert.equal(described.error, undefined)
  assert.equal(described.result?.contract?.contractDigest, calls[0].contractDigest)
  assert.equal(described.result?.contractTool?.schemaDigest, calls[0].schemaDigest)
  assert.equal(described.result?.contractTool?.extensionId, 'fixture-mcp')
  assert.equal(described.result?.contractTool?.upstreamToolName, 'inspect-item')
  console.log('MCP native dynamic tool freezes schema, activates same-turn, reuses Host transport, and records policy identity')
} finally {
  host.stdin.end()
  if (host.exitCode === null) await once(host, 'exit').catch(() => host.kill())
  modelServer.close()
  await Promise.all([rm(agentDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })])
}
