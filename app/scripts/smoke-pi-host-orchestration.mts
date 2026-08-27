import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const agentDir = await mkdtemp(join(tmpdir(), 'pi-orchestration-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-orchestration-state-'))
let requests = 0
const requestBodies: string[] = []
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') return response.writeHead(404).end()
  let body = ''
  for await (const chunk of request) body += String(chunk)
  requestBodies.push(body)
  requests += 1
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const content = body.includes('never complete') ? '' : requests === 1 ? '' : `iteration-${requests}`
  response.end(`data: ${JSON.stringify({ id: `orch-${requests}`, object: 'chat.completion.chunk', model: 'orchestration-model', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: `orch-${requests}`, object: 'chat.completion.chunk', model: 'orchestration-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
})
await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('model server did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: {
  baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'test-key',
  models: [
    { id: 'orchestration-model', name: 'Orchestration Model', reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 256 },
    { id: 'small-model', name: 'Small Model', reasoning: false, input: ['text'], contextWindow: 10, maxTokens: 8 },
  ],
} } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'orchestration-model', defaultThinkingLevel: 'off' }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, any>> = []
let hostStopped = false
output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, any>))
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((item) => item.id === id)
    if (message) return message
    await Promise.race([
      once(output, 'line'),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for host response ${id}: ${JSON.stringify(messages)}`)), 5_000)),
    ])
  }
}
try {
  host.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { protocolVersion: 2 } })}\n`)
  await waitFor(1)
  host.stdin.write(`${JSON.stringify({ id: 20, method: 'memory/add', params: { memory: { id: 'session-rule', project: process.cwd(), text: 'Keep model changes scoped to the active session', tags: ['session', 'model'], createdAt: '2026-08-20T00:00:00.000Z' } } })}\n`)
  await waitFor(20)
  host.stdin.write(`${JSON.stringify({ id: 201, method: 'memory/add', params: { memory: { id: 'global-rule', text: 'Global model changes must be reviewed', tags: ['session', 'model'], createdAt: '2026-08-20T00:01:00.000Z' } } })}\n`)
  await waitFor(201)
  host.stdin.write(`${JSON.stringify({ id: 202, method: 'memory/add', params: { memory: { id: 'other-rule', project: join(stateDir, 'other-project'), text: 'OTHER PROJECT PRIVATE model changes', tags: ['session', 'model'], createdAt: '2026-08-20T00:02:00.000Z' } } })}\n`)
  await waitFor(202)
  host.stdin.write(`${JSON.stringify({ id: 220, method: 'memory/add', params: { memory: { id: 'profile:user', text: 'PROFILE ALWAYS use Traditional Chinese', tags: [], createdAt: '2026-08-20T00:03:00.000Z' } } })}\n`)
  await waitFor(220)
  host.stdin.write(`${JSON.stringify({ id: 221, method: 'memory/add', params: { memory: { id: 'memory:document', text: 'DOCUMENT ALWAYS architecture rule', tags: [], createdAt: '2026-08-20T00:04:00.000Z' } } })}\n`)
  await waitFor(221)
  host.stdin.write(`${JSON.stringify({ id: 2, method: 'sessions/create', params: { title: 'Orchestration smoke' } })}\n`)
  const created = await waitFor(2)
  const sessionId = String(created.result.sessionId)
  host.stdin.write(`${JSON.stringify({ id: 3, method: 'turn/submit', params: { sessionId, runId: 'orchestration-run', cwd: process.cwd(), prompt: 'complete the goal about session model changes', contextPolicy: { memoryEnabled: true, memoryWriteEnabled: true, temporary: false, project: process.cwd(), contextWindowTokens: 4096 }, pattern: 'Goal-based', maxIterations: 2, definitionOfDone: 'Pi Core settlement returned', profile: { provider: 'loopback', model: 'orchestration-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false } } })}\n`)
  const settled = await waitFor(3)
  assert.equal(settled.result.settlement, 'answered')
  assert.deepEqual(settled.result.orchestration, { pattern: 'Goal-based', iterations: 2, maxIterations: 2, definitionOfDone: 'Pi Core settlement returned', dodMet: true })
  assert.equal(requests, 2)
  assert.match(requestBodies[0] || '', /Keep model changes scoped to the active session/)
  assert.match(requestBodies[0] || '', /Global model changes must be reviewed/)
  assert.match(requestBodies[0] || '', /PROFILE ALWAYS use Traditional Chinese/)
  assert.match(requestBodies[0] || '', /DOCUMENT ALWAYS architecture rule/)
  assert.doesNotMatch(requestBodies[0] || '', /OTHER PROJECT PRIVATE/)
  const recalledEntry = settled.result.record.entries.find((entry: { kind?: string }) => entry.kind === 'memory-recall')
  assert.equal(recalledEntry.revision, 5)
  assert.deepEqual(recalledEntry.items.map((item: { logicalKey: string; scope: string; memoryKind: string }) => [item.logicalKey, item.scope, item.memoryKind]).sort(), [
    ['global-rule', 'global', 'memory'], ['memory:document', 'global', 'document'], ['profile:user', 'global', 'profile'], ['session-rule', 'project', 'memory'],
  ])
  assert.doesNotMatch(JSON.stringify(recalledEntry), /Keep model changes|Global model changes|OTHER PROJECT PRIVATE|PROFILE ALWAYS|DOCUMENT ALWAYS/)
  const liveRecall = messages.flatMap((item) => item.event === 'host/record-append' ? item.payload?.entries || [] : []).find((entry: { kind?: string }) => entry.kind === 'memory-recall')
  assert.deepEqual(liveRecall, recalledEntry, 'live and returned record use the same provenance entry')
  host.stdin.write(`${JSON.stringify({ id: 204, method: 'sessions/record', params: { sessionId } })}\n`)
  const replayedRecall = (await waitFor(204)).result.page.entries.find((entry: { kind?: string }) => entry.kind === 'memory-recall')
  assert.deepEqual(replayedRecall, recalledEntry, 'replay reads the same Turn Record provenance')

  const requestsBeforeMismatch = requestBodies.length
  host.stdin.write(`${JSON.stringify({ id: 206, method: 'turn/submit', params: { sessionId, runId: 'mismatched-memory-project', cwd: process.cwd(), prompt: 'review model changes', contextPolicy: { memoryEnabled: true, memoryWriteEnabled: false, temporary: false, project: join(stateDir, 'other-project') }, profile: { provider: 'loopback', model: 'orchestration-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false } } })}\n`)
  const mismatched = await waitFor(206)
  assert.equal(mismatched.error?.code, 'invalid_request')
  assert.equal(requestBodies.length, requestsBeforeMismatch, 'a mismatched admitted project never reaches the model')

  const requestsBeforeImplicitProject = requestBodies.length
  host.stdin.write(`${JSON.stringify({ id: 207, method: 'turn/submit', params: { sessionId, runId: 'implicit-memory-project', cwd: process.cwd(), prompt: 'review model changes', contextPolicy: { memoryEnabled: true, memoryWriteEnabled: false, temporary: false }, profile: { provider: 'loopback', model: 'orchestration-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false } } })}\n`)
  const implicitProject = await waitFor(207)
  assert.match(requestBodies[requestsBeforeImplicitProject] || '', /Keep model changes scoped to the active session/)
  assert.equal(implicitProject.result.record.entries.some((entry: { kind?: string }) => entry.kind === 'memory-recall'), true)

  const requestsBeforeTemporary = requestBodies.length
  host.stdin.write(`${JSON.stringify({ id: 205, method: 'turn/submit', params: { sessionId, runId: 'temporary-no-recall', cwd: process.cwd(), prompt: 'complete model changes temporarily', contextPolicy: { memoryEnabled: true, memoryWriteEnabled: true, temporary: true, project: process.cwd() }, profile: { provider: 'loopback', model: 'orchestration-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false } } })}\n`)
  const temporary = await waitFor(205)
  assert.equal(temporary.result.record.entries.some((entry: { kind?: string }) => entry.kind === 'memory-recall'), false)
  assert.doesNotMatch(requestBodies[requestsBeforeTemporary] || '', /Keep model changes|Global model changes|OTHER PROJECT PRIVATE|PROFILE ALWAYS|DOCUMENT ALWAYS/)
  assert.equal(messages.filter((item) => item.event === 'host/turn-item').length > 0, true)
  assert.deepEqual(
    messages.filter((item) => item.event === 'host/orchestration' && item.payload?.runId === 'orchestration-run').map((item) => item.payload.phase),
    ['parse', 'iterate', 'dod', 'replan', 'iterate', 'dod', 'settlement'],
  )
  for (const [id, text, contextWindowTokens] of [
    [6, 'session continuation one', 4096],
    [7, 'session continuation two', 4096],
    [8, 'switch to a smaller-context model', 4096],
  ] as const) {
    const requestIndex = requestBodies.length
    host.stdin.write(`${JSON.stringify({ id, method: 'turn/submit', params: { sessionId, runId: `context-run-${id}`, cwd: process.cwd(), prompt: text, contextPolicy: { memoryEnabled: false, memoryWriteEnabled: true, temporary: false, project: process.cwd(), contextWindowTokens }, profile: { provider: 'loopback', model: id === 8 ? 'small-model' : 'orchestration-model', thinkingLevel: 'off', compaction: 'auto', approvalMode: 'full', unattended: false } } })}\n`)
    const disabled = await waitFor(id)
    assert.equal(disabled.result.settlement, 'answered')
    assert.equal(disabled.result.record.entries.some((entry: { kind?: string }) => entry.kind === 'memory-recall'), false)
    assert.doesNotMatch(requestBodies[requestIndex] || '', /Keep model changes|Global model changes|OTHER PROJECT PRIVATE|PROFILE ALWAYS|DOCUMENT ALWAYS/)
  }
  assert.equal(messages.some((item) => item.event === 'host/context' && item.payload?.phase === 'compacted'), true)
  assert.equal(messages.some((item) => item.event === 'host/context' && item.payload?.phase === 'compacted' && item.payload?.checkpointed === true), true)
  assert.equal((await readdir(join(stateDir, 'run-checkpoints'))).length > 0, true)
  assert.equal(messages.some((item) => item.event === 'host/context' && item.payload?.phase === 'model-switched' && item.payload?.model === 'small-model' && item.payload?.contextWindowTokens === 10), true)
  host.stdin.write(`${JSON.stringify({ id: 9, method: 'memory/list', params: {} })}\n`)
  assert.equal((await waitFor(9)).result.memories.some((memory: { tags?: string[] }) => memory.tags?.includes('compaction')), false)
  host.stdin.write(`${JSON.stringify({ id: 10, method: 'sessions/list', params: {} })}\n`)
  const listedSession = (await waitFor(10)).result.sessions.find((candidate: { id?: string }) => candidate.id === sessionId)
  assert.equal(listedSession.profile.model, 'small-model')
  assert.doesNotMatch(await readFile(listedSession.piSessionFile, 'utf8'), /Keep model changes scoped to the active session/)
  host.stdin.write(`${JSON.stringify({ id: 11, method: 'sessions/fork', params: { sessionId } })}\n`)
  const forked = (await waitFor(11)).result.sessions[0]
  assert.equal(forked.parentSessionId, sessionId)
  assert.equal(forked.profile.model, 'small-model')
  assert.deepEqual(forked.messages, listedSession.messages)
  const requestsBeforeStatelessTurn = requestBodies.length
  host.stdin.write(`${JSON.stringify({ id: 15, method: 'turn/submit', params: { sessionId, runId: 'stateless-context-run', cwd: process.cwd(), prompt: 'stateless current request', contextPolicy: { memoryEnabled: false, memoryWriteEnabled: false, referenceChatHistory: false, temporary: false, project: process.cwd(), contextWindowTokens: 4096 }, profile: { provider: 'loopback', model: 'small-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: false } } })}\n`)
  assert.equal((await waitFor(15)).result.settlement, 'answered')
  const statelessBody = requestBodies[requestsBeforeStatelessTurn] || ''
  assert.match(statelessBody, /stateless current request/)
  assert.doesNotMatch(statelessBody, /session continuation one|complete the goal about session model changes/)
  host.stdin.write(`${JSON.stringify({ id: 16, method: 'sessions/reset', params: { sessionId } })}\n`)
  const reset = (await waitFor(16)).result.sessions[0]
  assert.deepEqual(reset.messages, [])
  assert.equal(reset.profile, undefined)
  assert.equal(reset.piSessionFile, undefined)
  const requestsBeforeResetTurn = requestBodies.length
  host.stdin.write(`${JSON.stringify({ id: 17, method: 'turn/submit', params: { sessionId, runId: 'reset-memory-run', cwd: process.cwd(), prompt: '請記住我的偏好是繁體中文', contextPolicy: { memoryEnabled: true, memoryWriteEnabled: false, temporary: false, project: process.cwd(), contextWindowTokens: 4096 }, profile: { provider: 'loopback', model: 'small-model', thinkingLevel: 'off', compaction: 'auto', approvalMode: 'full', unattended: false } } })}\n`)
  assert.equal((await waitFor(17)).result.settlement, 'answered')
  const resetBody = requestBodies[requestsBeforeResetTurn] || ''
  assert.match(resetBody, /請記住我的偏好是繁體中文/)
  assert.doesNotMatch(resetBody, /session continuation one|complete the goal about session model changes/)
  host.stdin.write(`${JSON.stringify({ id: 18, method: 'memory/list', params: {} })}\n`)
  assert.equal((await waitFor(18)).result.memories.some((item: { tags?: string[] }) => item.tags?.includes('turn-memory')), false, 'write-disabled also denies explicit remember')
  assert.equal(messages.some((item) => item.event === 'host/context' && item.payload?.phase === 'memory-written' && item.payload?.runId === 'reset-memory-run'), false)
  host.stdin.write(`${JSON.stringify({ id: 117, method: 'turn/submit', params: { sessionId, runId: 'explicit-memory-enabled', cwd: process.cwd(), prompt: '請記住我的偏好是繁體中文', contextPolicy: { memoryEnabled: true, memoryWriteEnabled: true, temporary: false, project: process.cwd() }, profile: { provider: 'loopback', model: 'small-model', thinkingLevel: 'off', compaction: 'auto', approvalMode: 'full', unattended: false } } })}\n`)
  assert.equal((await waitFor(117)).result.settlement, 'answered')
  host.stdin.write(`${JSON.stringify({ id: 118, method: 'memory/list', params: {} })}\n`)
  assert.equal((await waitFor(118)).result.memories.some((item: { tags?: string[] }) => item.tags?.includes('explicit')), true)
  assert.equal(messages.some((item) => item.event === 'host/context' && item.payload?.phase === 'memory-written' && item.payload?.runId === 'explicit-memory-enabled'), true)
  host.stdin.write(`${JSON.stringify({ id: 19, method: 'turn/submit', params: { sessionId, runId: 'auto-memory-run', cwd: process.cwd(), prompt: '這個專案一律使用繁體中文 UI', contextPolicy: { memoryEnabled: true, memoryWriteEnabled: true, temporary: false, project: process.cwd(), contextWindowTokens: 4096 }, profile: { provider: 'loopback', model: 'small-model', thinkingLevel: 'off', compaction: 'auto', approvalMode: 'full', unattended: false } } })}\n`)
  assert.equal((await waitFor(19)).result.settlement, 'answered')
  host.stdin.write(`${JSON.stringify({ id: 21, method: 'memory/list', params: {} })}\n`)
  assert.equal((await waitFor(21)).result.memories.some((item: { tags?: string[] }) => item.tags?.includes('auto-learned')), true)
  host.stdin.write(`${JSON.stringify({ id: 4, method: 'sessions/create', params: { title: 'Unmet DoD smoke' } })}\n`)
  const unmetSession = await waitFor(4)
  host.stdin.write(`${JSON.stringify({ id: 5, method: 'turn/submit', params: { sessionId: String(unmetSession.result.sessionId), runId: 'unmet-run', cwd: process.cwd(), prompt: 'never complete', pattern: 'Goal-based', maxIterations: 2, definitionOfDone: 'non-empty assistant result', profile: { provider: 'loopback', model: 'orchestration-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false } } })}\n`)
  const unmet = await waitFor(5)
  assert.equal(unmet.result.settlement, 'failed')
  assert.deepEqual(unmet.result.orchestration, { pattern: 'Goal-based', iterations: 2, maxIterations: 2, definitionOfDone: 'non-empty assistant result', dodMet: false })
  assert.deepEqual(messages.filter((item) => item.event === 'host/orchestration' && item.payload?.runId === 'unmet-run').map((item) => item.payload.phase), ['parse', 'iterate', 'dod', 'replan', 'iterate', 'dod', 'settlement'])

  host.stdin.end()
  await once(host, 'exit')
  hostStopped = true
  const restarted = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
    env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const restartedOutput = createInterface({ input: restarted.stdout })
  const restartedMessages: Array<Record<string, any>> = []
  restartedOutput.on('line', (line) => restartedMessages.push(JSON.parse(line) as Record<string, any>))
  const restartedWaitFor = async (id: number) => {
    for (;;) {
      const found = restartedMessages.find((item) => item.id === id)
      if (found) return found
      await once(restartedOutput, 'line')
    }
  }
  restarted.stdin.write(`${JSON.stringify({ id: 300, method: 'initialize', params: { protocolVersion: 2 } })}\n`)
  await restartedWaitFor(300)
  const requestIndex = requestBodies.length
  restarted.stdin.write(`${JSON.stringify({ id: 301, method: 'turn/submit', params: { sessionId, runId: 'restart-memory-recall', cwd: process.cwd(), prompt: 'review model changes after restart', contextPolicy: { memoryEnabled: true, memoryWriteEnabled: false, temporary: false, project: process.cwd() }, profile: { provider: 'loopback', model: 'orchestration-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false } } })}\n`)
  const restartedTurn = await restartedWaitFor(301)
  assert.match(requestBodies[requestIndex] || '', /Keep model changes scoped to the active session/)
  assert.match(requestBodies[requestIndex] || '', /Global model changes must be reviewed/)
  assert.equal(restartedTurn.result.record.entries.some((entry: { kind?: string }) => entry.kind === 'memory-recall'), true)
  restarted.stdin.end()
  await once(restarted, 'exit')
} finally {
  if (!hostStopped) {
    host.stdin.end()
    await once(host, 'exit')
  }
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi Host owns bounded Goal-based orchestration and exposes iteration settlement')
