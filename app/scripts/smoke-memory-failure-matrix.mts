import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import {
  canonicalProjectId,
  DURABLE_MEMORY_PLAINTEXT_WARNING,
  type DurableMemoryBundle,
  type MemoryAccessContext,
} from '../electron/durableMemoryStore.ts'
import { createPiDurableMemoryBridge } from '../electron/piDurableMemory.ts'
import { setPiMemoryBridge } from '../electron/piPackBridges.ts'
import { createPiHostServer, PI_HOST_PROTOCOL_VERSION, type PiHostMessage } from '../electron/piHostProtocol.ts'
import { settlePiRunLearning } from '../electron/piRunLearningSettlement.ts'
import { SqliteDurableMemoryStore } from '../electron/sqliteDurableMemoryStore.ts'
import { bindPiSessionRun, executePiPackTool, unbindPiSessionRun } from '../electron/piToolHost.ts'
import { asTurnRecordMemoryWrite } from '../src/agent/turnRecord.ts'

type Response = Extract<PiHostMessage, { id: string | number }>
type FaultMode = 'disk-full' | 'read-only' | 'busy-timeout' | 'transaction-fault' | 'forced-close'
type Workflow = 'tool' | 'explicit-learning' | 'automatic-learning' | 'admin-edit' | 'admin-delete' | 'admin-clear' | 'dream' | 'import'

const root = await mkdtemp(join(tmpdir(), 'memory-failure-matrix-'))
const project = canonicalProjectId('/workspace/failure-matrix')
const admin: MemoryAccessContext = { origin: 'admin', memoryReadEnabled: false, memoryWriteEnabled: false, temporary: false }
const createdAt = '2026-08-27T00:00:00.000Z'
const faultModes: FaultMode[] = ['disk-full', 'read-only', 'busy-timeout', 'transaction-fault', 'forced-close']
const workflows: Workflow[] = ['tool', 'explicit-learning', 'automatic-learning', 'admin-edit', 'admin-delete', 'admin-clear', 'dream', 'import']

function injectedFailure(mode: Exclude<FaultMode, 'forced-close'>): Error {
  const definitions = {
    'disk-full': { message: 'simulated SQLITE_FULL', code: 'SQLITE_FULL', errcode: 13 },
    'read-only': { message: 'simulated SQLITE_READONLY', code: 'SQLITE_READONLY', errcode: 8 },
    'busy-timeout': { message: 'simulated SQLITE_BUSY timeout', code: 'SQLITE_BUSY', errcode: 5 },
    'transaction-fault': { message: 'simulated transaction fault', code: 'EIO', errcode: 10 },
  }[mode]
  return Object.assign(new Error(definitions.message), definitions)
}

function harness(store: SqliteDurableMemoryStore) {
  const messages: PiHostMessage[] = []
  const server = createPiHostServer((message) => messages.push(message), undefined, undefined, undefined, undefined, store)
  let nextId = 1
  const send = async (method: string, params: Record<string, unknown> = {}): Promise<Response> => {
    const id = nextId++
    await server.handle({ id, method, params })
    const response = messages.find((message): message is Response => 'id' in message && message.id === id)
    assert.ok(response, `missing response for ${method}`)
    return response
  }
  return { messages, send }
}

function bundle(logicalKey: string, text: string): DurableMemoryBundle {
  return {
    schema: 'subagents.durable-memory', version: 1, generatedAt: createdAt, revision: 0,
    privacy: { plaintext: true, warning: DURABLE_MEMORY_PLAINTEXT_WARNING },
    entries: [{
      id: `source-${logicalKey}`, scope: { kind: 'global' }, logicalKey, kind: 'memory', text, tags: ['matrix'],
      createdAt, updatedAt: createdAt, revision: 1, provenance: { origin: 'admin', operation: 'export' },
    }],
  }
}

