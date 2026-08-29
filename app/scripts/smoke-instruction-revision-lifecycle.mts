import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPiHostServer, type PiHostMessage, type PiHostResponse } from '../electron/piHostProtocol.ts'
import { InMemoryInstructionRepository } from '../electron/instructionRepository.ts'
import {
  acceptInstructionProjection,
  beginInstructionProjectionRequest,
  createInstructionProjectionCursor,
  observeInstructionRevision,
} from '../src/agent/instructionProjectionCursor.ts'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const root = await mkdtemp(join(tmpdir(), 'agentstudio-instruction-revision-'))
const projectPath = join(root, 'AGENTS.md')
const includePath = join(root, 'shared.md')
const messages: PiHostMessage[] = []
const host = createPiHostServer(
  (message) => messages.push(message),
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  new InMemoryInstructionRepository(),
)
let nextRequestId = 1
const request = async (method: string, params: Record<string, unknown> = {}): Promise<PiHostResponse> => {
  const id = nextRequestId++
  await host.handle({ id, method, params })
  const response = messages.find((message): message is PiHostResponse => 'id' in message && message.id === id)
  assert.ok(response, `missing Host response for ${method}`)
  return response
}
const instructionEvents = () => messages.filter((message): message is Extract<PiHostMessage, { event: 'instruction/changed' }> =>
  'event' in message && message.event === 'instruction/changed')

