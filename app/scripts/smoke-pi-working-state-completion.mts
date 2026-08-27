import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInitialWorkingState, checkWorkingStateProposal, type WorkingExecutionEvidence, type WorkingStateProposal } from '../src/agent/workingState.ts'
import { TURN_RECORD_FORMAT_VERSION, turnRecordEntries } from '../src/agent/turnRecord.ts'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const digest = sha256('fixture')

// The Checker contract is fail-closed even when fed deserialised/cast input.
const checkerState = createInitialWorkingState({
  runId: 'checker-run',
  objective: 'write result.txt',
  completionPredicate: { kind: 'file-content', path: 'result.txt', sha256: sha256('verified\n') },
})
const checkerProposal: WorkingStateProposal = {
  schemaVersion: 1,
  proposalId: 'proposal:checker-run:call-1',
  source: 'model',
  baseRevision: 1,
  runId: 'checker-run',
  goalId: 'checker-run:goal:1',
  proposedStatus: 'done',
  tool: 'write',
  callId: 'call-1',
  file: { path: 'result.txt', sha256: sha256('verified\n') },
}
const checkerEvidence: WorkingExecutionEvidence = {
  schemaVersion: 1,
  evidenceId: `execution:${digest}`,
  runId: 'checker-run',
  goalId: 'checker-run:goal:1',
  tool: 'write',
  callId: 'call-1',
  contractDigest: digest,
  schemaDigest: digest,
  receiptDigest: digest,
  resource: { kind: 'file-content', path: 'result.txt', sha256: sha256('verified\n') },
  issuedBy: 'host',
  attestation: 'non-model',
}
const accepted = checkWorkingStateProposal({
  state: checkerState,
  proposal: checkerProposal,
  settlement: 'success',
  evidence: checkerEvidence,
  evidenceSeq: 3,
})
assert.equal(accepted.verdict, 'accepted')
assert.equal(accepted.state?.revision, 2)
assert.equal(accepted.state?.goals[0]?.status, 'done')

for (const [label, patch] of [
  ['wrong run', { runId: 'other-run' }],
  ['wrong goal', { goalId: 'other-goal' }],
  ['wrong tool', { tool: 'edit' }],
  ['wrong call', { callId: 'other-call' }],
  ['model attested', { attestation: 'model' }],
  ['malformed receipt', { receiptDigest: 'not-a-digest' }],
] as const) {
  const rejected = checkWorkingStateProposal({
    state: checkerState,
    proposal: checkerProposal,
    settlement: 'success',
    evidence: { ...checkerEvidence, ...patch },
    evidenceSeq: 3,
  })
  assert.equal(rejected.verdict, 'rejected', `${label} evidence cannot commit a goal`)
  assert.equal(rejected.state, undefined)
}
for (const settlement of ['denied', 'failed', 'cancelled', 'interrupted', 'not-executed'] as const) {
  const rejected = checkWorkingStateProposal({
    state: checkerState,
    proposal: checkerProposal,
    settlement,
    evidence: checkerEvidence,
    evidenceSeq: 3,
  })
  assert.equal(rejected.verdict, 'rejected', `${settlement} cannot commit a goal`)
}
assert.equal(checkWorkingStateProposal({
  state: checkerState,
  proposal: checkerProposal,
  settlement: 'success',
  evidence: undefined,
  evidenceSeq: 3,
}).verdict, 'rejected', 'missing evidence fails closed')

const workspace = await mkdtemp(join(tmpdir(), 'pi-working-state-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-working-state-host-'))
const agentDir = await mkdtemp(join(tmpdir(), 'pi-working-state-agent-'))
const statePath = join(stateDir, 'state.json')
let completions = 0
const chunk = (delta: Record<string, unknown>, finish: string | null) => `data: ${JSON.stringify({
  id: 'chatcmpl-working-state',
  object: 'chat.completion.chunk',
  created: 1,
  model: 'smoke-model',
  choices: [{ index: 0, delta, finish_reason: finish }],
})}\n\n`

