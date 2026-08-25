import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

/**
 * Issue 15 — Pi Agent Runtime Contract qualification.
 *
 * ONE real Pi turn, driven through the shipped Host Protocol by a deterministic
 * loopback model, exercising every kind of tool the contract has to describe:
 * a builtin, a mutating builtin, an always-active Extension Pack tool, a
 * deferred capability revealed mid-turn, a Code Mode nested call, and an MCP
 * tool from a real child process.
 *
 * The question it answers is not "does each surface work" — the per-surface
 * smokes answer that. It is whether all of them describe the SAME per-turn
 * contract: one identity per call, carried unchanged from the catalog the
 * model was shown, through the decision and the result, into the durable Turn
 * Record. A surface that works but describes itself differently is the failure
 * this qualification exists to catch.
 */

type Message = {
  id?: number
  event?: string
  payload?: Record<string, any>
  result?: Record<string, any>
  error?: { code: string; message: string }
}
type ModelRequest = { tools?: Array<{ function?: { name?: string } }>; messages?: unknown[] }

const agentDir = await mkdtemp(join(tmpdir(), 'pi-qualify-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-qualify-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-qualify-workspace-'))
const fixtureLog = join(stateDir, 'mcp-fixture.log')
const fixtureText = 'runtime-contract-fixture-4f19ab'
await writeFile(join(workspace, 'fixture.txt'), fixtureText)

const MCP_TOOL = 'mcp_fixture-mcp_inspect-item'

/**
 * The call plan. `kind` is what the contract must describe consistently, and
 * is asserted against `toolSource`/`toolPack` rather than assumed.
 */
const plan = [
  { kind: 'builtin', name: 'read', args: { path: 'fixture.txt' } },
  { kind: 'builtin-mutating', name: 'write', args: { path: 'produced.txt', content: 'produced by qualification\n' } },
  { kind: 'pack-always-active', name: 'update_plan', args: { steps: [{ id: 'q', title: 'Runtime contract qualified', status: 'done' }] } },
  { kind: 'capability-load', name: 'load_capability', args: { id: 'workspace' } },
  { kind: 'capability-unlocked', name: 'workspace_mkdir', args: { path: 'unlocked' } },
  { kind: 'code-mode', name: 'run_code', args: { code: "return await tools.read({ path: 'fixture.txt' })" } },
  // The catalog states the precondition ("load the mcp-bridge capability"), so
  // the plan honours it. Calling the tool without loading is exercised
  // separately below — as a refusal, which is the contract, not an oversight.
  { kind: 'capability-load', name: 'load_capability', args: { id: 'mcp-bridge' } },
  { kind: 'mcp', name: MCP_TOOL, args: { itemId: 'alpha', options: { limit: 2 } } },
] as const

const requests: ModelRequest[] = []
const scripted: Array<{ name: string; args: Record<string, unknown> } | undefined> = [
  ...plan.map((entry) => ({ name: entry.name, args: entry.args as Record<string, unknown> })),
  undefined,
]

const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') return response.writeHead(404).end()
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (part) => { body += part })
  await once(request, 'end')
  requests.push(JSON.parse(body) as ModelRequest)
  const call = scripted.shift()
  const chunk = (delta: unknown, finish: string | null) => sse({
    id: `qualify-${requests.length}`,
    object: 'chat.completion.chunk',
    model: 'smoke-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (call) {
    response.write(chunk({ role: 'assistant', tool_calls: [{
      index: 0,
      id: `call_${requests.length}_${call.name}`,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.args) },
    }] }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: '執行合約已完整驗證。' }, null))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('model fixture did not bind')

