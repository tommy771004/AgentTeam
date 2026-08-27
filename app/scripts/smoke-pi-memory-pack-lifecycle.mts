import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

type Message = {
  id?: number
  event?: string
  payload?: Record<string, any>
  result?: Record<string, any>
  error?: { code: string; message: string }
}

type ScriptedCall = { id: string; name: string; args: Record<string, unknown> }

const agentDir = await mkdtemp(join(tmpdir(), 'pi-memory-pack-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-memory-pack-state-'))
const projectA = await mkdtemp(join(tmpdir(), 'pi-memory-project-a-'))
const projectB = await mkdtemp(join(tmpdir(), 'pi-memory-project-b-'))
const statePath = join(stateDir, 'state.json')
const databasePath = join(stateDir, 'memory.sqlite')

const modelRequests: Array<Record<string, any>> = []
let activePlan: ScriptedCall[] = []
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') return response.writeHead(404).end()
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (part) => { body += part })
  await once(request, 'end')
  modelRequests.push(JSON.parse(body))
  const call = activePlan.shift()
  const chunk = (delta: unknown, finish: string | null) => sse({
    id: `memory-pack-${modelRequests.length}`,
    object: 'chat.completion.chunk',
    model: 'smoke-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (call) {
    response.write(chunk({
      role: 'assistant',
      tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }],
    }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: '記憶工具生命週期完成。' }, null))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})

await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('memory model fixture did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({
  providers: {
    loopback: {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      api: 'openai-completions',
      models: [{ id: 'smoke-model', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 128_000 }],
    },
  },
}))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'smoke' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const hostEnv = {
  ...process.env,
  SUBAGENTS_PI_HOST_STATE_PATH: statePath,
  SUBAGENTS_DURABLE_MEMORY_DB_PATH: databasePath,
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
  const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  }
  const stop = async () => {
    child.stdin.end()
    if (child.exitCode === null) await once(child, 'exit')
    output.close()
  }
  return { messages, wait, send, stop }
}

const profile = {
  provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off',
  approvalMode: 'full', unattended: true, compaction: 'manual',
}

async function submitMemoryTurn(
  host: ReturnType<typeof startHost>,
  id: number,
  sessionId: string,
  runId: string,
  project: string,
  plan: ScriptedCall[],
  policy: { memoryWriteEnabled?: boolean; temporary?: boolean } = {},
) {
  activePlan = [...plan]
  const requestStart = modelRequests.length
  host.send(id, 'turn/submit', {
    sessionId,
    runId,
    cwd: project,
    prompt: `Execute memory lifecycle ${runId}`,
    profile,
    preloadedCapabilities: ['memory'],
    contextPolicy: {
      memoryEnabled: true,
      memoryWriteEnabled: policy.memoryWriteEnabled !== false,
      referenceChatHistory: false,
      temporary: policy.temporary === true,
      project,
    },
  })
  const settled = await host.wait(id)
  assert.equal(settled.error, undefined)
  assert.equal(settled.result?.settlement, 'answered')
  assert.equal(activePlan.length, 0, `${runId} executed every scripted real Pi call`)
  return { settled, requests: modelRequests.slice(requestStart) }
}

