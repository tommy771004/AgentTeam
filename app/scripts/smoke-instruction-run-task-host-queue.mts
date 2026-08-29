/**
 * Shipped-Pi-Host qualification for the coordinator queue.
 *
 * Both requests enter through production runTask. A is held at the loopback
 * provider, B is queued by the coordinator, and finalization drains B without
 * a test-side Host claim or submit. The child process is the built Pi Host,
 * so instruction snapshots, provider prompts and Turn Records are real.
 *
 * Run: node --experimental-strip-types scripts/smoke-instruction-run-task-host-queue.mts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  createInstructionProjectionCursor,
} from '../src/agent/instructionProjectionCursor.ts'
import {
  observeInstructionProjectionEvent,
  requestInstructionProjection,
} from '../src/agent/instructionProjectionUpdate.ts'

type ProviderMessage = { role?: string; content?: unknown }
type ProviderRequest = { messages?: ProviderMessage[] }
type HostResponse = { id?: number; result?: any; error?: any; event?: string; payload?: any }

function providerText(message: ProviderMessage): string {
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) return message.content.map((part) => {
    if (typeof part === 'string') return part
    if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text
    return JSON.stringify(part)
  }).join('\n')
  return JSON.stringify(message.content ?? '')
}

function occurrence(text: string, needle: string): number {
  let count = 0
  let offset = 0
  while (needle && (offset = text.indexOf(needle, offset)) >= 0) {
    count += 1
    offset += needle.length
  }
  return count
}

function assertProviderOrder(
  request: ProviderRequest,
  current: string,
  expected: readonly string[],
  forbidden: readonly string[],
) {
  const messages = request.messages || []
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  assert.ok(lastUser, 'provider request has a user-authored message')
  const text = providerText(lastUser)
  assert.equal(occurrence(text, current), 1, `${current} exactly once in current user message`)
  const currentAt = text.lastIndexOf(current)
  for (const sentinel of expected) {
    assert.equal(occurrence(text, sentinel), 1, `${sentinel} exactly once in provider user message`)
    assert.ok(text.indexOf(sentinel) < currentAt, `${sentinel} precedes current request`)
  }
  for (const sentinel of forbidden) assert.equal(occurrence(JSON.stringify(messages), sentinel), 0, `${sentinel} is absent`)
  const suffix = text.slice(currentAt + current.length)
  for (const sentinel of [...expected, ...forbidden]) assert.equal(occurrence(suffix, sentinel), 0, `${sentinel} is not reinjected after current request`)
}

class MemoryStorage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

type ClockGate = {
  deferred: Deferred<void>
  advanced: boolean
}

/** Explicit one-shot gates, not polling: the scenario advances every external phase. */
class FakeClock {
  private readonly gates = new Map<string, ClockGate>()
  readonly trace: string[] = []
  ticks = 0

  wait(label: string): Promise<void> {
    assert.equal(this.gates.has(label), false, `FakeClock gate registered once: ${label}`)
    const gate = { deferred: deferred<void>(), advanced: false }
    this.gates.set(label, gate)
    this.trace.push(`wait:${label}`)
    return gate.deferred.promise.then(() => {
      this.trace.push(`consume:${label}`)
    })
  }

  advance(label: string): void {
    const gate = this.gates.get(label)
    assert.ok(gate, `FakeClock advance requires a registered waiter: ${label}`)
    assert.equal(gate.advanced, false, `FakeClock gate is one-shot: ${label}`)
    this.ticks += 1
    gate.advanced = true
    this.trace.push(`advance:${label}`)
    gate.deferred.resolve()
  }

  releaseIfWaiting(label: string): void {
    const gate = this.gates.get(label)
    if (gate && !gate.advanced) {
      gate.advanced = true
      gate.deferred.resolve()
    }
  }
}

async function bounded<T>(label: string, operation: Promise<T>, timeoutMs = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`stage timeout after ${timeoutMs}ms: ${label}`)), timeoutMs)
      }),
    ])
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function listenModelServer(server: ReturnType<typeof createServer>): Promise<number> {
  return bounded('model server listen', new Promise<number>((resolvePort, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    try {
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError)
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('loopback model did not bind'))
          return
        }
        resolvePort(address.port)
      })
    } catch (error) {
      server.off('error', onError)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  }))
}