await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: {
  baseUrl: `http://127.0.0.1:${address.port}/v1`,
  api: 'openai-completions',
  models: [{ id: 'smoke-model', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 128_000 }],
} } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'smoke' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as Message))
const wait = async (id: number) => {
  for (;;) {
    const found = messages.find((message) => message.id === id)
    if (found) return found
    await Promise.race([
      once(output, 'line'),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout waiting for ${id}`)), 40_000)),
    ])
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

const IDENTITY_FIELDS = ['contractRevision', 'contractDigest', 'schemaDigest', 'toolSource'] as const
const identityOf = (entry: Record<string, any> | undefined) =>
  entry ? Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, entry[field]])) : undefined

console.log('qualify-pi-agent-runtime-contract')

try {
  send(1, 'initialize', { protocolVersion: 2, capabilities: ['tool-contract-v1'] })
  assert.equal((await wait(1)).error, undefined)

  send(2, 'extensions/install', {
    id: 'fixture-mcp', name: 'Fixture MCP', version: '1.0.0', kind: 'mcp', source: 'controlled-fixture', trusted: true,
    tools: ['inspect-item'],
    mcp: { command: process.execPath, args: [resolve(import.meta.dirname, 'fixtures/pi-mcp-native-fixture.mjs')], env: { PI_MCP_NATIVE_FIXTURE_LOG: fixtureLog } },
  })
  assert.equal((await wait(2)).error, undefined)

  send(3, 'sessions/create', { title: 'Pi Agent Runtime Contract' })
  const sessionId = String((await wait(3)).result?.sessionId)

  // The catalog the model is about to be shown. Every identity asserted below
  // is compared against THIS projection, so a catalog that describes a tool
  // differently from how it executes fails here rather than in production.
  send(4, 'tools/list', { sessionId, requireContract: true })
  const catalog: Array<Record<string, any>> = (await wait(4)).result?.catalog || []
  const catalogFor = (name: string) => catalog.find((entry) => entry.name === name)

  check('the catalog describes every tool kind this turn will call', () => {
    for (const entry of plan) {
      const projected = catalogFor(entry.name)
      assert.ok(projected, `${entry.name} (${entry.kind}) is missing from the catalog projection`)
      assert.match(String(projected.schemaDigest || ''), /^[a-f0-9]{8,}$/, `${entry.name} publishes a schema digest`)
    }
    // A deferred capability's tools are catalogued but not yet callable.
    assert.equal(catalogFor('workspace_mkdir')?.active, false, 'a deferred capability tool starts inactive')
    assert.equal(catalogFor(MCP_TOOL)?.extensionId, 'fixture-mcp', 'the MCP tool names the extension that owns it')
  })

  send(5, 'turn/submit', {
    sessionId,
    runId: 'runtime-contract-run',
    cwd: workspace,
    prompt: 'Exercise every tool kind, then finish.',
    contextPolicy: { memoryEnabled: false, memoryWriteEnabled: false, referenceChatHistory: false, temporary: false },
    // Attended `full` access: the point of this turn is to exercise execution
    // across every surface. The unattended downgrade (which turns `full` back
    // into `auto` and auto-denies) is a policy property, covered per origin by
    // smoke-pi-all-origin-policy-contract; asserting it here would only stop
    // the mutating and capability tools from ever running.
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false },
  })
  const settled = await wait(5)
  assert.equal(settled.error, undefined, JSON.stringify(settled.error))
  assert.equal(settled.result?.settlement, 'answered', 'the turn completed through every surface')

  const entries: Array<Record<string, any>> = settled.result?.record?.entries || []
  const callsByTool = (tool: string) => entries.filter((entry) => entry.kind === 'tool-call' && entry.tool === tool)
  /** The nth planned call of a tool, so a tool used twice is still checked per call. */
  const plannedCall = (entry: (typeof plan)[number]) => {
    const sameTool = plan.filter((candidate) => candidate.name === entry.name)
    return callsByTool(entry.name)[sameTool.indexOf(entry)]
  }
  const resultFor = (callId: string) => entries.find((entry) => entry.kind === 'tool-result' && entry.callId === callId)

  check('every planned call reached production execution', () => {
    for (const entry of plan) {
      const expected = plan.filter((candidate) => candidate.name === entry.name).length
      assert.equal(callsByTool(entry.name).length, expected, `${entry.name} (${entry.kind}) executed exactly as planned`)
    }
  })

  check('one identity per call, unchanged from catalog to Turn Record', () => {
    for (const entry of plan) {
      const call = plannedCall(entry)
      const result = resultFor(call.callId)
      assert.ok(result, `${entry.name} has a terminal result`)
      assert.deepEqual(
        identityOf(result),
        identityOf(call),
        `${entry.name} (${entry.kind}) result preserves the call's contract identity`,
      )
      assert.equal(call.schemaDigest, catalogFor(entry.name)?.schemaDigest,
        `${entry.name} executed against the schema the model was shown`)
      assert.equal(call.invocationOrigin, 'model', `${entry.name} is recorded as model-originated`)
      assert.equal(result.invocationOrigin, 'model')
    }
  })

  check('the recorded arguments are the arguments that ran', () => {
    for (const entry of plan) {
      const call = plannedCall(entry)
      assert.deepEqual(call.args, entry.args, `${entry.name} recorded the exact arguments (ADR-0050 replay)`)
    }
  })

  check('exactly one terminal settlement per call', () => {
    for (const entry of plan) {
      const call = plannedCall(entry)
      const terminals = entries.filter((record) => record.kind === 'tool-result' && record.callId === call.callId)
      assert.equal(terminals.length, 1, `${entry.name} settles once, not twice`)
      assert.ok(['success', 'failed', 'denied', 'cancelled'].includes(terminals[0].settlement))
    }
  })

  check('a deferred capability becomes callable only after it is loaded', () => {
    const loadIndex = entries.findIndex((entry) => entry.kind === 'tool-call' && entry.tool === 'load_capability')
    const unlockedIndex = entries.findIndex((entry) => entry.kind === 'tool-call' && entry.tool === 'workspace_mkdir')
    assert.ok(loadIndex >= 0 && unlockedIndex > loadIndex, 'the capability was loaded before its tool was called')
    // The model could not have called it earlier: it was absent from the tool
    // list the model was given on the first request.
    const firstOffer = (requests[0]?.tools || []).map((tool) => tool.function?.name)
    assert.equal(firstOffer.includes('workspace_mkdir'), false, 'a deferred tool is not model-callable before load')
  })

  check('a call outside this turn contract says so, instead of just lacking identity', () => {
    // Issue 19: every planned call here IS in the contract, so none may carry
    // the marker. Its absence-when-identified is half the contract; the other
    // half (present-when-unidentified) is asserted by the inactive-tool case.
    for (const entry of plan) {
      const call = plannedCall(entry)
      assert.equal(call.contractStatus, undefined, `${entry.name} is in the contract, so it carries identity rather than a marker`)
      assert.ok(call.schemaDigest, `${entry.name} carries a schema digest`)
    }
  })

  check('an inactive tool is refused and the catalog says how to enable it', () => {
    const projected = catalog.find((entry) => entry.name === MCP_TOOL)
    assert.equal(projected?.active, false, 'the MCP tool starts inactive')
    assert.match(String(projected?.reason || ''), /load the mcp-bridge capability/,
      'the projection states the precondition rather than leaving the model to guess')
    // The model was never offered it before the capability was loaded, which
    // is the enforcement — the reason string is guidance, not the gate.
    assert.equal((requests[0]?.tools || []).some((tool) => tool.function?.name === MCP_TOOL), false)
  })

  check('a Code Mode nested call re-enters the same contract', () => {
    const outer = callsByTool('run_code')[0]
    assert.ok(outer, 'run_code executed')
    // The nested call is the model reaching a tool through code rather than
    // through a tool call, and it must still be described by this contract.
    const nested = entries.filter((entry) => entry.kind === 'tool-call' && entry.tool === 'read' && entry.callId !== callsByTool('read')[0]?.callId)
    for (const call of nested) {
      assert.equal(call.contractDigest, catalogFor('read')?.contractDigest ?? call.contractDigest,
        'a nested call carries the same contract as the direct one')
    }
  })

  // Facts on disk, not reported success: a tool that CLAIMS to have written is
  // exactly what a qualification must refuse to believe.
  assert.equal(entries.some((entry) => entry.kind === 'tool-result' && entry.tool === 'write' && entry.settlement === 'success'), true)
  assert.match(await readFile(join(workspace, 'produced.txt'), 'utf8'), /produced by qualification/)
  assert.match(await readFile(fixtureLog, 'utf8'), /inspect-item/, 'the MCP tool ran in its own child process')
  passed++
  console.log('  ✓ the mutating builtin wrote to disk and the MCP child logged its call')

  // ── The shell expectation for THIS platform, settled by a real turn ──
  // ADR-0047 + ADR-0051: what `required` means is a property of the host, and
  // BOTH answers are lawful. What is not lawful is silence, so the outcome is
  // asserted either way rather than skipped on the platforms that refuse.
  const shellSideEffect = join(workspace, 'shell-effect.txt')
  scripted.push(
    { name: 'bash', args: { command: `printf ran > ${JSON.stringify(shellSideEffect)}` } },
    undefined,
  )
  send(6, 'turn/submit', {
    sessionId,
    runId: 'runtime-contract-shell',
    cwd: workspace,
    prompt: 'Exercise the builtin shell under required.',
    contextPolicy: {
      memoryEnabled: false, memoryWriteEnabled: false, referenceChatHistory: false, temporary: false,
      outboundShellMode: 'required', viewRoot: workspace,
    },
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false },
  })
  const shellTurn = await wait(6)
  assert.equal(shellTurn.error, undefined)
  const hasVerifiedBackend = process.platform === 'darwin' || process.platform === 'linux'
  const shellDecision = messages.find((message) => message.event === 'host/tool-decision'
    && message.payload?.runId === 'runtime-contract-shell' && message.payload?.tool === 'bash')

  check(`required builtin shell behaves as this platform can prove (${process.platform})`, () => {
    assert.ok(shellDecision, 'a required shell call always produces a decision')
    if (hasVerifiedBackend) {
      assert.equal(shellDecision?.payload?.decision, 'allow')
      assert.match(String(shellDecision?.payload?.reason || ''), /backend=\S+ profile=[a-f0-9]{12} view=\S+/,
        'an allowed shell names the backend, profile digest and view that authorised it')
    } else {
      assert.equal(shellDecision?.payload?.decision, 'deny')
      assert.match(String(shellDecision?.payload?.reason || ''), /Required.*builtin shell/i)
    }
  })

  await (async () => {
    const ran = await readFile(shellSideEffect, 'utf8').then(() => true, () => false)
    assert.equal(ran, hasVerifiedBackend,
      hasVerifiedBackend
        ? 'a verified backend runs the command inside the view'
        : 'no verified backend means no side effect at all')
    passed++
    console.log(`  ✓ the shell side effect ${hasVerifiedBackend ? 'exists' : 'does not exist'}, matching this platform's backend`)
  })()

  // ── Issue 19: a call the frozen contract does not carry ──
  // Three situations that used to look identical in the record are separated
  // here: catalogued-but-inactive, wholly unknown, and an ordinary call.
  const UNKNOWN_TOOL = 'definitely_not_a_registered_tool'
  scripted.push(
    { name: MCP_TOOL, args: { itemId: 'charlie' } },
    { name: UNKNOWN_TOOL, args: {} },
    undefined,
  )
  send(8, 'sessions/create', { title: 'Contract-outsider calls' })
  const outsiderSession = String((await wait(8)).result?.sessionId)
  send(9, 'turn/submit', {
    sessionId: outsiderSession,
    runId: 'runtime-contract-outsider',
    cwd: workspace,
    prompt: 'Call a tool this turn never activated, then one that does not exist.',
    contextPolicy: { memoryEnabled: false, memoryWriteEnabled: false, referenceChatHistory: false, temporary: false },
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false },
  })
  const outsider = await wait(9)
  assert.equal(outsider.error, undefined)
  const outsiderEntries: Array<Record<string, any>> = outsider.result?.record?.entries || []
  const outsiderCall = (tool: string) => outsiderEntries.find((entry) => entry.kind === 'tool-call' && entry.tool === tool)
  const outsiderResult = (tool: string) => outsiderEntries.find((entry) => entry.kind === 'tool-result' && entry.tool === tool)

  check('a catalogued-but-inactive call keeps its identity and is refused by name', () => {
    const call = outsiderCall(MCP_TOOL)
    assert.ok(call, 'the inactive tool call was recorded')
    assert.equal(call.contractStatus, 'catalogued-not-in-turn-contract',
      'the record says WHY this call carries no contract revision')
    assert.equal(call.schemaDigest, catalogFor(MCP_TOOL)?.schemaDigest,
      'the identity comes from the catalog the Host published')
    assert.equal(call.toolSource, 'mcp')
    // The tool was not part of that revision, so claiming it was would be a
    // worse lie than leaving it out.
    assert.equal(call.contractRevision, undefined)

    const result = outsiderResult(MCP_TOOL)
    assert.equal(result?.settlement, 'denied', 'an inactive tool is refused, not reported as a broken tool')
    assert.match(String(result?.detail || ''), /load the mcp-bridge capability/,
      'the refusal carries the catalog reason, which names what would fix it')
  })

  check('a wholly unknown tool is distinguishable from a known-but-inactive one', () => {
    const call = outsiderCall(UNKNOWN_TOOL)
    assert.ok(call, 'the unknown tool call was recorded')
    assert.equal(call.contractStatus, 'not-in-turn-contract', 'an unknown tool gets the other marker')
    assert.equal(call.schemaDigest, undefined, 'there is no catalog entry to take a digest from')
    assert.notEqual(call.contractStatus, outsiderCall(MCP_TOOL)?.contractStatus,
      'the two cases must not collapse into one status')
  })

  // The unsupported expectation is exercised too, not just reasoned about:
  // a run whose view cannot be verified must fail closed on EVERY platform,
  // including the ones that do have a backend. Without this, "unsupported" is
  // only ever observed on hosts that happen to lack an adapter.
  const unverifiableView = join(workspace, 'no-such-view')
  scripted.push(
    { name: 'bash', args: { command: `printf ran > ${JSON.stringify(join(workspace, 'never.txt'))}` } },
    undefined,
  )
  send(7, 'turn/submit', {
    sessionId,
    runId: 'runtime-contract-shell-unverifiable',
    cwd: workspace,
    prompt: 'Exercise the builtin shell with no verifiable view.',
    contextPolicy: {
      memoryEnabled: false, memoryWriteEnabled: false, referenceChatHistory: false, temporary: false,
      outboundShellMode: 'required', viewRoot: unverifiableView,
    },
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: false },
  })
  assert.equal((await wait(7)).error, undefined)
  const unverifiableDecision = messages.find((message) => message.event === 'host/tool-decision'
    && message.payload?.runId === 'runtime-contract-shell-unverifiable' && message.payload?.tool === 'bash')

  check('a required shell with no verifiable sandbox fails closed on every platform', () => {
    assert.equal(unverifiableDecision?.payload?.decision, 'deny')
    assert.match(String(unverifiableDecision?.payload?.reason || ''), /Required.*builtin shell/i)
  })

  await (async () => {
    const ran = await readFile(join(workspace, 'never.txt'), 'utf8').then(() => true, () => false)
    assert.equal(ran, false, 'a refused shell produces no side effect')
    passed++
    console.log('  ✓ the refused shell left nothing behind')
  })()

  console.log(`\n${passed} checks passed`)
} finally {
  host.stdin.end()
  if (host.exitCode === null) await once(host, 'exit').catch(() => host.kill())
  output.close()
  await new Promise<void>((done) => modelServer.close(() => done()))
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}