async function prepareWorkflow(
  workflow: Workflow,
  store: SqliteDurableMemoryStore,
  send: ReturnType<typeof harness>['send'],
  privateText: string,
) {
  if (workflow === 'admin-edit') {
    await store.upsert({ access: admin, scope: { kind: 'project', project }, logicalKey: 'edit-target', kind: 'memory', text: 'original', tags: [], createdAt })
  } else if (workflow === 'admin-delete') {
    await store.upsert({ access: admin, scope: { kind: 'project', project }, logicalKey: 'delete-target', kind: 'memory', text: privateText, tags: [], createdAt })
  } else if (workflow === 'admin-clear') {
    await store.upsert({ access: admin, scope: { kind: 'project', project }, logicalKey: 'clear-target', kind: 'memory', text: privateText, tags: [], createdAt })
  } else if (workflow === 'dream') {
    for (const key of ['dream-a', 'dream-b', 'dream-c']) {
      await store.upsert({ access: admin, scope: { kind: 'project', project }, logicalKey: key, kind: 'memory', text: privateText, tags: ['auto'], createdAt })
    }
  } else if (workflow === 'import') {
    const preview = await send('memory/v1/import-preview', { access: admin, bundle: bundle('import-target', privateText), mode: 'skip' })
    return { previewId: preview.result?.memoryStore?.preview?.previewId, expectedRevision: preview.result?.memoryStore?.preview?.revision }
  }
  return {}
}

async function executeToolFailure(store: SqliteDurableMemoryStore, privateText: string) {
  const access: MemoryAccessContext = {
    origin: 'runtime', canonicalProject: project, memoryReadEnabled: true, memoryWriteEnabled: true,
    temporary: false, runId: 'fault-tool-run', sessionId: 'fault-tool-session', callId: 'fault-tool-call',
  }
  const published: unknown[] = []
  setPiMemoryBridge(createPiDurableMemoryBridge(store, (change) => published.push(change)))
  bindPiSessionRun(access.sessionId!, { runId: access.runId!, memoryAccess: access })
  try {
    const result = await executePiPackTool('memory_set', { key: 'tool-target', text: privateText }, {
      sessionId: access.sessionId!, runId: access.runId!, cwd: project,
    }, { callId: access.callId! })
    assert.equal((result.data as { ok?: boolean } | undefined)?.ok, false)
    return { result, published }
  } finally {
    unbindPiSessionRun(access.sessionId!)
  }
}

async function executeLearningFailure(store: SqliteDurableMemoryStore, mode: 'explicit' | 'automatic', privateText: string) {
  const published: unknown[] = []
  const candidate = {
    mode,
    memory: { id: `${mode}-target`, project, text: privateText, tags: [mode], createdAt },
    access: {
      runId: `${mode}-fault-run`, sessionId: `${mode}-fault-session`, canonicalProject: project,
      memoryReadEnabled: true, memoryWriteEnabled: true, temporary: false,
    },
  }
  let failure: unknown
  try {
    await settlePiRunLearning({
      store, candidate, publish: (change) => published.push(change),
      outcome: { status: 'success', executionKind: 'loop', ...(mode === 'automatic' ? { dodMet: true } : {}) },
    })
  } catch (error) { failure = error }
  assert.ok(failure, `${mode} learning must not report success`)
  return { failure, published }
}

async function executeProtocolFailure(
  workflow: Exclude<Workflow, 'tool' | 'explicit-learning' | 'automatic-learning'>,
  send: ReturnType<typeof harness>['send'],
  privateText: string,
  prepared: { previewId?: string; expectedRevision?: number },
) {
  const methods = {
    'admin-edit': ['memory/v1/upsert', { access: admin, entry: { scope: { kind: 'project', project }, logicalKey: 'edit-target', kind: 'memory', text: privateText, tags: [], createdAt } }],
    'admin-delete': ['memory/v1/delete-entry', { access: admin, scope: { kind: 'project', project }, logicalKey: 'delete-target' }],
    'admin-clear': ['memory/v1/clear-project', { access: admin, project }],
    dream: ['memory/v1/consolidate-dream', {
      access: { origin: 'consolidation', canonicalProject: project, memoryReadEnabled: false, memoryWriteEnabled: false, temporary: false },
      scope: { kind: 'project', project }, operationId: 'fault-dream', force: true,
    }],
    import: ['memory/v1/import-apply', {
      access: admin, bundle: bundle('import-target', privateText), mode: 'skip', operationId: 'fault-import',
      previewId: prepared.previewId, expectedRevision: prepared.expectedRevision,
    }],
  } satisfies Record<typeof workflow, [string, Record<string, unknown>]>
  const [method, params] = methods[workflow]
  const response = await send(method, params)
  assert.ok(response.error, `${workflow} must return an error`)
  return response
}