const NativeDate = Date
let fakeNow = 1_000
class FakeDate extends NativeDate {
  constructor(value?: string | number | Date) {
    super(value === undefined ? fakeNow : value)
  }
  static override now() { return fakeNow }
}
try {
  await writeFile(includePath, 'INCLUDE_V1')
  await writeFile(projectPath, 'PROJECT_V1\n@shared.md')
  await request('initialize', { protocolVersion: 5, capabilities: ['instructions-v1'] })

  const firstProjection = await request('instructions/v1/resolve', { projectRoot: root, workPath: root })
  const firstSnapshot = firstProjection.result?.instructionSnapshot
  assert.ok(firstSnapshot?.effectiveText.includes('PROJECT_V1'))
  assert.ok(firstSnapshot?.effectiveText.includes('INCLUDE_V1'))
  const rootSource = firstSnapshot?.sources.find((source) => source.path === projectPath || source.path?.endsWith('/AGENTS.md'))
  assert.ok(rootSource?.hash)

  await request('instructions/v1/save', { expectedRevision: 0, globalCustomInstructions: 'GLOBAL_V1' })
  await request('instructions/v1/project-write', {
    projectRoot: root,
    target: 'AGENTS.md',
    expectedHash: rootSource.hash,
    content: 'PROJECT_V2\n@shared.md',
  })
  await writeFile(includePath, 'INCLUDE_V2')
  const changedProjection = await request('instructions/v1/resolve', { projectRoot: root, workPath: root })
  assert.ok(changedProjection.result?.instructionSnapshot?.effectiveText.includes('GLOBAL_V1'))
  assert.ok(changedProjection.result?.instructionSnapshot?.effectiveText.includes('PROJECT_V2'))
  assert.ok(changedProjection.result?.instructionSnapshot?.effectiveText.includes('INCLUDE_V2'))

  const observedEvents = instructionEvents()
  assert.deepEqual(observedEvents.map((event) => event.payload.operation), [
    'filesystem-observed',
    'save',
    'project-write',
    'filesystem-observed',
  ])
  const revisions = observedEvents.map((event) => event.payload.revision)
  assert.deepEqual(revisions, [...revisions].sort((left, right) => left - right))
  assert.equal(new Set(revisions).size, revisions.length, 'every instruction invalidation gets a unique monotonic revision')
  const initialFilesystemEvent = observedEvents[0]
  assert.ok(initialFilesystemEvent)
  const canonicalProject = await realpath(root)
  assert.equal(initialFilesystemEvent.payload.projectIdentity, canonicalProject)
  assert.equal(initialFilesystemEvent.payload.effectiveHash, firstSnapshot?.effectiveHash)
  assert.ok(initialFilesystemEvent.payload.sources?.some((source) => source.path?.endsWith('/AGENTS.md') && source.hash === rootSource?.hash), 'filesystem invalidation identifies the project source hash')
  assert.ok(initialFilesystemEvent.payload.sources?.some((source) => source.path?.endsWith('/shared.md') && source.hash === firstSnapshot?.sources.find((source) => source.path?.endsWith('/shared.md'))?.hash), 'filesystem invalidation identifies transitive include hash')
  const saveEvent = observedEvents.find((event) => event.payload.operation === 'save')
  assert.equal(saveEvent?.payload.source?.identity, 'global:instruction-state')
  assert.equal(saveEvent?.payload.source?.hash, (await request('instructions/v1/get')).result?.instructions?.hash)
  const projectWriteEvent = observedEvents.find((event) => event.payload.operation === 'project-write')
  assert.equal(projectWriteEvent?.payload.source?.path?.endsWith('/AGENTS.md'), true)
  assert.equal(projectWriteEvent?.payload.source?.hash, changedProjection.result?.instructionSnapshot?.sources.find((source) => source.path?.endsWith('/AGENTS.md'))?.hash)
  const changedFilesystemEvent = observedEvents.find((event) => event.payload.operation === 'filesystem-observed' && event.payload.revision > (initialFilesystemEvent?.payload.revision || 0))
  assert.equal(changedFilesystemEvent?.payload.projectIdentity, canonicalProject)
  assert.equal(changedFilesystemEvent?.payload.effectiveHash, changedProjection.result?.instructionSnapshot?.effectiveHash)
  const beforeNoopResolve = observedEvents.length
  await request('instructions/v1/resolve', { projectRoot: root, workPath: root })
  assert.equal(instructionEvents().length, beforeNoopResolve, 'unchanged projection does not manufacture a revision')

  // Renderer after-cursor gate: a delayed old request and a reordered event
  // cannot replace a projection already accepted at a newer Host revision.
  const cursor = createInstructionProjectionCursor()
  const staleRequest = beginInstructionProjectionRequest(cursor)
  assert.equal(observeInstructionRevision(cursor, 10), true)
  const freshRequest = beginInstructionProjectionRequest(cursor)
  assert.equal(acceptInstructionProjection(cursor, freshRequest, 10), true)
  assert.equal(acceptInstructionProjection(cursor, staleRequest, 9), false)
  assert.equal(observeInstructionRevision(cursor, 9), false)
  const waitingRequest = beginInstructionProjectionRequest(cursor)
  assert.equal(observeInstructionRevision(cursor, 11), true)
  assert.equal(acceptInstructionProjection(cursor, waitingRequest, 10), false)
  const caughtUpRequest = beginInstructionProjectionRequest(cursor)
  assert.equal(acceptInstructionProjection(cursor, caughtUpRequest, 11), true)

  // Fake-clock queue scenario. The queue contains only the request. Global,
  // project and transitive include sources change while it waits; the real
  // canonical external-admission helper resolves the Host only when drained.
  const memory = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true })
  Object.defineProperty(globalThis, 'Date', { value: FakeDate, configurable: true })
  const queue = await import('../src/agent/runQueue.ts')
  queue.resetRunQueueForTests()
  const queued = queue.enqueueExternalRun({
    runId: 'instruction-queued-run',
    objective: 'resolve at admission',
    sourceKind: 'composer',
    runner: 'codex',
    projectRoot: root,
  })
  assert.equal(queued?.enqueuedAt, new Date(1_000).toISOString())

  const latestBeforeQueue = changedProjection.result!.instructionSnapshot!
  const latestRoot = latestBeforeQueue.sources.find((source) => source.path?.endsWith('/AGENTS.md'))
  assert.ok(latestRoot?.hash)
  await request('instructions/v1/save', { expectedRevision: 1, globalCustomInstructions: 'GLOBAL_QUEUE_LATEST' })
  await request('instructions/v1/project-write', {
    projectRoot: root,
    target: 'AGENTS.md',
    expectedHash: latestRoot.hash,
    content: 'PROJECT_QUEUE_LATEST\n@shared.md',
  })
  await writeFile(includePath, 'INCLUDE_QUEUE_LATEST')
  fakeNow = 9_000

  const windowValue = {
    subagents: {
      piHost: {
        instructions: {
          resolve: async (input: Record<string, unknown>) => {
            const response = await request('instructions/v1/resolve', input)
            assert.ok(response.result?.instructionSnapshot)
            return { instructionSnapshot: response.result.instructionSnapshot }
          },
        },
      },
    },
  }
  Object.defineProperty(globalThis, 'window', { value: windowValue, configurable: true })
  const { admitExternalInstructions } = await import('../src/agent/taskRunCoordinator.ts')
  let admittedHash = ''
  let admittedText = ''
  await queue.drainExternalRunQueue(async (item) => {
    const overrides: Record<string, unknown> = {}
    await admitExternalInstructions({
      runner: item.runner || 'codex',
      projectRoot: item.projectRoot,
      overrides,
      notice: () => {},
    })
    const snapshot = overrides.instructionSnapshot as typeof latestBeforeQueue
    assert.ok(snapshot.effectiveText.includes('GLOBAL_QUEUE_LATEST'))
    assert.ok(snapshot.effectiveText.includes('PROJECT_QUEUE_LATEST'))
    assert.ok(snapshot.effectiveText.includes('INCLUDE_QUEUE_LATEST'))
    assert.ok(!snapshot.effectiveText.includes('GLOBAL_V1'))
    admittedHash = snapshot.effectiveHash
    admittedText = snapshot.effectiveText
    return { path: 'cli', executionKind: 'external', status: 'success', threadId: null, runId: item.runId }
  })
  const { createHash } = await import('node:crypto')
  assert.equal(admittedHash, createHash('sha256').update(admittedText).digest('hex'))
  assert.equal(await readFile(projectPath, 'utf8'), 'PROJECT_QUEUE_LATEST\n@shared.md')
} finally {
  Object.defineProperty(globalThis, 'Date', { value: NativeDate, configurable: true })
  await rm(root, { recursive: true, force: true })
}

console.log('instruction revision lifecycle: monotonic Host events, after-cursor projection gate and queue-time admission passed')
