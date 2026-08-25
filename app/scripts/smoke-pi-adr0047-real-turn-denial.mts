import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

type Message = {
  id?: number
  event?: string
  payload?: Record<string, any>
  result?: Record<string, any>
  error?: { code: string; message: string }
}

const agentDir = await mkdtemp(join(tmpdir(), 'pi-adr0047-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-adr0047-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-adr0047-workspace-'))
await mkdir(join(agentDir, 'skills'), { recursive: true })

let pendingCall: { id: string; command: string } | undefined
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const chunk = (delta: unknown, finish: string | null) => sse({
  id: 'adr0047',
  object: 'chat.completion.chunk',
  model: 'smoke-model',
  choices: [{ index: 0, delta, finish_reason: finish }],
})
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  await new Promise<void>((done) => {
    request.on('data', () => undefined)
    request.on('end', done)
  })
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (pendingCall) {
    const call = pendingCall
    pendingCall = undefined
    response.write(chunk({ role: 'assistant', tool_calls: [{
      index: 0,
      id: call.id,
      type: 'function',
      function: { name: 'bash', arguments: JSON.stringify({ command: call.command }) },
    }] }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: '拒絕已記錄。' }, null))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const modelAddress = modelServer.address()
if (!modelAddress || typeof modelAddress === 'string') throw new Error('loopback model did not bind')

await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: {
  baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`,
  api: 'openai-completions',
  apiKey: 'test-key-placeholder',
  models: [{ id: 'smoke-model', name: 'Smoke Model', reasoning: false, input: ['text'], contextWindow: 128_000 }],
} } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: {
    ...process.env,
    SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'),
    SUBAGENTS_PI_AGENT_DIR: agentDir,
    SUBAGENTS_PI_SKILLS_DIR: join(agentDir, 'skills'),
  },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as Message))
const waitFor = async (id: number) => {
  for (;;) {
    const found = messages.find((message) => message.id === id)
    if (found) return found
    await Promise.race([
      once(output, 'line'),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${id}`)), 25_000)
        timer.unref()
      }),
    ])
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
}