async function runOneFailure(workflow: Workflow, mode: FaultMode, index: number) {
  const databasePath = join(root, `fault-${index}.sqlite`)
  let fault: Error | undefined
  const store = await SqliteDurableMemoryStore.open(databasePath, undefined, {
    beforeCommitWrite: () => { if (fault) throw fault },
  })
  const { messages, send } = harness(store)
  await send('initialize', { protocolVersion: PI_HOST_PROTOCOL_VERSION, capabilities: ['memory-store-v1'] })
  const privateText = `private-${workflow}-${mode}`
  const prepared = await prepareWorkflow(workflow, store, send, privateText)
  const baselineRevision = await store.revision()
  const messageStart = messages.length
  if (mode === 'forced-close') await store.close()
  else fault = injectedFailure(mode)

  const observed = workflow === 'tool'
    ? await executeToolFailure(store, privateText)
    : workflow === 'explicit-learning' || workflow === 'automatic-learning'
      ? await executeLearningFailure(store, workflow === 'explicit-learning' ? 'explicit' : 'automatic', privateText)
      : await executeProtocolFailure(workflow, send, privateText, prepared)

  const newMessages = messages.slice(messageStart)
  assert.equal(newMessages.some((message) => 'event' in message && message.event === 'memory/changed'), false)
  assert.equal(JSON.stringify({ observed, newMessages }).includes(privateText), false, `${workflow}/${mode} failure payload leaked private text`)
  assert.deepEqual('published' in observed ? observed.published : [], [])
  fault = undefined
  if (mode !== 'forced-close') await store.close()
  const restarted = await SqliteDurableMemoryStore.open(databasePath)
  assert.equal(await restarted.revision(), baselineRevision, `${workflow}/${mode} advanced revision without commit`)
  await restarted.close()
}

async function failureMatrix() {
  let index = 0
  for (const workflow of workflows) {
    for (const mode of faultModes) await runOneFailure(workflow, mode, index++)
  }
}

class FixtureHost {
  readonly child
  readonly lines
  readonly messages: any[] = []

  constructor(databasePath: string, hold = false, busyTimeoutMs = 250) {
    this.child = spawn(process.execPath, ['--experimental-strip-types', resolve(import.meta.dirname, 'memory-host-contention-fixture.mts'), databasePath, hold ? 'hold' : 'normal', String(busyTimeoutMs)], {
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    this.lines = createInterface({ input: this.child.stdout })
    this.lines.on('line', (line) => this.messages.push(JSON.parse(line)))
  }

  send(value: unknown) { this.child.stdin.write(`${JSON.stringify(value)}\n`) }

  async waitFor(predicate: (message: any) => boolean, label: string) {
    const deadline = Date.now() + 10_000
    for (;;) {
      const found = this.messages.find(predicate)
      if (found) return found
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error(`timed out waiting for ${label}`)
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        once(this.lines, 'line'),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), remaining) }),
      ]).finally(() => { if (timer) clearTimeout(timer) })
    }
  }

  response(id: number) { return this.waitFor((message) => message.id === id, `response ${id}`) }

  async stop(id: number) {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return
    this.send({ id, method: 'lifecycle/shutdown', params: {} })
    await this.response(id)
    this.child.stdin.end()
    if (this.child.exitCode === null && this.child.signalCode === null) await once(this.child, 'exit')
  }
}

