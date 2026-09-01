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
const [mainSource, preloadSource, runnerSource, dispatchSource, storeSource] = await Promise.all([
  readFile(resolve(import.meta.dirname, '../electron/main.ts'), 'utf8'),
  readFile(resolve(import.meta.dirname, '../electron/preload.ts'), 'utf8'),
  readFile(resolve(import.meta.dirname, '../src/agent/piHostRun.ts'), 'utf8'),
  readFile(resolve(import.meta.dirname, '../src/agent/runDispatch.ts'), 'utf8'),
  readFile(resolve(import.meta.dirname, '../src/store/agentStore.ts'), 'utf8'),
])
assert.match(mainSource, /workingGoal: input\.workingGoal, goalContractV1: input\.goalContractV1/)
assert.match(preloadSource, /workingGoal\?: WorkingGoalCompletionPredicate; goalContractV1\?: boolean/)
assert.match(runnerSource, /workingGoal: input\.workingGoal,[\s\S]*goalContractV1: input\.goalContractV1/)
assert.match(dispatchSource, /startExecution\(piText, \{[\s\S]*goalContractV1: true,[\s\S]*runId: snapshot\.runId/,
  'canonical product dispatch must request the negotiated Goal Contract')
assert.match(dispatchSource, /executionSettlement: state\.executionSettlement,[\s\S]*goalVerdict: state\.goalVerdict,[\s\S]*acceptanceDigest: state\.acceptanceDigest/,
  'canonical product dispatch must project Host-owned Goal outcome facts')
assert.match(storeSource, /builtinTurnOutcome\(\{[\s\S]*goalVerdict: result\.goalVerdict,[\s\S]*\.\.\.hostGoalOutcomeFacts\(result\)/,
  'AgentStore must derive the Goal projection from the Host verdict')

const agentDir = await mkdtemp(join(tmpdir(), 'goal-contract-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'goal-contract-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'goal-contract-cwd-'))
let providerCalls = 0
const semanticRequestBodies: string[] = []
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions') return response.writeHead(404).end()
  providerCalls += 1
  const chunks: Buffer[] = []
  request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  await once(request, 'end')
  const body = Buffer.concat(chunks).toString('utf8')
  const semantic = body.includes('fresh acceptance verifier')
  if (semantic) semanticRequestBodies.push(body)
  const content = semantic
    ? JSON.stringify({ verdict: 'passed', reason: 'sanitized answer satisfies this check' })
    : 'answered'
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' })
  response.write(`data: ${JSON.stringify({ id: 'goal-contract-smoke', object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`)
  response.write(`data: ${JSON.stringify({ id: 'goal-contract-smoke', object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 } })}\n\n`)
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
  assert.notEqual(verifiedShape.result?.goalVerdict, 'passed', 'model completion text cannot pass a missing file checker')
  assert.equal(verifiedShape.result?.acceptanceSnapshot?.overall, 'unmet')
  assert.match(String(verifiedShape.result?.acceptanceSnapshot?.digest), /^[a-f0-9]{64}$/)
  const goalVerdictEntry = verifiedShape.result?.record?.entries.find((entry: Record<string, unknown>) => entry.kind === 'goal-verdict')
  assert.equal(goalVerdictEntry?.acceptanceDigest, verifiedShape.result?.acceptanceSnapshot?.digest)
  const contractSeq = verifiedShape.result?.record?.entries.find((entry: Record<string, unknown>) => entry.kind === 'goal-contract')?.seq
  const providerSeq = verifiedShape.result?.record?.entries.find((entry: Record<string, unknown>) => entry.kind === 'provider-prompt')?.seq
  assert.ok(Number(contractSeq) < Number(providerSeq), 'canonical contract is recorded before provider dispatch')

  const noProgress = await call('turn/submit', {
    ...base,
    maxIterations: 2,
    runId: 'goal-repair-no-progress',
    prompt: 'claim completion without changing the missing artifact',
    workingGoal: predicate,
    goalContractV1: true,
  })
  assert.equal(noProgress.error, undefined)
  assert.equal(providerCalls, 3, 'Host RepairPlan drives the second internal iteration')
  assert.equal(noProgress.result?.goalVerdict, 'failed')
  const repairEntries = noProgress.result?.record?.entries.filter((entry: Record<string, unknown>) => entry.kind === 'repair-plan') || []
  assert.equal(repairEntries.length, 2)
  assert.equal(repairEntries[0]?.plan?.targets?.[0]?.criterionId, 'goal-repair-no-progress:goal:1')
  assert.ok(noProgress.result?.record?.entries.some((entry: Record<string, unknown>) => entry.kind === 'notice' && entry.topic === 'repair-no-progress'))

  await writeFile(join(workspace, predicate.path), 'verified\n')
  const accepted = await call('turn/submit', {
    ...base,
    runId: 'goal-file-content-pass',
    prompt: 'check the already-settled typed output',
    workingGoal: predicate,
    goalContractV1: true,
  })
  assert.equal(accepted.error, undefined)
  assert.equal(providerCalls, 4)
  assert.equal(accepted.result?.goalVerdict, 'passed')
  assert.equal(accepted.result?.acceptanceSnapshot?.overall, 'passed')
  const acceptedVerdict = accepted.result?.record?.entries.find((entry: Record<string, unknown>) => entry.kind === 'goal-verdict')
  assert.equal(acceptedVerdict?.acceptanceDigest, accepted.result?.acceptanceSnapshot?.digest)

  assert.equal((await call('initialize', {
    protocolVersion: 5,
    capabilities: ['tool-contract-v1', 'goal-contract-v1', 'fresh-semantic-verifier-v1'],
  })).error, undefined)
  const semanticAccepted = await call('turn/submit', {
    ...base,
    runId: 'goal-semantic-pass',
    prompt: 'WORKER_PROMPT_SENTINEL produce a semantically acceptable answer',
    definitionOfDone: 'The final answer must be supported by the sanitized acceptance artifact.',
    goalContractV1: true,
  })
  assert.equal(semanticAccepted.error, undefined)
  assert.equal(semanticAccepted.result?.goalContract?.criteria?.[0]?.kind, 'semantic-rubric')
  assert.equal(semanticRequestBodies.length, 3, `semantic provider request count; total provider calls=${providerCalls}`)
  assert.equal(semanticAccepted.result?.goalVerdict, 'passed', JSON.stringify(semanticAccepted.result?.record?.entries))
  assert.equal(semanticAccepted.result?.acceptanceSnapshot?.overall, 'passed')
  const semanticEvidence = semanticAccepted.result?.record?.entries.find((entry: Record<string, any>) =>
    entry.kind === 'criterion-evidence' && entry.evidence?.kind === 'semantic-verifier')?.evidence
  assert.equal(semanticEvidence?.checks?.length, 3)
  assert.ok(semanticRequestBodies.every((body) => !body.includes('WORKER_PROMPT_SENTINEL')), 'fresh verifier sessions exclude worker conversation')
  assert.ok(semanticRequestBodies.every((body) => {
    const tools = (JSON.parse(body) as { tools?: unknown[] }).tools
    return !tools || tools.length === 0
  }), JSON.stringify(semanticRequestBodies.map((body) => (JSON.parse(body) as { tools?: unknown[] }).tools)))

  const flagOff = await call('turn/submit', {
    ...base,
    runId: 'goal-flag-off',
    prompt: 'legacy rollout behavior',
    definitionOfDone: 'legacy prose',
  })
  assert.equal(flagOff.error, undefined)
  assert.equal(providerCalls, 9, 'feature flag is default-off after one worker call plus three semantic verifier calls')
  assert.equal(flagOff.result?.goalContract, undefined)

  assert.equal((await call('initialize', { protocolVersion: 5, capabilities: ['tool-contract-v1'] })).error, undefined)
  const capabilityOff = await call('turn/submit', {
    ...base,
    runId: 'goal-capability-off',
    prompt: 'non-negotiated rollout behavior',
    goalContractV1: true,
  })
  assert.equal(capabilityOff.error, undefined)
  assert.equal(providerCalls, 10, 'feature flag alone cannot enable unnegotiated guarantees')
  assert.equal(capabilityOff.result?.goalContract, undefined)

  console.log('Goal Contract admission passed: product opt-in, fresh semantic acceptance, criterion repair, typed mapping, and fail-closed rollout')
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
