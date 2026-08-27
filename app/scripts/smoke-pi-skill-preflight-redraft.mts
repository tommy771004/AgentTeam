import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { selectFrozenPiPreflightSkills, snapshotPiSkillResources } from '../electron/piSkills.ts'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const agentDir = await mkdtemp(join(tmpdir(), 'pi-preflight-redraft-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-preflight-redraft-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-preflight-redraft-workspace-'))
const skillDir = join(agentDir, 'skills', 'safe-write-redraft')
const statePath = join(stateDir, 'state.json')
const skillRaw = `---
name: safe-write-redraft
description: Require the verified payload before write execution
version: 3
preflight-tools: write
---
Write result.txt with the exact content safe-redraft followed by one newline.
Never reuse the intercepted call identity.
`
await mkdir(skillDir, { recursive: true })
await writeFile(join(skillDir, 'SKILL.md'), skillRaw)
const secondSkillDir = join(agentDir, 'skills', 'z-second-write-check')
await mkdir(secondSkillDir, { recursive: true })
const secondSkillRaw = `---
name: z-second-write-check
description: A second explicit preflight fixture
version: 1
preflight-tools: write
---
Check the final newline.
`.replaceAll('\n', '\r\n')
await writeFile(join(secondSkillDir, 'SKILL.md'), secondSkillRaw)
const frozenSkills = await snapshotPiSkillResources(agentDir, 'redraft-policy-smoke')
assert.ok(frozenSkills)
assert.equal((await selectFrozenPiPreflightSkills({ resourceView: frozenSkills, exactTool: 'write' })).length, 1)
await assert.rejects(
  () => selectFrozenPiPreflightSkills({ resourceView: frozenSkills, exactTool: 'write', maxSkills: 2 }),
  /explicit reason and hard context budget/,
)
assert.equal((await selectFrozenPiPreflightSkills({
  resourceView: frozenSkills,
  exactTool: 'write',
  maxSkills: 2,
  secondSkillReason: 'newline checker complements the primary write contract',
  contextBudgetBytes: 2_048,
})).length, 2)
await chmod(join(frozenSkills.root, 'safe-write-redraft', 'SKILL.md'), 0o644)
await writeFile(join(frozenSkills.root, 'safe-write-redraft', 'SKILL.md'), `${skillRaw}\nTampered after snapshot.\n`)
await assert.rejects(
  () => selectFrozenPiPreflightSkills({ resourceView: frozenSkills, exactTool: 'write' }),
  /Frozen Skill Resource View digest mismatch/,
  'materialized Skill bytes must still match the immutable snapshot identity',
)

const requests: Array<Record<string, any>> = []
let completion = 0
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const modelServer = createServer(async (request, response) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (part) => { body += part })
  await once(request, 'end')
  requests.push(JSON.parse(body))
  completion += 1
  const chunk = (delta: unknown, finish: string | null) => sse({
    id: `redraft-${completion}`,
    object: 'chat.completion.chunk',
    model: 'smoke-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (completion <= 3) {
    const original = completion <= 2
    response.write(chunk({
      role: 'assistant',
      tool_calls: [{
        index: 0,
        id: original ? 'call_original_write' : 'call_redrafted_write',
        type: 'function',
        function: {
          name: 'write',
          arguments: JSON.stringify({ path: 'result.txt', content: original ? 'unsafe-original\n' : 'safe-redraft\n' }),
        },
      }],
    }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: 'Skill redraft completed.' }, null))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})

