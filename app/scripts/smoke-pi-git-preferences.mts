import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { decideGitCommand, gitCommandPolicyFromSettings } from '../src/agent/tools/gitCommandPolicy.ts'
import { buildRunContextPolicy } from '../src/agent/runSettingsSnapshot.ts'
import { parsePiTurnContextPolicy } from '../electron/piSessionContext.ts'
import type { LlmSettings } from '../src/agent/types.ts'

/**
 * Issue 18 — Settings → Git preferences reach the runtime.
 *
 * The failure this guards against is not a wrong rewrite; it is a preference
 * that reaches nothing at all. So the assertions follow the value across every
 * hop it has to survive: Settings → frozen run policy → IPC → the decision the
 * Host makes on the command.
 */

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

console.log('smoke-pi-git-preferences')

const settings = (overrides: Partial<LlmSettings>) => ({
  model: 'test-model',
  gitBranchPrefix: 'agent/',
  gitCreateDraftPr: true,
  gitForcePush: false,
  ...overrides,
} as unknown as LlmSettings)

test('a forbidden force push is DENIED, not silently stripped', () => {
  const policy = gitCommandPolicyFromSettings(settings({}))
  const decision = decideGitCommand('git push --force origin main', policy)
  assert.equal(decision.action, 'deny')
  assert.match((decision as { reason: string }).reason, /force push/i)
  // The distinction that matters: a strip would have produced a runnable
  // command, so the model would read success for a push that did not happen.
  assert.equal('command' in decision, false, 'a denial never yields a rewritten command to run')
  assert.equal(decideGitCommand('git push --force-with-lease origin main', policy).action, 'deny',
    '--force-with-lease is still a force push')
})

test('force push is allowed when the user allows it', () => {
  const policy = gitCommandPolicyFromSettings(settings({ gitForcePush: true }))
  assert.equal(decideGitCommand('git push --force origin main', policy).action, 'allow')
})

test('an ordinary push is never mistaken for a force push', () => {
  const policy = gitCommandPolicyFromSettings(settings({}))
  for (const command of ['git push origin main', 'git push', 'echo "--force"']) {
    assert.equal(decideGitCommand(command, policy).action, 'allow', command)
  }
})

test('additive preferences are rewrites, and only where they apply', () => {
  const policy = gitCommandPolicyFromSettings(settings({}))
  const branch = decideGitCommand('git checkout -b fix-login', policy)
  assert.equal(branch.action, 'rewrite')
  assert.equal((branch as { command: string }).command, 'git checkout -b agent/fix-login')

  const pr = decideGitCommand('gh pr create --title x', policy)
  assert.equal((pr as { command: string }).command, 'gh pr create --draft --title x')

  // Already-correct commands are left alone rather than rewritten to identical
  // text, so `rewrite` always means something actually changed.
  assert.equal(decideGitCommand('git checkout -b agent/already', policy).action, 'allow')
  assert.equal(decideGitCommand('gh pr create --draft', policy).action, 'allow')
  // A branch that names its own namespace is a deliberate choice, not a
  // missing default.
  assert.equal(decideGitCommand('git checkout -b feature/login', policy).action, 'allow')
  // `git checkout main` is not branch creation.
  assert.equal(decideGitCommand('git checkout main', policy).action, 'allow')
})

test('the preferences are frozen onto the run policy', () => {
  const policy = buildRunContextPolicy(settings({}), { temporary: false })
  assert.deepEqual(policy.gitPolicy, { branchPrefix: 'agent/', allowForcePush: false, draftPr: true })
  // Frozen means frozen: the snapshot does not observe a later Settings change.
  const permissive = buildRunContextPolicy(settings({ gitForcePush: true }), { temporary: false })
  assert.equal(permissive.gitPolicy?.allowForcePush, true)
  assert.equal(policy.gitPolicy?.allowForcePush, false)
})

test('the policy survives the IPC crossing, and fails closed if mangled', () => {
  const policy = buildRunContextPolicy(settings({}), { temporary: false })
  const parsed = parsePiTurnContextPolicy(JSON.parse(JSON.stringify(policy)))
  assert.deepEqual(parsed.gitPolicy, { branchPrefix: 'agent/', allowForcePush: false, draftPr: true })

  // The one preference with destructive consequences is read strictly: only an
  // explicit `true` allows it, so a partial or malformed policy cannot open it.
  for (const value of ['true', 1, {}, null, undefined]) {
    const mangled = parsePiTurnContextPolicy({ ...policy, gitPolicy: { allowForcePush: value } })
    assert.equal(mangled.gitPolicy?.allowForcePush, false, `allowForcePush must not be opened by ${JSON.stringify(value)}`)
  }
  // A policy that is absent entirely stays absent — the Host then applies no
  // Git preference rather than inventing one.
  assert.equal(parsePiTurnContextPolicy({ ...policy, gitPolicy: undefined }).gitPolicy, undefined)
})

