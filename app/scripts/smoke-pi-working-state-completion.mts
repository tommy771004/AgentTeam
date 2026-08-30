import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInitialWorkingState, checkWorkingStateProposal, type WorkingExecutionEvidence, type WorkingStateProposal } from '../src/agent/workingState.ts'
import { TURN_RECORD_FORMAT_VERSION, turnRecordEntries } from '../src/agent/turnRecord.ts'
import {
  bindPiSessionRun,
  piBashGateExtensionFactory,
  setPiPolicyEvidenceBridge,
  unbindPiSessionRun,
  wrapPiBuiltinWriteWithEvidence,
} from '../electron/piToolHost.ts'
import { piCodingAgentModule } from '../electron/piVendor.ts'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const digest = sha256('fixture')
const workspace = await mkdtemp(join(tmpdir(), 'pi-working-state-'))

// A resumed run never lets a tool with no frozen contract slip past the Host hook.
const unknownGateSession = 'resume-unknown-contract-session'
bindPiSessionRun(unknownGateSession, {
  runId: 'resume-unknown-contract-run',
  frozenPolicy: {
    approvalMode: 'full',
    unattended: false,
    approvalTimeoutMs: 1_000,
    projectRoot: workspace,
    outbound: { mode: 'off' },
    deniedTools: [],
    approvalTools: [],
  },
  completedFileEffects: [{ path: '@result.txt', sha256: digest }],
})
setPiPolicyEvidenceBridge({ contractIdentity: () => undefined, append: () => undefined })
let unknownGate: ((event: Record<string, unknown>) => unknown) | undefined
piBashGateExtensionFactory({ sessionId: unknownGateSession }).factory({
  on: (event, handler) => { if (event === 'tool_call') unknownGate = handler },
  registerTool: () => undefined,
})
assert.ok(unknownGate)
const unknownGateDecision = await unknownGate({ toolName: 'future_mutator', toolCallId: 'call_future', input: {} })
assert.equal((unknownGateDecision as { block?: boolean } | undefined)?.block, true)
unbindPiSessionRun(unknownGateSession)

