import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalProjectId, type MemoryAccessContext } from '../electron/durableMemoryStore.ts'
import { SqliteDurableMemoryStore } from '../electron/sqliteDurableMemoryStore.ts'
import { createPiHostServer, type PiHostMessage } from '../electron/piHostProtocol.ts'
import { createPiDurableMemoryBridge } from '../electron/piDurableMemory.ts'
import { setPiMemoryBridge } from '../electron/piPackBridges.ts'
import { bindPiSessionRun, executePiPackTool, unbindPiSessionRun } from '../electron/piToolHost.ts'

const directory = await mkdtemp(join(tmpdir(), 'pi-memory-consumers-'))
const database = join(directory, 'memory.sqlite')
const store = await SqliteDurableMemoryStore.open(database)
const project = canonicalProjectId(directory)
const access: MemoryAccessContext = { origin: 'runtime', canonicalProject: project, memoryReadEnabled: true, memoryWriteEnabled: true, temporary: false, runId: 'run', sessionId: 'session' }
const admin: MemoryAccessContext = { origin: 'admin', memoryReadEnabled: false, memoryWriteEnabled: false, temporary: false }
const messages: PiHostMessage[] = []
const snapshots: unknown[] = []
const server = createPiHostServer((message) => messages.push(message), undefined, (snapshot) => snapshots.push(snapshot), undefined, undefined, store)
const ctx = { sessionId: 'session', runId: 'run', cwd: '/untrusted/other-project' }
let call = 0
async function tool(name: string, args: Record<string, unknown>, callId = `call-${++call}`) {
  const result = await executePiPackTool(name, args, ctx, { callId })
  return { ...result, data: result.data as {
    ok?: boolean
    code?: string
    id?: string
    memoryWrite?: {
      operation: 'set' | 'append'
      id: string
      logicalKey: string
      scope: 'project'
      revision: number
      runId: string
      sessionId: string
      callId: string
    }
  } | undefined }
}
function bind(overrides: Partial<MemoryAccessContext> = {}) {
  bindPiSessionRun('session', { runId: 'run', memoryAccess: { ...access, ...overrides } })
}

