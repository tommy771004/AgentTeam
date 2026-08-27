import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { buildPiTurnToolContract, canonicalJson, schemaDigest } from '../electron/piToolContract.ts'

type Message = { id?: number; event?: string; result?: Record<string, any>; error?: { code: string; message: string } }

assert.equal(canonicalJson({ b: { z: 1, a: 2 }, a: 3 }), '{"a":3,"b":{"a":2,"z":1}}')
assert.equal(schemaDigest({ properties: { b: { type: 'string' }, a: { type: 'number' } } }), schemaDigest({ properties: { a: { type: 'number' }, b: { type: 'string' } } }))
assert.notEqual(schemaDigest({ properties: { a: { type: 'string' } } }), schemaDigest({ properties: { a: { type: 'number' } } }))
const fixtureContract = buildPiTurnToolContract('fixture-session', 1, {
  getActiveToolNames: () => ['fixture_builtin'],
  getAllTools: () => [{ name: 'fixture_builtin', description: 'fixture', parameters: { type: 'object' }, sourceInfo: { source: 'builtin' } }],
})
assert.equal(Object.isFrozen(fixtureContract), true)
assert.equal(Object.isFrozen(fixtureContract.tools), true)

const agentDir = await mkdtemp(join(tmpdir(), 'pi-contract-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-contract-state-'))
const malformedStateDir = await mkdtemp(join(tmpdir(), 'pi-contract-malformed-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-contract-cwd-'))
const modelRequests: Array<Record<string, any>> = []
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions') return response.writeHead(404).end()
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => { body += chunk })
  await once(request, 'end')
  modelRequests.push(JSON.parse(body) as Record<string, any>)
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' })
  const chunk = (delta: Record<string, unknown>, finish: string | null) => `data: ${JSON.stringify({ id: 'contract-smoke', object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  response.write(chunk({ role: 'assistant', content: 'contract captured' }, 'stop'))
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('model server did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', models: [{ id: 'smoke-model', name: 'Smoke Model', reasoning: false, input: ['text'], contextWindow: 128_000 }] } } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'smoke' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const hostEnv = { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir }
const startHost = (environment = hostEnv) => {
  const child = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], { env: environment, stdio: ['pipe', 'pipe', 'inherit'] })
  const lines = createInterface({ input: child.stdout })
  const received: Message[] = []
  lines.on('line', (line) => received.push(JSON.parse(line) as Message))
  const wait = async (id: number) => {
    for (;;) {
      const found = received.find((message) => message.id === id)
      if (found) return found
      await new Promise<Array<unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${id}`)), 20_000)
      once(lines, 'line').then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
    })
    }
  }
  const sendRequest = (id: number, method: string, params: Record<string, unknown> = {}) => child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  return { child, lines, wait, send: sendRequest }
}

const stopHost = async (instance: ReturnType<typeof startHost>) => {
  instance.child.stdin.end()
  if (instance.child.exitCode === null) {
    await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { instance.child.kill(); resolve() }, 1_000)
    once(instance.child, 'exit').then(() => { clearTimeout(timer); resolve() })
  })
  }
  instance.lines.close()
}

const host = startHost()
const waitFor = host.wait
const send = host.send

