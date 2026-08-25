import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

type Message = { id?: number; result?: Record<string, any>; error?: { code: string; message: string } }
type ModelRequest = { tools?: Array<{ function?: { name?: string; description?: string; parameters?: Record<string, unknown> } }>; messages?: unknown[] }

const agentDir = await mkdtemp(join(tmpdir(), 'pi-mcp-reload-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-mcp-reload-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-mcp-reload-workspace-'))
const fixture = resolve(import.meta.dirname, 'fixtures/pi-mcp-reload-fixture.mjs')
const stateFile = join(stateDir, 'reload.json')
const emptyFile = join(stateDir, 'empty.json')
const invalidFile = join(stateDir, 'invalid.json')
const v1 = {
  resultPrefix: 'v1',
  tools: [{ name: 'inspect-item', description: 'Reload fixture v1', inputSchema: { type: 'object', properties: { itemId: { type: 'string', minLength: 3 } }, required: ['itemId'], additionalProperties: false } }],
}
const v2 = {
  resultPrefix: 'v2',
  tools: [{ name: 'inspect-item', description: 'Reload fixture v2', inputSchema: { type: 'object', properties: { count: { type: 'integer', minimum: 2, maximum: 4 } }, required: ['count'], additionalProperties: false } }],
}
await Promise.all([
  writeFile(stateFile, JSON.stringify(v1)),
  writeFile(emptyFile, JSON.stringify({ tools: [] })),
  writeFile(invalidFile, JSON.stringify({ tools: [{ name: 'bad-schema', description: 'Invalid schema fixture', inputSchema: { type: 'string' } }] })),
])

const requests: ModelRequest[] = []
const nativeName = 'mcp_reload-mcp_inspect-item'
const scripts: Array<{ name: string; args: Record<string, unknown> } | undefined> = [
  { name: 'load_capability', args: { id: 'mcp-bridge' } },
  { name: nativeName, args: { itemId: 'alpha' } },
  undefined,
  { name: nativeName, args: { itemId: 'old-shape' } },
  { name: nativeName, args: { count: 2 } },
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
  // Change the upstream after Pi already emitted request #2 with its frozen v1
  // schema. The registered native definition and validation must remain v1.
  if (requests.length === 2) await writeFile(stateFile, JSON.stringify(v2))
  const script = scripts.shift()
  const chunk = (delta: unknown, finish: string | null) => sse({ id: `mcp-reload-${requests.length}`, object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta, finish_reason: finish }] })
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (script) {
    response.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${requests.length}`, type: 'function', function: { name: script.name, arguments: JSON.stringify(script.args) } }] }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: `turn ${requests.length} complete` }, null))
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
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'host-state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as Message))
const wait = async (id: number) => {
  for (;;) {
    const found = messages.find((message) => message.id === id)
    if (found) return found
    await Promise.race([once(output, 'line'), new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout waiting for ${id}: ${JSON.stringify(messages.slice(-5))}`)), 30_000))])
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
const install = async (id: number, extension: Record<string, unknown>) => {
  send(id, 'extensions/install', extension)
  assert.equal((await wait(id)).error, undefined)
}