type HostClient = {
  child: ChildProcess
  ready: Promise<void>
  messages: HostResponse[]
  call: (method: string, params?: Record<string, unknown>) => Promise<HostResponse>
  close: () => Promise<void>
}

const delay = (ms: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms))

function spawnHost(agentDir: string, stateDir: string, dbPath: string): HostClient {
  const child = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
    env: {
      ...process.env,
      SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'),
      SUBAGENTS_PI_AGENT_DIR: agentDir,
      SUBAGENTS_INSTRUCTION_DB_PATH: dbPath,
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  let spawned = false
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    child.once('spawn', () => {
      spawned = true
      resolveReady()
    })
    child.on('error', (error) => {
      if (!spawned) rejectReady(error)
    })
  })
  const messages: HostResponse[] = []
  const pending = new Map<number, (message: HostResponse) => void>()
  const output = createInterface({ input: child.stdout })
  output.on('line', (line) => {
    try {
      const message = JSON.parse(line) as HostResponse
      messages.push(message)
      if (typeof message.id === 'number') pending.get(message.id)?.(message)
    } catch { /* Host diagnostics remain on stderr. */ }
  })
  let id = 1
  const call = (method: string, params: Record<string, unknown> = {}) => new Promise<HostResponse>((resolveResponse, reject) => {
    const requestId = id++
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error(`Pi Host timeout: ${method}`))
    }, 10_000)
    pending.set(requestId, (message) => {
      clearTimeout(timer)
      pending.delete(requestId)
      resolveResponse(message)
    })
    if (child.stdin.destroyed || child.stdin.writableEnded) {
      clearTimeout(timer)
      pending.delete(requestId)
      reject(new Error(`Pi Host stdin closed before stage: ${method}`))
      return
    }
    child.stdin.write(`${JSON.stringify({ id: requestId, method, params })}\n`)
  })
  const close = async () => {
    if (child.exitCode !== null) return
    if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end()
    await Promise.race([once(child, 'exit'), delay(3_000)])
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await Promise.race([once(child, 'exit'), delay(1_000)])
    }
  }
  return { child, ready, messages, call, close }
}

const agentDir = await mkdtemp(join(tmpdir(), 'pi-run-task-host-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-run-task-host-state-'))
const projectDir = await mkdtemp(join(tmpdir(), 'pi-run-task-host-project-'))
const dbPath = join(stateDir, 'instructions.sqlite')
const projectFile = join(projectDir, 'AGENTS.md')
const includeFile = join(projectDir, 'included.md')
const nestedFile = join(projectDir, 'nested.md')
const providerRequests: ProviderRequest[] = []
const clock = new FakeClock()
const firstProviderReady = deferred<void>()
let modelServer: ReturnType<typeof createServer> | undefined
modelServer = createServer(async (request, response) => {
    if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
      response.writeHead(404).end()
      return
    }
    let body = ''
    for await (const chunk of request) body += String(chunk)
    providerRequests.push(JSON.parse(body) as ProviderRequest)
    if (providerRequests.length === 1) {
      firstProviderReady.resolve()
      await clock.wait('provider:A')
    }
    const answer = `run-task-host-answer-${providerRequests.length}`
    response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
    response.write(`data: ${JSON.stringify({ id: answer, model: 'run-task-host-model', choices: [{ index: 0, delta: { role: 'assistant', content: answer }, finish_reason: null }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ id: answer, model: 'run-task-host-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
    response.end('data: [DONE]\n\n')
})

const modelPort = await listenModelServer(modelServer!)
await bounded('write model config', writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: {
  baseUrl: `http://127.0.0.1:${modelPort}/v1`, api: 'openai-completions', apiKey: 'test-key',
  models: [{ id: 'run-task-host-model', name: 'Run Task Host Model', reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 256 }],
} } })))
await bounded('write auth config', writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } })))
await bounded('write settings config', writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'run-task-host-model', defaultThinkingLevel: 'off' })))
await bounded('write nested source', writeFile(nestedFile, 'NESTED_OLD\n'))
await bounded('write include source', writeFile(includeFile, `INCLUDE_OLD\n@${nestedFile}\n`))
await bounded('write project source', writeFile(projectFile, `PROJECT_OLD\n@${includeFile}\n`))

