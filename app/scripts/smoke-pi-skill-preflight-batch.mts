import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const agentDir = await mkdtemp(join(tmpdir(), 'pi-preflight-batch-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-preflight-batch-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-preflight-batch-workspace-'))
const statePath = join(stateDir, 'state.json')
const skillDir = join(agentDir, 'skills', 'safe-write-batch')
const skillRaw = `---
name: safe-write-batch
description: Require a safe payload before write execution
version: 1
preflight-tools: write
---
Write result.txt with the exact content safe-redraft followed by one newline.
Never reuse an intercepted batch call identity.
`
await mkdir(skillDir, { recursive: true })
await writeFile(join(skillDir, 'SKILL.md'), skillRaw)
await writeFile(join(workspace, 'sibling.txt'), 'original\n')

const requests: Array<Record<string, any>> = []
let completion = 0
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const toolDelta = (id: string, name: string, args: Record<string, unknown>, index: number) => ({
  index,
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})
const originalBatch = (conflict = false) => [
  toolDelta('call_original_write', 'write', {
    path: 'result.txt',
    content: conflict ? 'identity-conflict\n' : 'unsafe-original\n',
  }, 0),
  toolDelta('call_original_edit', 'edit', {
    path: 'sibling.txt', oldText: 'original\n', newText: conflict ? 'identity-conflict\n' : 'unsafe-original\n',
  }, 1),
]
const freshBatch = () => [
  toolDelta('call_redrafted_write', 'write', { path: 'result.txt', content: 'safe-redraft\n' }, 0),
  toolDelta('call_redrafted_edit', 'edit', { path: 'sibling.txt', oldText: 'original\n', newText: 'safe-redraft\n' }, 1),
]
const modelServer = createServer(async (request, response) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (part) => { body += part })
  await once(request, 'end')
  requests.push(JSON.parse(body))
  completion += 1
  const chunk = (delta: unknown, finish: string | null) => sse({
    id: `batch-${completion}`,
    object: 'chat.completion.chunk',
    model: 'smoke-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (completion <= 5) {
    const calls = completion <= 2 ? originalBatch() : completion === 3 ? originalBatch(true) : freshBatch()
    response.write(chunk({ role: 'assistant', tool_calls: calls }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: 'Batch redraft completed.' }, null))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})

