import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

type Message = { id?: number | string; event?: string; payload?: Record<string, any>; result?: Record<string, any>; error?: { code: string; message: string } }

const agentDir = await mkdtemp(join(tmpdir(), 'pi-direct-code-policy-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-direct-code-policy-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-direct-code-policy-workspace-'))
const statePath = join(stateDir, 'state.json')
await writeFile(join(workspace, 'sample.txt'), 'contract policy sample\n')

const scripted = [
  { name: 'load_capability', args: { id: 'workspace' } },
  { name: 'workspace_download', args: { url: 'https://example.test/model', path: 'model.txt' } },
  { name: 'run_code', args: { code: "return await tools.workspace_download({url:'https://example.test/nested',path:'nested.txt'})" } },
  undefined,
]
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') return response.writeHead(404).end()
  request.resume()
  await once(request, 'end')
  const call = scripted.shift()
  const chunk = (delta: unknown, finish: string | null) => sse({
    id: `direct-code-${scripted.length}`, object: 'chat.completion.chunk', model: 'smoke-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' })
  if (call) {
    response.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `model_${call.name}_${scripted.length}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: 'policy origins complete' }, null))
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
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: statePath, SUBAGENTS_PI_AGENT_DIR: agentDir },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const lines = createInterface({ input: host.stdout })
const messages: Message[] = []
lines.on('line', (line) => messages.push(JSON.parse(line)))
let id = 0
const send = (method: string, params: Record<string, unknown> = {}) => {
  const requestId = ++id
  host.stdin.write(`${JSON.stringify({ id: requestId, method, params })}\n`)
  return requestId
}
const waitFor = async (predicate: (message: Message) => boolean, label: string, from = 0) => {
  const deadline = Date.now() + 25_000
  for (;;) {
    const found = messages.slice(from).find(predicate)
    if (found) return found
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`)
    await new Promise((done) => setTimeout(done, 20))
  }
}
const waitId = (requestId: number) => waitFor((message) => message.id === requestId, `id ${requestId}`)

