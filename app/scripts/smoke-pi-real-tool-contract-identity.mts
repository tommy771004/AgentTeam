import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

type Message = {
  id?: number
  event?: string
  payload?: Record<string, any>
  result?: Record<string, any>
  error?: { code: string; message: string }
}

type ModelRequest = {
  tools?: Array<{ function?: { name?: string } }>
  messages?: unknown[]
}

const agentDir = await mkdtemp(join(tmpdir(), 'pi-real-contract-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-real-contract-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-real-contract-workspace-'))
const statePath = join(stateDir, 'state.json')
const fixtureText = 'contract-identity-fixture-7d2d8c'
await writeFile(join(workspace, 'identity.txt'), fixtureText)

const requests: ModelRequest[] = []
const scriptedCalls: Array<{ name: string; args: Record<string, unknown> } | undefined> = [
  { name: 'read', args: { path: 'identity.txt' } },
  { name: 'update_plan', args: { steps: [{ id: 'identity', title: 'Contract identity qualified', status: 'done' }] } },
  // Empty text is valid against the model-visible string schema, then the
  // pack returns its expected failure as structured content rather than throw.
  { name: 'tool_search', args: { query: '' } },
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
  const call = scriptedCalls.shift()
  const chunk = (delta: unknown, finish: string | null) => sse({
    id: `real-contract-${requests.length}`,
    object: 'chat.completion.chunk',
    model: 'smoke-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (call) {
    response.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${requests.length}_${call.name}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: '工具失敗已結構化處理，回合繼續完成。' }, null))
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

const hostEnv = {
  ...process.env,
  SUBAGENTS_PI_HOST_STATE_PATH: statePath,
  SUBAGENTS_PI_AGENT_DIR: agentDir,
}