const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  for await (const part of request) void part
  completions += 1
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (completions === 1) {
    response.write(chunk({ role: 'assistant', content: '寫入指定內容。' }, null))
    response.write(chunk({
      tool_calls: [{
        index: 0,
        id: 'call_write_verified',
        type: 'function',
        function: { name: 'write', arguments: JSON.stringify({ path: 'result.txt', content: 'verified\n' }) },
      }],
    }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: completions === 2 ? '檔案已驗證完成。' : '我宣稱已經完成。' }, null))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('Loopback model server did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({
  providers: {
    loopback: {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      api: 'openai-completions',
      apiKey: 'test-key',
      models: [{ id: 'smoke-model', name: 'Smoke Model', reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 256 }],
    },
  },
}))
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
  const timeoutAt = Date.now() + 20_000
  for (;;) {
    const message = messages.find((candidate) => candidate.id === id)
    if (message) return message
    if (Date.now() > timeoutAt) throw new Error(`timed out waiting for response ${id}`)
    await new Promise((done) => setTimeout(done, 10))
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
}

try {
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor(1)
  send(2, 'sessions/create', { title: 'Checker-backed completion' })
  const successSessionId = String((await waitFor(2)).result?.sessionId)
  const profile = {
    provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off',
    activeTools: ['write'], approvalMode: 'full', unattended: false, compaction: 'manual',
  }
  send(3, 'turn/submit', {
    sessionId: successSessionId,
    runId: 'working-success-run',
    cwd: workspace,
    prompt: '把 verified 寫入 result.txt',
    profile,
    pattern: 'Goal-based',
    maxIterations: 1,
    definitionOfDone: 'result.txt contains the exact requested content',
    workingGoal: { kind: 'file-content', path: 'result.txt', sha256: sha256('verified\n') },
  })
  const completed = await waitFor(3)
  assert.equal(completed.result?.settlement, 'answered')
  assert.equal(await readFile(join(workspace, 'result.txt'), 'utf8'), 'verified\n')
  assert.equal(completed.result?.orchestration?.dodMet, true)
  assert.equal(completed.result?.workingState?.revision, 2)
  assert.equal(completed.result?.workingState?.goals[0]?.status, 'done')

  const successEntries = turnRecordEntries({
    version: TURN_RECORD_FORMAT_VERSION,
    entries: completed.result?.record?.entries || [],
  })
  const orderedKinds = successEntries
    .filter((entry) => ['state-proposal', 'tool-result', 'state-check', 'working-state'].includes(entry.kind))
    .map((entry) => entry.kind)
  assert.deepEqual(orderedKinds.slice(-4), ['state-proposal', 'tool-result', 'state-check', 'working-state'])
  const proposal = successEntries.find((entry) => entry.kind === 'state-proposal')
  const toolResult = successEntries.find((entry) => entry.kind === 'tool-result')
  const stateCheck = successEntries.find((entry) => entry.kind === 'state-check')
  assert.equal(proposal?.source, 'model')
  assert.equal(toolResult?.source, 'host')
  assert.equal(stateCheck?.source, 'host')
  assert.equal(stateCheck && 'check' in stateCheck ? stateCheck.check.verdict : undefined, 'accepted')

  send(4, 'sessions/create', { title: 'False done refusal' })
  const falseDoneSessionId = String((await waitFor(4)).result?.sessionId)
  send(5, 'turn/submit', {
    sessionId: falseDoneSessionId,
    runId: 'working-false-done-run',
    cwd: workspace,
    prompt: '只用文字宣稱完成，不能執行工具',
    profile,
    pattern: 'Goal-based',
    maxIterations: 1,
    definitionOfDone: 'result.txt changed again',
    workingGoal: { kind: 'file-content', path: 'result.txt', sha256: sha256('changed\n') },
  })
  const refused = await waitFor(5)
  assert.equal(refused.result?.settlement, 'failed', 'an answered model call still fails when its verified goal stays pending')
  assert.equal(refused.result?.orchestration?.dodMet, false, 'assistant completion text is not DoD evidence')
  assert.equal(refused.result?.workingState?.revision, 1)
  assert.equal(refused.result?.workingState?.goals[0]?.status, 'pending')
} finally {
  host.stdin.end()
  if (host.exitCode === null && host.signalCode === null) await once(host, 'exit')
  modelServer.close()
  await rm(workspace, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(agentDir, { recursive: true, force: true })
}

console.log('Checker-backed Working State commits only trusted file-change evidence')
