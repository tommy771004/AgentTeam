import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const agentDir = await mkdtemp(join(tmpdir(), 'pi-turn-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-turn-success-state-'))
let requestSeen = false
let holdNextRequest = false
let releaseHeldRequest: (() => void) | undefined
let heldRequestReady = Promise.resolve()
let resolveHeldRequestReady: (() => void) | undefined
let requestBody: { tools?: unknown[]; messages?: Array<{ role?: string; content?: unknown }> } | undefined
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  requestSeen = true
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { tools?: unknown[] }
  if (holdNextRequest) {
    holdNextRequest = false
    await new Promise<void>((resolveRequest) => {
      releaseHeldRequest = resolveRequest
      resolveHeldRequestReady?.()
    })
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  response.write(`data: ${JSON.stringify({ id: 'smoke-completion', object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'hello from Pi' }, finish_reason: null }] })}\n\n`)
  response.write(`data: ${JSON.stringify({ id: 'smoke-completion', object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((resolveListen) => modelServer.listen(0, '127.0.0.1', resolveListen))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('Loopback model server did not bind')
const baseUrl = `http://127.0.0.1:${address.port}/v1`
await writeFile(join(agentDir, 'models.json'), JSON.stringify({
  providers: {
    loopback: {
      baseUrl,
      api: 'openai-completions',
      apiKey: 'test-key',
      models: [{ id: 'smoke-model', name: 'Smoke Model', reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 256 }],
    },
  },
}))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))
await writeFile(join(stateDir, 'AGENTS.md'), 'PROJECT_SENTINEL：專案規則\napi_key=PROJECT_SECRET')

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir, SUBAGENTS_OUTBOUND_POLICY_DIR: join(stateDir, 'outbound-policy') },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, any>> = []
output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, any>))
const waitFor = async (predicate: (message: Record<string, any>) => boolean) => {
  for (;;) {
    const current = messages.find(predicate)
    if (current) return current
    await once(output, 'line')
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)

try {
  send(1, 'initialize', { protocolVersion: 5, capabilities: ['instructions-v1'] })
  await waitFor((message) => message.id === 1)
  send(2, 'sessions/create', { title: 'Success smoke' })
  const created = await waitFor((message) => message.id === 2)
  const sessionId = String(created.result.sessionId)
  send(3, 'settings/update', { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: ['read'] })
  await waitFor((message) => message.id === 3)
  send(31, 'instructions/v1/save', { expectedRevision: 0, globalCustomInstructions: 'GLOBAL_SENTINEL：全域規則\napi_key=GLOBAL_SECRET' })
  const instructionSaved = await waitFor((message) => message.id === 31)
  assert.equal(instructionSaved.result.instructions.revision, 1)
  send(4, 'turn/submit', {
    sessionId,
    runId: 'smoke-success-run',
    cwd: stateDir,
    prompt: 'say hello',
    contextPolicy: { memoryEnabled: false, memoryWriteEnabled: false, referenceChatHistory: true, temporary: false, outboundShellMode: 'optional' },
    profile: {
      provider: 'loopback',
      model: 'smoke-model',
      thinkingLevel: 'off',
      activeTools: ['grep'],
      compaction: 'auto',
      approvalMode: 'full',
      unattended: false,
    },
  })
  const settled = await waitFor((message) => message.id === 4)
  assert.equal(settled.result.settlement, 'answered')
  assert.equal(settled.result.items[0].type, 'assistant_message')
  assert.equal(settled.result.items[0].content, 'hello from Pi')
  assert.equal(requestSeen, true)
  const modelInput = JSON.stringify(requestBody?.messages || [])
  assert.ok(modelInput.indexOf('GLOBAL_SENTINEL') < modelInput.indexOf('PROJECT_SENTINEL'), modelInput)
  assert.ok(modelInput.indexOf('PROJECT_SENTINEL') < modelInput.lastIndexOf('say hello'), modelInput)
  assert.ok(!modelInput.includes('GLOBAL_SECRET'), modelInput)
  assert.ok(!modelInput.includes('PROJECT_SECRET'), modelInput)
  assert.ok(modelInput.includes('PROTECTED_EXCLUSION'), modelInput)
  const instructionRecord = settled.result.record.entries.find((entry: { kind?: string }) => entry.kind === 'instruction-snapshot')
  assert.equal(instructionRecord.source, 'host')
  assert.ok(instructionRecord.snapshot.revision >= 1)
  assert.ok(instructionRecord.snapshot.effectiveText.includes('GLOBAL_SENTINEL'))
  assert.ok(instructionRecord.snapshot.effectiveText.includes('PROJECT_SENTINEL'))
  assert.ok(!instructionRecord.snapshot.effectiveText.includes('GLOBAL_SECRET'))
  assert.ok(!instructionRecord.snapshot.effectiveText.includes('PROJECT_SECRET'))
  assert.ok(instructionRecord.snapshot.effectiveText.includes('PROTECTED_EXCLUSION'))
  const providerHistoryRecord = settled.result.record.entries.find((entry: { kind?: string }) => entry.kind === 'provider-history')
  assert.equal(providerHistoryRecord.source, 'host')
  assert.deepEqual(providerHistoryRecord.messages, [])
  const providerPromptRecord = settled.result.record.entries.find((entry: { kind?: string }) => entry.kind === 'provider-prompt')
  assert.equal(providerPromptRecord.source, 'host')
  assert.ok(providerPromptRecord.content.includes('GLOBAL_SENTINEL'))
  assert.ok(providerPromptRecord.content.includes('PROTECTED_EXCLUSION'))
  assert.ok(!providerPromptRecord.content.includes('GLOBAL_SECRET'))
  assert.ok(!providerPromptRecord.content.includes('PROJECT_SECRET'))
  // A restricted allowlist exposes grep plus the ALWAYS-ON pack tools —
  // and never a capability-gated tool whose capability has not loaded.
  const names = (requestBody?.tools || []).map((tool: { function?: { name?: string } }) => tool?.function?.name)
  const ALWAYS_ON = ['ask_user', 'update_plan', 'datetime_now', 'table_parse', 'json_extract_lite', 'tool_output_read', 'load_capability', 'tool_search', 'run_code']
  assert.equal(names.includes('grep'), true)
  assert.ok(names.every((name: string) => name === 'grep' || ALWAYS_ON.includes(name)), `unexpected tools in restricted turn: ${names.join(', ')}`)
  assert.equal(names.includes('http_fetch'), false, 'capability-gated tools stay out until loaded')
  send(5, 'sessions/list')
  const listed = await waitFor((message) => message.id === 5)
  const projected = listed.result.sessions.find((candidate: { id: string }) => candidate.id === sessionId)
  assert.deepEqual(projected.messages, [
    { role: 'user', content: 'say hello' },
    { role: 'assistant', content: 'hello from Pi' },
  ])

  // A profile-less turn starts with the persisted `read` allowlist. Tightening
  // the latest settings to `grep` makes their intersection empty; that empty
  // result must stay fail-closed and never regain Pi's legacy "all tools"
  // meaning on the next Goal-based iteration.
  holdNextRequest = true
  requestBody = undefined
  heldRequestReady = new Promise<void>((resolveReady) => { resolveHeldRequestReady = resolveReady })
  send(6, 'turn/submit', {
    sessionId,
    runId: 'smoke-restricted-intersection-run',
    cwd: stateDir,
    prompt: 'prove restricted intersection',
    pattern: 'Goal-based',
    maxIterations: 2,
    contextPolicy: { memoryEnabled: false, memoryWriteEnabled: false, referenceChatHistory: true, temporary: false, outboundShellMode: 'optional' },
  })
  await waitFor((message) => message.event === 'host/orchestration'
    && message.payload?.runId === 'smoke-restricted-intersection-run'
    && message.payload?.phase === 'iterate')
  await heldRequestReady
  send(7, 'settings/update', { activeTools: ['grep'] })
  await waitFor((message) => message.id === 7)
  releaseHeldRequest?.()
  const restrictedSettled = await waitFor((message) => message.id === 6)
  assert.equal(restrictedSettled.result.settlement, 'answered')
  const restrictedNames = (requestBody?.tools || []).map((tool: { function?: { name?: string } }) => tool?.function?.name)
  assert.equal(restrictedNames.includes('grep'), false)
  assert.equal(restrictedNames.includes('read'), false)
  const orchestrationControls = ['record_continuation_items']
  assert.ok(restrictedNames.every((name: string) => ALWAYS_ON.includes(name) || orchestrationControls.includes(name)), `empty restricted intersection widened tools: ${restrictedNames.join(', ')}`)
} finally {
  host.stdin.end()
  await once(host, 'exit')
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi successful turn uses the configured Pi model through the Host Protocol')
