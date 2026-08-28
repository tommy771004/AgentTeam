/**
 * Durable external CLI harness contract smoke.
 *
 * This is intentionally a public-session test: fake time and a fake process
 * transport drive the same session lifecycle that Electron uses, without
 * reaching into timer or parser implementation details.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_EXTERNAL_CLI_RUN_POLICY,
  ExternalCliRunSession,
  ExternalCliRunSessionRegistry,
  FakeExternalCliClock,
  classifyExternalCliDiagnostic,
  evaluateExternalCliRecovery,
  type ExternalCliProcessTransport,
} from '../src/agent/externalCliRunSession.ts'
import { redactCliDisplayArgs, redactCliTelemetryText } from '../src/agent/cliCommandTelemetry.ts'
import { MemoryExternalCliCheckpointStore } from '../src/agent/externalCliCheckpoint.ts'

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    console.error(`  ✗ ${name}`)
    throw error
  }
}

function fakeTransport() {
  const calls: string[] = []
  let alive = true
  const transport: ExternalCliProcessTransport = {
    processId: 'pid-fake',
    async terminateTree() {
      calls.push('terminate')
      alive = false
      return { confirmed: true }
    },
    isAlive: () => alive,
    sendInput: () => true,
    sendApproval: () => true,
  }
  return { transport, calls, isAlive: () => alive }
}

console.log('smoke-external-cli-durable-harness')

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await test('active work survives the legacy five-minute boundary and settles once', async () => {
  const clock = new FakeExternalCliClock()
  const fake = fakeTransport()
  const settlements: string[] = []
  const session = new ExternalCliRunSession({
    runId: 'run-active',
    conversationId: 'conversation-a',
    adapter: 'codex',
    clock,
    transport: fake.transport,
    onSettlement: (value) => settlements.push(value.classification),
  })
  session.start()
  session.observe({ type: 'process_started', processId: 'pid-fake' })
  clock.advance(5 * 60_000 + 1)
  session.observe({ type: 'model_activity', detail: 'token' })
  clock.advance(5 * 60_000)
  assert.equal(session.snapshot().terminal, null)
  session.observe({ type: 'process_exit', code: 0 })
  assert.equal(session.snapshot().terminal?.classification, 'success')
  assert.deepEqual(settlements, ['success'])
})

await test('silent and startup runs classify independently and terminate their tree', async () => {
  const idleClock = new FakeExternalCliClock()
  const idle = fakeTransport()
  const idleSession = new ExternalCliRunSession({
    runId: 'run-idle',
    conversationId: 'conversation-a',
    adapter: 'claude',
    clock: idleClock,
    transport: idle.transport,
    policy: { idleMs: 10_000, startupMs: 20_000 },
  })
  idleSession.start()
  idleSession.observe({ type: 'process_started', processId: 'pid-idle' })
  idleClock.advance(10_001)
  assert.equal(idleSession.snapshot().terminal?.classification, 'idle-timeout')
  assert.deepEqual(idle.calls, ['terminate'])

  const startupClock = new FakeExternalCliClock()
  const startup = fakeTransport()
  const startupSession = new ExternalCliRunSession({
    runId: 'run-startup',
    conversationId: 'conversation-a',
    adapter: 'grok',
    clock: startupClock,
    transport: startup.transport,
    policy: { startupMs: 5_000 },
  })
  startupSession.start()
  startupClock.advance(5_001)
  assert.equal(startupSession.snapshot().terminal?.classification, 'startup-timeout')

  const earlyClock = new FakeExternalCliClock()
  const earlySession = new ExternalCliRunSession({
    runId: 'run-early-model',
    conversationId: 'conversation-a',
    adapter: 'codex',
    clock: earlyClock,
    policy: { startupMs: 5_000, idleMs: 10_000 },
  })
  earlySession.start()
  earlySession.observe({ type: 'model_activity', detail: 'first valid provider event' })
  earlyClock.advance(5_001)
  assert.equal(earlySession.snapshot().terminal, null)
})

await test('absolute safety cap wins over continuously noisy activity', () => {
  const clock = new FakeExternalCliClock()
  const fake = fakeTransport()
  const session = new ExternalCliRunSession({
    runId: 'run-cap',
    conversationId: 'conversation-a',
    adapter: 'gemini',
    clock,
    transport: fake.transport,
    policy: { idleMs: 200, absoluteMs: 1_000, startupMs: 100 },
  })
  session.start()
  session.observe({ type: 'process_started' })
  for (let i = 0; i < 9; i += 1) {
    clock.advance(100)
    session.observe({ type: 'process_output', channel: 'stdout', detail: `chunk-${i}` })
  }
  clock.advance(101)
  assert.equal(session.snapshot().terminal?.classification, 'absolute-timeout')
})

await test('yield and reconnect return ordered bounded snapshots without killing process', () => {
  const clock = new FakeExternalCliClock()
  const fake = fakeTransport()
  const session = new ExternalCliRunSession({
    runId: 'run-reconnect',
    conversationId: 'conversation-b',
    adapter: 'gemini',
    clock,
    transport: fake.transport,
    policy: { outputHeadBytes: 8, outputTailBytes: 8 },
  })
  session.start()
  session.observe({ type: 'process_started', providerSessionId: 'provider-1' })
  session.observe({ type: 'process_output', channel: 'stdout', detail: '1234567890abcdefghij' })
  const yielded = session.yieldObservation()
  assert.equal(yielded.live, true)
  assert.equal(yielded.processId, 'pid-fake')
  assert.equal(fake.isAlive(), true)
  assert.equal(yielded.output.omitted, true)
  const after = session.eventsAfter(0)
  assert.ok(after.length >= 3)
  assert.deepEqual(after.map((event) => event.sequence), [...after].map((event) => event.sequence).sort((a, b) => a - b))
  assert.equal(session.reconnect(after[0].sequence - 1).events[0]?.sequence, after[0].sequence)
  const merged = session.reconnect(2)
  assert.equal(
    new Set([...merged.snapshot.events, ...merged.events].map((event) => event.sequence)).size,
    merged.snapshot.events.length + merged.events.length,
  )
})

await test('reconnect reports a bounded event-log gap and returns retained replay state', () => {
  const session = new ExternalCliRunSession({
    runId: 'run-replay-gap',
    conversationId: 'conversation-b',
    adapter: 'gemini',
    clock: new FakeExternalCliClock(),
  })
  session.start()
  session.observe({ type: 'process_started' })
  for (let index = 0; index < 1_005; index += 1) {
    session.observe({ type: 'provider_activity', detail: `provider-event-${index}` })
  }
  const replay = session.reconnect(0)
  assert.equal(replay.replayGap, true)
  assert.equal(replay.events.length, 0)
  assert.equal(replay.snapshot.events.length, 1_000)
  assert.ok(replay.snapshot.oldestEventCursor > 1)
  assert.equal(replay.snapshot.events[0]?.sequence, replay.snapshot.oldestEventCursor)
})

await test('terminal process exit is represented once and output evidence stays bounded', () => {
  const clock = new FakeExternalCliClock()
  const session = new ExternalCliRunSession({
    runId: 'run-bounded-output',
    conversationId: 'conversation-b',
    adapter: 'claude',
    clock,
    policy: { outputHeadBytes: 8, outputTailBytes: 8 },
  })
  session.start()
  session.observe({ type: 'process_started' })
  session.observe({ type: 'process_output', channel: 'stdout', detail: '一二三四五六七八九十' })
  session.observe({ type: 'process_exit', code: 0 })
  const snapshot = session.snapshot()
  assert.equal(snapshot.events.filter((event) => event.type === 'process_exit').length, 1)
  assert.equal(snapshot.output.omitted, true)
  assert.ok(snapshot.output.omittedBytes > 0)
  assert.ok(snapshot.output.head.length > 0 || snapshot.output.tail.length > 0)

  const large = new ExternalCliRunSession({
    runId: 'run-large-chunk',
    conversationId: 'conversation-b',
    adapter: 'claude',
    policy: { outputHeadBytes: 8, outputTailBytes: 8 },
  })
  large.start()
  large.observe({ type: 'process_started' })
  large.observe({ type: 'process_output', channel: 'stdout', detail: `HEAD-${'x'.repeat(29_980)}-TAIL` })
  assert.ok(large.snapshot().output.omittedBytes > 0)
  assert.match(large.snapshot().output.head, /^HEAD-/)
  assert.match(large.snapshot().output.tail, /-TAIL$/)
})

await test('failed provider exit reaches one failed settlement through the same seam', () => {
  const settlements: string[] = []
  const observed = new ExternalCliRunSession({
    runId: 'run-failed-exit-observed',
    conversationId: 'conversation-b',
    adapter: 'gemini',
    onSettlement: (value) => settlements.push(value.classification),
  })
  observed.start()
  observed.observe({ type: 'process_started' })
  observed.observe({ type: 'process_exit', code: 2, detail: 'provider failed' })
  assert.equal(observed.snapshot().terminal?.classification, 'process-exit-failure')
  assert.deepEqual(settlements, ['process-exit-failure'])

  const transport = fakeTransport()
  const broken = new ExternalCliRunSession({
    runId: 'run-transport-failure',
    conversationId: 'conversation-b',
    adapter: 'gemini',
    transport: transport.transport,
  })
  broken.start()
  broken.observe({ type: 'process_started' })
  assert.equal(broken.failTransport('SSE disconnected').classification, 'transport-failure')
  assert.deepEqual(transport.calls, ['terminate'])
})

await test('interactive wait pauses idle, unattended wait auto-denies, and cancellation settles once', async () => {
  const clock = new FakeExternalCliClock()
  const fake = fakeTransport()
  const session = new ExternalCliRunSession({
    runId: 'run-wait',
    conversationId: 'conversation-c',
    adapter: 'cursor',
    clock,
    transport: fake.transport,
    policy: { idleMs: 100, absoluteMs: 5_000, unattendedWaitMs: 500 },
  })
  session.start()
  session.observe({ type: 'process_started', providerSessionId: 'provider-1' })
  session.observe({ type: 'waiting_for_user', detail: 'Which file?' })
  clock.advance(1_000)
  assert.equal(session.snapshot().terminal, null)
  assert.equal(await session.provideInput('wrong target', 'provider-2'), false)
  await session.provideInput('src/App.tsx')
  clock.advance(50)
  assert.equal(session.snapshot().phase, 'running')
  await session.cancel('user stop')
  await session.cancel('second stop')
  assert.equal(session.snapshot().terminal?.classification, 'user-cancelled')
  assert.deepEqual(fake.calls, ['terminate'])

  const unattendedClock = new FakeExternalCliClock()
  const unattended = fakeTransport()
  const unattendedSession = new ExternalCliRunSession({
    runId: 'run-unattended',
    conversationId: 'conversation-c',
    adapter: 'codex',
    clock: unattendedClock,
    transport: unattended.transport,
    unattended: true,
    policy: { idleMs: 100, unattendedWaitMs: 500, absoluteMs: 5_000 },
  })
  unattendedSession.start()
  unattendedSession.observe({ type: 'process_started' })
  unattendedSession.observe({ type: 'waiting_for_approval', detail: 'allow shell?' })
  unattendedClock.advance(501)
  assert.equal(unattendedSession.snapshot().terminal?.classification, 'permission-denied')
  assert.deepEqual(unattended.calls, ['terminate'])
})

await test('cancellation wins a delayed process-exit race', async () => {
  let releaseTermination: ((result: { confirmed: boolean }) => void) | undefined
  const settlements: string[] = []
  const session = new ExternalCliRunSession({
    runId: 'run-cancel-race',
    conversationId: 'conversation-c',
    adapter: 'codex',
    transport: {
      terminateTree: () => new Promise((resolve) => { releaseTermination = resolve }),
    },
    onSettlement: (value) => settlements.push(value.classification),
  })
  session.start()
  session.observe({ type: 'process_started' })
  const pending = session.cancel('race stop')
  session.observe({ type: 'process_exit', code: 0 })
  assert.equal(session.snapshot().terminal, null)
  releaseTermination?.({ confirmed: true })
  assert.equal((await pending).classification, 'user-cancelled')
  assert.deepEqual(settlements, ['user-cancelled'])
  assert.ok(session.snapshot().events.some((event) => event.type === 'cancellation_requested'))
  assert.ok(session.snapshot().events.some((event) => event.type === 'cancellation_confirmed'))
})

await test('input and approval fail closed without a real process capability', async () => {
  const session = new ExternalCliRunSession({
    runId: 'run-no-interaction-transport',
    conversationId: 'conversation-c',
    adapter: 'codex',
  })
  session.start()
  session.observe({ type: 'process_started', providerSessionId: 'provider-input' })
  session.observe({ type: 'waiting_for_user' })
  assert.equal(await session.provideInput('answer', 'provider-input'), false)
  session.observe({ type: 'waiting_for_approval' })
  assert.equal(await session.provideApproval(true, 'provider-input'), false)
  assert.equal(session.snapshot().events.some((event) => event.type === 'input_received'), false)
  assert.equal(session.snapshot().events.some((event) => event.type === 'approval_received'), false)
})

await test('cancellation reports uncertain termination instead of claiming confirmation', async () => {
  const session = new ExternalCliRunSession({
    runId: 'run-cancel-uncertain',
    conversationId: 'conversation-c',
    adapter: 'codex',
    transport: { terminateTree: () => ({ confirmed: false, detail: 'child close not observed' }) },
  })
  session.start()
  session.observe({ type: 'process_started' })
  const settlement = await session.cancel('uncertain stop')
  assert.equal(settlement.classification, 'transport-failure')
  assert.equal(settlement.terminationConfirmed, false)
  assert.ok(session.snapshot().events.some((event) => event.type === 'cancellation_unconfirmed'))
  assert.equal(session.snapshot().events.some((event) => event.type === 'cancellation_confirmed'), false)
})

await test('configured required connector context blocks only the selected capability', () => {
  const required = new ExternalCliRunSession({
    runId: 'run-required-connector',
    conversationId: 'conversation-c',
    adapter: 'codex',
    requiredConnectors: [{ connector: 'cloudflare', server: 'Cloudflare MCP', operation: 'search' }],
  })
  required.start()
  required.observe({ type: 'process_started', providerSessionId: 'provider-auth' })
  required.observe({
    type: 'connector_authentication_required',
    connector: 'cloudflare',
    server: 'Cloudflare MCP',
    operation: 'search',
    detail: 'AuthRequired: Cloudflare MCP',
  })
  assert.equal(required.snapshot().terminal?.classification, 'connector-authentication-required')
  assert.equal(required.snapshot().events.at(-2)?.type, 'connector_authentication_required')
  const optional = new ExternalCliRunSession({
    runId: 'run-optional-connector',
    conversationId: 'conversation-c',
    adapter: 'codex',
    requiredConnectors: [{ connector: 'cloudflare', operation: 'deploy' }],
  })
  optional.start()
  optional.observe({ type: 'process_started' })
  optional.observe({ type: 'connector_authentication_required', connector: 'cloudflare', operation: 'search', detail: 'AuthRequired' })
  assert.equal(optional.snapshot().terminal, null)
})

await test('CLI telemetry redacts prompt material from command display', () => {
  const prompt = 'PRIVATE PROMPT should-never-appear token=super-secret-value'
  const realArgs = ['exec', '--json', prompt]
  const displayArgs = redactCliDisplayArgs(realArgs, prompt)
  assert.doesNotMatch(displayArgs.join(' '), /PRIVATE PROMPT|super-secret-value/)
  assert.match(displayArgs.at(-1) || '', /prompt omitted/i)
  assert.equal(realArgs.at(-1), prompt)
  const credentialArgs = redactCliDisplayArgs(['--api-key', 'super-secret-key', '--json'], prompt)
  assert.equal(credentialArgs[1], '[credential omitted]')
  assert.doesNotMatch(redactCliTelemetryText('adapter error authorization=Bearer secret-token token=second-secret'), /secret-token|second-secret/)
})

await test('connector auth and benign stdin diagnostics remain separate from root cause', () => {
  const diagnostic = classifyExternalCliDiagnostic('Reading additional input from stdin…', {
    adapter: 'codex',
    headless: true,
  })
  assert.equal(diagnostic.kind, 'diagnostic')
  assert.equal(diagnostic.severity, 'info')
  const authDiagnostic = classifyExternalCliDiagnostic('AuthRequired: Cloudflare MCP operation=search', {
    adapter: 'codex',
  })
  assert.equal(authDiagnostic.kind, 'connector-authentication-required')
  assert.equal(authDiagnostic.connector, 'cloudflare')
  assert.equal(authDiagnostic.server, 'Cloudflare MCP')
  assert.equal(authDiagnostic.operation, 'search')
  assert.equal(classifyExternalCliDiagnostic('timed out', {
    adapter: 'codex',
    headless: false,
  }).headlessHint, true)
  assert.equal(classifyExternalCliDiagnostic('timed out', {
    adapter: 'codex',
    headless: true,
  }).headlessHint, false)
})

await test('captured provider trace keeps connector warnings separate from clean or timed-out settlement', () => {
  const clock = new FakeExternalCliClock()
  const clean = new ExternalCliRunSession({
    runId: 'run-codex-trace-clean',
    conversationId: 'conversation-c',
    adapter: 'codex',
    clock,
    policy: { idleMs: 100, absoluteMs: 1_000 },
  })
  clean.start()
  clean.observe({ type: 'process_started', providerSessionId: 'provider-codex' })
  clean.observe({ type: 'diagnostic', detail: 'Reading additional input from stdin…', severity: 'info' })
  clean.observe({
    type: 'connector_authentication_required',
    connector: 'cloudflare',
    server: 'Cloudflare MCP',
    operation: 'search',
    required: false,
    detail: 'AuthRequired: Bearer secret-token-value',
  })
  clean.observe({ type: 'model_activity', delta: 'model output' })
  clean.observe({ type: 'process_exit', code: 0 })
  assert.equal(clean.snapshot().terminal?.classification, 'success')
  assert.ok(clean.snapshot().events.some((event) => event.type === 'connector_authentication_required'))
  assert.doesNotMatch(JSON.stringify(clean.snapshot()), /secret-token-value/)

  const timed = new ExternalCliRunSession({
    runId: 'run-codex-trace-timeout',
    conversationId: 'conversation-c',
    adapter: 'codex',
    clock,
    policy: { idleMs: 100, absoluteMs: 1_000 },
  })
  timed.start()
  timed.observe({ type: 'process_started' })
  timed.observe({ type: 'connector_authentication_required', required: false, detail: 'AuthRequired: optional connector' })
  clock.advance(101)
  assert.equal(timed.snapshot().terminal?.classification, 'idle-timeout')
  assert.ok(timed.snapshot().events.some((event) => event.type === 'connector_authentication_required'))
})

await test('recovery is fail-closed and only automatic with replay-safe evidence', () => {
  assert.deepEqual(
    evaluateExternalCliRecovery({
      providerSessionId: 'provider-1',
      adapterSupportsResume: true,
      replaySafeCheckpoint: true,
    }),
    { interrupted: true, resumable: true, automaticRetry: true },
  )
  assert.equal(
    evaluateExternalCliRecovery({
      providerSessionId: 'provider-1',
      adapterSupportsResume: true,
      replaySafeCheckpoint: false,
    }).automaticRetry,
    false,
  )
  assert.equal(DEFAULT_EXTERNAL_CLI_RUN_POLICY.idleMs, 600_000)
  assert.equal(DEFAULT_EXTERNAL_CLI_RUN_POLICY.absoluteMs, 3_600_000)
})

await test('durable checkpoint restart marks process loss interrupted without auto retry', () => {
  const store = new MemoryExternalCliCheckpointStore()
  const firstHost = new ExternalCliRunSessionRegistry({ checkpointStore: store })
  const session = firstHost.create({
    runId: 'run-durable-restart',
    conversationId: 'conversation-recovery',
    adapter: 'codex',
    providerSessionId: 'provider-resume-id',
    adapterSupportsResume: true,
    replaySafeCheckpoint: false,
  })
  session.start()
  session.observe({ type: 'process_started', providerSessionId: 'provider-resume-id' })
  const afterRestart = new ExternalCliRunSessionRegistry({ checkpointStore: store }).recoverPersistedSessions('host process lost')
  assert.equal(afterRestart.length, 1)
  assert.equal(afterRestart[0]?.phase, 'interrupted')
  assert.equal(afterRestart[0]?.terminal?.classification, 'interrupted')
  assert.equal(afterRestart[0]?.recovery?.resumable, true)
  assert.equal(afterRestart[0]?.recovery?.automaticRetry, false)
  assert.doesNotMatch(JSON.stringify(afterRestart[0]), /provider prompt|credentials|token=/i)
})

await test('host interruption terminates owned transport and stays non-success', () => {
  const fake = fakeTransport()
  const session = new ExternalCliRunSession({
    runId: 'run-interrupted',
    conversationId: 'conversation-b',
    adapter: 'cursor',
    transport: fake.transport,
  })
  session.start()
  session.observe({ type: 'process_started' })
  assert.equal(session.markInterrupted('host restart').classification, 'interrupted')
  assert.equal(session.snapshot().active, false)
  assert.deepEqual(fake.calls, ['terminate'])
})

await test('operation timeout has its own classification and stops the owned process', () => {
  const clock = new FakeExternalCliClock()
  const fake = fakeTransport()
  const session = new ExternalCliRunSession({
    runId: 'run-operation-timeout',
    conversationId: 'conversation-b',
    adapter: 'grok',
    clock,
    transport: fake.transport,
    policy: { operationMs: 250, idleMs: 5_000, absoluteMs: 10_000 },
  })
  session.start()
  session.observe({ type: 'process_started' })
  session.armOperationTimeout('mcp.call')
  clock.advance(251)
  assert.equal(session.snapshot().terminal?.classification, 'operation-timeout')
  assert.deepEqual(fake.calls, ['terminate'])
})

await test('registry isolates conversations and serializes one session interaction', async () => {
  const registry = new ExternalCliRunSessionRegistry()
  const a = registry.create({ runId: 'run-a', conversationId: 'thread-a', adapter: 'codex' })
  const b = registry.create({ runId: 'run-b', conversationId: 'thread-b', adapter: 'codex' })
  a.start()
  b.start()
  assert.equal(registry.forConversation('thread-a')[0]?.runId, 'run-a')
  const order: string[] = []
  await Promise.all([
    registry.interact('run-a', async () => {
      order.push('first-start')
      await Promise.resolve()
      order.push('first-end')
    }),
    registry.interact('run-a', async () => order.push('second')),
  ])
  assert.deepEqual(order, ['first-start', 'first-end', 'second'])
  assert.equal(registry.get('run-b')?.conversationId, 'thread-b')
})

await test('terminal sessions stay replayable until an explicit bounded ack', () => {
  const records: Array<Record<string, unknown>> = []
  const registry = new ExternalCliRunSessionRegistry({
    terminalRetentionMs: 100,
    telemetrySink: { record: (record: Record<string, unknown>) => records.push(record) },
  })
  const session = registry.create({
    runId: 'run-terminal-retention',
    conversationId: 'thread-retention',
    adapter: 'codex',
    clock: new FakeExternalCliClock(),
  })
  session.start()
  session.observe({ type: 'process_started', providerSessionId: 'provider-retention' })
  session.observe({ type: 'model_activity', detail: 'safe activity' })
  session.observe({ type: 'process_exit', code: 0 })

  assert.equal(registry.get('run-terminal-retention')?.snapshot().terminal?.classification, 'success')
  assert.equal(registry.reconnect('run-terminal-retention', 0)?.snapshot.terminal?.classification, 'success')
  assert.equal(records[0]?.settlement, 'success')
  assert.equal(records[0]?.eventCount && Number(records[0]?.eventCount) > 0, true)
  registry.acknowledgeTerminal('run-terminal-retention')
  assert.equal(registry.get('run-terminal-retention'), undefined)

  const retained = registry.create({
    runId: 'run-terminal-expiry',
    conversationId: 'thread-retention',
    adapter: 'codex',
  })
  retained.start()
  retained.observe({ type: 'process_started' })
  retained.observe({ type: 'process_exit', code: 0 })
  registry.pruneTerminalSessions(Date.now() + 101)
  assert.equal(registry.get('run-terminal-expiry'), undefined)
})

await test('queued external connector requirements survive renderer restart exactly', async () => {
  const values = new Map<string, string>()
  ;(globalThis as typeof globalThis & { localStorage: Storage }).localStorage = {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => { values.clear() },
    key: (index: number) => [...values.keys()][index] || null,
    get length() { return values.size },
  }
  const queue = await import('../src/agent/runQueue.ts')
  queue.resetRunQueueForTests()
  const requirements = [{ connector: 'Cloudflare', server: 'Cloudflare MCP', operation: 'search' }]
  const item = queue.enqueueExternalRun({
    runId: 'run-queued-required-connector',
    objective: 'queued auth snapshot',
    runner: 'codex',
    overrides: { externalCliRequiredConnectors: requirements },
  })
  assert.deepEqual(item?.overrides?.externalCliRequiredConnectors, requirements)
  queue.resetRunQueueForTests()
  queue.hydrateRunQueue()
  assert.deepEqual(queue.listQueuedRuns()[0]?.overrides?.externalCliRequiredConnectors, requirements)
  queue.clearRunQueue()
})

await test('connector requirements are produced from the selected configured capability snapshot', async () => {
  const { resolveExternalCliRequiredConnectors } = await import('../src/agent/externalCliConnectorSnapshot.ts')
  const settings = {
    mcpEnabled: true,
    mcpServers: [
      { id: 'global', name: 'Global MCP', enabled: true, transport: 'http' as const },
      { id: 'selected', name: 'Selected MCP', enabled: true, transport: 'http' as const, pluginId: 'connector-selected' },
      { id: 'disabled', name: 'Disabled MCP', enabled: false, transport: 'http' as const },
    ],
    mcpAgentServers: { build: ['selected'] },
  }
  assert.deepEqual(resolveExternalCliRequiredConnectors(settings, { agentMode: 'build' }), [
    { connector: 'connector-selected', server: 'Selected MCP' },
  ])
  // An explicit empty selection is authoritative and must not be replaced by
  // a later settings read or an inferred stderr connector name.
  assert.deepEqual(resolveExternalCliRequiredConnectors(settings, { externalCliRequiredConnectors: [] }), [])
})

await test('shipped adapters retain the coordinator and Host ownership boundaries', () => {
  const localRunner = fs.readFileSync(path.join(appRoot, 'electron/localCliRunner.ts'), 'utf8')
  const rendererProjection = fs.readFileSync(path.join(appRoot, 'src/agent/externalCliProjection.ts'), 'utf8')
  const app = fs.readFileSync(path.join(appRoot, 'src/App.tsx'), 'utf8')
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  const main = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  assert.match(localRunner, /ExternalCliRunSession/)
  assert.match(localRunner, /externalSession:\s*true/)
  assert.doesNotMatch(localRunner, /timeoutMs:\s*300_000/)
  assert.match(coordinator, /externalCliPolicy:\s*normalizeExternalCliRunPolicy/)
  assert.match(main, /cli:sessionSnapshot/)
  assert.match(main, /cli:sessionSnapshots/)
  assert.match(rendererProjection, /reconnectExternalCliSessions/)
  assert.match(rendererProjection, /startExternalCliSessionProjection/)
  assert.match(rendererProjection, /sessionEvents/)
  assert.match(rendererProjection, /setTimeout/)
  assert.match(app, /<ExternalCliSessionBootstrap\s*\/>/)
  assert.match(main, /interruptExternalCliSessions/)
  assert.doesNotMatch(main, /serverSession\.observe\(\{ type: 'process_started'/)
})

console.log(`\n${passed} tests passed`)
await import('./smoke-external-cli-primary-seam.mts')
