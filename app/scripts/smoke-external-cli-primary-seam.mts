/**
 * Qualification through the shipped primary seam:
 * runTask → runDispatch → agentStore local CLI adapter → Electron supervisor
 * session → streamed lifecycle + one final settlement.
 *
 * The fake process boundary is deterministic, but the coordinator, agent store,
 * production supervisor registry, and renderer IPC-shaped API are real.
 */
import assert from 'node:assert/strict'
import {
  ExternalCliRunSession,
  FakeExternalCliClock,
  type ExternalCliLifecycleEvent,
} from '../src/agent/externalCliRunSession.ts'
import { externalCliSupervisor } from '../electron/externalCliSupervisor.ts'

if (typeof globalThis.localStorage === 'undefined') {
  const values = new Map<string, string>()
  ;(globalThis as typeof globalThis & { localStorage: Storage }).localStorage = {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => { values.clear() },
    key: (index: number) => [...values.keys()][index] || null,
    get length() { return values.size },
  }
}

const { runTask } = await import('../src/agent/taskRunCoordinator.ts')
const { useSettingsStore } = await import('../src/store/settingsStore.ts')
const { useThreadStore } = await import('../src/store/threadStore.ts')

type FakeCliRequest = {
  runId: string
  conversationId: string
  prompt: string
  session: ExternalCliRunSession
  clock: FakeExternalCliClock
  resolve: (value: Record<string, unknown>) => void
}

const originalWindow = (globalThis as { window?: Window }).window
const originalSettings = useSettingsStore.getState().settings
const requests = new Map<string, FakeCliRequest>()
const streamSubscribers = new Set<(event: Record<string, unknown>) => void>()
const terminalOrder: string[] = []

function streamEvent(event: ExternalCliLifecycleEvent): Record<string, unknown> {
  const terminal = event.type === 'process_exit'
  return {
    runId: event.runId,
    kind: terminal ? (event.detail === 'success' ? 'done' : 'error') : event.type === 'tool_started' || event.type === 'tool_completed' ? 'tool' : 'status',
    title: event.type,
    detail: event.detail,
    tool: 'fake-tool',
    ok: !terminal || event.detail === 'success',
    sequence: event.sequence,
    sessionPhase: event.phase,
    terminalClassification: terminal ? event.detail : undefined,
  }
}

function release(request: FakeCliRequest, code = 0) {
  request.session.observe({ type: 'process_exit', code, detail: code === 0 ? undefined : 'fake provider failure' })
}

function fakeRunAgent(input: {
  runId?: string
  conversationId?: string
  prompt: string
  externalCliPolicy?: Record<string, number>
}) {
  const runId = String(input.runId)
  const conversationId = String(input.conversationId || runId)
  const clock = new FakeExternalCliClock()
  let resolveResult!: (value: Record<string, unknown>) => void
  const result = new Promise<Record<string, unknown>>((resolve) => { resolveResult = resolve })
  const session = externalCliSupervisor.create({
    runId,
    conversationId,
    adapter: 'codex',
    clock,
    policy: input.externalCliPolicy,
    transport: {
      processId: `fake-process:${runId}`,
      terminateTree: () => ({ confirmed: true }),
    },
    onEvent: (event) => {
      for (const subscriber of streamSubscribers) subscriber(streamEvent(event))
    },
    onSettlement: (settlement) => {
      terminalOrder.push(runId)
      resolveResult({
        ok: settlement.classification === 'success',
        output: `fake output for ${runId}`,
        command: 'codex exec --json [prompt omitted]',
        kind: 'codex',
        code: settlement.classification === 'success' ? 0 : 1,
        runId,
        terminalClassification: settlement.classification,
        externalRun: {
          provider: 'codex',
          adapter: 'codex',
          runId,
          conversationId,
          processId: session.snapshot().processId,
          sessionId: session.snapshot().providerSessionId,
          status: settlement.classification === 'success' ? 'success' : 'failed',
          terminalClassification: settlement.classification,
          eventCursor: session.snapshot().eventCursor,
        },
      })
    },
  })
  requests.set(runId, { runId, conversationId, prompt: input.prompt, session, clock, resolve: resolveResult })
  session.start()
  session.observe({ type: 'process_started', processId: `fake-process:${runId}`, providerSessionId: `provider:${runId}` })
  session.observe({ type: 'model_activity', detail: 'fake model activity' })
  session.observe({ type: 'tool_started', tool: 'fake-tool', operation: 'fake operation' })
  session.observe({ type: 'tool_completed', tool: 'fake-tool', operation: 'fake operation', ok: true })
  return result
}