let host: HostClient | undefined
let sessionId = ''
try {
  host = spawnHost(agentDir, stateDir, dbPath)
  await bounded('Host spawn', host.ready)
  const initialize = await bounded('Host initialize', host.call('initialize', { protocolVersion: 5, capabilities: ['instructions-v1', 'memory-store-v1'] }))
  assert.equal(initialize.error, undefined)
  const oldSave = await bounded('initial instruction save', host.call('instructions/v1/save', { expectedRevision: 0, globalCustomInstructions: 'GLOBAL_OLD' }))
  assert.equal(oldSave.error, undefined)
  assert.equal(oldSave.result.instructions.revision, 1)

  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  // This is the production preload shape. All methods below call the public
  // child-process protocol; no test implementation of Host turn semantics is
  // present here.
  const bProviderStarted = deferred<void>()
  const bSettled = deferred<any>()
  const bridge = {
    piHost: {
      sessions: {
        list: async () => (await host!.call('sessions/list')).result,
        create: async (title?: string, threadId?: string) => {
          const created = (await host!.call('sessions/create', { title, threadId })).result
          sessionId = String(created.sessionId)
          return created
        },
      },
      instructions: {
        get: async () => (await host!.call('instructions/v1/get')).result,
        resolve: async (input: { projectRoot?: string; workPath?: string }) => (await host!.call('instructions/v1/resolve', input)).result,
        migrateLegacy: async (input: Record<string, unknown>) => (await host!.call('instructions/v1/migrate-legacy', input)).result,
      },
      turn: {
        submit: async (input: Record<string, unknown>) => {
          if (input.runId === 'run-task-host-B') bProviderStarted.resolve()
          if (input.runId === 'run-task-host-A') sessionId = String(input.sessionId)
          const response = await host!.call('turn/submit', input)
          assert.equal(response.error, undefined, `public Host turn/submit failed: ${JSON.stringify(response.error)}`)
          return response.result
        },
      },
    },
  }
  Object.defineProperty(globalThis, 'window', { value: { subagents: bridge }, configurable: true })

  const { runTask } = await import('../src/agent/taskRunCoordinator.ts')
  const { useAgentStore } = await import('../src/store/agentStore.ts')
  const { useSettingsStore } = await import('../src/store/settingsStore.ts')
  const { useThreadStore } = await import('../src/store/threadStore.ts')
  const { clearRunQueue, listQueuedRuns } = await import('../src/agent/runQueue.ts')
  useAgentStore.getState().reset()
  clearRunQueue()
  useSettingsStore.setState({ settings: {
    ...useSettingsStore.getState().settings,
    maxConcurrentRuns: 1,
    followUpMode: 'queue',
    model: 'run-task-host-model',
    sessionRecallEnabled: false,
    referenceChatHistory: false,
  } })
  const threadId = useThreadStore.getState().createThread({ title: 'real Host queue scenario' })

  const runA = runTask({
    sourceKind: 'composer', runner: 'builtin', loopType: 'Goal-based',
    objective: 'RUN_TASK_HOST_A', runId: 'run-task-host-A', reuseThreadId: threadId,
    projectRoot: projectDir, overrides: { maxIterations: 2 },
  })
  await bounded('A provider admission', firstProviderReady.promise)
  if (!sessionId) {
    const sessions = await host.call('sessions/list')
    sessionId = String(sessions.result?.sessions?.[0]?.id || '')
  }
  assert.ok(sessionId, 'production runTask created a real Host session')

  const runB = runTask({
    sourceKind: 'composer', runner: 'builtin', loopType: 'Goal-based',
    objective: 'RUN_TASK_HOST_B', runId: 'run-task-host-B', reuseThreadId: threadId,
    projectRoot: projectDir, overrides: { maxIterations: 1 },
    onSettled: (result) => { bSettled.resolve(result) },
  })
  const queued = await runB
  assert.equal(queued.queued, true)
  assert.equal(queued.skipReason, 'queued')
  assert.equal(listQueuedRuns().length, 1)
  assert.equal(providerRequests.length, 1, 'B is not submitted while A provider request is held')

  // A real gate pins all source mutations before B can be admitted. This is
  // causal scheduling, not a polling loop or a test-side queue claim.
  const mutationGate = clock.wait('before:B-admission')
  // Public Host DB save plus real project-file mutations while B waits.
  const latestSave = await bounded('queued-run instruction save', host.call('instructions/v1/save', { expectedRevision: 1, globalCustomInstructions: 'GLOBAL_NEW' }))
  assert.equal(latestSave.error, undefined)
  assert.equal(latestSave.result.instructions.revision, 2)
  await bounded('mutate nested source', writeFile(nestedFile, 'NESTED_NEW\n'))
  await bounded('mutate include source', writeFile(includeFile, `INCLUDE_NEW\n@${nestedFile}\n`))
  await bounded('mutate project source', writeFile(projectFile, `PROJECT_NEW\n@${includeFile}\n`))
  const refreshed = await bounded('queued-run source refresh', bridge.piHost.instructions.resolve({ projectRoot: projectDir, workPath: projectDir }))
  assert.match(refreshed.instructionSnapshot.effectiveText, /PROJECT_NEW/)
  assert.match(refreshed.instructionSnapshot.effectiveText, /INCLUDE_NEW/)
  assert.match(refreshed.instructionSnapshot.effectiveText, /NESTED_NEW/)
  clock.advance('before:B-admission')
  await bounded('queued-run mutation gate', mutationGate)

  // A's deferred provider request is released; only after finalization does
  // runTask drain B, so B resolves after the mutation gate.
  clock.advance('provider:A')
  const resultA = await bounded('A settlement', runA)
  assert.equal(resultA.status, 'success')
  await bounded('B automatic provider admission', bProviderStarted.promise)
  const settledB = await bounded('B settlement callback', bSettled.promise)
  assert.equal(settledB.runId, 'run-task-host-B')
  assert.equal(listQueuedRuns().length, 0)
  await bounded('run registry release', new Promise<void>((resolveRelease) => setImmediate(resolveRelease)))
  assert.equal(useAgentStore.getState().activeRunIds.length, 0)

  const oldSentinels = ['GLOBAL_OLD', 'PROJECT_OLD', 'INCLUDE_OLD', 'NESTED_OLD']
  const newSentinels = ['GLOBAL_NEW', 'PROJECT_NEW', 'INCLUDE_NEW', 'NESTED_NEW']
  assert.equal(providerRequests.length, 2, 'A uses the held provider request and B is dispatched by the coordinator')
  assertProviderOrder(providerRequests[0], 'RUN_TASK_HOST_A', oldSentinels, newSentinels)
  assertProviderOrder(providerRequests[1], 'RUN_TASK_HOST_B', newSentinels, oldSentinels)

  // The Host responses returned through production turn/submit carry exact
  // records. Capture the record by reading the session after both runs.
  const recordPage = await host.call('sessions/record', { sessionId, limit: 500 })
  const entries = recordPage.result.page.entries as any[]
  const snapshots = entries.filter((entry) => entry.kind === 'instruction-snapshot')
  assert.equal(snapshots.length, 2)
  const oldSnapshot = snapshots.find((entry) => entry.snapshot.effectiveText.includes('GLOBAL_OLD'))?.snapshot
  const newSnapshot = snapshots.find((entry) => entry.snapshot.effectiveText.includes('GLOBAL_NEW'))?.snapshot
  assert.ok(oldSnapshot && newSnapshot)
  assert.notEqual(oldSnapshot.effectiveHash, newSnapshot.effectiveHash)
  for (const sentinel of oldSentinels) assert.match(oldSnapshot.effectiveText, new RegExp(sentinel))
  for (const sentinel of newSentinels) assert.match(newSnapshot.effectiveText, new RegExp(sentinel))
  const oldProject = await realpath(projectFile)
  const oldInclude = await realpath(includeFile)
  const oldNested = await realpath(nestedFile)
  const oldSources = oldSnapshot.sources
  assert.equal(oldSources.find((source: any) => source.path === oldProject)?.hash, createHash('sha256').update('PROJECT_OLD\n@' + includeFile + '\n').digest('hex'))
  assert.equal(oldSources.find((source: any) => source.path === oldInclude)?.hash, createHash('sha256').update(`INCLUDE_OLD\n@${nestedFile}\n`).digest('hex'))
  assert.equal(oldSources.find((source: any) => source.path === oldNested)?.hash, createHash('sha256').update('NESTED_OLD\n').digest('hex'))
  assert.ok(newSnapshot.sources.some((source: any) => source.path === oldInclude && source.hash === createHash('sha256').update(`INCLUDE_NEW\n@${nestedFile}\n`).digest('hex')))
  assert.ok(newSnapshot.sources.some((source: any) => source.path === oldNested && source.hash === createHash('sha256').update('NESTED_NEW\n').digest('hex')))

  // Production projection owner: a fake clock delivers the newer Host event
  // and response first, then a delayed older response. The older state loses.
  const events = host.messages.filter((message) => message.event === 'instruction/changed')
  const revisions = events.map((message) => Number(message.payload?.revision)).filter(Number.isSafeInteger)
  const latestRevision = Math.max(...revisions)
  assert.ok(latestRevision >= 2)
  const cursor = createInstructionProjectionCursor()
  const freshEventDelivery = clock.wait('projection:fresh-event')
  const freshRefreshDelivery = clock.wait('projection:fresh-refresh')
  const staleUpdate = requestInstructionProjection(cursor, async () => {
    await clock.wait('projection:stale-response')
    return oldSnapshot
  })
  const freshUpdate = requestInstructionProjection(cursor, async () =>
    (await bridge.piHost.instructions.resolve({ projectRoot: projectDir, workPath: projectDir })).instructionSnapshot)
  let refreshRequested = 0
  clock.advance('projection:fresh-event')
  await bounded('fresh Host event delivery', freshEventDelivery)
  assert.equal(observeInstructionProjectionEvent(cursor, latestRevision, () => { refreshRequested += 1 }), true)
  clock.advance('projection:fresh-refresh')
  await bounded('fresh projection refresh gate', freshRefreshDelivery)
  const freshResult = await bounded('fresh projection response', freshUpdate)
  assert.equal(freshResult.accepted, true)
  assert.ok(freshResult.snapshot.revision >= latestRevision)
  clock.advance('projection:stale-response')
  const staleResult = await bounded('delayed stale projection response', staleUpdate)
  assert.equal(staleResult.accepted, false)
  assert.equal(refreshRequested, 1)

  // Keep an old renderer request in flight across the restart. The restart
  // gate and the real post-restart Host event drive the production helper;
  // the old response is released only after the newer projection wins.
  const preRestartResponse = requestInstructionProjection(cursor, async () => {
    await clock.wait('restart:stale-response')
    return oldSnapshot
  })
  const restartAction = clock.wait('restart')
  clock.advance('restart')
  await bounded('restart action gate', restartAction)
  await bounded('Host close before restart', host.close())
  host = spawnHost(agentDir, stateDir, dbPath)
  await bounded('Host respawn', host.ready)
  assert.equal((await bounded('restart initialize', host.call('initialize', { protocolVersion: 5, capabilities: ['instructions-v1'] }))).error, undefined)
  const restartInstructions = await bounded('restart instruction get', host.call('instructions/v1/get'))
  assert.ok(Number(restartInstructions.result.instructions.revision) >= 2)
  const restartProjection = await bounded('restart instruction resolve', host.call('instructions/v1/resolve', { projectRoot: projectDir, workPath: projectDir }))
  assert.ok(Number(restartProjection.result.instructionSnapshot.revision) >= freshResult.snapshot.revision)
  const restartSave = await bounded('restart Host event save', host.call('instructions/v1/save', {
    expectedRevision: restartInstructions.result.instructions.revision,
    globalCustomInstructions: 'GLOBAL_NEW',
  }))
  assert.equal(restartSave.error, undefined)
  const restartDbRevision = Number(restartSave.result.instructions.revision)
  assert.equal(restartDbRevision, Number(restartInstructions.result.instructions.revision) + 1)
  const restartEvent = host.messages.find((message) => message.event === 'instruction/changed'
    && message.payload?.operation === 'save'
    && Number(message.payload?.revision) > freshResult.snapshot.revision)
  const restartEventRevision = Number(restartEvent?.payload?.revision)
  assert.ok(restartEvent, 'restart save published a Host projection event')
  assert.ok(restartEventRevision > freshResult.snapshot.revision)
  const restartEventDelivery = clock.wait('restart:event')
  assert.ok(host.messages.some((message) => message.event === 'instruction/changed' && Number(message.payload?.revision) === restartEventRevision))
  clock.advance('restart:event')
  await bounded('restart Host event delivery', restartEventDelivery)
  let restartRefreshRequested = 0
  const restartProjectionReady = deferred<void>()
  let restartProjectionUpdate: Promise<{ accepted: boolean; snapshot: typeof restartProjection.result.instructionSnapshot }> | undefined
  assert.equal(observeInstructionProjectionEvent(cursor, restartEventRevision, () => {
    restartRefreshRequested += 1
    restartProjectionUpdate = requestInstructionProjection(cursor, async () => {
      const resolved = await host!.call('instructions/v1/resolve', { projectRoot: projectDir, workPath: projectDir })
      assert.equal(resolved.error, undefined)
      restartProjectionReady.resolve()
      await clock.wait('restart:projection-refresh')
      return resolved.result.instructionSnapshot
    })
  }), true)
  await bounded('restart projection request readiness', restartProjectionReady.promise)
  assert.ok(restartProjectionUpdate, 'restart event started production projection refresh')
  clock.advance('restart:projection-refresh')
  const restartFresh = await bounded('restart projection refresh', restartProjectionUpdate!)
  assert.equal(restartFresh.accepted, true)
  assert.equal(restartRefreshRequested, 1)
  assert.ok(restartFresh.snapshot.revision >= restartEventRevision)
  clock.advance('restart:stale-response')
  const preRestartResult = await bounded('pre-restart stale renderer response', preRestartResponse)
  assert.equal(preRestartResult.accepted, false)
  const replay = await bounded('restart replay record', host.call('sessions/record', { sessionId, limit: 500 }))
  const replayEntries = replay.result.page.entries as any[]
  const replayOld = replayEntries.find((entry) => entry.kind === 'instruction-snapshot' && entry.snapshot.id === oldSnapshot.id)
  assert.ok(replayOld)
  assert.equal(replayOld.snapshot.effectiveHash, oldSnapshot.effectiveHash)
  assert.equal(replayOld.snapshot.effectiveText, oldSnapshot.effectiveText)
  assert.ok(!JSON.stringify(replayOld).includes('GLOBAL_NEW'))
  const restartEvents = host.messages.filter((message) => message.event === 'instruction/changed')
    .map((message) => Number(message.payload?.revision)).filter(Number.isSafeInteger)
  assert.ok(restartEvents.every((revision, index) => index === 0 || revision >= restartEvents[index - 1]))
  assert.deepEqual(clock.trace, [
    'wait:provider:A', 'wait:before:B-admission', 'advance:before:B-admission', 'consume:before:B-admission',
    'advance:provider:A', 'consume:provider:A',
    'wait:projection:fresh-event', 'wait:projection:fresh-refresh', 'wait:projection:stale-response',
    'advance:projection:fresh-event', 'consume:projection:fresh-event',
    'advance:projection:fresh-refresh', 'consume:projection:fresh-refresh',
    'advance:projection:stale-response', 'consume:projection:stale-response',
    'wait:restart:stale-response', 'wait:restart', 'advance:restart', 'consume:restart',
    'wait:restart:event', 'advance:restart:event', 'consume:restart:event',
    'wait:restart:projection-refresh', 'advance:restart:projection-refresh', 'consume:restart:projection-refresh',
    'advance:restart:stale-response', 'consume:restart:stale-response',
  ])
  console.log(`smoke-instruction-run-task-host-queue: ok (A/B production queue, real Host records, restart replay, fake-clock trace=${clock.trace.join(' > ')})`)
} finally {
  clock.releaseIfWaiting('provider:A')
  clock.releaseIfWaiting('projection:stale-response')
  clock.releaseIfWaiting('restart:stale-response')
  await host?.close()
  modelServer?.close?.()
  await Promise.all([
    rm(agentDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(projectDir, { recursive: true, force: true }),
  ])
}