await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('redraft model fixture did not bind')
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
  send(2, 'sessions/create', { title: 'Skill redraft' })
  const sessionId = String((await waitFor(2)).result?.sessionId)
  send(3, 'turn/submit', {
    sessionId,
    runId: 'skill-redraft-run',
    cwd: workspace,
    prompt: 'Write the verified result.',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: ['write'], approvalMode: 'full', unattended: false, compaction: 'manual' },
    pattern: 'Goal-based', maxIterations: 1,
    workingGoal: { kind: 'file-content', path: 'result.txt', sha256: sha256('safe-redraft\n') },
  })
  const settled = await waitFor(3)
  assert.equal(settled.error, undefined)
  assert.equal(settled.result?.settlement, 'answered')
  assert.equal(await readFile(join(workspace, 'result.txt'), 'utf8'), 'safe-redraft\n')
  assert.equal(requests.length, 4)
  const secondRequest = JSON.stringify(requests[1]?.messages)
  assert.match(secondRequest, /HOST SKILL PREFLIGHT REDRAFT/)
  assert.match(secondRequest, /safe-write-redraft/)
  assert.match(secondRequest, /Version: 3/)
  assert.match(secondRequest, new RegExp(sha256(skillRaw)))
  assert.match(secondRequest, /fresh call identity/)

  const entries = settled.result?.record?.entries || []
  const originalCall = entries.findIndex((entry: any) => entry.kind === 'tool-call' && entry.callId === 'call_original_write')
  const invocation = entries.findIndex((entry: any) => entry.kind === 'skill-invocation' && entry.invocation?.callId === 'call_original_write')
  const originalResult = entries.findIndex((entry: any) => entry.kind === 'tool-result' && entry.callId === 'call_original_write')
  const context = entries.findIndex((entry: any) => entry.kind === 'skill-context' && entry.injection?.originalCallId === 'call_original_write')
  const redraftedCall = entries.findIndex((entry: any) => entry.kind === 'tool-call' && entry.callId === 'call_redrafted_write')
  assert.ok(originalCall >= 0 && originalCall < invocation && invocation < originalResult && originalResult < context && context < redraftedCall)
  assert.equal(entries[invocation]?.invocation?.decision, 'redraft')
  assert.equal(entries[invocation]?.invocation?.matchCount, 1)
  assert.deepEqual(entries[invocation]?.invocation?.selectedSkills, [{
    id: 'safe-write-redraft', version: 3, digest: sha256(skillRaw),
    bodyBytes: Buffer.byteLength(skillRaw.slice(skillRaw.indexOf('\n---\n', 4) + 5).trim(), 'utf8'),
  }])
  const originalResults = entries.filter((entry: any) => entry.kind === 'tool-result' && entry.callId === 'call_original_write')
  assert.equal(originalResults.length, 2, 'transport/model replay receives the same non-execution outcome')
  assert.ok(originalResults.every((entry: any) => entry.settlement === 'not-executed' && entry.executionEvidence === undefined))
  assert.equal(entries.filter((entry: any) => entry.kind === 'skill-context' && entry.injection?.originalCallId === 'call_original_write').length, 1)
  assert.equal(entries.filter((entry: any) => entry.kind === 'tool-evidence' && entry.callId === 'call_original_write').length, 0)
  const freshResult = entries.find((entry: any) => entry.kind === 'tool-result' && entry.callId === 'call_redrafted_write')
  assert.equal(freshResult?.settlement, 'success')
  assert.equal(freshResult?.executionEvidence?.issuedBy, 'adapter')
  const relevant = (entry: any) => entry.kind === 'skill-invocation' || entry.kind === 'skill-context'
    || (entry.kind === 'tool-call' && ['call_original_write', 'call_redrafted_write'].includes(entry.callId))
    || (entry.kind === 'tool-result' && ['call_original_write', 'call_redrafted_write'].includes(entry.callId))
  const liveEntries = messages
    .filter((message) => message.event === 'host/record-append' && message.payload?.runId === 'skill-redraft-run')
    .flatMap((message) => message.payload?.entries || [])
    .filter(relevant)
  assert.deepEqual(liveEntries, entries.filter(relevant), 'live and replay preserve the same Skill redraft order')
  assert.equal(JSON.stringify(entries).includes('Never reuse the intercepted call identity.'), false, 'Turn Record keeps immutable Skill identity, not the body')
  console.log('Skill preflight blocks the original effect, injects one immutable revision, and executes only a fresh redraft')
} finally {
  host.stdin.end()
  if (host.exitCode === null) await once(host, 'exit').catch(() => host.kill())
  modelServer.close()
  await Promise.all([rm(agentDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })])
}