await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('batch model fixture did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: {
  baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'test-key',
  models: [{ id: 'smoke-model', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 16_384, maxTokens: 256 }],
} } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: statePath, SUBAGENTS_PI_AGENT_DIR: agentDir },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const messages: Array<Record<string, any>> = []
let stdout = ''
host.stdout.on('data', (buffer) => {
  stdout += String(buffer)
  for (;;) {
    const newline = stdout.indexOf('\n')
    if (newline < 0) break
    const line = stdout.slice(0, newline).trim()
    stdout = stdout.slice(newline + 1)
    if (line) messages.push(JSON.parse(line))
  }
})
const waitFor = async (id: number) => {
  const timeoutAt = Date.now() + 25_000
  for (;;) {
    const found = messages.find((message) => message.id === id)
    if (found) return found
    if (Date.now() > timeoutAt) throw new Error(`timeout waiting for ${id}: ${JSON.stringify(messages.slice(-5))}`)
    await new Promise((done) => setTimeout(done, 10))
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)

try {
  send(1, 'initialize', { protocolVersion: 2 })
  assert.equal((await waitFor(1)).error, undefined)
  send(2, 'sessions/create', { title: 'Skill batch barrier' })
  const sessionId = String((await waitFor(2)).result?.sessionId)
  const profile = { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: ['write', 'edit'], approvalMode: 'full', unattended: false, compaction: 'manual' }
  send(30, 'settings/update', profile)
  const persistedSettings = await waitFor(30)
  assert.equal(persistedSettings.error, undefined, JSON.stringify(persistedSettings))
  assert.equal(persistedSettings.result?.settings?.provider, profile.provider)
  assert.equal(persistedSettings.result?.settings?.model, profile.model)
  assert.equal(persistedSettings.result?.settings?.thinkingLevel, profile.thinkingLevel)
  assert.deepEqual(persistedSettings.result?.settings?.activeTools, [...profile.activeTools].sort())
  assert.equal(persistedSettings.result?.settings?.approvalMode, profile.approvalMode)
  assert.equal(persistedSettings.result?.settings?.unattended, profile.unattended)
  assert.equal(persistedSettings.result?.settings?.compaction, profile.compaction)
  send(3, 'turn/submit', {
    sessionId,
    runId: 'skill-batch-run',
    cwd: workspace,
    prompt: 'Safely update both files.',
    profile,
    pattern: 'Goal-based', maxIterations: 1,
  })
  const settled = await waitFor(3)
  assert.equal(settled.error, undefined)
  assert.equal(settled.result?.settlement, 'answered', JSON.stringify(settled.result?.items || settled))
  assert.equal(requests.length, 6)
  assert.equal(await readFile(join(workspace, 'result.txt'), 'utf8'), 'safe-redraft\n')
  assert.equal(await readFile(join(workspace, 'sibling.txt'), 'utf8'), 'safe-redraft\n', 'blocked sibling never consumed its original oldText')

  const entries = settled.result?.record?.entries || []
  const originalWriteResults = entries.filter((entry: any) => entry.kind === 'tool-result' && entry.callId === 'call_original_write')
  const originalEditResults = entries.filter((entry: any) => entry.kind === 'tool-result' && entry.callId === 'call_original_edit')
  assert.equal(originalWriteResults.length, 3)
  assert.equal(originalEditResults.length, 3)
  assert.ok(originalWriteResults.every((entry: any) => entry.settlement === 'not-executed' && entry.executionEvidence === undefined))
  assert.ok(originalEditResults.every((entry: any) => entry.settlement === 'not-executed' && entry.executionEvidence === undefined))
  assert.match(String(originalWriteResults[2]?.detail), /identity conflict/i)
  assert.match(String(originalEditResults[2]?.detail), /identity conflict/i)
  const originalPreflights = entries
    .filter((entry: any) => entry.kind === 'skill-invocation' && ['call_original_write', 'call_original_edit'].includes(entry.invocation?.callId))
    .map((entry: any) => entry.invocation)
  assert.equal(originalPreflights.length, 2, 'exact retry and conflicting replay do not repeat Host preflight decisions')
  assert.deepEqual(originalPreflights.map((trace: any) => trace.callId), ['call_original_write', 'call_original_edit'])
  assert.equal(new Set(originalPreflights.map((trace: any) => trace.batchId)).size, 1)
  assert.ok(originalPreflights.every((trace: any) => trace.schemaVersion === 2
    && trace.runId === 'skill-batch-run' && trace.step === 1 && trace.workingStateRevision === 1
    && /^[a-f0-9]{64}$/.test(trace.identityDigest)))
  assert.deepEqual(originalPreflights.map((trace: any) => trace.decision), ['redraft', 'pass-through'])
  assert.equal(entries.filter((entry: any) => entry.kind === 'skill-context' && entry.injection?.originalCallId === 'call_original_write').length, 1)
  assert.equal(entries.filter((entry: any) => entry.kind === 'tool-evidence' && ['call_original_write', 'call_original_edit'].includes(entry.callId)).length, 0)

  const freshCalls = entries.filter((entry: any) => entry.kind === 'tool-call' && ['call_redrafted_write', 'call_redrafted_edit'].includes(entry.callId))
  assert.deepEqual(freshCalls.map((entry: any) => entry.callId), [
    'call_redrafted_write', 'call_redrafted_edit', 'call_redrafted_write', 'call_redrafted_edit',
  ])
  for (const callId of ['call_redrafted_write', 'call_redrafted_edit']) {
    const call = entries.find((entry: any) => entry.kind === 'tool-call' && entry.callId === callId)
    const results = entries.filter((entry: any) => entry.kind === 'tool-result' && entry.callId === callId)
    const result = results[0]
    assert.deepEqual(results.map((entry: any) => entry.settlement), ['success', 'not-executed'])
    assert.match(String(results[1]?.detail), /duplicate execution identity/i)
    assert.equal(result?.contractRevision > 0, true)
    assert.match(String(result?.contractDigest), /^[a-f0-9]{64}$/)
    assert.equal(result?.contractDigest, call?.contractDigest)
    assert.equal(result?.schemaDigest, call?.schemaDigest)
    const evidence = entries.filter((entry: any) => entry.kind === 'tool-evidence' && entry.callId === callId)
    assert.deepEqual(evidence.map((entry: any) => entry.phase), ['start', 'decision', 'update', 'result', 'settlement'])
    assert.ok(evidence.every((entry: any) => entry.contractDigest === call?.contractDigest && entry.schemaDigest === call?.schemaDigest))
  }
  console.log('Skill preflight retries are idempotent and one redraft blocks the whole parallel batch before side effects')
} finally {
  host.stdin.end()
  if (host.exitCode === null) await once(host, 'exit').catch(() => host.kill())
  modelServer.close()
  await Promise.all([rm(agentDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })])
}
