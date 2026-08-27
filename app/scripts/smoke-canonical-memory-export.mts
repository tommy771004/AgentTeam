import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canonicalProjectId,
  DurableMemoryStoreError,
  type MemoryAccessContext,
} from '../electron/durableMemoryStore.ts'
import { createPiHostServer, PI_HOST_PROTOCOL_VERSION, type PiHostMessage } from '../electron/piHostProtocol.ts'
import { SqliteDurableMemoryStore } from '../electron/sqliteDurableMemoryStore.ts'

type Response = Extract<PiHostMessage, { id: string | number }>

const stateDir = await mkdtemp(join(tmpdir(), 'subagents-canonical-memory-export-'))
try {
  const store = await SqliteDurableMemoryStore.open(join(stateDir, 'memory.sqlite'))
  const messages: PiHostMessage[] = []
  const server = createPiHostServer((message) => messages.push(message), undefined, undefined, undefined, undefined, store)
  const send = async (id: number, method: string, params: Record<string, unknown> = {}): Promise<Response> => {
    await server.handle({ id, method, params })
    const response = messages.find((message): message is Response => 'id' in message && message.id === id)
    assert.ok(response, `missing response for ${method}`)
    return response
  }
  const admin: MemoryAccessContext = {
    origin: 'admin', memoryReadEnabled: false, memoryWriteEnabled: false, temporary: true,
  }
  const alpha = canonicalProjectId('/workspace/export-alpha')
  const beta = canonicalProjectId('/workspace/export-beta')
  const runtime: MemoryAccessContext = {
    origin: 'runtime', canonicalProject: alpha,
    memoryReadEnabled: true, memoryWriteEnabled: true, temporary: false,
    runId: 'run-export', sessionId: 'session-export', callId: 'call-export-alpha',
  }

  assert.equal((await send(1, 'initialize', {
    protocolVersion: PI_HOST_PROTOCOL_VERSION,
    capabilities: ['memory-store-v1'],
  })).error, undefined)

  const write = (id: number, access: MemoryAccessContext, entry: Record<string, unknown>) =>
    send(id, 'memory/v1/upsert', { access, entry })
  await write(2, admin, {
    scope: { kind: 'global' }, logicalKey: 'profile:user', kind: 'profile',
    text: '請使用繁體中文', tags: ['always-recall', '語言'], createdAt: '2026-08-27T00:00:00.000Z',
  })
  await write(3, admin, {
    scope: { kind: 'global' }, logicalKey: 'memory:document', kind: 'document',
    text: '共享規範', tags: ['always-recall'], createdAt: '2026-08-27T00:01:00.000Z',
  })
  await write(4, runtime, {
    scope: { kind: 'project', project: alpha }, logicalKey: '相同-key', kind: 'memory',
    text: 'Alpha 的 Unicode 記憶', tags: ['臺灣', 'TypeScript'], createdAt: '2026-08-27T00:02:00.000Z',
  })
  await write(5, admin, {
    scope: { kind: 'project', project: beta }, logicalKey: '相同-key', kind: 'memory',
    text: 'Beta memory', tags: ['beta'], createdAt: '2026-08-27T00:03:00.000Z',
  })
  await write(6, admin, {
    scope: { kind: 'project', project: beta }, logicalKey: 'deleted', kind: 'memory',
    text: 'must never return from audit metadata', tags: ['deleted'], createdAt: '2026-08-27T00:04:00.000Z',
  })
  await send(7, 'memory/v1/delete-entry', {
    access: admin, scope: { kind: 'project', project: beta }, logicalKey: 'deleted',
  })

  const exported = await send(8, 'memory/v1/export', { access: admin })
  assert.equal(exported.error, undefined)
  const bundle = exported.result?.memoryStore?.bundle
  assert.ok(bundle)
  assert.equal(bundle.schema, 'subagents.durable-memory')
  assert.equal(bundle.version, 1)
  assert.equal(bundle.revision, 6)
  assert.ok(Date.parse(bundle.generatedAt))
  assert.equal(bundle.privacy.plaintext, true)
  assert.match(bundle.privacy.warning, /plaintext/i)
  assert.equal(bundle.entries.length, 4)
  assert.equal(JSON.stringify(bundle).includes('must never return'), false)
  assert.deepEqual(
    bundle.entries.filter((entry) => entry.logicalKey === '相同-key').map((entry) => entry.scope),
    [{ kind: 'project', project: alpha }, { kind: 'project', project: beta }],
  )
  const alphaEntry = bundle.entries.find((entry) => entry.text === 'Alpha 的 Unicode 記憶')
  assert.deepEqual(alphaEntry?.tags, ['臺灣', 'TypeScript'])
  assert.deepEqual(alphaEntry?.provenance, {
    origin: 'runtime', operation: 'upsert', runId: 'run-export', sessionId: 'session-export', callId: 'call-export-alpha',
  })

  const snapshotPath = join(stateDir, 'concurrent-snapshot.sqlite')
  let concurrentWriter: SqliteDurableMemoryStore
  const snapshotReader = await SqliteDurableMemoryStore.open(snapshotPath, undefined, {
    afterExportEntriesRead: async () => {
      await concurrentWriter.upsert({
        access: admin, scope: { kind: 'global' }, logicalKey: 'during-export', kind: 'memory',
        text: 'committed while read snapshot is open', tags: ['concurrent'], createdAt: '2026-08-27T00:06:00.000Z',
      })
    },
  })
  concurrentWriter = await SqliteDurableMemoryStore.open(snapshotPath)
  await snapshotReader.upsert({
    access: admin, scope: { kind: 'global' }, logicalKey: 'before-export', kind: 'memory',
    text: 'visible in snapshot', tags: ['snapshot'], createdAt: '2026-08-27T00:05:00.000Z',
  })
  const concurrentBundle = await snapshotReader.exportBundle({ access: admin })
  assert.equal(await concurrentWriter.revision(), 2)
  assert.equal(concurrentBundle.revision, 1)
  assert.deepEqual(concurrentBundle.entries.map((entry) => entry.logicalKey), ['before-export'])
  assert.equal(concurrentBundle.entries.every((entry) => entry.revision <= concurrentBundle.revision), true)

  const emptyStore = await SqliteDurableMemoryStore.open(join(stateDir, 'empty.sqlite'))
  const emptyMessages: PiHostMessage[] = []
  const emptyServer = createPiHostServer((message) => emptyMessages.push(message), undefined, undefined, undefined, undefined, emptyStore)
  await emptyServer.handle({ id: 20, method: 'initialize', params: { protocolVersion: PI_HOST_PROTOCOL_VERSION, capabilities: ['memory-store-v1'] } })
  await emptyServer.handle({ id: 21, method: 'memory/v1/export', params: { access: admin } })
  const empty = emptyMessages.find((message): message is Response => 'id' in message && message.id === 21)
  assert.deepEqual(empty?.result?.memoryStore?.bundle?.entries, [])
  assert.equal(empty?.result?.memoryStore?.bundle?.revision, 0)

  const boundedStore = await SqliteDurableMemoryStore.open(join(stateDir, 'bounded.sqlite'), {
    maxExportEntries: 1,
  })
  await boundedStore.upsert({
    access: admin, scope: { kind: 'global' }, logicalKey: 'one', kind: 'memory',
    text: 'one', tags: [], createdAt: '2026-08-27T01:00:00.000Z',
  })
  await boundedStore.upsert({
    access: admin, scope: { kind: 'global' }, logicalKey: 'two', kind: 'memory',
    text: 'two', tags: [], createdAt: '2026-08-27T01:01:00.000Z',
  })
  await assert.rejects(
    boundedStore.exportBundle({ access: admin }),
    (error: unknown) => error instanceof DurableMemoryStoreError && error.code === 'invalid_input',
  )

  await boundedStore.close()
  await emptyStore.close()
  await concurrentWriter.close()
  await snapshotReader.close()
  await store.close()
  console.log('canonical memory export: protocol bundle, scopes, special entries, provenance, privacy, and empty store passed')
} finally {
  await rm(stateDir, { recursive: true, force: true })
}
