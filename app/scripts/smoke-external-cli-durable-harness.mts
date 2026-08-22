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
    adapter: 'opencode',
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
    adapter: 'opencode',
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
    policy: { outputHeadBytes: 4, outputTailBytes: 4 },
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
    policy: { outputHeadBytes: 4, outputTailBytes: 4 },
  })
  large.start()
  large.observe({ type: 'process_started' })
  large.observe({ type: 'process_output', channel: 'stdout', detail: 'x'.repeat(30_000) })
  assert.ok(large.snapshot().output.omittedBytes >= 29_992)
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
})

await test('connector auth and benign stdin diagnostics remain separate from root cause', () => {
  const diagnostic = classifyExternalCliDiagnostic('Reading additional input from stdin…', {
    adapter: 'codex',
    headless: true,
  })
  assert.equal(diagnostic.kind, 'diagnostic')
  assert.equal(diagnostic.severity, 'info')
  assert.equal(classifyExternalCliDiagnostic('AuthRequired: Cloudflare MCP', {
    adapter: 'codex',
    connector: 'cloudflare',
    required: false,
  }).kind, 'connector-authentication-required')
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
  assert.match(app, /<ExternalCliSessionBootstrap\s*\/>/)
  assert.match(main, /interruptExternalCliSessions/)
})

console.log(`\n${passed} tests passed`)