// The Checker contract is fail-closed even when fed deserialised/cast input.
const checkerState = createInitialWorkingState({
  runId: 'checker-run',
  objective: 'write result.txt',
  completionPredicate: { kind: 'file-content', path: '@result.txt', sha256: sha256('verified\n') },
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
  file: { path: '@result.txt', sha256: sha256('verified\n') },
}
const checkerWrite = wrapPiBuiltinWriteWithEvidence({
  cwd: workspace,
  factory: piCodingAgentModule.createWriteToolDefinition,
  evidenceContext: () => ({ runId: 'checker-run', contractDigest: digest, schemaDigest: digest }),
})
const checkerWriteResult = await checkerWrite.execute('call-1', { path: '@result.txt', content: 'verified\n' })
const checkerEvidence = (checkerWriteResult.details as Record<string, unknown> | undefined)?.workingExecutionEvidence as WorkingExecutionEvidence
assert.equal(await readFile(join(workspace, 'result.txt'), 'utf8'), 'verified\n')
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
  ['wrong tool', { tool: 'edit' }],
  ['wrong call', { callId: 'other-call' }],
  ['host attested', { issuedBy: 'host' }],
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

const blockedProposal = {
  schemaVersion: 1 as const,
  proposalId: 'proposal:checker-run:call-blocked',
  source: 'host' as const,
  baseRevision: 1,
  runId: 'checker-run',
  goalId: 'checker-run:goal:1',
  proposedStatus: 'blocked' as const,
  tool: 'write',
  callId: 'call-blocked',
  blocker: 'write denied by the frozen Host policy',
}
const blocked = checkWorkingStateProposal({
  state: checkerState,
  proposal: blockedProposal,
  settlement: 'denied',
  evidence: undefined,
  evidenceSeq: 0,
})
assert.equal(blocked.verdict, 'accepted')
assert.equal(blocked.state?.revision, 2)
assert.equal(blocked.state?.goals[0]?.status, 'blocked')
assert.equal(blocked.state?.goals[0]?.blocker, blockedProposal.blocker)
assert.equal(blocked.check.currentRevision, 1)
assert.equal(blocked.check.committedRevision, 2)

assert.equal(checkWorkingStateProposal({
  state: checkerState,
  proposal: { ...checkerProposal, baseRevision: 2 },
  settlement: 'success',
  evidence: checkerEvidence,
  evidenceSeq: 3,
}).reason, 'future-base-revision')
assert.equal(checkWorkingStateProposal({
  state: checkerState,
  proposal: { ...blockedProposal, blocker: 'x'.repeat(801) },
  settlement: 'failed',
  evidence: undefined,
  evidenceSeq: 0,
}).reason, 'proposal-malformed')

const resolvedBlock = checkWorkingStateProposal({
  state: blocked.state!,
  proposal: { ...checkerProposal, baseRevision: 2 },
  settlement: 'success',
  evidence: checkerEvidence,
  evidenceSeq: 4,
})
assert.equal(resolvedBlock.verdict, 'accepted')
assert.equal(resolvedBlock.state?.goals[0]?.status, 'done')
assert.equal(resolvedBlock.state?.goals[0]?.blocker, undefined)
assert.equal(checkWorkingStateProposal({
  state: resolvedBlock.state!,
  proposal: { ...blockedProposal, baseRevision: 3 },
  settlement: 'failed',
  evidence: undefined,
  evidenceSeq: 0,
}).reason, 'illegal-done-transition')

const secondWriteResult = await checkerWrite.execute('call-2', { path: 'second.txt', content: 'second\n' })
const secondEvidence = (secondWriteResult.details as Record<string, unknown>).workingExecutionEvidence as WorkingExecutionEvidence
const parallelState = {
  ...checkerState,
  goals: [
    checkerState.goals[0]!,
    {
      id: 'checker-run:goal:2',
      description: 'write second.txt',
      status: 'pending' as const,
      evidence: [],
      completionPredicate: { kind: 'file-content' as const, path: 'second.txt', sha256: sha256('second\n') },
    },
  ],
}
const firstCommit = checkWorkingStateProposal({
  state: parallelState,
  proposal: checkerProposal,
  settlement: 'success',
  evidence: checkerEvidence,
  evidenceSeq: 3,
})
const rebasedCommit = checkWorkingStateProposal({
  state: firstCommit.state!,
  proposal: {
    ...checkerProposal,
    proposalId: 'proposal:checker-run:call-2',
    goalId: 'checker-run:goal:2',
    callId: 'call-2',
    file: { path: 'second.txt', sha256: sha256('second\n') },
  },
  settlement: 'success',
  evidence: secondEvidence,
  evidenceSeq: 5,
})
assert.equal(rebasedCommit.verdict, 'rebased')
assert.equal(rebasedCommit.state?.revision, 3)
assert.deepEqual(rebasedCommit.state?.goals.map((goal) => goal.status), ['done', 'done'])
assert.equal(checkWorkingStateProposal({
  state: firstCommit.state!,
  proposal: checkerProposal,
  settlement: 'success',
  evidence: checkerEvidence,
  evidenceSeq: 5,
}).reason, 'stale-goal-conflict', 'same-goal stale proposal cannot overwrite the first commit')

const stateDir = await mkdtemp(join(tmpdir(), 'pi-working-state-host-'))
const agentDir = await mkdtemp(join(tmpdir(), 'pi-working-state-agent-'))
const statePath = join(stateDir, 'state.json')
const checkpointDir = join(stateDir, 'run-checkpoints')
let completions = 0
let requestCount = 0
let lastEvent = '<none>'
let regressionPlan: Array<Array<{ path: string; content: string }> | null> | undefined
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
  requestCount++
  lastEvent = `provider-request-${requestCount}`
  if (regressionPlan) {
    const calls = regressionPlan.shift()
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(chunk(calls ? { role: 'assistant', tool_calls: calls.map((args, index) => ({
      index, id: `regression-${regressionPlan!.length}-${index}`, type: 'function',
      function: { name: 'write', arguments: JSON.stringify(args) },
    })) } : { role: 'assistant', content: 'iteration finished' }, calls ? 'tool_calls' : 'stop'))
    response.end('data: [DONE]\n\n')
    return
  }
  completions += 1
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if ([1, 4, 6, 8, 10, 12].includes(completions)) {
    response.write(chunk({ role: 'assistant', content: completions === 1
      ? '寫入指定內容。'
      : completions === 4
        ? '同一步提出兩個衝突寫入。'
        : completions === 6
          ? '嘗試一個會失敗的寫入。'
          : completions === 8
            ? '同一步完成兩個獨立目標。'
            : completions === 10 ? '先失敗，再由 sibling 完成同一目標。' : '嘗試重做已完成的 write。' }, null))
    response.write(chunk({
      tool_calls: completions === 1
        ? [{
            index: 0,
            id: 'call_write_verified',
            type: 'function',
            function: { name: 'write', arguments: JSON.stringify({ path: 'result.txt', content: 'verified\n' }) },
          }]
        : completions === 4 ? [
            {
              index: 0,
              id: 'call_race_first',
              type: 'function',
              function: { name: 'write', arguments: JSON.stringify({ path: 'race.txt', content: 'race\n' }) },
            },
            {
              index: 1,
              id: 'call_race_stale',
              type: 'function',
              function: { name: 'write', arguments: JSON.stringify({ path: 'race.txt', content: 'overwritten\n' }) },
            },
          ] : completions === 8 ? [
            {
              index: 0,
              id: 'call_multi_first',
              type: 'function',
              function: { name: 'write', arguments: JSON.stringify({ path: 'nested/../first.txt', content: 'first\n' }) },
            },
            {
              index: 1,
              id: 'call_multi_second',
              type: 'function',
              function: { name: 'write', arguments: JSON.stringify({ path: 'second.txt', content: 'second\n' }) },
            },
          ] : completions === 10 ? [
            {
              index: 0,
              id: 'call_recover_failed',
              type: 'function',
              function: { name: 'write', arguments: JSON.stringify({ path: '@recover\u00A0file.txt', content: 'recovered\n', unexpected: true }) },
            },
            {
              index: 1,
              id: 'call_recover_success',
              type: 'function',
              function: { name: 'write', arguments: JSON.stringify({ path: '@recover\u00A0file.txt', content: 'recovered\n' }) },
            },
          ] : completions === 12 ? [
            {
              index: 0,
              id: 'call_resume_overwrite',
              type: 'function',
              function: { name: 'write', arguments: JSON.stringify({ path: 'nested/../recover file.txt', content: 'corrupted\n' }) },
            },
            {
              index: 1,
              id: 'call_resume_bash',
              type: 'function',
              function: { name: 'bash', arguments: JSON.stringify({ command: "printf 'corrupted\\n' > './recover file.txt'" }) },
            },
            {
              index: 2,
              id: 'call_resume_read_extension',
              type: 'function',
              function: { name: 'workspace_diff', arguments: JSON.stringify({ source: 'recover file.txt', target: 'recover file.txt' }) },
            },
            {
              index: 3,
              id: 'call_resume_mutating_extension',
              type: 'function',
              function: { name: 'workspace_mkdir', arguments: JSON.stringify({ path: 'must-not-exist' }) },
            },
          ] : [{
            index: 0,
            id: 'call_write_blocked',
            type: 'function',
            function: { name: 'write', arguments: JSON.stringify({ path: 'blocked-parent/result.txt', content: 'blocked\n' }) },
          }],
    }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: completions === 2
      ? '檔案已驗證完成。'
      : completions === 5
        ? '競爭提案已由 Host 仲裁。'
        : completions === 7
          ? '這個目標目前受檔案系統阻擋。'
          : completions === 9
            ? '兩個獨立目標都由 Host 驗證。'
            : completions === 11
              ? '成功 sibling 保留完成狀態。'
              : completions === 13 ? 'Host 已拒絕重做完成的 effect。' : '我宣稱已經完成。' }, null))
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
  env: {
    ...process.env,
    SUBAGENTS_PI_HOST_STATE_PATH: statePath,
    SUBAGENTS_PI_CHECKPOINT_DIR: checkpointDir,
    SUBAGENTS_PI_AGENT_DIR: agentDir,
  },
  stdio: ['pipe', 'pipe', 'inherit'],
})
let hostStopped = false
let restarted: ReturnType<typeof spawn> | undefined
let activeSessionId = ''
let activeRunId = ''
const messages: Array<Record<string, any>> = []
let stdout = ''
host.stdout.on('data', (buffer) => {
  stdout += String(buffer)
  for (;;) {
    const newline = stdout.indexOf('\n')
    if (newline < 0) break
    const line = stdout.slice(0, newline).trim()
    stdout = stdout.slice(newline + 1)
    if (line) {
      const message = JSON.parse(line)
      messages.push(message)
      lastEvent = message.event || (message.id === undefined ? '<notification>' : `response-${message.id}`)
    }
  }
})
const suiteDeadline = Date.now() + 120_000
const waitFor = async (id: number, stage = `response:${id}`) => {
  const found = messages.find((candidate) => candidate.id === id)
  if (found) return found
  return new Promise<Record<string, any>>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error, message?: Record<string, any>) => {
      if (timer) clearTimeout(timer)
      host.stdout.removeListener('data', onData)
      host.removeListener('exit', onExit)
      if (error) reject(error)
      else if (message) resolve(message)
    }
    const onData = () => {
      const response = messages.find((candidate) => candidate.id === id)
      if (response) finish(undefined, response)
    }
    const onExit = () => finish(new Error(
      `Host exited while waiting for response ${id}; run=${activeRunId || '<none>'}; requestCount=${requestCount}; lastEvent=${lastEvent}; pending=${stage}`,
    ))
    host.stdout.on('data', onData)
    host.once('exit', onExit)
    const remaining = suiteDeadline - Date.now()
    timer = setTimeout(() => finish(new Error(
      `timed out waiting for response ${id}; run=${activeRunId || '<none>'}; requestCount=${requestCount}; lastEvent=${lastEvent}; pending=${stage}`,
    )), Math.max(1, remaining))
  })
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
  if (typeof params.sessionId === 'string') activeSessionId = params.sessionId
  if (typeof params.runId === 'string') activeRunId = params.runId
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
}

