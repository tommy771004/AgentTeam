import assert from 'node:assert/strict'
import { resolvePiHostStateFile } from '../electron/piHostState.ts'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { parseTurnRecord } from '../src/agent/turnRecord.ts'
import {
  evaluatePiInvocationPolicy,
  freezePiRunPolicy,
  PiInvocationEvidence,
  PI_POLICY_EVIDENCE_MIGRATION_INVENTORY,
} from '../electron/piPolicyEvidence.ts'

const digest = 'a'.repeat(64)
const base = {
  coordinates: { sessionId: 'session', runId: 'run', callId: 'call' },
  origin: 'model' as const,
  tool: 'workspace_download',
  contract: { contractRevision: 1, schemaDigest: digest, toolSource: 'extension-pack' as const, toolPack: 'workspace-extra' },
  args: { url: 'https://example.test/fixture', path: 'fixture.txt' },
  requirements: { capabilityApproval: 'workspace download requires approval', sideEffect: true, outbound: true, pathArguments: ['path'] },
}
const fullPolicy = freezePiRunPolicy({ approvalMode: 'full', projectRoot: '/tmp/project' })
assert.equal(evaluatePiInvocationPolicy({ ...base, policy: fullPolicy }).verdict, 'ask', 'capability approval survives full access')
assert.equal(evaluatePiInvocationPolicy({ ...base, policy: freezePiRunPolicy({ approvalMode: 'full', unattended: true, projectRoot: '/tmp/project' }) }).verdict, 'deny', 'unattended ask fails closed')
assert.equal(evaluatePiInvocationPolicy({ ...base, requirements: { sideEffect: false }, policy: fullPolicy }).verdict, 'allow')
assert.equal(evaluatePiInvocationPolicy({ ...base, requirements: { sideEffect: false }, policy: freezePiRunPolicy({ approvalMode: 'full', projectRoot: '/tmp/project', deniedTools: ['workspace_download'] }) }).verdict, 'deny', 'restrictive deny wins')
assert.equal(evaluatePiInvocationPolicy({ ...base, requirements: { outbound: true }, policy: freezePiRunPolicy({ approvalMode: 'full', projectRoot: '/tmp/project', outboundMode: 'required' }) }).verdict, 'deny', 'required outbound refuses a missing frozen view')
assert.ok(PI_POLICY_EVIDENCE_MIGRATION_INVENTORY.migrated.includes('model:extension-pack:workspace_download'))
assert.ok(PI_POLICY_EVIDENCE_MIGRATION_INVENTORY.migrated.includes('code-mode:nested'))
const boundedEvents: any[] = []
const boundedEvidence = new PiInvocationEvidence({
  ...base.coordinates, ...base.contract, tool: base.tool, origin: base.origin,
}, (event) => boundedEvents.push(event))
boundedEvidence.update('界'.repeat(2_000))
boundedEvidence.settle('success')
boundedEvidence.settle('failed')
assert.ok(new TextEncoder().encode(boundedEvents[0].detail).byteLength <= 1_024)
assert.equal(boundedEvents.filter((event) => event.phase === 'settlement').length, 1, 'terminal settlement is exactly once')

type Message = { id?: number; event?: string; payload?: Record<string, any>; result?: Record<string, any>; error?: { code: string; message: string } }
const agentDir = await mkdtemp(join(tmpdir(), 'pi-policy-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-policy-state-'))
const projectRoot = await mkdtemp(join(tmpdir(), 'pi-policy-project-'))
const restrictedView = await mkdtemp(join(tmpdir(), 'pi-policy-view-'))
const statePath = join(stateDir, 'state.json')
await symlink(stateDir, join(restrictedView, 'escape-link'))
const escapedViewEvaluation = evaluatePiInvocationPolicy({
  ...base,
  args: { ...base.args, path: 'escape-link/stolen.txt' },
  requirements: { outbound: true, pathArguments: ['path'] },
  policy: freezePiRunPolicy({ approvalMode: 'full', projectRoot, outboundMode: 'optional', restrictedViewRoot: restrictedView }),
})
assert.equal(escapedViewEvaluation.verdict, 'deny', 'symlinked ancestors cannot escape the frozen view')
assert.equal(escapedViewEvaluation.evidence.restrictedViewRoot, restrictedView, 'policy evidence names the frozen view, not project cwd')