try {
  await server.handle({ id: 1, method: 'initialize', params: { protocolVersion: 5, capabilities: ['memory-store-v1'] } })
  bind()
  const set = await tool('memory_set', { key: 'rule', text: 'Use Traditional Chinese' }, 'set-rule')
  assert.equal(set.data?.ok, true)
  assert.deepEqual(set.data?.memoryWrite, {
    operation: 'set', id: 'memory-1', logicalKey: 'rule', scope: 'project', revision: 1,
    runId: 'run', sessionId: 'session', callId: 'set-rule',
  })
  assert.equal((await store.get({ access: admin, scope: { kind: 'project', project }, logicalKey: 'rule' }))?.text, 'Use Traditional Chinese')
  assert.equal((await tool('memory_get', { id: 'rule' })).data?.ok, true)
  const appended = await tool('memory_append', { text: 'Append exactly once' }, 'append-once')
  assert.equal(appended.data?.ok, true)
  assert.equal(appended.data?.memoryWrite?.operation, 'append')
  const retriedAppend = await tool('memory_append', { text: 'Append exactly once' }, 'append-once')
  assert.equal(retriedAppend.data?.memoryWrite?.id, appended.data?.memoryWrite?.id)
  assert.equal(retriedAppend.data?.memoryWrite?.revision, appended.data?.memoryWrite?.revision)
  assert.equal((await store.list({ access: admin })).total, 2)

  await store.upsert({ access: admin, scope: { kind: 'project', project: canonicalProjectId('/other-project') }, kind: 'memory', logicalKey: 'secret-other-project', text: 'Other project private note', tags: [], createdAt: '2026-08-27T00:00:00.000Z' })
  assert.equal((await tool('memory_get', { id: 'secret-other-project' })).data?.ok, false)
  assert.equal(JSON.stringify(await tool('memory_search', { query: 'private' })).includes('Other project private note'), false)
  for (const disabled of [{ memoryReadEnabled: false, memoryWriteEnabled: false }, { temporary: true }]) {
    bind(disabled)
    const deniedGet = await tool('memory_get', { id: 'rule' })
    assert.equal(deniedGet.data?.ok, false)
    assert.equal(deniedGet.data?.code, 'forbidden')
    assert.equal((await tool('memory_search', { query: 'Chinese' })).data?.ok, false)
    assert.equal((await tool('memory_set', { key: 'denied', text: 'must not commit' })).data?.ok, false)
  }
  bind({ memoryWriteEnabled: false })
  assert.equal((await tool('memory_get', { id: 'rule' })).data?.ok, true)
  const deniedAppend = await tool('memory_append', { text: 'must not commit' })
  assert.equal(deniedAppend.data?.ok, false)
  assert.equal(deniedAppend.data?.code, 'forbidden')
  bind()
  const invalid = await tool('memory_set', { key: 'x'.repeat(257), text: 'must not commit' })
  assert.equal(invalid.data?.ok, false)
  assert.equal(invalid.data?.code, 'invalid_input')
  unbindPiSessionRun('session')
  assert.equal((await tool('memory_set', { key: 'detached', text: 'must not commit' })).data?.ok, false)
  assert.equal((await store.list({ access: admin })).total, 3)
  const changes = messages.filter((message) => 'event' in message && message.event === 'memory/changed')
  assert.equal(changes.length, 2, 'only the committed pack writes publish, not retry or denials')
  assert.equal(JSON.stringify(changes).includes('Traditional Chinese'), false, 'change events omit private text')
  const written = messages.filter((message) => 'event' in message && message.event === 'host/context' && message.payload.phase === 'memory-written')
  assert.equal(written.length, 2, 'committed pack writes publish one metadata-only context event each')
  assert.deepEqual(written.map((message) => 'event' in message ? {
    operation: message.payload.operation,
    logicalKey: message.payload.logicalKey,
    revision: message.payload.revision,
    callId: message.payload.callId,
  } : undefined), [
    { operation: 'set', logicalKey: 'rule', revision: 1, callId: 'set-rule' },
    { operation: 'append', logicalKey: 'mem-run-append-once', revision: 2, callId: 'append-once' },
  ])
  assert.equal(JSON.stringify(written).includes('Traditional Chinese'), false, 'context events omit private text')

  await server.handle({ id: 2, method: 'memory/list' as never })
  const listed = messages.find((message) => 'id' in message && message.id === 2)
  assert.equal(listed && 'error' in listed ? listed.error?.code : undefined, 'unknown_method')
  assert.ok(snapshots.every((snapshot) => !Object.hasOwn(snapshot as object, 'memories')), 'state callbacks never contain a memory collection')

  const quotaStore = await SqliteDurableMemoryStore.open(join(directory, 'quota.sqlite'), { maxEntriesPerScope: 1 })
  try {
    setPiMemoryBridge(createPiDurableMemoryBridge(quotaStore))
    bind()
    assert.equal((await tool('memory_set', { key: 'quota-one', text: 'first entry' }, 'quota-one')).data?.ok, true)
    const quota = await tool('memory_set', { key: 'quota-two', text: 'must not commit' }, 'quota-two')
    assert.equal(quota.data?.ok, false)
    assert.equal(quota.data?.code, 'quota_exceeded')
    assert.equal(await quotaStore.revision(), 1, 'quota failure does not advance revision')
  } finally {
    await quotaStore.close()
  }
  bind()
  const closedPackStore = await tool('memory_set', { key: 'closed', text: 'must not commit' }, 'closed-store')
  assert.equal(closedPackStore.data?.ok, false)
  assert.equal(closedPackStore.data?.code, 'closed')
  unbindPiSessionRun('session')

  await server.handle({ id: 3, method: 'sessions/create', params: {} })
  const created = messages.find((message) => 'id' in message && message.id === 3)
  const sessionId = created && 'result' in created ? created.result?.sessionId : undefined
  assert.ok(sessionId)
  await server.handle({ id: 4, method: 'turn/submit', params: { sessionId, runId: 'bad-scope', prompt: 'test', contextPolicy: { memoryEnabled: false, project: 'invalid\u0000project' } } })
  await server.handle({ id: 5, method: 'runs/active', params: {} })
  const active = messages.find((message) => 'id' in message && message.id === 5)
  assert.equal(JSON.stringify(active).includes('bad-scope'), false, 'failed scope admission must not leave a running attachment')
  await store.close()
  await server.handle({ id: 6, method: 'turn/submit', params: { sessionId, runId: 'closed-memory', cwd: project, prompt: 'test', contextPolicy: { memoryEnabled: true, project } } })
  await server.handle({ id: 7, method: 'runs/active', params: {} })
  const afterFailure = messages.find((message) => 'id' in message && message.id === 7)
  assert.ok(afterFailure && 'result' in afterFailure)
  assert.equal(afterFailure.result?.activeRuns?.some((run) => run.runId === 'closed-memory'), false, 'async memory failure must settle the run before releasing its binding')
  assert.equal(afterFailure.result?.terminalRuns?.find((run) => run.runId === 'closed-memory')?.settlement, 'failed')
  const restarted = await SqliteDurableMemoryStore.open(database)
  try { assert.equal((await restarted.list({ access: admin })).total, 3) } finally { await restarted.close() }
  console.log('Pi memory consumers: shared SQLite, scoped pack policy, commit-before-success, retry, and no JSON writes passed')
} finally {
  unbindPiSessionRun('session')
  await store.close()
  await rm(directory, { recursive: true, force: true })
}