const waitForExit = async (child: ReturnType<typeof spawn>, timeoutMs: number) => {
  if (child.exitCode !== null || child.signalCode !== null) return true
  return new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (exited: boolean) => {
      if (timer) clearTimeout(timer)
      child.removeListener('exit', onExit)
      resolve(exited)
    }
    const onExit = () => finish(true)
    child.once('exit', onExit)
    timer = setTimeout(() => finish(false), timeoutMs)
  })
}

const stopChild = async (child: ReturnType<typeof spawn> | undefined, cancelRun: boolean) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  if (cancelRun && child === host && activeSessionId && activeRunId && !host.stdin.destroyed) {
    try {
      host.stdin.write(`${JSON.stringify({ id: 99, method: 'turn/cancel', params: { sessionId: activeSessionId, runId: activeRunId } })}\n`)
    } catch { /* best effort */ }
  }
  if (!child.stdin.destroyed) child.stdin.end()
  if (!(await waitForExit(child, 2_000))) child.kill('SIGTERM')
  if (!(await waitForExit(child, 2_000))) child.kill('SIGKILL')
  await waitForExit(child, 2_000)
}

const closeModelServer = async () => {
  if (!modelServer.listening) return
  await Promise.race([
    new Promise<void>((done) => modelServer.close(() => done())),
    new Promise<void>((done) => setTimeout(done, 2_000)),
  ])
}

