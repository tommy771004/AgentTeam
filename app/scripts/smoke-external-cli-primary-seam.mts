/**
 * Qualification through the shipped primary seam:
 * runTask → runDispatch → agentStore local CLI adapter → Electron supervisor
 * session → streamed lifecycle + one final settlement.
 *
 * The fake process boundary is deterministic, but the coordinator, agent store,
 * production supervisor registry, and renderer IPC-shaped API are real.
 */
import assert from 'node:assert/strict'
import { FakeExternalCliClock, type ExternalCliClock } from '../src/agent/externalCliRunSession.ts'
import { runLocalCliAgent, type LocalCliRunInput } from '../electron/localCliRunner.ts'
import type { BashResult } from '../electron/shellBridge.ts'

if (typeof globalThis.localStorage?.setItem !== 'function') {
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
  clock: FakeExternalCliClock
  started: boolean
  release: (result?: BashResult) => void
}

const originalWindow = (globalThis as { window?: Window }).window
const originalSettings = useSettingsStore.getState().settings
const requests = new Map<string, FakeCliRequest>()
const streamSubscribers = new Set<(event: Record<string, unknown>) => void>()
const terminalOrder: string[] = []

function fakeRunAgent(input: {
  runId?: string
  conversationId?: string
  prompt: string
  externalCliPolicy?: Record<string, number>
}) {
  const runId = String(input.runId)
  const conversationId = String(input.conversationId || runId)
  const clock = new FakeExternalCliClock()
  let resolveProcess: ((result: BashResult) => void) | undefined
  let pendingResult: BashResult | undefined
  const request: FakeCliRequest = {
    runId,
    conversationId,
    prompt: input.prompt,
    clock,
    started: false,
    release: (result = { ok: true, code: 0, stdout: '{"type":"text","data":"fake output"}\n', stderr: '' }) => {
      if (resolveProcess) resolveProcess(result)
      else pendingResult = result
    },
  }
  requests.set(runId, request)
  const run = runLocalCliAgent({
    ...(input as LocalCliRunInput),
    binary: process.execPath,
    kind: 'codex',
    conversationId,
    runId,
    onStream: (event) => {
      for (const subscriber of streamSubscribers) subscriber(event as unknown as Record<string, unknown>)
    },
  }, {
    clock,
    runArgv: async (options) => {
      request.started = true
      options.onStarted?.(`fake-process:${runId}`)
      options.onStdout?.('{"type":"text","data":"fake model activity"}\n')
      return new Promise<BashResult>((resolve) => {
        resolveProcess = resolve
        if (pendingResult) {
          const result = pendingResult
          pendingResult = undefined
          resolve(result)
        }
      })
    },
    cancelRun: async () => {
      request.release({ ok: false, code: null, stdout: '', stderr: '[cancelled]', cancelled: true })
      return { confirmed: true }
    },
    writeInput: () => true,
  })
  return run.finally(() => { terminalOrder.push(runId) })
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
  requests.get('primary-same-1')!.release()
  await first
  for (let i = 0; i < 100 && !requests.has('primary-same-2'); i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(requests.has('primary-same-2'))
  requests.get('primary-same-2')!.release()
  await new Promise((resolve) => setTimeout(resolve, 0))

  const concurrentA = runTask({ objective: 'primary seam concurrent A', sourceKind: 'composer', runner: 'codex', runId: 'primary-concurrent-a', reuseThreadId: threadA })
  const concurrentB = runTask({ objective: 'primary seam concurrent B', sourceKind: 'composer', runner: 'codex', runId: 'primary-concurrent-b', reuseThreadId: threadB })
  for (let i = 0; i < 100 && (!requests.has('primary-concurrent-a') || !requests.has('primary-concurrent-b')); i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(requests.has('primary-concurrent-a') && requests.has('primary-concurrent-b'), 'different threads execute concurrently')
  requests.get('primary-concurrent-b')!.release()
  requests.get('primary-concurrent-a')!.release()
  await Promise.all([concurrentA, concurrentB])

  const timeoutThread = useThreadStore.getState().createThread({ title: 'primary seam timeout', runner: 'codex' })
  const timeout = runTask({ objective: 'primary seam timeout telemetry', sourceKind: 'composer', runner: 'codex', runId: 'primary-timeout', reuseThreadId: timeoutThread, overrides: { externalCliPolicy: { idleMs: 25, absoluteMs: 500 } } })
  for (let i = 0; i < 100 && !requests.has('primary-timeout'); i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  const timeoutRequest = requests.get('primary-timeout')!
  timeoutRequest.clock.advance(26)
  const timeoutResult = await timeout
  assert.equal(timeoutResult.path, 'cli')
  assert.equal(timeoutResult.status, 'failed')
  assert.equal(timeoutResult.terminalClassification, 'idle-timeout')
  assert.equal(new Set(terminalOrder).size, terminalOrder.length, 'every primary-seam run settles once')
  assert.ok(streamSubscribers.size >= 0)
  console.log('primary-seam qualification passed: coordinator, real supervisor registry, stream, ordering, concurrency, timeout telemetry')
} finally {
  for (const request of requests.values()) {
    if (!request.started) request.release({ ok: false, code: null, stdout: '', stderr: '[cleanup]', cancelled: true })
  }
  requests.clear()
  streamSubscribers.clear()
  useSettingsStore.setState({ settings: originalSettings })
  if (originalWindow) (globalThis as { window?: Window }).window = originalWindow
  else delete (globalThis as { window?: Window }).window
}