let sessionId = ''
let runningHost: ReturnType<typeof startHost> | undefined
try {
  const host = startHost()
  runningHost = host
  host.send(1, 'initialize', { protocolVersion: 5, capabilities: ['tool-contract-v1', 'memory-store-v1'] })
  assert.equal((await host.wait(1)).error, undefined)
  host.send(2, 'sessions/create', { title: 'Memory Pack lifecycle' })
  sessionId = String((await host.wait(2)).result?.sessionId)

  const projectATurn = await submitMemoryTurn(host, 3, sessionId, 'memory-a', projectA, [
    { id: 'call_set_a', name: 'memory_set', args: { key: 'shared-rule', text: 'Project A private rule' } },
    { id: 'call_append_a', name: 'memory_append', args: { text: 'Append exactly once' } },
    { id: 'call_append_a', name: 'memory_append', args: { text: 'Append exactly once' } },
    { id: 'call_get_a', name: 'memory_get', args: { id: 'shared-rule' } },
    { id: 'call_search_a', name: 'memory_search', args: { query: 'Project A' } },
  ])
  assert.match(JSON.stringify(projectATurn.requests), /Project A private rule/, 'real memory get/search payload reached the model')
  const writes = projectATurn.settled.result?.record?.entries?.filter((entry: any) => entry.kind === 'tool-result' && entry.memoryWrite) || []
  assert.equal(writes.length, 3, 'set and both append attempts have durable receipts')
  assert.deepEqual(writes.slice(1).map((entry: any) => entry.memoryWrite.revision), [2, 2], 'same run/call retry reuses one append revision')
  assert.deepEqual(writes.map((entry: any) => entry.callId), ['call_set_a', 'call_append_a', 'call_append_a'])
  assert.ok(writes.every((entry: any) => entry.memoryWrite.callId === entry.callId))

  const writtenEvents = host.messages.filter((message) => message.event === 'host/context' && message.payload?.runId === 'memory-a' && message.payload?.phase === 'memory-written')
  const changedEvents = host.messages.filter((message) => message.event === 'memory/changed')
  assert.equal(writtenEvents.length, 2, 'retry does not republish memory-written')
  assert.equal(changedEvents.length, 2, 'retry does not republish memory/changed')
  assert.deepEqual(writtenEvents.map((event) => event.payload?.revision), [1, 2])
  assert.equal(JSON.stringify([...writtenEvents, ...changedEvents]).includes('private rule'), false, 'activity events contain no private body')
  assert.deepEqual(
    writtenEvents.map((event) => [event.payload?.callId, event.payload?.logicalKey, event.payload?.revision]),
    writes.slice(0, 2).map((entry: any) => [entry.memoryWrite.callId, entry.memoryWrite.logicalKey, entry.memoryWrite.revision]),
    'Host context and Turn Record reconcile on one write identity',
  )

  const projectBTurn = await submitMemoryTurn(host, 4, sessionId, 'memory-b', projectB, [
    { id: 'call_set_b', name: 'memory_set', args: { key: 'shared-rule', text: 'Project B private rule' } },
    { id: 'call_get_b', name: 'memory_get', args: { id: 'shared-rule' } },
  ])
  assert.match(JSON.stringify(projectBTurn.requests), /Project B private rule/)
  assert.doesNotMatch(JSON.stringify(projectBTurn.requests), /Project A private rule/, 'same key stays project-scoped')

  const beforeDeniedChanges = host.messages.filter((message) => message.event === 'memory/changed').length
  const writeDisabled = await submitMemoryTurn(host, 5, sessionId, 'memory-write-disabled', projectA, [
    { id: 'call_write_disabled', name: 'memory_set', args: { key: 'denied', text: 'must not commit' } },
  ], { memoryWriteEnabled: false })
  assert.match(JSON.stringify(writeDisabled.requests), /forbidden/, 'write-disabled returns typed failure content')
  const disabledResult = writeDisabled.settled.result?.record?.entries?.find((entry: any) => entry.kind === 'tool-result' && entry.callId === 'call_write_disabled')
  assert.equal(disabledResult?.settlement, 'failed')
  assert.equal(disabledResult?.memoryWrite, undefined)

  const temporary = await submitMemoryTurn(host, 6, sessionId, 'memory-temporary', projectA, [
    { id: 'call_temporary', name: 'memory_append', args: { text: 'must not commit' } },
  ], { temporary: true })
  assert.match(JSON.stringify(temporary.requests), /forbidden/, 'temporary returns typed failure content')
  assert.equal(host.messages.filter((message) => message.event === 'memory/changed').length, beforeDeniedChanges, 'policy failures never publish a commit')
  await host.stop()
  runningHost = undefined

  const restarted = startHost()
  runningHost = restarted
  try {
    restarted.send(20, 'initialize', { protocolVersion: 5, capabilities: ['tool-contract-v1', 'memory-store-v1'] })
    assert.equal((await restarted.wait(20)).error, undefined)
    const afterRestart = await submitMemoryTurn(restarted, 21, sessionId, 'memory-restart-a', projectA, [
      { id: 'call_restart_get', name: 'memory_get', args: { id: 'shared-rule' } },
      { id: 'call_restart_search', name: 'memory_search', args: { query: 'Project A' } },
    ])
    assert.match(JSON.stringify(afterRestart.requests), /Project A private rule/, 'committed payload survives Host restart')
    assert.doesNotMatch(JSON.stringify(afterRestart.requests), /Project B private rule/, 'restart recall remains project-scoped')
  } finally {
    await restarted.stop()
    runningHost = undefined
  }

  console.log('Real Pi Memory Pack lifecycle: scoped commit receipts, retry, typed denial, Turn Record reconciliation, and restart durability passed')
} finally {
  await runningHost?.stop().catch(() => undefined)
  modelServer.close()
  await Promise.all([
    rm(agentDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(projectA, { recursive: true, force: true }),
    rm(projectB, { recursive: true, force: true }),
  ])
}