try {
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor(1, 'initialize')
  send(2, 'sessions/create', { title: 'Checker-backed completion' })
  const successSessionId = String((await waitFor(2, 'success-session')).result?.sessionId)
  const profile = {
    provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off',
    activeTools: ['write'], approvalMode: 'full', unattended: false, compaction: 'manual',
  }
  send(100, 'settings/update', profile)
  const persistedSettings = await waitFor(100, 'settings-update')
  assert.equal(persistedSettings.error, undefined, JSON.stringify(persistedSettings))
  assert.equal(persistedSettings.result?.settings?.provider, profile.provider)
  assert.equal(persistedSettings.result?.settings?.model, profile.model)
  assert.equal(persistedSettings.result?.settings?.thinkingLevel, profile.thinkingLevel)
  assert.deepEqual(persistedSettings.result?.settings?.activeTools, profile.activeTools)
  assert.equal(persistedSettings.result?.settings?.approvalMode, profile.approvalMode)
  assert.equal(persistedSettings.result?.settings?.unattended, profile.unattended)
  assert.equal(persistedSettings.result?.settings?.compaction, profile.compaction)
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
  const completed = await waitFor(3, 'working-success-turn')
  assert.equal(completed.result?.settlement, 'answered', JSON.stringify(completed.result?.record?.entries || []))
  assert.equal(await readFile(join(workspace, 'result.txt'), 'utf8'), 'verified\n')
  assert.equal(completed.result?.orchestration?.dodMet, true)
  assert.equal(completed.result?.workingState?.revision, 2)
  assert.equal(completed.result?.workingState?.goals[0]?.status, 'done')

  const successEntries = turnRecordEntries({
    version: TURN_RECORD_FORMAT_VERSION,
    entries: completed.result?.record?.entries || [],
  })
  const skillInvocations = successEntries.filter((entry) => entry.kind === 'skill-invocation')
  assert.equal(skillInvocations.length, 1, 'one state-changing draft receives one Host Skill preflight')
  const skillInvocation = skillInvocations[0]?.invocation
  assert.equal(skillInvocation?.decision, 'pass-through')
  assert.equal(skillInvocation?.matchCount, 0)
  assert.equal(skillInvocation?.workingStateRevision, 1)
  assert.deepEqual(skillInvocation?.goalIds, ['working-success-run:goal:1'])
  assert.equal(skillInvocation?.toolIdentity.tool, 'write')
  assert.equal(skillInvocation?.toolIdentity.contractDigest, successEntries.find((entry) => entry.kind === 'tool-call' && entry.callId === 'call_write_verified' && 'contractDigest' in entry)?.contractDigest)
  assert.equal(skillInvocation?.draft.sampleBytes !== undefined && skillInvocation.draft.sampleBytes <= 4_096, true)
  assert.equal(JSON.stringify(skillInvocation).includes('verified\n'), false, 'preflight trace does not copy raw tool content')
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
  assert.equal(toolResult && 'executionEvidence' in toolResult ? toolResult.executionEvidence?.issuedBy : undefined, 'adapter')
  assert.equal(successEntries.filter((entry) => entry.kind === 'tool-result' && entry.callId === 'call_write_verified').length, 1, 'preflight adds no second executor or terminal path')
  assert.deepEqual(
    toolResult && 'executionEvidence' in toolResult ? toolResult.executionEvidence?.resource : undefined,
    { kind: 'file-content', path: 'result.txt', sha256: sha256('verified\n') },
    'builtin write adapter attests the bytes read back from disk',
  )

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

  send(6, 'sessions/create', { title: 'CAS proposal race' })
  const raceSessionId = String((await waitFor(6)).result?.sessionId)
  send(7, 'turn/submit', {
    sessionId: raceSessionId,
    runId: 'working-cas-race-run',
    cwd: workspace,
    prompt: '在同一步把 race 寫入 race.txt 兩次，Host 必須仲裁 stale proposal',
    profile,
    pattern: 'Goal-based',
    maxIterations: 1,
    definitionOfDone: 'race.txt contains exact verified content',
    workingGoal: { kind: 'file-content', path: 'race.txt', sha256: sha256('race\n') },
  })
  const raced = await waitFor(7)
  assert.equal(raced.result?.settlement, 'failed')
  assert.equal(raced.result?.workingState?.revision, 1, 'invalidated sibling evidence must not commit')
  assert.equal(raced.result?.workingState?.goals[0]?.status, 'pending')
  const raceEntries = turnRecordEntries({
    version: TURN_RECORD_FORMAT_VERSION,
    entries: raced.result?.record?.entries || [],
  })
  const raceProposals = raceEntries.filter((entry) => entry.kind === 'state-proposal')
  const raceChecks = raceEntries.filter((entry) => entry.kind === 'state-check')
  assert.equal(raceProposals.length, 2)
  assert.deepEqual(raceProposals.map((entry) => entry.proposal.baseRevision), [1, 1])
  assert.deepEqual(raceChecks.map((entry) => entry.check.verdict), ['rejected', 'rejected'])
  assert.deepEqual(raceChecks.map((entry) => entry.check.reason), ['goal-predicate-unmet', 'execution-evidence-invalidated'])
  assert.equal(await readFile(join(workspace, 'race.txt'), 'utf8'), 'overwritten\n')

  await writeFile(join(workspace, 'blocked-parent'), 'not a directory')
  send(8, 'sessions/create', { title: 'Concrete blocked state' })
  const blockedSessionId = String((await waitFor(8)).result?.sessionId)
  send(9, 'turn/submit', {
    sessionId: blockedSessionId,
    runId: 'working-blocked-run',
    cwd: workspace,
    prompt: '把 blocked 寫入 blocked-parent/result.txt',
    profile,
    pattern: 'Goal-based',
    maxIterations: 1,
    definitionOfDone: 'blocked-parent/result.txt exists with exact content',
    workingGoal: { kind: 'file-content', path: 'blocked-parent/result.txt', sha256: sha256('blocked\n') },
  })
  const blockedRun = await waitFor(9)
  assert.equal(blockedRun.result?.settlement, 'failed')
  assert.equal(blockedRun.result?.workingState?.revision, 2)
  assert.equal(blockedRun.result?.workingState?.goals[0]?.status, 'blocked')
  assert.match(
    blockedRun.result?.workingState?.goals[0]?.blocker || '',
    /EEXIST: file already exists, mkdir .*blocked-parent/,
    'blocked Working State must preserve the Host tool failure detail instead of replacing it with a generic label',
  )
  assert.ok((blockedRun.result?.workingState?.goals[0]?.blocker || '').length <= 800)
  const blockedEntries = turnRecordEntries({
    version: TURN_RECORD_FORMAT_VERSION,
    entries: blockedRun.result?.record?.entries || [],
  })
  assert.equal(blockedEntries.find((entry) => entry.kind === 'state-proposal' && entry.source === 'host')?.proposal.proposedStatus, 'blocked')
  assert.equal(blockedEntries.find((entry) => entry.kind === 'state-check')?.check.verdict, 'accepted')

  send(10, 'sessions/create', { title: 'Independent proposal rebase' })
  const multiSessionId = String((await waitFor(10)).result?.sessionId)
  send(11, 'turn/submit', {
    sessionId: multiSessionId,
    runId: 'working-multi-rebase-run',
    cwd: workspace,
    prompt: '同一步寫入 first.txt 與 second.txt，保留兩個獨立進度',
    profile,
    pattern: 'Goal-based',
    maxIterations: 1,
    definitionOfDone: 'both files contain exact verified content',
    workingGoals: [
      { description: 'first.txt exact content', completionPredicate: { kind: 'file-content', path: 'nested/../first.txt', sha256: sha256('first\n') } },
      { description: 'second.txt exact content', completionPredicate: { kind: 'file-content', path: 'second.txt', sha256: sha256('second\n') } },
    ],
  })
  const multi = await waitFor(11)
  assert.equal(multi.result?.settlement, 'answered')
  assert.equal(multi.result?.workingState?.revision, 3)
  assert.deepEqual(multi.result?.workingState?.goals.map((goal: { status: string }) => goal.status), ['done', 'done'])
  const multiEntries = turnRecordEntries({
    version: TURN_RECORD_FORMAT_VERSION,
    entries: multi.result?.record?.entries || [],
  })
  assert.deepEqual(
    multiEntries.filter((entry) => entry.kind === 'state-proposal').map((entry) => entry.proposal.baseRevision),
    [1, 1],
  )
  assert.deepEqual(
    multiEntries.filter((entry) => entry.kind === 'state-check').map((entry) => entry.check.verdict),
    ['accepted', 'rebased'],
  )
  assert.deepEqual(
    multiEntries.filter((entry) => entry.kind === 'working-state').map((entry) => entry.state.revision),
    [1, 2, 3],
  )

  send(12, 'sessions/create', { title: 'Malformed multi-goal admission' })
  const malformedSessionId = String((await waitFor(12)).result?.sessionId)
  send(13, 'turn/submit', {
    sessionId: malformedSessionId,
    runId: 'working-malformed-goals-run',
    cwd: workspace,
    prompt: '這個 admission 必須 fail closed',
    profile,
    workingGoals: [
      { description: 'valid', completionPredicate: { kind: 'file-content', path: 'valid.txt', sha256: sha256('valid\n') } },
      { description: '', completionPredicate: { kind: 'file-content', path: 'dropped.txt', sha256: sha256('dropped\n') } },
    ],
  })
  const malformed = await waitFor(13)
  assert.equal(malformed.error?.code, 'invalid_request')
  assert.match(malformed.error?.message || '', /workingGoals contains an invalid description/)

  send(14, 'sessions/create', { title: 'Failed then successful sibling' })
  const recoveredSessionId = String((await waitFor(14)).result?.sessionId)
  send(15, 'turn/submit', {
    sessionId: recoveredSessionId,
    runId: 'working-recovered-sibling-run',
    cwd: workspace,
    prompt: '第一個 sibling 失敗後，第二個完成 recover.txt',
    profile,
    pattern: 'Goal-based',
    maxIterations: 1,
    definitionOfDone: 'recover.txt contains exact verified content',
    workingGoal: { kind: 'file-content', path: '@recover\u00A0file.txt', sha256: sha256('recovered\n') },
  })
  const recovered = await waitFor(15)
  assert.equal(recovered.result?.settlement, 'answered')
  assert.equal(recovered.result?.workingState?.revision, 2)
  assert.equal(recovered.result?.workingState?.goals[0]?.status, 'done')
  const recoveredChecks = turnRecordEntries({
    version: TURN_RECORD_FORMAT_VERSION,
    entries: recovered.result?.record?.entries || [],
  }).filter((entry) => entry.kind === 'state-check')
  assert.equal(recoveredChecks.some((entry) => entry.check.verdict === 'accepted'), true)
  assert.equal(recoveredChecks.some((entry) => entry.check.verdict === 'rejected'), true)

  send(16, 'sessions/compact', {
    sessionId: recoveredSessionId,
    runId: 'working-recovered-sibling-run',
    contextWindowTokens: 10,
  })
  const compacted = await waitFor(16)
  assert.equal(compacted.error, undefined, JSON.stringify(compacted))
  const checkpointPath = join(stateDir, 'run-checkpoints', 'working-recovered-sibling-run', '0001.json')
  const checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'))
  assert.equal(checkpoint.workingStateRevision, 2)
  assert.equal(checkpoint.workingState.goals[0].status, 'done')
  assert.equal(checkpoint.governingPackage.revision, 1)
  assert.match(checkpoint.governingPackage.digest, /^[a-f0-9]{64}$/)
  assert.deepEqual(checkpoint.manifest.workingState, checkpoint.workingState)
  assert.deepEqual(checkpoint.manifest.completedEffects, checkpoint.workingState.goals[0].evidence.map((item: { evidenceId: string }) => item.evidenceId))

  regressionPlan = [
    [{ path: 'regression-a.txt', content: 'correct a' }], null,
    [{ path: 'regression-a.txt', content: 'WRONG' }, { path: 'regression-b.txt', content: 'correct b' }], null,
  ]
  send(30, 'sessions/create', { title: 'Completed predicate invalidation' })
  const regressionSession = String((await waitFor(30)).result?.sessionId)
  send(31, 'turn/submit', {
    sessionId: regressionSession, runId: 'completed-predicate-regression', cwd: workspace,
    prompt: 'Write correct a and correct b', profile, pattern: 'Goal-based', maxIterations: 2,
    definitionOfDone: 'Both files retain their requested content',
    workingGoals: ['a', 'b'].map((name) => ({ description: name,
      completionPredicate: { kind: 'file-content', path: `regression-${name}.txt`, sha256: sha256(`correct ${name}`) },
    })),
  })
  const regression = await waitFor(31)
  assert.equal(regression.error, undefined)
  assert.equal(await readFile(join(workspace, 'regression-a.txt'), 'utf8'), 'WRONG')
  assert.equal(regression.result.orchestration.dodMet, false)
  assert.deepEqual(regression.result.workingState.goals.map((goal: any) => goal.status), ['pending', 'done'])
  assert.ok(regression.result.record.entries.some((entry: any) => entry.kind === 'state-check' && entry.check.reason === 'completed-predicate-invalidated'))
  regressionPlan = undefined

  await stopChild(host, true)
  hostStopped = true
  restarted = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
    env: {
      ...process.env,
      SUBAGENTS_PI_HOST_STATE_PATH: statePath,
      SUBAGENTS_PI_CHECKPOINT_DIR: checkpointDir,
      SUBAGENTS_PI_AGENT_DIR: agentDir,
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const restartedMessages: Array<Record<string, any>> = []
  let restartedStdout = ''
  restarted.stdout.on('data', (buffer) => {
    restartedStdout += String(buffer)
    for (;;) {
      const newline = restartedStdout.indexOf('\n')
      if (newline < 0) break
      const line = restartedStdout.slice(0, newline).trim()
      restartedStdout = restartedStdout.slice(newline + 1)
      if (line) {
        const message = JSON.parse(line)
        restartedMessages.push(message)
        lastEvent = message.event || (message.id === undefined ? '<restart-notification>' : `restart-response-${message.id}`)
      }
    }
  })
  const restartedWaitFor = async (id: number, stage = `restart-response:${id}`) => {
    for (;;) {
      const message = restartedMessages.find((candidate) => candidate.id === id)
      if (message) return message
      if (Date.now() > suiteDeadline) {
        throw new Error(`timed out waiting for restarted response ${id}; run=${activeRunId || '<none>'}; requestCount=${requestCount}; lastEvent=${lastEvent}; pending=${stage}`)
      }
      await new Promise((done) => setTimeout(done, 10))
    }
  }
  restarted.stdin.write(`${JSON.stringify({ id: 17, method: 'initialize', params: { protocolVersion: 5 } })}\n`)
  await restartedWaitFor(17)
  restarted.stdin.write(`${JSON.stringify({ id: 18, method: 'turn/submit', params: {
    sessionId: recoveredSessionId,
    runId: 'working-recovered-resume-run',
    resumeFromRunId: 'working-recovered-sibling-run',
    cwd: workspace,
    prompt: '從 verified checkpoint 接續，不要重做 recover.txt',
    profile: { ...profile, activeTools: ['write', 'edit', 'bash', 'workspace_diff', 'workspace_mkdir'] },
    pattern: 'Goal-based',
    maxIterations: 1,
    definitionOfDone: 'recover.txt remains verified',
  } })}\n`)
  const resumed = await restartedWaitFor(18)
  assert.equal(resumed.error, undefined, JSON.stringify(resumed))
  assert.equal(resumed.result.workingState.revision, 2)
  assert.equal(resumed.result.workingState.runId, 'working-recovered-sibling-run')
  assert.equal(resumed.result.workingState.goals[0].status, 'done')
  const resumedPackage = resumed.result.record.entries
    .filter((entry: any) => entry.kind === 'memory-control-package').at(-1)?.packageIdentity
  assert.deepEqual(resumedPackage, checkpoint.governingPackage, 'resume keeps the checkpoint package identity')
  assert.equal(await readFile(join(workspace, 'recover file.txt'), 'utf8'), 'recovered\n')
  const replayResults = resumed.result.record.entries.filter((entry: { kind?: string; callId?: string }) =>
    entry.kind === 'tool-result' && ['call_resume_overwrite', 'call_resume_bash', 'call_resume_read_extension', 'call_resume_mutating_extension'].includes(entry.callId || ''))
  assert.equal(replayResults.find((entry: { callId?: string }) => entry.callId === 'call_resume_read_extension')?.settlement, 'success')
  assert.equal(replayResults.find((entry: { callId?: string }) => entry.callId === 'call_resume_mutating_extension')?.settlement, 'denied')
  assert.equal(existsSync(join(workspace, 'must-not-exist')), false)
  const builtinReplayResults = replayResults.filter((entry: { callId?: string }) =>
    entry.callId === 'call_resume_overwrite' || entry.callId === 'call_resume_bash')
  assert.deepEqual(builtinReplayResults.map((entry: { settlement?: string }) => entry.settlement), ['denied', 'denied'], JSON.stringify(replayResults))
  assert.equal(replayResults.filter((entry: { settlement?: string }) => entry.settlement === 'denied')
    .every((entry: { detail?: string }) => /resume replay refused/.test(entry.detail || '')), true)
  restarted.stdin.write(`${JSON.stringify({ id: 19, method: 'turn/submit', params: {
    sessionId: recoveredSessionId,
    runId: 'working-duplicate-resume-run',
    resumeFromRunId: 'working-recovered-sibling-run',
    cwd: workspace,
    prompt: '不可重複 claim',
    profile,
  } })}\n`)
  assert.match((await restartedWaitFor(19)).error?.message || '', /revision mismatch|already-claimed|newer completed effects/)
  restarted.stdin.write(`${JSON.stringify({ id: 20, method: 'turn/submit', params: {
    sessionId: recoveredSessionId,
    runId: 'working-missing-resume-run',
    resumeFromRunId: 'missing-checkpoint-run',
    cwd: workspace,
    prompt: '缺少 checkpoint 必須 fail closed',
    profile,
  } })}\n`)
  assert.match((await restartedWaitFor(20)).error?.message || '', /checkpoint is missing/)
  await stopChild(restarted, false)
} finally {
  if (!hostStopped) await stopChild(host, true)
  await stopChild(restarted, false)
  await closeModelServer()
  await rm(workspace, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(agentDir, { recursive: true, force: true })
}

console.log('Checker-backed Working State commits only trusted file-change evidence')