const concurrentAccess = (callId: string): MemoryAccessContext => ({
  origin: 'runtime', canonicalProject: project, memoryReadEnabled: true, memoryWriteEnabled: true,
  temporary: false, runId: 'concurrent-run', sessionId: 'concurrent-session', callId,
})
const concurrentEntry = (logicalKey: string, text: string) => ({
  scope: { kind: 'project', project }, logicalKey, kind: 'memory', text, tags: ['concurrent'], createdAt,
})

async function initializeFixture(host: FixtureHost, id: number) {
  await host.waitFor((message) => message.fixture === 'ready', 'fixture readiness')
  host.send({ id, method: 'initialize', params: { protocolVersion: PI_HOST_PROTOCOL_VERSION, capabilities: ['memory-store-v1'] } })
  assert.equal((await host.response(id)).error, undefined)
}

async function contentionMatrix() {
  const databasePath = join(root, 'contention.sqlite')
  const initialized = await SqliteDurableMemoryStore.open(databasePath)
  await initialized.close()
  const first = new FixtureHost(databasePath)
  const second = new FixtureHost(databasePath)
  try {
    await initializeFixture(first, 1)
    await initializeFixture(second, 1)
    const same = { method: 'memory/v1/upsert', params: { access: concurrentAccess('same-operation'), entry: concurrentEntry('same-key', 'same payload') } }
    first.send({ id: 2, ...same })
    second.send({ id: 2, ...same })
    const sameResults = await Promise.all([first.response(2), second.response(2)])
    assert.deepEqual(sameResults.map((response) => response.result?.memoryStore?.revision), [1, 1])
    assert.equal(new Set(sameResults.map((response) => response.result?.memoryStore?.entry?.id)).size, 1)

    first.send({ id: 3, method: 'memory/v1/upsert', params: { access: concurrentAccess('distinct-a'), entry: concurrentEntry('distinct-a', 'A') } })
    second.send({ id: 3, method: 'memory/v1/upsert', params: { access: concurrentAccess('distinct-b'), entry: concurrentEntry('distinct-b', 'B') } })
    const revisions = (await Promise.all([first.response(3), second.response(3)])).map((response) => response.result?.memoryStore?.revision).sort()
    assert.deepEqual(revisions, [2, 3])
  } finally {
    await Promise.all([first.stop(90), second.stop(91)])
  }

  const holder = new FixtureHost(databasePath, true, 250)
  const contender = new FixtureHost(databasePath, false, 25)
  try {
    await initializeFixture(holder, 10)
    await initializeFixture(contender, 10)
    holder.send({ id: 11, method: 'memory/v1/upsert', params: { access: concurrentAccess('held'), entry: concurrentEntry('held', 'held private body') } })
    await holder.waitFor((message) => message.fixture === 'transaction-held', 'held transaction evidence')
    contender.send({ id: 11, method: 'memory/v1/upsert', params: { access: concurrentAccess('busy'), entry: concurrentEntry('busy-refused', 'busy private body') } })
    const refused = await contender.response(11)
    assert.equal(refused.error?.code, 'unavailable')
    assert.equal(JSON.stringify(refused).includes('busy private body'), false)
    assert.equal(contender.messages.some((message) => message.event === 'memory/changed' && message.payload.logicalKey === 'busy-refused'), false)
    holder.send({ control: 'release' })
    assert.equal((await holder.response(11)).result?.memoryStore?.revision, 4)
    contender.send({ id: 12, method: 'memory/v1/upsert', params: { access: concurrentAccess('after-busy'), entry: concurrentEntry('after-busy', 'recovered') } })
    assert.equal((await contender.response(12)).result?.memoryStore?.revision, 5)
  } finally {
    await Promise.all([holder.stop(92), contender.stop(93)])
  }

  const verified = await SqliteDurableMemoryStore.open(databasePath)
  const page = await verified.list({ access: admin, scope: { kind: 'project', project }, limit: 100 })
  assert.equal(page.total, 5)
  assert.equal(new Set(page.items.map((entry) => entry.logicalKey)).size, 5)
  assert.equal(page.items.some((entry) => entry.logicalKey === 'busy-refused'), false)
  await verified.close()
  const audit = new DatabaseSync(databasePath, { readOnly: true })
  const operationIds = audit.prepare('SELECT operation_id FROM memory_operations WHERE operation_id IS NOT NULL').all() as Array<{ operation_id: string }>
  const integrity = audit.prepare('PRAGMA integrity_check(1)').get() as { integrity_check?: string }
  audit.close()
  assert.equal(new Set(operationIds.map((row) => row.operation_id)).size, operationIds.length)
  assert.equal(integrity.integrity_check, 'ok')
}