function startHost() {
  const child = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
    env: hostEnv,
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const output = createInterface({ input: child.stdout })
  const messages: Message[] = []
  output.on('line', (line) => messages.push(JSON.parse(line) as Message))
  const wait = async (id: number) => {
    for (;;) {
      const found = messages.find((message) => message.id === id)
      if (found) return found
      await Promise.race([
        once(output, 'line'),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout waiting for ${id}`)), 25_000)),
      ])
    }
  }
  const send = (id: number, method: string, params: Record<string, unknown> = {}) => child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  const stop = async () => {
    child.stdin.end()
    if (child.exitCode === null) await once(child, 'exit')
    output.close()
  }
  return { child, messages, wait, send, stop }
}

const identityFields = (entry: Record<string, any>) => ({
  contractRevision: entry.contractRevision,
  schemaDigest: entry.schemaDigest,
  toolSource: entry.toolSource,
  toolPack: entry.toolPack,
  invocationOrigin: entry.invocationOrigin,
})

let sessionId = ''
try {
  const host = startHost()
  host.send(1, 'initialize', { protocolVersion: 2, capabilities: ['tool-contract-v1'] })
  assert.equal((await host.wait(1)).error, undefined)
  host.send(2, 'sessions/create', { title: 'Real Pi contract identity' })
  sessionId = String((await host.wait(2)).result?.sessionId)
  host.send(3, 'turn/submit', {
    sessionId,
    runId: 'real-contract-run',
    cwd: workspace,
    prompt: 'Read the fixture, update the plan, exercise expected failure, then finish.',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: true },
  })
  const settled = await host.wait(3)
  assert.equal(settled.error, undefined)
  assert.equal(settled.result?.settlement, 'answered', 'structured tool failure did not abort the Pi turn')
  assert.equal(requests.length, 4, 'production Pi session continued after all three real tool calls')

  const observedStarts = host.messages
    .filter((message) => message.event === 'host/turn-item' && message.payload?.item?.type === 'tool_execution_start')
    .map((message) => message.payload?.item?.toolName)
  assert.deepEqual(observedStarts, ['read', 'update_plan', 'tool_search'], 'protocol events observe model-originated production execution')
  assert.ok(host.messages.some((message) => message.event === 'host/plan-updated'), 'always-active Extension Pack produced its external plan event')
  assert.match(JSON.stringify(requests[1]?.messages), new RegExp(fixtureText), 'builtin read returned the filesystem fixture to the next model request')
  assert.match(JSON.stringify(requests[3]?.messages), /\\?"ok\\?":false/, 'expected pack failure returned structured content to the model')

  const modelToolNames = (requests[0]?.tools || []).map((tool) => tool.function?.name)
  assert.ok(modelToolNames.includes('read'))
  assert.ok(modelToolNames.includes('update_plan'))
  assert.ok(!modelToolNames.includes('http_fetch'), 'catalog-only inactive tool was not model-callable')
  assert.ok(requests.every((request) => !(request.tools || []).some((tool) => tool.function?.name === 'http_fetch')))

  const recordEntries = settled.result?.record?.entries || []
  const calls = recordEntries.filter((entry: any) => entry.kind === 'tool-call')
  const results = recordEntries.filter((entry: any) => entry.kind === 'tool-result')
  assert.deepEqual(calls.map((entry: any) => entry.tool), ['read', 'update_plan', 'tool_search'])
  for (const call of calls) {
    const result = results.find((entry: any) => entry.callId === call.callId)
    assert.ok(result, `${call.tool} has a matching durable result`)
    assert.deepEqual(identityFields(result), identityFields(call), `${call.tool} call and result retain one frozen identity`)
    assert.equal(call.contractRevision, settled.result?.contractRevision)
    assert.match(String(call.schemaDigest), /^[a-f0-9]{64}$/)
    assert.equal(call.invocationOrigin, 'model')

    host.send(10 + calls.indexOf(call), 'tools/contract', {
      sessionId,
      revision: call.contractRevision,
      toolName: call.tool,
    })
    const described = await host.wait(10 + calls.indexOf(call))
    assert.equal(described.error, undefined)
    assert.equal(described.result?.contractTool?.schemaDigest, call.schemaDigest, `${call.tool} description digest matches actual invocation`)
    assert.equal(described.result?.contractTool?.source, call.toolSource)
    assert.equal(described.result?.contractTool?.pack, call.toolPack)
  }
  assert.equal(calls.find((entry: any) => entry.tool === 'read')?.toolSource, 'builtin')
  assert.deepEqual(
    { source: calls.find((entry: any) => entry.tool === 'update_plan')?.toolSource, pack: calls.find((entry: any) => entry.tool === 'update_plan')?.toolPack },
    { source: 'extension-pack', pack: 'planning-pack' },
  )

  host.send(20, 'tools/list', { sessionId, requireContract: true })
  const catalog = await host.wait(20)
  assert.equal(catalog.result?.catalog?.find((entry: any) => entry.name === 'http_fetch')?.active, false)
  host.send(21, 'tools/contract', { sessionId, revision: settled.result?.contractRevision, toolName: 'http_fetch' })
  assert.equal((await host.wait(21)).error?.code, 'tool_contract_inactive')

  host.send(22, 'sessions/record', { sessionId, limit: 100 })
  const paged = await host.wait(22)
  const pagedCalls = paged.result?.page?.entries?.filter((entry: any) => entry.kind === 'tool-call') || []
  assert.deepEqual(pagedCalls.map(identityFields), calls.map(identityFields), 'protocol page exposes the same durable identities')
  await host.stop()

  const persisted = JSON.parse(await readFile(statePath, 'utf8'))
  const persistedCalls = persisted.sessions.find((session: any) => session.id === sessionId)?.record?.entries?.filter((entry: any) => entry.kind === 'tool-call') || []
  assert.deepEqual(persistedCalls.map(identityFields), calls.map(identityFields), 'identity survives filesystem persistence')

  const restarted = startHost()
  try {
    restarted.send(30, 'initialize', { protocolVersion: 2, capabilities: ['tool-contract-v1'] })
    assert.equal((await restarted.wait(30)).error, undefined)
    restarted.send(31, 'sessions/record', { sessionId, limit: 100 })
    const afterRestart = await restarted.wait(31)
    const restartedCalls = afterRestart.result?.page?.entries?.filter((entry: any) => entry.kind === 'tool-call') || []
    assert.deepEqual(restartedCalls.map(identityFields), calls.map(identityFields), 'identity survives Host restart')
  } finally {
    await restarted.stop()
  }

  console.log('Real Pi builtin and Extension Pack calls retain exact contract identity through durable Turn Record')
} finally {
  modelServer.close()
  await Promise.all([
    rm(agentDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(workspace, { recursive: true, force: true }),
  ])
}