try {
  send(1, 'initialize', { protocolVersion: 2, capabilities: ['tool-contract-v1'] })
  assert.equal((await waitFor(1)).error, undefined)
  send(2, 'sessions/create', { title: 'Tool contract smoke' })
  const sessionId = String((await waitFor(2)).result?.sessionId)
  send(3, 'turn/submit', { sessionId, runId: 'contract-smoke-run', cwd: workspace, prompt: '請回報目前能力', profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: true } })
  const settled = await waitFor(3)
  assert.equal(settled.error, undefined)
  const revision = Number(settled.result?.contractRevision)
  const digest = String(settled.result?.contractDigest)
  assert.ok(Number.isInteger(revision) && revision > 0, 'turn returns an immutable contract revision')
  assert.match(digest, /^[a-f0-9]{64}$/, 'turn returns a SHA-256 contract digest')

  send(4, 'tools/contract', { sessionId, revision, toolName: 'read' })
  const builtin = await waitFor(4)
  assert.equal(builtin.error, undefined)
  assert.equal(builtin.result?.contract?.revision, revision)
  assert.equal(builtin.result?.contract?.contractDigest, digest)
  assert.equal(builtin.result?.contractTool?.name, 'read')
  assert.equal(builtin.result?.contractTool?.source, 'builtin')
  assert.equal(builtin.result?.contractTool?.active, true)
  assert.equal(typeof builtin.result?.contractTool?.parameters, 'object')

  send(5, 'tools/contract', { sessionId, revision, toolName: 'update_plan' })
  const pack = await waitFor(5)
  assert.equal(pack.error, undefined)
  assert.equal(pack.result?.contractTool?.source, 'extension-pack')
  assert.equal(pack.result?.contractTool?.active, true)
  assert.equal(pack.result?.contractTool?.pack, 'planning-pack')

  const modelRequest = modelRequests.at(-1)
  assert.ok(modelRequest, 'loopback provider received a model request')
  const modelTools = Array.isArray(modelRequest?.tools) ? modelRequest.tools : []
  const activeContractTools = (builtin.result?.contract?.tools || []).filter((tool: any) => tool.active)
  assert.equal(modelTools.length, activeContractTools.length, 'model received exactly the active contract tools')
  for (const tool of activeContractTools) {
    const actual = modelTools.find((entry: any) => entry?.function?.name === tool.name)
    assert.ok(actual, `model received ${tool.name}`)
    assert.equal(actual.function.description, tool.description)
    assert.deepEqual(actual.function.parameters, tool.parameters)
  }

  send(6, 'tools/contract', { sessionId, revision, toolName: 'http_fetch' })
  const inactive = await waitFor(6)
  assert.equal(inactive.error?.code, 'tool_contract_inactive')
  send(7, 'tools/contract', { sessionId, revision, toolName: 'not_active_in_this_contract' })
  const unknown = await waitFor(7)
  assert.equal(unknown.error?.code, 'tool_contract_unknown_tool')
  send(8, 'tools/contract', { sessionId: 'other-session', revision, toolName: 'read' })
  const mismatch = await waitFor(8)
  assert.equal(mismatch.error?.code, 'tool_contract_session_mismatch')

  const unnegotiated = startHost()
  try {
    unnegotiated.send(20, 'initialize', { protocolVersion: 2, capabilities: [] })
    assert.equal((await unnegotiated.wait(20)).error, undefined)
    unnegotiated.send(21, 'tools/contract', { sessionId, revision, toolName: 'read' })
    assert.equal((await unnegotiated.wait(21)).error?.code, 'invalid_request')
  } finally {
    await stopHost(unnegotiated)
  }

  send(9, 'turn/submit', { sessionId, runId: 'contract-smoke-run-2', cwd: workspace, prompt: '請再回報一次能力', profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: true } })
  const secondSettled = await waitFor(9)
  const secondRevision = Number(secondSettled.result?.contractRevision)
  assert.equal(secondSettled.error, undefined)
  assert.equal(secondRevision, revision + 1, 'each turn receives a new contract revision')
  send(10, 'tools/contract', { sessionId, revision, toolName: 'read' })
  assert.equal((await waitFor(10)).result?.revisionStatus, 'historical')
  send(11, 'tools/contract', { sessionId, revision: secondRevision, toolName: 'read' })
  assert.equal((await waitFor(11)).result?.revisionStatus, 'current')

  send(12, 'sessions/reset', { sessionId })
  assert.equal((await waitFor(12)).error, undefined)
  send(13, 'tools/contract', { sessionId, revision, toolName: 'read' })
  assert.equal((await waitFor(13)).error?.code, 'tool_contract_stale')
  send(14, 'turn/submit', { sessionId, runId: 'contract-smoke-run-3', cwd: workspace, prompt: '重設後再回報能力', profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: true } })
  const thirdSettled = await waitFor(14)
  const thirdRevision = Number(thirdSettled.result?.contractRevision)
  assert.ok(thirdRevision > secondRevision, 'reset never aliases an earlier contract revision')

  await stopHost(host)
  const restarted = startHost()
  try {
    restarted.send(15, 'initialize', { protocolVersion: 2, capabilities: ['tool-contract-v1'] })
    assert.equal((await restarted.wait(15)).error, undefined)
    restarted.send(16, 'tools/contract', { sessionId, revision: thirdRevision, toolName: 'read' })
    const restored = await restarted.wait(16)
    assert.equal(restored.error, undefined, 'persisted current contract survives Host restart')
    assert.equal(restored.result?.contract?.revision, thirdRevision)
  } finally {
    await stopHost(restarted)
  }

  await writeFile(join(malformedStateDir, 'state.json'), JSON.stringify({
    schemaVersion: 1,
    cursor: 1,
    sessions: [{ id: 'malformed-session', title: 'Malformed', messages: [], toolContracts: [null, { version: 1, revision: 1, tools: 'not-an-array' }] }],
    settings: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: [] },
    queue: [], resources: [], extensions: [],
  }))
  const malformedHost = startHost({ ...hostEnv, SUBAGENTS_PI_HOST_STATE_PATH: join(malformedStateDir, 'state.json') })
  try {
    malformedHost.send(17, 'initialize', { protocolVersion: 2, capabilities: ['tool-contract-v1'] })
    assert.equal((await malformedHost.wait(17)).error, undefined, 'malformed persisted contracts do not crash Host startup')
    malformedHost.send(18, 'sessions/list')
    assert.equal((await malformedHost.wait(18)).error, undefined)
  } finally {
    await stopHost(malformedHost)
  }
  console.log('Pi Host tool contract captures live builtin and Extension Pack schemas over stdio')
} finally {
  await stopHost(host)
  modelServer.close()
  await Promise.all([rm(agentDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true }), rm(malformedStateDir, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })])
}