try {
  send(1, 'initialize', { protocolVersion: 2 })
  assert.equal((await waitFor(1)).error, undefined)
  send(2, 'sessions/create')
  const sessionId = String((await waitFor(2)).result?.sessionId)

  const runId = 'adr0047-required-run'
  const callId = 'call_shell_required'
  /**
   * Since issue 13 ships a real macOS adapter, `required` has TWO lawful
   * outcomes and which one applies is a property of the host, not a choice:
   * a platform with a verified backend runs the command confined, and every
   * other platform still denies. Both are asserted; neither is skipped. The
   * command writes inside the Restricted Project View, so a verified run may
   * legitimately produce it while a denied run must not.
   */
  const expectsVerifiedShell = process.platform === 'darwin'
  const insideEffect = join(workspace, 'required-effect.txt')
  pendingCall = { id: callId, command: `printf executed > ${JSON.stringify(insideEffect)}` }
  send(3, 'turn/submit', {
    sessionId,
    runId,
    cwd: workspace,
    prompt: '執行 deterministic shell fixture',
    contextPolicy: {
      memoryEnabled: false,
      memoryWriteEnabled: false,
      referenceChatHistory: false,
      temporary: false,
      outboundShellMode: 'required',
      viewRoot: workspace,
    },
    profile: {
      provider: 'loopback',
      model: 'smoke-model',
      thinkingLevel: 'off',
      compaction: 'manual',
      approvalMode: 'full',
      unattended: false,
    },
  })
  const turn = await waitFor(3)
  assert.equal(turn.error, undefined)
  assert.equal(turn.result?.settlement, 'answered')
  if (expectsVerifiedShell) {
    await access(insideEffect)
  } else {
    await assert.rejects(access(insideEffect), 'required denial must prevent the command side effect')
  }

  const decisions = messages.filter((message) => message.event === 'host/tool-decision'
    && message.payload?.runId === runId && message.payload?.callId === callId)
  assert.equal(decisions.length, 1, 'one composed invocation emits one final Host decision')
  const decision = decisions[0]
  assert.equal(decision?.payload?.decision, expectsVerifiedShell ? 'allow' : 'deny')
  assert.match(
    String(decision?.payload?.reason || ''),
    expectsVerifiedShell ? /backend=\S+ profile=[a-f0-9]{12} view=\S+/ : /Required.*builtin shell|isolation/iu,
    expectsVerifiedShell
      ? 'a verified allow names the backend, the profile digest and the view it is bound to'
      : 'a refusal names the rule that refused',
  )
  assert.equal(decision?.payload?.invocationOrigin, 'model')

  const eventResults = messages.filter((message) => message.event === 'host/tool-result'
    && message.payload?.runId === runId && message.payload?.callId === callId)
  if (expectsVerifiedShell) {
    // Issue 16: an allowed in-turn call now publishes the same terminal event
    // a denied one does, so both settle observably and exactly once.
    assert.equal(eventResults.length, 1, 'an allowed call emits exactly one matching result event')
    assert.equal(eventResults[0]?.payload?.settlement, 'success')
    assert.equal(eventResults[0]?.payload?.invocationOrigin, 'model')
    const starts = messages.filter((message) => message.event === 'host/tool-start'
      && message.payload?.runId === runId && message.payload?.callId === callId)
    assert.equal(starts.length, 1, 'the call also announces that it started')
  } else {
    assert.equal(eventResults.length, 1, 'a denied call emits exactly one matching result event')
    assert.equal(eventResults[0]?.payload?.settlement, 'denied')
    assert.equal(eventResults[0]?.payload?.invocationOrigin, 'model')
    assert.equal(messages.some((message) => message.event === 'host/tool-result'
      && message.payload?.runId === runId && message.payload?.settlement === 'success'), false)
  }

  const entries = turn.result?.record?.entries || []
  const call = entries.find((entry: any) => entry.kind === 'tool-call' && entry.callId === callId)
  const result = entries.find((entry: any) => entry.kind === 'tool-result' && entry.callId === callId)
  assert.ok(call)
  assert.ok(result)
  assert.equal(result.settlement, expectsVerifiedShell ? 'success' : 'denied')
  assert.equal(entries.filter((entry: any) => entry.kind === 'tool-result' && entry.callId === callId).length, 1,
    'the durable Turn Record has one terminal result for the denied call')
  assert.equal(result.invocationOrigin, 'model')
  for (const field of ['contractRevision', 'contractDigest', 'schemaDigest', 'toolSource']) {
    assert.equal(result[field], call[field], `result preserves ${field}`)
  }
  const evidence = entries.filter((entry: any) => entry.kind === 'tool-evidence'
    && entry.runId === runId && entry.callId === callId)
  if (expectsVerifiedShell) {
    // The Turn Record must carry the backend, profile digest and view binding
    // that authorised execution — the metadata ADR-0051 requires to be able to
    // say later WHICH sandbox let this command run.
    assert.ok(evidence.some((entry: any) => entry.phase === 'decision' && entry.decision === 'allow'
      && /backend=\S+ profile=[a-f0-9]{12} view=\S+/.test(String(entry.detail || ''))),
      'the recorded decision identifies the verified backend, profile and view')
    assert.ok(evidence.some((entry: any) => entry.phase === 'settlement' && entry.settlement === 'success'))
  } else {
    assert.ok(evidence.some((entry: any) => entry.phase === 'decision' && entry.decision === 'deny'
      && /Required.*builtin shell|isolation/iu.test(String(entry.detail || ''))))
    assert.ok(evidence.some((entry: any) => entry.phase === 'result' && entry.settlement !== 'success'))
    assert.ok(evidence.some((entry: any) => entry.phase === 'settlement' && entry.settlement === 'denied'))
  }
  for (const entry of evidence) {
    assert.equal(entry.invocationOrigin, 'model')
    assert.equal(entry.contractRevision, call.contractRevision)
    assert.equal(entry.contractDigest, call.contractDigest)
    assert.equal(entry.schemaDigest, call.schemaDigest)
  }

  /**
   * A view no adapter can verify, so the ONLY thing that could let these runs
   * execute is the forged field under test. Pointing them at a real view would
   * let a legitimate macOS verification pass the case for the wrong reason,
   * and the forgery would go untested on the one platform that has a backend.
   */
  const unverifiableView = join(workspace, 'no-such-restricted-view')

  const failClosedCases = [
    {
      id: 4,
      runId: 'adr0047-missing-view-run',
      callId: 'call_shell_missing_view',
      contextPolicy: { outboundShellMode: 'required', shellIsolationVerified: true },
    },
    {
      id: 5,
      runId: 'adr0047-malformed-isolation-run',
      callId: 'call_shell_malformed_isolation',
      contextPolicy: { outboundShellMode: 'required', viewRoot: unverifiableView, shellIsolationVerified: 'verified' },
    },
    {
      id: 8,
      runId: 'adr0051-forged-isolation-run',
      callId: 'call_shell_forged_isolation',
      contextPolicy: {
        outboundShellMode: 'required',
        viewRoot: unverifiableView,
        shellIsolationVerified: true,
        sandboxEvidence: {
          runId: 'adr0051-forged-isolation-run',
          backend: 'model-claimed',
          profileDigest: 'a'.repeat(64),
        },
      },
    },
  ] as const
  for (const probe of failClosedCases) {
    const effect = join(workspace, `${probe.callId}.txt`)
    pendingCall = { id: probe.callId, command: `printf executed > ${JSON.stringify(effect)}` }
    send(probe.id, 'turn/submit', {
      sessionId,
      runId: probe.runId,
      cwd: workspace,
      prompt: '驗證 fail-closed shell posture',
      contextPolicy: {
        memoryEnabled: false,
        memoryWriteEnabled: false,
        referenceChatHistory: false,
        temporary: false,
        ...probe.contextPolicy,
      },
      profile: {
        provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off',
        compaction: 'manual', approvalMode: 'full', unattended: false,
      },
    })
    const probeTurn = await waitFor(probe.id)
    assert.equal(probeTurn.error, undefined)
    await assert.rejects(access(effect), `${probe.callId} must not execute`)
    const probeResult = probeTurn.result?.record?.entries?.find((entry: any) =>
      entry.kind === 'tool-result' && entry.callId === probe.callId)
    assert.equal(probeResult?.settlement, 'denied')
  }

  // Optional keeps the lexical guard but says explicitly that it is degraded,
  // never a verified sandbox. Off bypasses that degraded shell posture.
  for (const probe of [
    { id: 6, mode: 'optional', runId: 'adr0047-optional-run', callId: 'call_shell_optional', degraded: true },
    { id: 7, mode: 'off', runId: 'adr0047-off-run', callId: 'call_shell_off', degraded: false },
  ] as const) {
    const effect = join(workspace, `${probe.callId}.txt`)
    pendingCall = { id: probe.callId, command: `printf executed > ${JSON.stringify(effect)}` }
    send(probe.id, 'turn/submit', {
      sessionId,
      runId: probe.runId,
      cwd: workspace,
      prompt: `驗證 ${probe.mode} shell posture`,
      contextPolicy: {
        memoryEnabled: false,
        memoryWriteEnabled: false,
        referenceChatHistory: false,
        temporary: false,
        outboundShellMode: probe.mode,
        viewRoot: workspace,
      },
      profile: {
        provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off',
        compaction: 'manual', approvalMode: 'full', unattended: false,
      },
    })
    const probeTurn = await waitFor(probe.id)
    assert.equal(probeTurn.error, undefined)
    await access(effect)
    const probeEntries = probeTurn.result?.record?.entries || []
    const probeResult = probeEntries.find((entry: any) => entry.kind === 'tool-result' && entry.callId === probe.callId)
    assert.equal(probeResult?.settlement, 'success')
    const shellEvidence = probeEntries.filter((entry: any) => entry.kind === 'tool-evidence'
      && entry.runId === probe.runId && entry.callId === probe.callId)
    if (probe.degraded) {
      assert.ok(shellEvidence.some((entry: any) => /unverified|degraded|不得宣稱企業邊界/iu.test(String(entry.detail || ''))))
      assert.equal(shellEvidence.some((entry: any) => /verified sandbox|sandboxed/iu.test(String(entry.detail || ''))), false)
    } else {
      assert.ok(shellEvidence.some((entry: any) => entry.phase === 'decision' && /Outbound Guard is off/iu.test(String(entry.detail || ''))))
      assert.equal(shellEvidence.some((entry: any) => /unverified|degraded|不得宣稱企業邊界/iu.test(String(entry.detail || ''))), false)
    }
  }

  console.log('ADR-0047 real Pi turns prove required fail-closed, optional degraded, and off unrestricted shell posture')
} finally {
  if (host.exitCode === null) {
    const exited = once(host, 'exit')
    host.stdin.destroy()
    host.kill('SIGKILL')
    await exited
  }
  output.close()
  modelServer.closeAllConnections()
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}
