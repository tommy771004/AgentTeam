import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { JsonMemoryControlPackageRepository } from '../electron/memoryControlPackageRepository.ts'
import { finalWorkingStateSatisfiesDoD } from '../electron/memoryControlEvaluationAuthority.ts'
import { createCanonicalMemoryControlEvaluationExecutor, evaluateMemoryControlCandidate, sealMemoryControlEvaluationCorpus } from '../src/agent/memoryControlEvaluationGate.ts'
import { canonicalMemoryControlEvaluationJson } from '../src/agent/memoryControlEvaluationContract.ts'
import { createInitialWorkingState } from '../src/agent/workingState.ts'

const root = await mkdtemp(join(tmpdir(), 'memory-control-evaluation-'))
const agentDir = join(root, 'agent')
const packagePath = join(root, 'packages.json')
const statePath = join(root, 'state.json')
const corpusPath = join(root, 'evaluation-corpora.json')
const token = 'ticket-12-evaluation-secret'
const repository = await JsonMemoryControlPackageRepository.open(packagePath)

const partialState = createInitialWorkingState({
  runId: 'multi-goal-regression', objective: 'complete both goals',
  goals: [{ description: 'first' }, { description: 'second' }],
})
const firstGoal = partialState.goals[0]
const partiallyDone = {
  ...partialState,
  revision: 2,
  goals: [
    { ...firstGoal, status: 'done' as const, evidence: [{
      seq: 2, evidenceId: `execution:${'a'.repeat(64)}`, runId: partialState.runId,
      goalId: firstGoal.id, tool: 'write', callId: 'first', contractDigest: 'b'.repeat(64),
      schemaDigest: 'c'.repeat(64), receiptDigest: 'a'.repeat(64),
    }] },
    partialState.goals[1],
  ],
}
assert.equal(finalWorkingStateSatisfiesDoD([
  { seq: 1, turn: 1, step: 1, kind: 'working-state', source: 'host', state: partialState },
  { seq: 2, turn: 1, step: 1, kind: 'working-state', source: 'host', state: partiallyDone },
] as any, partialState.runId), false, 'one accepted goal cannot satisfy a multi-goal DoD')
const candidates = await Promise.all(['false-done', 'tokens'].map((name) => repository.createCandidate({
  expectedActiveRevision: 1, diagnosisComponent: 'invocationPolicy',
  patch: [{ op: 'replace', path: '/maxSkills', value: 1 }], reason: `source diagnosis ${name}`,
})))
const repairSkill = '---\nname: package-repair\nversion: 1\npreflight-tools: write\n---\nWrite package-result.txt with VERIFIED, not the original wrong draft.'
candidates.push(await repository.createCandidate({
  expectedActiveRevision: 1, diagnosisComponent: 'experientialSkills',
  patch: [{ op: 'add', path: '/overrides', value: { 'package-repair': repairSkill } }],
  reason: 'repair the source failure through actual immutable Skill content',
}))