test('the Host applies Git preferences BEFORE the outbound shell gate', () => {
  // Order is load-bearing: the gate inspects the command that runs, and the
  // sandbox wraps it. If the rewrite happened after, the string the gate
  // approved and the string that executed would differ.
  const host = readSource('electron/piToolHost.ts')
  const gitAt = host.indexOf('decideGitCommand(')
  const shellAt = host.indexOf('const shell = binding?.shellPolicy')
  assert.notEqual(gitAt, -1, 'the Host evaluates Git preferences')
  assert.notEqual(shellAt, -1)
  assert.ok(gitAt < shellAt, 'Git preferences are decided before the outbound shell policy')
})

test('the renderer rewriter is gone, so there is one owner', () => {
  assert.doesNotMatch(readSource('src/agent/tools/toolIoHelpers.ts'), /applyGitSettingsToBash/)
  assert.equal(existsSync(new URL('../src/agent/tools/executor.ts', import.meta.url)), false)
})



function readSource(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
}

/**
 * The last hop, settled by a real turn.
 *
 * Everything above proves the preference SURVIVES each hop. Only a real Pi
 * turn proves it ARRIVES: the model asks for a force push through the shipped
 * Host, and the command must not run.
 */
type Message = { id?: number; event?: string; payload?: Record<string, any>; result?: Record<string, any>; error?: { code: string; message: string } }

const agentDir = await mkdtemp(join(tmpdir(), 'git-prefs-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'git-prefs-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'git-prefs-workspace-'))
const forbiddenEffect = join(workspace, 'force-push-ran.txt')
await new Promise<void>((done, fail) => {
  const init = spawn('/bin/sh', ['-c', 'git init -q . && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base'], { cwd: workspace, stdio: 'ignore' })
  init.once('close', (code) => (code === 0 ? done() : fail(new Error('could not stage a git workspace'))))
})
const branchEffect = join(workspace, 'branch-command.txt')

// Two calls: one the policy must refuse, one it must rewrite. Both write a
// file if they run, so "did it execute" is a fact on disk.
const scripted: Array<{ command: string } | undefined> = [
  { command: `git push --force origin main && printf ran > ${JSON.stringify(forbiddenEffect)}` },
  // A real repository, so the branch that ends up existing is the proof of
  // what executed — not what any layer reported it did.
  { command: 'git checkout -b fix-login' },
  { command: `git rev-parse --abbrev-ref HEAD > ${JSON.stringify(branchEffect)}` },
  undefined,
]
const requests: Array<{ index: number }> = []
const stageTrace: string[] = []
let lastEvent = '<none>'
const noteStage = (stage: string) => {
  stageTrace.push(`${new Date().toISOString()} ${stage}`)
}
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') return response.writeHead(404).end()
  request.on('data', () => undefined)
  await once(request, 'end')
  requests.push({ index: requests.length + 1 })
  lastEvent = `provider-request-${requests.length}`
  noteStage(lastEvent)
  const call = scripted.shift()
  const chunk = (delta: unknown, finish: string | null) => sse({
    id: `git-prefs-${requests.length}`, object: 'chat.completion.chunk', model: 'smoke-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (call) {
    response.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${requests.length}`, type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: call.command }) } }] }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: 'Git 偏好已套用。' }, null))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('model fixture did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', models: [{ id: 'smoke-model', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 128_000 }] } } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'smoke' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: {
    ...process.env,
    SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'),
    SUBAGENTS_PI_AGENT_DIR: agentDir,
    // The production resolver intentionally prefers a configured native Pi
    // directory. This smoke must never inherit the developer's ~/.pi/agent.
    SUBAGENTS_PI_NATIVE_AGENT_DIR: '',
  },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => {
  const message = JSON.parse(line) as Message
  messages.push(message)
  lastEvent = message.event || (message.id === undefined ? '<notification>' : `response-${message.id}`)
})
const suiteDeadline = Date.now() + 120_000
const wait = async (id: number, stage: string) => {
  const found = messages.find((message) => message.id === id)
  if (found) return found
  noteStage(`wait:${stage}`)
  return new Promise<Message>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error, response?: Message) => {
      if (timer) clearTimeout(timer)
      output.removeListener('line', onLine)
      output.removeListener('close', onClose)
      if (error) reject(error)
      else if (response) resolve(response)
    }
    const onLine = () => {
      const response = messages.find((message) => message.id === id)
      if (response) finish(undefined, response)
    }
    const onClose = () => finish(new Error(`Host output closed while waiting for ${stage} id=${id}`))
    output.on('line', onLine)
    output.once('close', onClose)
    const remaining = suiteDeadline - Date.now()
    timer = setTimeout(() => finish(new Error(
      `timeout ${stage} id=${id}; requestCount=${requests.length}; lastEvent=${lastEvent}; trace=${stageTrace.join(' > ')}`,
    )), Math.max(1, remaining))
  })
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
  noteStage(`send:${method}#${id}`)
  if (!host.stdin.destroyed) host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
}

const waitForHostExit = async (timeoutMs: number): Promise<boolean> => {
  if (host.exitCode !== null || host.signalCode !== null) return true
  return new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (exited: boolean) => {
      if (timer) clearTimeout(timer)
      host.removeListener('exit', onExit)
      resolve(exited)
    }
    const onExit = () => finish(true)
    host.once('exit', onExit)
    timer = setTimeout(() => finish(false), Math.max(1, Math.min(timeoutMs, suiteDeadline - Date.now())))
  })
}

