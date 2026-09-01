import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { goalContractFromWorkingState, hasExecutableGoalCriterion, verifyGoalContractSnapshot } from '../src/agent/goalContract.ts'
import { createInitialWorkingState } from '../src/agent/workingState.ts'

type Message = { id?: number; result?: Record<string, any>; error?: { code: string; message: string } }

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const predicate = { kind: 'file-content' as const, path: 'result.txt', sha256: sha256('verified\n') }
const state = createInitialWorkingState({ runId: 'pure-contract', objective: 'write result', completionPredicate: predicate })
const frozen = await goalContractFromWorkingState({ state, mode: 'goal', maxIterations: 3, maxWallClockMs: 10_000, unattended: false })
assert.equal(hasExecutableGoalCriterion(frozen), true)
assert.equal(frozen.criteria[0]?.kind, 'file-content')
assert.equal(Object.isFrozen(frozen), true)
assert.equal(Object.isFrozen(frozen.criteria), true)
assert.equal(Object.isFrozen(frozen.criteria[0]), true)
assert.match(frozen.digest, /^[a-f0-9]{64}$/)
assert.equal(await verifyGoalContractSnapshot(frozen), true)
assert.equal(await verifyGoalContractSnapshot({ ...frozen, objective: 'tampered' }), false)
const [mainSource, preloadSource, runnerSource] = await Promise.all([
  readFile(resolve(import.meta.dirname, '../electron/main.ts'), 'utf8'),
  readFile(resolve(import.meta.dirname, '../electron/preload.ts'), 'utf8'),
  readFile(resolve(import.meta.dirname, '../src/agent/piHostRun.ts'), 'utf8'),
])
assert.match(mainSource, /workingGoal: input\.workingGoal, goalContractV1: input\.goalContractV1/)
assert.match(preloadSource, /workingGoal\?: WorkingGoalCompletionPredicate; goalContractV1\?: boolean/)
assert.match(runnerSource, /workingGoal: input\.workingGoal,[\s\S]*goalContractV1: input\.goalContractV1/)

const agentDir = await mkdtemp(join(tmpdir(), 'goal-contract-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'goal-contract-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'goal-contract-cwd-'))
let providerCalls = 0
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions') return response.writeHead(404).end()
  providerCalls += 1
  request.resume()
  await once(request, 'end')
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' })
  response.write(`data: ${JSON.stringify({ id: 'goal-contract-smoke', object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'answered' }, finish_reason: 'stop' }] })}\n\n`)
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('model fixture did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', models: [{ id: 'smoke-model', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 128_000 }] } } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'smoke' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const lines = createInterface({ input: host.stdout })
const received: Message[] = []
lines.on('line', (line) => received.push(JSON.parse(line) as Message))
let sequence = 0
const call = async (method: string, params: Record<string, unknown> = {}) => {
  const id = ++sequence
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  for (;;) {
    const message = received.find((candidate) => candidate.id === id)
    if (message) return message
    await new Promise<Array<unknown>>((resolveLine, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 20_000)
      once(lines, 'line').then((value) => { clearTimeout(timer); resolveLine(value) }, (error) => { clearTimeout(timer); reject(error) })
    })
  }
}

try {
  assert.equal((await call('initialize', { protocolVersion: 5, capabilities: ['tool-contract-v1', 'goal-contract-v1'] })).error, undefined)
  const created = await call('sessions/create', { title: 'goal contract admission' })
  const sessionId = String(created.result?.sessionId)
  const base = {
    sessionId,
    cwd: workspace,
    pattern: 'Goal-based',
    maxIterations: 1,
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: true },
  }

  const unverifiable = await call('turn/submit', {
    ...base,
    runId: 'goal-unverifiable',
    prompt: 'answer without an executable checker',
    definitionOfDone: 'arbitrary prose is not a checker',
    goalContractV1: true,
  })
  assert.equal(unverifiable.error, undefined)
  assert.equal(unverifiable.result?.settlement, 'empty')
  assert.equal(unverifiable.result?.goalVerdict, 'unverifiable')
  assert.equal(providerCalls, 0, 'missing executable criteria fail before the first provider call')
  assert.deepEqual(unverifiable.result?.goalContract?.criteria, [], 'free-form DoD never becomes executable')
  const unverifiableEntries = unverifiable.result?.record?.entries || []
  assert.ok(unverifiableEntries.some((entry: Record<string, unknown>) => entry.kind === 'goal-contract'))
  assert.equal(unverifiableEntries.some((entry: Record<string, unknown>) => entry.kind === 'provider-prompt'), false)

  const verifiedShape = await call('turn/submit', {
    ...base,
    runId: 'goal-file-content',
    prompt: 'produce the typed output',
    definitionOfDone: 'this prose remains display-only',
    workingGoal: predicate,
    goalContractV1: true,
  })
  assert.equal(verifiedShape.error, undefined)
  assert.equal(providerCalls, 1)
  assert.deepEqual(verifiedShape.result?.goalContract?.criteria, [{
    id: 'goal-file-content:goal:1',
    kind: 'file-content',
    path: predicate.path,
    sha256: predicate.sha256,
  }])
  const contractSeq = verifiedShape.result?.record?.entries.find((entry: Record<string, unknown>) => entry.kind === 'goal-contract')?.seq
  const providerSeq = verifiedShape.result?.record?.entries.find((entry: Record<string, unknown>) => entry.kind === 'provider-prompt')?.seq
  assert.ok(Number(contractSeq) < Number(providerSeq), 'canonical contract is recorded before provider dispatch')

  const flagOff = await call('turn/submit', {
    ...base,
    runId: 'goal-flag-off',
    prompt: 'legacy rollout behavior',
    definitionOfDone: 'legacy prose',
  })
  assert.equal(flagOff.error, undefined)
  assert.equal(providerCalls, 2, 'feature flag is default-off')
  assert.equal(flagOff.result?.goalContract, undefined)

  assert.equal((await call('initialize', { protocolVersion: 5, capabilities: ['tool-contract-v1'] })).error, undefined)
  const capabilityOff = await call('turn/submit', {
    ...base,
    runId: 'goal-capability-off',
    prompt: 'non-negotiated rollout behavior',
    goalContractV1: true,
  })
  assert.equal(capabilityOff.error, undefined)
  assert.equal(providerCalls, 3, 'feature flag alone cannot enable unnegotiated guarantees')
  assert.equal(capabilityOff.result?.goalContract, undefined)

  console.log('Goal Contract admission passed: frozen/digested/recorded before provider, typed mapping lossless, fail-closed rollout gated')
} finally {
  host.stdin.end()
  if (host.exitCode === null) await new Promise<void>((done) => {
    const timer = setTimeout(() => { host.kill(); done() }, 1_000)
    once(host, 'exit').then(() => { clearTimeout(timer); done() })
  })
  lines.close()
  modelServer.close()
  await Promise.all([
    rm(agentDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(workspace, { recursive: true, force: true }),
  ])
}