type ModelReply = { content: string; promptTokens: number }
let replies: ModelReply[] = []
let behaviorEvaluation = false
let auditStarted: (() => void) | undefined
let releaseAudit: (() => void) | undefined
const modelServer = createServer(async (request, response) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => { body += chunk })
  await once(request, 'end')
  if (behaviorEvaluation) {
    const messages = JSON.parse(body).messages as Array<Record<string, any>>
    const source = body.includes('package behavior source')
    const redraft = body.includes('[HOST SKILL PREFLIGHT REDRAFT]')
    const completedWrite = messages.some((message) => message.role === 'tool' &&
      (message.tool_call_id === 'package-redraft' || !redraft && message.tool_call_id === 'package-original'))
    const delta = !source || completedWrite ? { role: 'assistant', content: 'fixture finished' }
      : { role: 'assistant', tool_calls: [{ index: 0, id: redraft ? 'package-redraft' : 'package-original', type: 'function',
        function: { name: 'write', arguments: JSON.stringify({ path: 'package-result.txt', content: redraft ? 'VERIFIED' : 'WRONG' }) },
      }] }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ id: 'package-behavior', object: 'chat.completion.chunk', model: 'smoke-model',
      choices: [{ index: 0, delta, finish_reason: 'tool_calls' in delta ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 80, completion_tokens: 2, total_tokens: 82 },
    })}\n\ndata: [DONE]\n\n`)
    return
  }
  const isAudit = body.includes('evaluation settlement audit')
  if (isAudit) {
    auditStarted?.()
    await new Promise<void>((resolveRelease) => { releaseAudit = resolveRelease })
  }
  const reply = isAudit ? { content: 'audit settled', promptTokens: 40 } : replies.shift()
  if (!reply) throw new Error('model fixture response queue exhausted')
  const payload = {
    id: 'evaluation-fixture', object: 'chat.completion.chunk', model: 'smoke-model',
    choices: [{ index: 0, delta: { role: 'assistant', content: reply.content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: reply.promptTokens, completion_tokens: reply.content ? 2 : 0, total_tokens: reply.promptTokens + (reply.content ? 2 : 0) },
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  response.end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`)
})