const scriptedCalls: Array<{ name: string; args: Record<string, unknown> } | undefined> = [
  { name: 'load_capability', args: { id: 'workspace' } },
  { name: 'workspace_download', args: { url: `http://127.0.0.1:__PORT__/fixture.txt`, path: 'download-success.txt' } },
  { name: 'workspace_download', args: { url: 'file:///not-outbound', path: 'download-failure.txt' } },
  undefined,
  { name: 'workspace_download', args: { url: `http://127.0.0.1:__PORT__/fixture.txt`, path: 'denied-download.txt' } },
  undefined,
]
const requests: Array<Record<string, any>> = []
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const modelServer = createServer(async (request, response) => {
  if (request.url === '/fixture.txt' && request.method === 'GET') return response.writeHead(200, { 'content-type': 'text/plain' }).end('download fixture payload')
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') return response.writeHead(404).end()
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (part) => { body += part })
  await once(request, 'end')
  requests.push(JSON.parse(body))
  const call = scriptedCalls.shift()
  const chunk = (delta: unknown, finish: string | null) => sse({
    id: `policy-${requests.length}`, object: 'chat.completion.chunk', model: 'smoke-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (call) {
    response.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `policy_call_${requests.length}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: 'Policy evidence turn complete.' }, null))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})

await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('model fixture did not bind')
for (const call of scriptedCalls) {
  if (call && typeof call.args.url === 'string') call.args.url = call.args.url.replace('__PORT__', String(address.port))
}
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', models: [{ id: 'smoke-model', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 128_000 }] } } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'smoke' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const child = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: statePath, SUBAGENTS_PI_AGENT_DIR: agentDir },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: child.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line)))
const waitFor = async (predicate: (message: Message) => boolean, label: string, from = 0) => {
  const deadline = Date.now() + 25_000
  for (;;) {
    const found = messages.slice(from).find(predicate)
    if (found) return found
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`)
    await new Promise((done) => setTimeout(done, 20))
  }
}
const waitId = (id: number) => waitFor((message) => message.id === id, `id ${id}`)
const send = (id: number, method: string, params: Record<string, unknown> = {}) => child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)