try {
  send(1, 'initialize', { protocolVersion: 2, capabilities: ['tool-contract-v1'] })
  assert.equal((await wait(1)).error, undefined)
  const config = (path: string, extraEnv: Record<string, string> = {}) => ({ command: process.execPath, args: [fixture], env: { PI_MCP_RELOAD_STATE: path, ...extraEnv } })
  await install(2, { id: 'reload-mcp', name: 'Reload MCP', version: '1', kind: 'mcp', source: 'fixture', trusted: true, tools: ['inspect-item'], mcp: config(stateFile) })
  await install(3, { id: 'collision.one', name: 'Collision A', version: '1', kind: 'mcp', source: 'fixture-a', trusted: true, tools: ['inspect-item'], mcp: config(stateFile) })
  await install(4, { id: 'collision_one', name: 'Collision B', version: '1', kind: 'mcp', source: 'fixture-b', trusted: true, tools: ['inspect-item'], mcp: config(stateFile) })
  await install(5, { id: 'disabled-mcp', name: 'Disabled', version: '1', kind: 'mcp', source: 'fixture', trusted: true, enabled: false, tools: ['disabled-tool'], mcp: config(stateFile) })
  await install(6, { id: 'missing-mcp', name: 'Missing', version: '1', kind: 'mcp', source: 'fixture', trusted: true, tools: ['ghost-tool'], mcp: config(emptyFile) })
  await install(7, { id: 'invalid-mcp', name: 'Invalid', version: '1', kind: 'mcp', source: 'fixture', trusted: true, tools: ['bad-schema'], mcp: config(invalidFile) })
  await install(8, { id: 'transport-mcp', name: 'Transport', version: '1', kind: 'mcp', source: 'fixture', trusted: true, tools: ['offline-tool'], mcp: config(emptyFile, { PI_MCP_RELOAD_TRANSPORT_FAIL: '1' }) })
  send(9, 'sessions/create', { title: 'MCP reload qualification' })
  const sessionId = String((await wait(9)).result?.sessionId)
  send(10, 'tools/list', { sessionId, requireContract: true })
  const initialCatalog = (await wait(10)).result?.catalog || []
  const collisions = initialCatalog.filter((entry: any) => entry.upstreamToolName === 'inspect-item' && String(entry.extensionId).startsWith('collision'))
  assert.equal(collisions.length, 2)
  assert.notEqual(collisions[0].name, collisions[1].name)
  assert.ok(collisions.every((entry: any) => /^mcp_collision_one_inspect-item_[a-f0-9]{8}$/.test(entry.name)))
  for (const [tool, category] of [['disabled-tool', 'disabled'], ['ghost-tool', 'missing'], ['bad-schema', 'schema-invalid'], ['offline-tool', 'transport-failed']] as const) {
    const entry = initialCatalog.find((candidate: any) => candidate.upstreamToolName === tool)
    assert.equal(entry?.available, false)
    assert.match(String(entry?.reason), new RegExp(category))
  }

  send(11, 'turn/submit', { sessionId, runId: 'mcp-reload-v1', cwd: workspace, prompt: 'Load and call v1.', profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false } })
  const first = await wait(11)
  assert.equal(first.error, undefined)
  const v1Definition = requests[1]?.tools?.find((tool) => tool.function?.name === nativeName)?.function
  assert.equal(v1Definition?.description, 'Reload fixture v1')
  assert.deepEqual(v1Definition?.parameters, v1.tools[0].inputSchema)
  assert.ok(!requests[1]?.tools?.some((tool) => tool.function?.name === 'mcp_call' || tool.function?.name === 'mcp_list_tools'), 'generic bridge is hidden from ordinary model invocation')
  assert.match(JSON.stringify(requests[2]?.messages), /v2:inspect-item.*itemId/) // transport sees live upstream, contract remains frozen v1
  const firstCall = first.result?.record?.entries?.find((entry: any) => entry.kind === 'tool-call' && entry.tool === nativeName)
  assert.ok(firstCall?.schemaDigest)

  send(12, 'tools/list', { sessionId, requireContract: true })
  const stale = (await wait(12)).result?.catalog?.find((entry: any) => entry.name === nativeName)
  assert.equal(stale?.available, false)
  assert.match(String(stale?.reason), /stale/)

  send(13, 'extensions/reload', { id: 'reload-mcp' })
  assert.equal((await wait(13)).error, undefined)
  send(14, 'turn/submit', { sessionId, runId: 'mcp-reload-v2', cwd: workspace, prompt: 'Call v2.', profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false } })
  const second = await wait(14)
  assert.equal(second.error, undefined)
  const v2Definition = requests[3]?.tools?.find((tool) => tool.function?.name === nativeName)?.function
  assert.equal(v2Definition?.description, 'Reload fixture v2')
  assert.deepEqual(v2Definition?.parameters, v2.tools[0].inputSchema)
  assert.notEqual(second.result?.contractDigest, first.result?.contractDigest)
  const secondCall = second.result?.record?.entries?.find((entry: any) => entry.kind === 'tool-call' && entry.tool === nativeName)
  assert.notEqual(secondCall?.schemaDigest, firstCall?.schemaDigest)
  assert.ok(!requests[3]?.tools?.some((tool) => tool.function?.name === 'mcp_call' || tool.function?.name === 'mcp_list_tools'))
  assert.match(JSON.stringify(requests[4]?.messages), /count.*required|required.*count/, 'v2 native validation rejects the stale v1 argument shape')
  assert.match(JSON.stringify(requests[5]?.messages), /v2:inspect-item.*count/, 'v2 valid arguments reach the existing Host MCP transport')
  console.log('MCP names are collision-safe; reload is next-turn only; native contracts own activation, validation, execution, and structured failure states')
} finally {
  host.stdin.end()
  if (host.exitCode === null) await once(host, 'exit').catch(() => host.kill())
  modelServer.close()
  modelServer.closeAllConnections()
  await Promise.all([rm(agentDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })])
}