let sessionId = ''
try {
  send(1, 'initialize', { protocolVersion: 2 })
  assert.equal((await wait(1, 'initialize')).error, undefined)
  send(2, 'sessions/create', { title: 'Git preferences' })
  sessionId = String((await wait(2, 'session-create')).result?.sessionId)
  send(3, 'settings/update', {
    provider: 'loopback',
    model: 'smoke-model',
    thinkingLevel: 'off',
    approvalMode: 'full',
    unattended: false,
    activeTools: ['bash'],
    compaction: 'manual',
  })
  assert.equal((await wait(3, 'settings-update')).error, undefined)
  send(4, 'turn/submit', {
    sessionId,
    runId: 'git-prefs-run',
    cwd: workspace,
    prompt: 'Push and branch.',
    contextPolicy: {
      memoryEnabled: false, memoryWriteEnabled: false, referenceChatHistory: false, temporary: false,
      gitPolicy: { branchPrefix: 'agent/', allowForcePush: false, draftPr: true },
    },
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false, activeTools: ['bash'], compaction: 'manual' },
  })
  const settled = await wait(4, 'turn-settlement')
  noteStage(`settled:id=4 requestCount=${requests.length}`)
  assert.equal(settled.error, undefined)

  const decisions = messages.filter((message) => message.event === 'host/tool-decision' && message.payload?.runId === 'git-prefs-run')

  test('a real turn cannot force push when the user disallowed it', async () => {
    const denial = decisions.find((message) => message.payload?.decision === 'deny')
    assert.ok(denial, 'the force push was refused')
    assert.match(String(denial?.payload?.reason || ''), /force push/i, 'the refusal names the setting that refused')
  })
  assert.equal(await readFile(forbiddenEffect, 'utf8').then(() => true, () => false), false,
    'the refused command produced no side effect')
  passed++
  console.log('  ✓ the refused force push left nothing behind')

  test('a rewrite is recorded, and the record says what was asked for', () => {
    const entries: Array<Record<string, any>> = settled.result?.record?.entries || []
    const branchCall = entries.find((entry) => entry.kind === 'tool-call' && String(entry.args?.command || '').includes('checkout -b'))
    assert.ok(branchCall, 'the branch command reached execution')
    // The recorded arguments are the model's REQUEST, captured before the Host
    // patched them — that is what Pi's execution-start event carries. So the
    // rewrite has to be legible somewhere else, and it is: the evidence trail
    // records that a preference was applied. Pinned here because the two
    // together are the honest account; the tool-call args alone are not.
    assert.match(String(branchCall.args.command), /checkout -b fix-login\b/,
      'the record preserves what the model asked for')
    const applied = entries.filter((entry) => entry.kind === 'tool-evidence'
      && /Git 偏好已套用/.test(String(entry.detail || '')))
    assert.ok(applied.length >= 1, 'the evidence trail records that a Git preference rewrote the command')
    assert.match(String(applied[0].detail), /branch prefix/, 'and names which preference applied')
  })

  const branchOnDisk = (await readFile(branchEffect, 'utf8').catch(() => '')).trim()
  test('the branch that exists is the rewritten one', () => {
    // The only account that cannot be wrong: git itself says which branch the
    // command created.
    assert.equal(branchOnDisk, 'agent/fix-login',
      `the prefix reached execution; git reports ${JSON.stringify(branchOnDisk)}`)
  })
} finally {
  noteStage('cleanup:start')
  if (host.exitCode === null && sessionId) {
    try { send(99, 'turn/cancel', { sessionId, runId: 'git-prefs-run' }) } catch { /* best effort */ }
  }
  if (!host.stdin.destroyed) host.stdin.end()
  if (!(await waitForHostExit(2_000)) && host.exitCode === null) host.kill('SIGTERM')
  if (!(await waitForHostExit(2_000)) && host.exitCode === null) host.kill('SIGKILL')
  await waitForHostExit(2_000)
  noteStage(`cleanup:done requestCount=${requests.length} lastEvent=${lastEvent}`)
  output.close()
  await new Promise<void>((done) => modelServer.close(() => done()))
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}

console.log(`\n${passed} tests passed`)