try {
  send(1, 'initialize', { protocolVersion: 2, capabilities: ['tool-contract-v1'] })
  assert.equal((await waitId(1)).error, undefined)
  send(2, 'sessions/create', { title: 'Policy evidence expand' })
  const sessionId = String((await waitId(2)).result?.sessionId)

  const firstStart = messages.length
  send(3, 'turn/submit', {
    sessionId, runId: 'policy-run-interactive', cwd: projectRoot,
    prompt: 'Activate workspace, delete the fixture, exercise missing-file failure, then finish.',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'auto', unattended: false },
    contextPolicy: { outboundShellMode: 'optional', viewRoot: restrictedView },
  })
  const ask1 = await waitFor((message) => message.event === 'host/approval-requested' && message.payload?.tool === 'workspace_download', 'first approval', firstStart)
  assert.equal(ask1.payload?.args?.path, join(restrictedView, 'download-success.txt'), 'approval evidence uses the frozen view root')
  // Mutating Settings while the ask waits must not change this admitted run.
  send(4, 'settings/update', { approvalMode: 'full' })
  assert.equal((await waitId(4)).error, undefined)
  send(5, 'approvals/resolve', { runId: ask1.payload?.runId, callId: ask1.payload?.callId, decision: 'allow' })
  assert.equal((await waitId(5)).error, undefined)
  const ask2 = await waitFor((message) => message.event === 'host/approval-requested' && message.payload?.tool === 'workspace_download' && message.payload?.callId !== ask1.payload?.callId, 'second approval', firstStart)
  assert.equal(ask2.payload?.args?.path, join(restrictedView, 'download-failure.txt'))
  send(6, 'approvals/resolve', { runId: ask2.payload?.runId, callId: ask2.payload?.callId, decision: 'allow' })
  assert.equal((await waitId(6)).error, undefined)
  const first = await waitId(3)
  assert.equal(first.error, undefined)
  assert.equal(first.result?.settlement, 'answered', 'structured pack failure did not abort the real Pi turn')
  assert.equal(await readFile(join(restrictedView, 'download-success.txt'), 'utf8'), 'download fixture payload')
  await assert.rejects(readFile(join(projectRoot, 'download-success.txt')), /ENOENT/, 'download never falls back to the turn cwd')
  assert.match(JSON.stringify(requests[3]?.messages), /Only http\(s\) URLs are allowed/, 'structured failure returned to the next model request')

  const firstEntries = first.result?.record?.entries || []
  const calls = firstEntries.filter((entry: any) => entry.kind === 'tool-call' && entry.tool === 'workspace_download')
  assert.equal(calls.length, 2)
  for (const call of calls) {
    const evidence = firstEntries.filter((entry: any) => entry.kind === 'tool-evidence' && entry.callId === call.callId)
    assert.deepEqual(evidence.map((entry: any) => entry.phase), ['start', 'decision', 'decision', 'update', 'result', 'settlement'])
    assert.equal(evidence[0].invocationOrigin, 'model')
    assert.equal(evidence[0].contractRevision, call.contractRevision)
    assert.equal(evidence[0].schemaDigest, call.schemaDigest)
    assert.ok(evidence.every((entry: any) => !entry.detail || new TextEncoder().encode(entry.detail).byteLength <= 1_024))
  }
  const workspaceSettlements = firstEntries.filter((entry: any) => entry.kind === 'tool-evidence' && entry.tool === 'workspace_download' && entry.phase === 'settlement')
  assert.equal(workspaceSettlements[0]?.settlement, 'success')
  assert.equal(workspaceSettlements[1]?.settlement, 'failed')

  const secondStart = messages.length
  send(7, 'turn/submit', {
    sessionId, runId: 'policy-run-unattended', cwd: projectRoot,
    prompt: 'Attempt the requested deletion and then finish.',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: true },
    contextPolicy: { outboundShellMode: 'optional', viewRoot: restrictedView },
  })
  const second = await waitId(7)
  assert.equal(second.error, undefined)
  assert.equal(second.result?.settlement, 'answered')
  await assert.rejects(readFile(join(restrictedView, 'denied-download.txt')), /ENOENT/)
  assert.ok(!messages.slice(secondStart).some((message) => message.event === 'host/approval-requested'), 'unattended ask denied without waiting')
  const deniedEvidence = (second.result?.record?.entries || []).filter((entry: any) => entry.kind === 'tool-evidence')
  assert.deepEqual(deniedEvidence.map((entry: any) => entry.phase), ['start', 'decision', 'result', 'settlement'])
  assert.equal(deniedEvidence.find((entry: any) => entry.phase === 'decision')?.decision, 'deny')
  assert.equal(deniedEvidence.at(-1)?.settlement, 'denied')

  const persisted = JSON.parse(await readFile(await resolvePiHostStateFile(statePath), 'utf8'))
  const persistedRecord = persisted.sessions.find((session: any) => session.id === sessionId)?.record
  const parsed = parseTurnRecord(persistedRecord)
  assert.equal(parsed.tornTail, false)
  assert.ok(parsed.record.entries.some((entry) => entry.kind === 'tool-evidence' && entry.phase === 'settlement'), 'persisted parser accepts complete evidence identity and coordinates')

  console.log('Host policy/evidence expand slice freezes outbound/view policy and records complete workspace_download lifecycle')
} finally {
  child.stdin.end()
  if (child.exitCode === null) await once(child, 'exit')
  output.close()
  modelServer.close()
  await Promise.all([
    rm(agentDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(projectRoot, { recursive: true, force: true }),
    rm(restrictedView, { recursive: true, force: true }),
  ])
}
