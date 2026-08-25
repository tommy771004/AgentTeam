import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

type Message = { id?: number; result?: Record<string, any>; error?: { code: string; message: string } }
type RequestBody = { tools?: Array<{ function?: { name?: string } }>; messages?: unknown[] }

const agentDir = await mkdtemp(join(tmpdir(), 'pi-cap-contract-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-cap-contract-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-cap-contract-cwd-'))
const requests: RequestBody[] = []
const scripts: Array<{ tool: string; args: Record<string, unknown> } | undefined> = [
  { tool: 'tool_search', args: { query: 'http_fetch' } },
  { tool: 'load_capability', args: { id: 'web-research' } },
  { tool: 'http_fetch', args: { url: 'http://127.0.0.1/not-found' } },
  undefined,
  { tool: 'tool_search', args: { query: 'http_fetch' } },
  undefined,
]
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const chunk = (delta: unknown, finish: string | null) => sse({
  id: `cap-contract-${requests.length}`,
  object: 'chat.completion.chunk',
  model: 'smoke-model',
  choices: [{ index: 0, delta, finish_reason: finish }],
})
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') return response.writeHead(404).end()
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (part) => { body += part })
  await once(request, 'end')
  requests.push(JSON.parse(body) as RequestBody)
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  const script = scripts.shift()
  if (script) {
    response.write(chunk({ role: 'assistant', content: '呼叫工具。' }, null))
    response.write(chunk({ tool_calls: [{ index: 0, id: `call_${requests.length}`, type: 'function', function: { name: script.tool, arguments: JSON.stringify(script.args) } }] }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: '完成。' }, null))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('model server did not bind')
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
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((candidate) => candidate.id === id)
    if (message) return message
    await Promise.race([once(output, 'line'), new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout waiting for ${id}`)), 25_000))])
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)

try {
  send(1, 'initialize', { protocolVersion: 2, capabilities: ['tool-contract-v1'] })
  assert.equal((await waitFor(1)).error, undefined)
  send(2, 'sessions/create', { title: 'Capability contract revision' })
  const sessionId = String((await waitFor(2)).result?.sessionId)
  send(3, 'tools/list', { requireContract: true })
  const before = await waitFor(3)
  assert.equal(before.result?.catalog?.find((entry: any) => entry.name === 'http_fetch')?.active, false, 'deferred tool starts inactive in compact catalog')
  send(4, 'turn/submit', { sessionId, runId: 'cap-contract-run-1', cwd: workspace, prompt: '搜尋、載入能力並呼叫工具', profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: true } })
  const first = await waitFor(4)
  assert.equal(first.error, undefined)
  assert.equal(first.result?.settlement, 'answered')
  const firstRevision = Number(first.result?.contractRevision)
  assert.ok(Number.isInteger(firstRevision) && firstRevision > 1, 'loading a deferred capability publishes a new contract revision in the same turn')
  const calls = (first.result?.record?.entries || []).filter((entry: any) => entry.kind === 'tool-call')
  const loadCall = calls.find((entry: any) => entry.tool === 'load_capability')
  const fetchCall = calls.find((entry: any) => entry.tool === 'http_fetch')
  assert.ok(loadCall && fetchCall, 'the model completed both pre- and post-load calls')
  assert.ok((requests[2]?.tools || []).some((tool) => tool.function?.name === 'http_fetch'), 'Pi receives the newly active schema on its next model request')

  assert.match(JSON.stringify(requests[1]?.messages || []), /schemaDigest/, 'tool_search returns schema metadata from the same contract')
  send(5, 'tools/contract', { sessionId, revision: firstRevision, toolName: 'http_fetch' })
  const described = await waitFor(5)
  assert.equal(described.error, undefined)
  assert.equal(described.result?.revisionStatus, 'current')
  assert.equal(described.result?.contractTool?.active, true)
  assert.match(String(described.result?.contractTool?.schemaDigest), /^[a-f0-9]{64}$/)
  send(6, 'tools/list', { sessionId, requireContract: true })
  const catalog = await waitFor(6)
  const catalogEntry = catalog.result?.catalog?.find((entry: any) => entry.name === 'http_fetch')
  assert.equal(catalog.result?.catalogContractRevision, firstRevision)
  assert.equal(catalogEntry?.active, true)
  assert.equal(catalogEntry?.contractRevision, firstRevision)

  // The same session restores the capability for the next turn without
  // mutating the frozen revision above; tool_search reads that latest contract.
  send(7, 'turn/submit', { sessionId, runId: 'cap-contract-run-2', cwd: workspace, prompt: '下一輪搜尋已載入工具', profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: true } })
  const second = await waitFor(7)
  assert.equal(second.error, undefined)
  const secondRevision = Number(second.result?.contractRevision)
  assert.ok(secondRevision > firstRevision)
  const secondSearch = (second.result?.record?.entries || []).find((entry: any) => entry.kind === 'tool-call' && entry.tool === 'tool_search')
  assert.ok(secondSearch, 'the next turn can call tool_search against its preloaded contract')
  assert.ok((requests[4]?.tools || []).some((tool) => tool.function?.name === 'http_fetch'), 'next turn preloads the capability into Pi active tools')
  send(8, 'tools/contract', { sessionId, revision: firstRevision, toolName: 'http_fetch' })
  assert.equal((await waitFor(8)).result?.revisionStatus, 'historical', 'the previous turn remains addressable as historical')
  console.log('Pi capability load publishes same-turn contract revisions and next-turn preload')
} finally {
  host.stdin.end()
  if (host.exitCode === null) await once(host, 'exit').catch(() => host.kill())
  modelServer.close()
  await Promise.all([rm(agentDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })])
}