async function crashDurabilityMatrix() {
  const databasePath = join(root, 'crash-workflows.sqlite')
  const child = spawn(process.execPath, ['--experimental-strip-types', resolve(import.meta.dirname, 'memory-workflow-crash-fixture.mts'), databasePath], {
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const lines = createInterface({ input: child.stdout })
  let acknowledged: { fixture: string; revision: number } | undefined
  lines.on('line', (line) => {
    const parsed = JSON.parse(line)
    if (parsed.fixture === 'acknowledged') acknowledged = parsed
  })
  while (!acknowledged) await once(lines, 'line')
  child.kill('SIGKILL')
  await once(child, 'exit')

  const restarted = await SqliteDurableMemoryStore.open(databasePath)
  assert.equal(await restarted.revision(), acknowledged.revision)
  const page = await restarted.list({ access: admin, limit: 100 })
  const byKey = new Map(page.items.map((entry) => [entry.logicalKey, entry]))
  for (const key of ['tool-write', 'explicit-learning', 'automatic-learning', 'profile:user', 'admin-edit', 'imported']) assert.ok(byKey.has(key), key)
  assert.equal(byKey.get('admin-edit')?.text, 'admin edited body')
  assert.equal(byKey.has('delete-me'), false)
  assert.equal(byKey.has('clear-me'), false)
  assert.equal(new Set(page.items.map((entry) => `${entry.scope.kind}:${entry.logicalKey}`)).size, page.items.length)
  const dream = await restarted.list({ access: admin, scope: { kind: 'project', project: canonicalProjectId('/workspace/failure-matrix-dream') }, limit: 100 })
  assert.equal(dream.total, 1)
  await restarted.close()

  const audit = new DatabaseSync(databasePath, { readOnly: true })
  const metadata = JSON.stringify(audit.prepare('SELECT operation, scope_kind, project_id, logical_key, provenance_json FROM memory_operations').all())
  audit.close()
  assert.equal(metadata.includes('deleted private body'), false)
  assert.equal(metadata.includes('cleared private body'), false)
  const bytes = await readFile(databasePath)
  assert.equal(bytes.includes(Buffer.from('deleted private body')), false)
  assert.equal(bytes.includes(Buffer.from('cleared private body')), false)
}

async function validationAndPrivacyMatrix() {
  const databasePath = join(root, 'privacy.sqlite')
  const store = await SqliteDurableMemoryStore.open(databasePath)
  const { messages, send } = harness(store)
  await send('initialize', { protocolVersion: PI_HOST_PROTOCOL_VERSION, capabilities: ['memory-store-v1'] })
  const credential = 'api_key=sk-proj-abcdefghijklmnopqrstuvwxyz'
  const access: MemoryAccessContext = {
    origin: 'runtime', canonicalProject: project, memoryReadEnabled: true, memoryWriteEnabled: true,
    temporary: false, runId: 'privacy-run', sessionId: 'privacy-session', callId: 'privacy-call',
  }
  setPiMemoryBridge(createPiDurableMemoryBridge(store))
  bindPiSessionRun(access.sessionId!, { runId: access.runId!, memoryAccess: access })
  const tool = await executePiPackTool('memory_set', { key: 'credential-tool', text: credential }, {
    sessionId: access.sessionId!, runId: access.runId!, cwd: project,
  }, { callId: access.callId! })
  unbindPiSessionRun(access.sessionId!)
  assert.equal((tool.data as { code?: string } | undefined)?.code, 'forbidden')

  await assert.rejects(settlePiRunLearning({
    store,
    candidate: {
      mode: 'explicit', memory: { id: 'credential-learning', project, text: credential, tags: [], createdAt },
      access: { runId: 'privacy-learning', sessionId: 'privacy-learning', canonicalProject: project, memoryReadEnabled: true, memoryWriteEnabled: true, temporary: false },
    },
    outcome: { status: 'success', executionKind: 'loop' },
  }), /Protected credential/)
  for (const [logicalKey, kind] of [['profile:user', 'profile'], ['memory:document', 'document']] as const) {
    const response = await send('memory/v1/upsert', { access: admin, entry: { scope: { kind: 'global' }, logicalKey, kind, text: credential, tags: [], createdAt } })
    assert.equal(response.error?.code, 'forbidden')
  }
  const invalidImport = await send('memory/v1/import-preview', { access: admin, bundle: bundle('credential-import', credential), mode: 'skip' })
  assert.equal(invalidImport.result?.memoryStore?.preview?.counts.invalid, 1)
  const legacy = await send('memory/add', { memory: { id: 'credential-legacy', text: credential, tags: [], createdAt } })
  assert.ok(legacy.error, 'legacy bridge must not turn sanitizer rejection into success')
  assert.equal(JSON.stringify(messages).includes(credential), false)

  const receipt = asTurnRecordMemoryWrite({
    operation: 'set', id: 'memory-1', logicalKey: 'safe-key', scope: 'project', revision: 1,
    runId: 'run', sessionId: 'session', callId: 'call', text: credential, authorization: 'Bearer private',
  }) as unknown as Record<string, unknown>
  assert.deepEqual(Object.keys(receipt).sort(), ['callId', 'id', 'logicalKey', 'operation', 'revision', 'runId', 'scope', 'sessionId'].sort())
  assert.equal(JSON.stringify(receipt).includes(credential), false)
  assert.match(DURABLE_MEMORY_PLAINTEXT_WARNING, /plaintext.*not encrypted/i)
  const capability = await store.deletionCapability()
  assert.equal(capability.mode, 'best-effort')
  assert.equal(capability.limitations.some((line) => /SSD|snapshot|backup/i.test(line)), true)
  await store.close()

  const limited = await SqliteDurableMemoryStore.open(join(root, 'quota-privacy.sqlite'), { maxEntriesPerScope: 1 })
  await limited.upsert({ access: admin, scope: { kind: 'global' }, logicalKey: 'quota-seed', kind: 'memory', text: 'seed', tags: [], createdAt })
  await assert.rejects(limited.upsert({
    access: admin, scope: { kind: 'global' }, logicalKey: 'profile:user', kind: 'profile',
    text: 'special entry cannot bypass quota', tags: [], createdAt,
  }), (error: unknown) => (error as { code?: unknown })?.code === 'quota_exceeded')
  const quotaBundle = bundle('quota-import', 'import cannot bypass quota')
  const quotaPreview = await limited.previewImport({ access: admin, bundle: quotaBundle, mode: 'skip' })
  assert.equal(quotaPreview.counts.quota, 1)
  await assert.rejects(limited.applyImport({
    access: admin, bundle: quotaBundle, mode: 'skip', operationId: 'quota-import',
    previewId: quotaPreview.previewId, expectedRevision: quotaPreview.revision,
  }), (error: unknown) => (error as { code?: unknown })?.code === 'quota_exceeded')
  const migrated = await limited.migrateLegacy({
    access: { origin: 'migration', memoryReadEnabled: false, memoryWriteEnabled: false, temporary: false },
    sourceHash: 'a'.repeat(64), sourceSchema: 2,
    memories: [{ id: 'quota-legacy', text: 'legacy cannot bypass quota', tags: [], createdAt }],
  })
  assert.deepEqual(migrated.report.rejected, [{ index: 0, code: 'quota_exceeded' }])
  assert.equal(migrated.report.imported, 0)
  await limited.close()
}

try {
  await failureMatrix()
  await contentionMatrix()
  await crashDurabilityMatrix()
  await validationAndPrivacyMatrix()
  console.log('memory failure matrix: all write origins, crash durability, contention, rollback and privacy passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