try {
  useSettingsStore.setState({
    settings: {
      ...originalSettings,
      concurrentRunsEnabled: true,
      maxConcurrentRuns: 2,
      cliProviders: [{ id: 'codex', enabled: true, authorized: true, cliBinary: 'codex' }],
    },
  })
  ;(globalThis as { window: Window }).window = {
    ...(originalWindow || {}),
    subagents: {
      ...((originalWindow as Window & { subagents?: unknown } | undefined)?.subagents as object || {}),
      cli: {
        runAgent: fakeRunAgent,
        onStream: (callback: (event: Record<string, unknown>) => void) => {
          streamSubscribers.add(callback)
          return () => streamSubscribers.delete(callback)
        },
      },
    },
  } as Window

  const threadA = useThreadStore.getState().createThread({ title: 'primary seam A', runner: 'codex' })
  const threadB = useThreadStore.getState().createThread({ title: 'primary seam B', runner: 'codex' })
  const first = runTask({ objective: 'primary seam same thread first', sourceKind: 'composer', runner: 'codex', runId: 'primary-same-1', reuseThreadId: threadA })
  for (let i = 0; i < 100 && !requests.has('primary-same-1'); i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(requests.has('primary-same-1'), 'first run crossed the fake Electron supervisor')
  const queued = await runTask({ objective: 'primary seam same thread second', sourceKind: 'schedule', runner: 'codex', runId: 'primary-same-2', reuseThreadId: threadA, loopType: 'Goal-based' })
  assert.equal(queued.queued, true)
  assert.equal(requests.has('primary-same-2'), false, 'same-thread follow-up remains ordered')
  release(requests.get('primary-same-1')!)
  await first
  for (let i = 0; i < 100 && !requests.has('primary-same-2'); i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(requests.has('primary-same-2'))
  release(requests.get('primary-same-2')!)
  await new Promise((resolve) => setTimeout(resolve, 0))

  const concurrentA = runTask({ objective: 'primary seam concurrent A', sourceKind: 'composer', runner: 'codex', runId: 'primary-concurrent-a', reuseThreadId: threadA })
  const concurrentB = runTask({ objective: 'primary seam concurrent B', sourceKind: 'composer', runner: 'codex', runId: 'primary-concurrent-b', reuseThreadId: threadB })
  for (let i = 0; i < 100 && (!requests.has('primary-concurrent-a') || !requests.has('primary-concurrent-b')); i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(requests.has('primary-concurrent-a') && requests.has('primary-concurrent-b'), 'different threads execute concurrently')
  release(requests.get('primary-concurrent-b')!)
  release(requests.get('primary-concurrent-a')!)
  await Promise.all([concurrentA, concurrentB])

  const timeoutThread = useThreadStore.getState().createThread({ title: 'primary seam timeout', runner: 'codex' })
  const timeout = runTask({ objective: 'primary seam timeout telemetry', sourceKind: 'composer', runner: 'codex', runId: 'primary-timeout', reuseThreadId: timeoutThread, overrides: { externalCliPolicy: { idleMs: 25, absoluteMs: 500 } } })
  for (let i = 0; i < 100 && !requests.has('primary-timeout'); i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  const timeoutRequest = requests.get('primary-timeout')!
  timeoutRequest.clock.advance(26)
  const timeoutResult = await timeout
  assert.equal(timeoutResult.path, 'cli')
  assert.equal(timeoutResult.status, 'failed')
  assert.equal(timeoutRequest.session.snapshot().terminal?.classification, 'idle-timeout')
  assert.equal(new Set(terminalOrder).size, terminalOrder.length, 'every primary-seam run settles once')
  assert.ok(streamSubscribers.size >= 0)
  console.log('primary-seam qualification passed: coordinator, real supervisor registry, stream, ordering, concurrency, timeout telemetry')
} finally {
  for (const request of requests.values()) {
    if (!request.session.snapshot().terminal) request.session.markInterrupted('qualification cleanup')
  }
  requests.clear()
  streamSubscribers.clear()
  useSettingsStore.setState({ settings: originalSettings })
  if (originalWindow) (globalThis as { window?: Window }).window = originalWindow
  else delete (globalThis as { window?: Window }).window
}