try {
  assert.equal((await waitId(send('initialize', { protocolVersion: 3, capabilities: ['tool-contract-v1', 'attachments-v1'] }))).error, undefined)
  const created = await waitId(send('sessions/create', { title: 'direct/code policy' }))
  const sessionId = String(created.result?.sessionId)
  const turnStart = messages.length
  const turnId = send('turn/submit', {
    sessionId,
    runId: 'policy-origin-run',
    cwd: workspace,
    prompt: 'Exercise model, direct, and Code Mode policy decisions.',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'auto', unattended: false },
    contextPolicy: { outboundShellMode: 'optional', viewRoot: workspace },
  })

  const modelAsk = await waitFor((message) => message.event === 'host/approval-requested' && message.payload?.tool === 'workspace_download', 'model workspace approval', turnStart)
  const activeWhileApproval = await waitId(send('runs/active'))
  const attachedWhileApproval = (activeWhileApproval.result?.activeRuns || []).find((run: any) => run.runId === 'policy-origin-run')
  assert.deepEqual(attachedWhileApproval?.pendingApproval, {
    runId: modelAsk.payload?.runId,
    sessionId,
    tool: 'workspace_download',
    callId: modelAsk.payload?.callId,
    args: modelAsk.payload?.args,
    reason: modelAsk.payload?.reason,
    timeoutMs: modelAsk.payload?.timeoutMs,
  })
  const attachedPage = await waitId(send('runs/attach', { runId: 'policy-origin-run' }))
  assert.deepEqual(attachedPage.result?.page?.attachment?.pendingApproval, attachedWhileApproval?.pendingApproval)
  const catalogId = send('tools/list', { sessionId, requireContract: true })
  const catalog = await waitId(catalogId)
  const revision = Number(catalog.result?.catalogContractRevision)
  const workspaceEntry = (catalog.result?.catalog || []).find((entry: any) => entry.name === 'workspace_download')
  assert.equal(workspaceEntry?.active, true)

  const directCallId = 'direct-origin-call'
  const directId = send('tools/pack', {
    name: 'workspace_download',
    arguments: { url: 'https://example.test/direct', path: 'direct.txt' },
    cwd: workspace,
    sessionId,
    runId: 'policy-origin-run',
    callId: directCallId,
    contractRevision: revision,
    schemaDigest: workspaceEntry.schemaDigest,
    approval: 'deny',
  })
  const direct = await waitId(directId)
  assert.match(String(direct.error?.message), /denied/i)
  assert.equal((await waitId(send('approvals/resolve', { runId: modelAsk.payload?.runId, callId: modelAsk.payload?.callId, decision: 'deny' }))).error, undefined)

  const outerAsk = await waitFor((message) => message.event === 'host/approval-requested' && message.payload?.tool === 'run_code', 'outer run_code approval', turnStart)
  const activeAfterApproval = await waitId(send('runs/active'))
  assert.notEqual((activeAfterApproval.result?.activeRuns || []).find((run: any) => run.runId === 'policy-origin-run')?.pendingApproval?.callId, modelAsk.payload?.callId)
  assert.equal((activeAfterApproval.result?.activeRuns || []).find((run: any) => run.runId === 'policy-origin-run')?.pendingApproval?.callId, outerAsk.payload?.callId)
  assert.equal((await waitId(send('approvals/resolve', { runId: outerAsk.payload?.runId, callId: outerAsk.payload?.callId, decision: 'allow' }))).error, undefined)
  const nestedAsk = await waitFor((message) => message.event === 'host/approval-requested' && message.payload?.tool === 'workspace_download' && message.payload?.callId !== modelAsk.payload?.callId, 'nested workspace approval', turnStart)
  assert.match(String(nestedAsk.payload?.callId), /:code:/)
  assert.equal((await waitId(send('approvals/resolve', { runId: nestedAsk.payload?.runId, callId: nestedAsk.payload?.callId, decision: 'deny' }))).error, undefined)

  const turn = await waitId(turnId)
  assert.equal(turn.error, undefined)
  assert.equal(turn.result?.settlement, 'answered')
  const evidence = (turn.result?.record?.entries || []).filter((entry: any) => entry.kind === 'tool-evidence' && entry.tool === 'workspace_download')
  const terminal = evidence.filter((entry: any) => entry.phase === 'settlement')
  assert.deepEqual(new Set(terminal.map((entry: any) => entry.invocationOrigin)), new Set(['model', 'direct-protocol', 'code-mode']))
  assert.ok(terminal.every((entry: any) => entry.settlement === 'denied'))
  assert.ok(terminal.every((entry: any) => entry.contractRevision === revision && entry.schemaDigest === workspaceEntry.schemaDigest))
  const nested = evidence.find((entry: any) => entry.invocationOrigin === 'code-mode')
  assert.equal(nested.parentRunId, 'policy-origin-run')
  assert.match(nested.callId, /:code:/)
  assert.equal(evidence.find((entry: any) => entry.invocationOrigin === 'direct-protocol')?.callId, directCallId)
  await assert.rejects(readFile(join(workspace, 'model.txt')), /ENOENT/)
  await assert.rejects(readFile(join(workspace, 'direct.txt')), /ENOENT/)
  await assert.rejects(readFile(join(workspace, 'nested.txt')), /ENOENT/)

  const runCodeEntry = (catalog.result?.catalog || []).find((entry: any) => entry.name === 'run_code')
  const readEntry = (catalog.result?.catalog || []).find((entry: any) => entry.name === 'read')
  const writeEntry = (catalog.result?.catalog || []).find((entry: any) => entry.name === 'write')

  // Success is `success` for both origins and carries the same contract identity.
  const successStart = messages.length
  const directSuccess = await waitId(send('tools/read', {
    sessionId, cwd: workspace, runId: 'direct-success', callId: 'direct-success-call',
    contractRevision: revision, schemaDigest: readEntry.schemaDigest, path: 'sample.txt',
  }))
  assert.equal(directSuccess.error, undefined)
  const codeSuccess = await waitId(send('tools/code', {
    sessionId, cwd: workspace, runId: 'code-success', approval: 'allow',
    contractRevision: revision, schemaDigest: runCodeEntry.schemaDigest,
    code: "return await tools.read({path:'sample.txt'})",
  }))
  assert.equal(codeSuccess.result?.settlement, 'success')
  const successResults = messages.slice(successStart).filter((message) => message.event === 'host/tool-result' && message.payload?.tool === 'read')
  assert.deepEqual(new Set(successResults.map((message) => message.payload?.invocationOrigin)), new Set(['direct-protocol', 'code-mode']))
  assert.ok(successResults.every((message) => message.payload?.settlement === 'success' && message.payload?.schemaDigest === readEntry.schemaDigest))

  // Invalid arguments settle failed before execution for both origins.
  const invalidStart = messages.length
  const directInvalid = await waitId(send('tools/read', {
    sessionId, cwd: workspace, runId: 'direct-invalid', callId: 'direct-invalid-call',
    contractRevision: revision, schemaDigest: readEntry.schemaDigest, path: 42,
  }))
  assert.match(String(directInvalid.error?.message), /must be string/)
  const codeInvalid = await waitId(send('tools/code', {
    sessionId, cwd: workspace, runId: 'code-invalid', approval: 'allow',
    contractRevision: revision, schemaDigest: runCodeEntry.schemaDigest,
    code: 'return await tools.read({path:42})',
  }))
  assert.equal(codeInvalid.result?.settlement, 'failed')
  const invalidResults = messages.slice(invalidStart).filter((message) => message.event === 'host/tool-result' && message.payload?.tool === 'read')
  assert.deepEqual(new Set(invalidResults.map((message) => message.payload?.invocationOrigin)), new Set(['direct-protocol', 'code-mode']))
  assert.ok(invalidResults.every((message) => message.payload?.settlement === 'failed'))

  // A direct ask remains an ask; Code Mode exposes its own nested ask instead
  // of inheriting the outer approval. Both then support an explicit cancel.
  const directAsk = await waitId(send('tools/write', {
    sessionId, cwd: workspace, runId: 'direct-ask', callId: 'direct-ask-call',
    contractRevision: revision, schemaDigest: writeEntry.schemaDigest, path: 'ask.txt', content: 'blocked',
  }))
  assert.match(String(directAsk.error?.message), /Approval required/)
  assert.ok(messages.some((message) => message.event === 'host/tool-decision' && message.payload?.callId === 'direct-ask-call' && message.payload?.decision === 'ask'))

  const directCancel = await waitId(send('tools/write', {
    sessionId, cwd: workspace, runId: 'direct-cancel', callId: 'direct-cancel-call', approval: 'cancel',
    contractRevision: revision, schemaDigest: writeEntry.schemaDigest, path: 'cancel-direct.txt', content: 'blocked',
  }))
  assert.match(String(directCancel.error?.message), /cancelled/i)
  assert.ok(messages.some((message) => message.event === 'host/tool-result' && message.payload?.callId === 'direct-cancel-call' && message.payload?.settlement === 'cancelled'))

  const cancelStart = messages.length
  const codeCancelId = send('tools/code', {
    sessionId, cwd: workspace, runId: 'code-cancel', approval: 'allow',
    contractRevision: revision, schemaDigest: runCodeEntry.schemaDigest,
    code: "return await tools.write({path:'cancel-code.txt',content:'blocked'})",
  })
  const cancelAsk = await waitFor((message) => message.event === 'host/approval-requested' && message.payload?.runId === 'code-cancel' && message.payload?.tool === 'write', 'nested cancel approval', cancelStart)
  assert.match(String(cancelAsk.payload?.callId), /:code:/)
  const cancelRequest = await waitId(send('turn/cancel', { runId: 'code-cancel' }))
  assert.equal(cancelRequest.result?.settlement, 'cancelled')
  const codeCancel = await waitId(codeCancelId)
  assert.equal(codeCancel.result?.settlement, 'cancelled')
  await waitFor((message) => message.event === 'host/tool-result' && message.payload?.callId === cancelAsk.payload?.callId && message.payload?.settlement === 'cancelled', 'nested cancelled settlement', cancelStart)
  await assert.rejects(readFile(join(workspace, 'cancel-direct.txt')), /ENOENT/)
  await assert.rejects(readFile(join(workspace, 'cancel-code.txt')), /ENOENT/)

  const stale = await waitId(send('tools/code', {
    sessionId, cwd: workspace, runId: 'stale-code', code: 'return 1', approval: 'allow', contractRevision: revision - 1,
  }))
  assert.equal(stale.error?.code, 'tool_contract_stale')
  const inactiveName = (catalog.result?.catalog || []).find((entry: any) => entry.active === false)?.name
  if (inactiveName) {
    const directInactive = await waitId(send('tools/pack', {
      sessionId, cwd: workspace, runId: 'inactive-direct', name: inactiveName,
      arguments: {}, contractRevision: revision,
    }))
    assert.match(String(directInactive.error?.message), /inactive/i)
    const blocked = await waitId(send('tools/code', {
      sessionId, cwd: workspace, runId: 'inactive-code', approval: 'allow', contractRevision: revision,
      code: `return await tools.${inactiveName}({})`,
    }))
    assert.match(JSON.stringify(blocked.result), /not active/i)
  }

  const directStale = await waitId(send('tools/read', {
    sessionId, cwd: workspace, runId: 'stale-direct', path: 'sample.txt', contractRevision: revision - 1,
  }))
  assert.match(String(directStale.error?.message), /not current|stale/i)

  console.log('Direct, Pi-originated, and Code Mode nested calls share frozen contract policy without inherited approval')
} finally {
  host.stdin.end()
  if (host.exitCode === null) await Promise.race([once(host, 'exit'), new Promise<void>((done) => setTimeout(() => { host.kill(); done() }, 1_000))])
  lines.close()
  modelServer.close()
  await Promise.all([
    rm(agentDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(workspace, { recursive: true, force: true }),
  ])
}