await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('evaluation model fixture did not bind')
await mkdir(agentDir, { recursive: true })
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: {
  baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'test-key',
  models: [{ id: 'smoke-model', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 16_384, maxTokens: 256 }],
} } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))
await writeFile(corpusPath, JSON.stringify({ schemaVersion: 1, corpora: [
  { version: 'ticket-12-write', tasks: [
    { id: 'source', cohort: 'source-failure', loopType: 'Turn-based', expected: { requiredActions: ['write'], requiredSkills: [], allowedSkills: [], maxPromptTokens: 120 } },
    { id: 'anchor', cohort: 'held-out-anchor', loopType: 'Turn-based', expected: { requiredActions: [], requiredSkills: [], allowedSkills: [], maxPromptTokens: 120 } },
  ] },
  { version: 'ticket-12-success', tasks: [
    { id: 'source', cohort: 'source-failure', loopType: 'Turn-based', expected: { requiredActions: [], requiredSkills: [], allowedSkills: [], maxPromptTokens: 120 } },
    { id: 'anchor', cohort: 'held-out-anchor', loopType: 'Turn-based', expected: { requiredActions: [], requiredSkills: [], allowedSkills: [], maxPromptTokens: 120 } },
  ] },
  { version: 'actual-package-behavior', tasks: [
    { id: 'source', cohort: 'source-failure', loopType: 'Goal-based', expected: { requiredActions: ['write'], requiredSkills: ['package-repair'], allowedSkills: ['package-repair'], maxPromptTokens: 1_000 } },
    { id: 'anchor', cohort: 'held-out-anchor', loopType: 'Turn-based', expected: { requiredActions: [], requiredSkills: [], allowedSkills: [], maxPromptTokens: 1_000 } },
  ] },
] }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: statePath, SUBAGENTS_PI_AGENT_DIR: agentDir,
    SUBAGENTS_MEMORY_CONTROL_PACKAGE_PATH: packagePath, SUBAGENTS_MEMORY_CONTROL_MAINTAINER_TOKEN: token,
    SUBAGENTS_MEMORY_CONTROL_EVALUATION_CORPUS_PATH: corpusPath },
  stdio: ['pipe', 'pipe', 'inherit'],
})
let nextId = 1
let stdout = ''
const pending = new Map<number, (message: any) => void>()
host.stdout.on('data', (buffer) => {
  stdout += String(buffer)
  for (;;) {
    const newline = stdout.indexOf('\n')
    if (newline < 0) break
    const line = stdout.slice(0, newline).trim()
    stdout = stdout.slice(newline + 1)
    if (!line) continue
    const message = JSON.parse(line)
    if (typeof message.id === 'number') pending.get(message.id)?.(message)
  }
})
const rpc = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolveResponse, reject) => {
  const id = nextId++
  const requestLabel = typeof params.runId === 'string' ? `${method} (${params.runId})` : method
  const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${requestLabel}`)), 25_000)
  pending.set(id, (message) => {
    clearTimeout(timeout)
    pending.delete(id)
    if (message.error) reject(new Error(message.error.message))
    else resolveResponse(message.result || {})
  })
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
})

const bridgeFor = (revision: number) => ({
  platform: async () => process.platform,
  piHost: {
    sessions: { list: () => rpc('sessions/list'), create: (title?: string, threadId?: string) => rpc('sessions/create', { title, threadId }) },
    turn: { submit: async (input: Record<string, unknown>) => {
      // Both phases receive the same explicit fixture authority to write only
      // within this disposable project; unattended production defaults deny writes.
      const profile = behaviorEvaluation ? { ...(input.profile as object), approvalMode: 'full', unattended: false } : input.profile
      const result = await rpc('turn/submit', { ...input, cwd: root, maxIterations: 1, profile, evaluationPackageRevision: revision, evaluationToken: token })
      assert.ok(result.record, `Host evaluation turn ${String(input.runId)} returned no Turn Record`)
      return result
    } },
  },
}) as any
const execute = createCanonicalMemoryControlEvaluationExecutor({
  runOptionsForPackage: async (memoryControlPackage) => ({
    subagents: bridgeFor(memoryControlPackage.revision),
    settingsPatch: { enabled: true, provider: 'loopback', model: 'smoke-model' },
  }),
})
const tasks = {
  source: { id: 'source', objective: 'source qualification', loopType: 'Turn-based' as const },
  anchor: { id: 'anchor', objective: 'held-out anchor', loopType: 'Turn-based' as const },
}
const corpus = (sourceActions: string[] = []) => sealMemoryControlEvaluationCorpus({
  version: `ticket-12-${sourceActions.join('-') || 'success'}`,
  sourceFailures: [{ task: tasks.source, expected: { requiredActions: sourceActions, requiredSkills: [], allowedSkills: [], maxPromptTokens: 120 } }],
  heldOutAnchors: [{ task: tasks.anchor, expected: { requiredActions: [], requiredSkills: [], allowedSkills: [], maxPromptTokens: 120 } }],
})

let auditSequence = 0
let lastAudit: any
const settleThroughAuditRun = async (
  report: Awaited<ReturnType<typeof evaluateMemoryControlCandidate>>,
  expected: 'settled' | 'rejected' = 'settled',
  rollbackRevision?: number,
) => {
  const session = await rpc('sessions/create', { title: 'evaluation settlement audit' })
  const started = new Promise<void>((resolveStarted) => { auditStarted = resolveStarted })
  const turn = rpc('turn/submit', {
    sessionId: session.sessionId, runId: `audit-${report.reportId.slice(0, 8)}-${++auditSequence}`, cwd: root,
    prompt: 'evaluation settlement audit', pattern: 'Turn-based', maxIterations: 1,
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: [], approvalMode: 'full', unattended: false, compaction: 'manual' },
  })
  void turn.catch(() => undefined)
  await started
  await rpc('runtime/status')
  let settled: any
  let settlementError: unknown
  try {
    settled = await rpc('memory-control/v1/maintain', {
      maintenanceToken: token, sessionId: session.sessionId,
      ...(rollbackRevision === undefined ? { operation: 'settle-evaluation', report }
        : { operation: 'rollback', revision: rollbackRevision, expectedActiveRevision: report.candidatePackage.revision, reason: 'verify executable rollback' }),
    })
  } catch (error) {
    settlementError = error
  } finally {
    assert.ok(releaseAudit, 'audit model fixture did not install its release barrier')
    releaseAudit()
  }
  const audit = await turn
  lastAudit = audit
  auditStarted = undefined
  releaseAudit = undefined
  const lifecycleEntries = audit.record.entries.filter((entry: any) => entry.kind === 'memory-control-lifecycle')
  if (expected === 'rejected') {
    assert.match(String(settlementError), /digest mismatch|aggregate metrics|Host corpus|Host evidence/i)
    assert.equal(lifecycleEntries.length, 0)
    return undefined
  }
  if (settlementError) throw settlementError
  assert.equal(lifecycleEntries.length, 1)
  return settled
}

try {
  await rpc('initialize', { protocolVersion: 5, capabilities: ['memory-control-v1'] })
  await assert.rejects(() => evaluateMemoryControlCandidate({
    packages: repository, corpus: corpus(), candidateRevision: candidates[0].revision,
    tokenBudget: { maxRegressionRatio: 0.1 }, execute: (async () => []) as any,
  }), /canonical headless executor/i)

  replies = [{ content: 'baseline source', promptTokens: 80 }, { content: 'anchor', promptTokens: 80 },
    { content: 'candidate claims done', promptTokens: 80 }, { content: 'anchor', promptTokens: 80 }]
  const falseDone = await evaluateMemoryControlCandidate({
    packages: repository, corpus: corpus(['write']), candidateRevision: candidates[0].revision,
    tokenBudget: { maxRegressionRatio: 0.1 }, execute,
  })
  assert.equal(falseDone.decision, 'rejected')
  assert.match(falseDone.reasons.join(' '), /false-done|required-action/i)
  const tampered = structuredClone(falseDone)
  tampered.metrics.promptTokens += 1
  await settleThroughAuditRun(tampered, 'rejected')
  const rehashedTampered = structuredClone(falseDone)
  rehashedTampered.metrics.promptTokens += 1
  const { reportId: _reportId, ...rehashedBody } = rehashedTampered
  rehashedTampered.reportId = createHash('sha256').update(canonicalMemoryControlEvaluationJson(rehashedBody)).digest('hex')
  await settleThroughAuditRun(rehashedTampered, 'rejected')
  const unchanged = await rpc('memory-control/v1/package/get', { schemaVersion: 1, view: 'evaluations' })
  const unchangedLineage = await rpc('memory-control/v1/package/get', { schemaVersion: 1, view: 'lineage' })
  const unchangedCandidate = await rpc('memory-control/v1/package/get', { schemaVersion: 1, revision: candidates[0].revision })
  assert.equal(unchangedLineage.memoryControlLineage.activeRevision, 1)
  assert.equal(unchanged.memoryControlEvaluations.length, 0)
  assert.equal(unchangedCandidate.memoryControlPackage.status, 'candidate')
  await settleThroughAuditRun(falseDone)

  replies = [{ content: '', promptTokens: 80 }, { content: 'anchor', promptTokens: 80 },
    { content: 'fixed source', promptTokens: 80 }, { content: 'anchor', promptTokens: 200 }]
  const tokenRegression = await evaluateMemoryControlCandidate({
    packages: repository, corpus: corpus(), candidateRevision: candidates[1].revision,
    tokenBudget: { maxRegressionRatio: 0.1 }, execute,
  })
  assert.equal(tokenRegression.decision, 'rejected')
  assert.match(tokenRegression.reasons.join(' '), /token regression/i)
  await settleThroughAuditRun(tokenRegression)

  behaviorEvaluation = true
  const behaviorCorpus = sealMemoryControlEvaluationCorpus({
    version: 'actual-package-behavior',
    sourceFailures: [{ task: { id: 'source', objective: 'package behavior source: write package-result.txt correctly', loopType: 'Goal-based',
      workingGoal: { kind: 'file-content', path: 'package-result.txt', sha256: createHash('sha256').update('VERIFIED').digest('hex') } },
      expected: { requiredActions: ['write'], requiredSkills: ['package-repair'], allowedSkills: ['package-repair'], maxPromptTokens: 1_000 } }],
    heldOutAnchors: [{ task: tasks.anchor,
      expected: { requiredActions: [], requiredSkills: [], allowedSkills: [], maxPromptTokens: 1_000 } }],
  })
  const improving = await evaluateMemoryControlCandidate({
    packages: repository, corpus: behaviorCorpus, candidateRevision: candidates[2].revision,
    // One additional real preflight redraft is explicitly budgeted.
    tokenBudget: { maxRegressionRatio: 0.5 }, execute,
  })
  behaviorEvaluation = false
  assert.equal(improving.decision, 'promoted', JSON.stringify(improving))
  assert.equal(improving.metrics.taskSuccessRate, 1)
  assert.equal(improving.metrics.falseDoneRate, 0)
  assert.equal(improving.runs.find((run) => run.phase === 'baseline' && run.taskId === 'source')?.metrics.taskSuccess, false)
  assert.equal(await readFile(join(root, 'package-result.txt'), 'utf8'), 'VERIFIED')
  await settleThroughAuditRun(improving)

  const auditPackage = lastAudit.record.entries.find((entry: any) => entry.kind === 'memory-control-package')
  assert.equal(auditPackage.packageIdentity.revision, 1,
    'the already-admitted audit run remains frozen on its original package while activation settles')
  replies = [{ content: 'new run after gated activation', promptTokens: 80 }]
  const nextSession = await rpc('sessions/create', { title: 'post-promotion admission' })
  const nextRun = await rpc('turn/submit', {
    sessionId: nextSession.sessionId, runId: 'post-promotion-run', cwd: root,
    prompt: 'observe the newly activated package', pattern: 'Turn-based', maxIterations: 1,
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: [], approvalMode: 'full', unattended: false, compaction: 'manual' },
  })
  const nextPackage = nextRun.record.entries.find((entry: any) => entry.kind === 'memory-control-package')
  assert.equal(nextPackage.packageIdentity.revision, candidates[2].revision,
    'only a new run observes the candidate revision activated through the evaluation gate')

  const persisted = await rpc('memory-control/v1/package/get', { schemaVersion: 1, view: 'evaluations' })
  assert.deepEqual(persisted.memoryControlEvaluations.map((report: any) => report.reportId), [falseDone.reportId, tokenRegression.reportId, improving.reportId])
  const reopened = await JsonMemoryControlPackageRepository.open(packagePath)
  assert.equal(reopened.lineage().activeRevision, candidates[2].revision)
  assert.equal(reopened.read({ schemaVersion: 1, revision: candidates[0].revision }).status, 'rejected')
  assert.equal(reopened.read({ schemaVersion: 1, revision: candidates[1].revision }).status, 'rejected')
  assert.equal(reopened.evaluationReports().length, 3)
  assert.equal(replies.length, 0)
  const verifyActiveBehavior = async (expectedContent: string, expectedDone: boolean) => {
    behaviorEvaluation = true
    try {
      const session = await rpc('sessions/create', { title: 'active package behavior' })
      const run = await rpc('turn/submit', {
        sessionId: session.sessionId, runId: `active-behavior-${expectedContent}`, cwd: root,
        prompt: 'package behavior source: write package-result.txt correctly', pattern: 'Goal-based', maxIterations: 1,
        workingGoal: { kind: 'file-content', path: 'package-result.txt', sha256: createHash('sha256').update('VERIFIED').digest('hex') },
        profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: ['write'], approvalMode: 'full', unattended: false, compaction: 'manual' },
      })
      assert.equal(run.orchestration.dodMet, expectedDone)
      assert.equal(await readFile(join(root, 'package-result.txt'), 'utf8'), expectedContent)
    } finally { behaviorEvaluation = false }
  }
  await verifyActiveBehavior('VERIFIED', true)
  await settleThroughAuditRun(improving, 'settled', 1)
  await verifyActiveBehavior('WRONG', false)
  console.log('smoke-memory-control-evaluation-gate: canonical Host promotion + regressions passed')
} finally {
  releaseAudit?.()
  host.stdin.end()
  if (host.exitCode === null) {
    const exited = once(host, 'exit')
    const forced = new Promise<void>((resolveForced) => setTimeout(() => {
      if (host.exitCode === null) host.kill()
      resolveForced()
    }, 2_000))
    await Promise.race([exited, forced])
  }
  modelServer.close()
  await once(modelServer, 'close')
  await rm(root, { recursive: true, force: true })
}
