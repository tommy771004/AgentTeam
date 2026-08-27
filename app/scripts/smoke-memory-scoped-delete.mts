import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  canonicalProjectId,
  InMemoryDurableMemoryStore,
  type MemoryAccessContext,
} from '../electron/durableMemoryStore.ts'
import { createPiHostServer, PI_HOST_PROTOCOL_VERSION, type PiHostMessage } from '../electron/piHostProtocol.ts'
import { SqliteDurableMemoryStore } from '../electron/sqliteDurableMemoryStore.ts'
import { confirmMemoryClear, memoryClearConfirmation } from '../src/agent/memoryDeletion.ts'

const messages: PiHostMessage[] = []
const store = new InMemoryDurableMemoryStore()
const server = createPiHostServer((message) => messages.push(message), undefined, undefined, undefined, undefined, store)
let nextId = 1
async function request(method: string, params: Record<string, unknown>) {
  const id = nextId++
  await server.handle({ id, method, params })
  const response = messages.find((message): message is Extract<PiHostMessage, { id: string | number }> => 'id' in message && message.id === id)
  assert.ok(response, `missing response for ${method}`)
  return response
}

await request('initialize', { protocolVersion: PI_HOST_PROTOCOL_VERSION, capabilities: ['memory-store-v1'] })
const alpha = canonicalProjectId('/workspace/delete-alpha')
const beta = canonicalProjectId('/workspace/delete-beta')
const admin: MemoryAccessContext = { origin: 'admin', memoryReadEnabled: false, memoryWriteEnabled: false, temporary: true }
const runtime: MemoryAccessContext = {
  origin: 'runtime', canonicalProject: alpha, memoryReadEnabled: true, memoryWriteEnabled: true,
  temporary: false, runId: 'delete-run', sessionId: 'delete-session', callId: 'delete-call',
}
const createdAt = '2026-08-27T00:00:00.000Z'
const upsert = (logicalKey: string, scope: { kind: 'global' } | { kind: 'project'; project: typeof alpha }, kind: 'memory' | 'profile' | 'document' = 'memory') =>
  request('memory/v1/upsert', { access: admin, entry: { scope, logicalKey, kind, text: `body-${logicalKey}`, tags: ['delete-smoke'], createdAt } })

await upsert('global-note', { kind: 'global' })
await upsert('profile:user', { kind: 'global' }, 'profile')
await upsert('memory:document', { kind: 'global' }, 'document')
await upsert('alpha-one', { kind: 'project', project: alpha })
await upsert('alpha-two', { kind: 'project', project: alpha })
await upsert('beta-one', { kind: 'project', project: beta as typeof alpha })

assert.equal((await request('memory/v1/delete-entry', { access: admin, scope: { kind: 'project', project: alpha }, logicalKey: 'alpha-one' })).result?.memoryStore?.operation, 'delete-entry')
assert.equal((await request('memory/v1/clear-project', { access: admin, project: alpha })).result?.memoryStore?.mutation?.changed, 1)
assert.equal((await request('memory/v1/get', { access: admin, scope: { kind: 'project', project: beta }, logicalKey: 'beta-one' })).result?.memoryStore?.entry?.text, 'body-beta-one')
assert.equal((await request('memory/v1/clear-global', { access: admin })).result?.memoryStore?.mutation?.changed, 1)
assert.equal((await request('memory/v1/get', { access: admin, scope: { kind: 'global' }, logicalKey: 'profile:user' })).result?.memoryStore?.entry?.kind, 'profile')
assert.equal((await request('memory/v1/get', { access: admin, scope: { kind: 'global' }, logicalKey: 'memory:document' })).result?.memoryStore?.entry?.kind, 'document')
assert.equal((await request('memory/v1/clear-all', { access: admin })).result?.memoryStore?.mutation?.changed, 3)
assert.equal((await request('memory/v1/list', { access: admin })).result?.memoryStore?.page?.total, 0)

for (const method of ['memory/v1/clear-project', 'memory/v1/clear-global', 'memory/v1/clear-all', 'memory/v1/deletion-capability']) {
  const params = method.endsWith('project') ? { access: runtime, project: alpha } : { access: runtime }
  assert.equal((await request(method, params)).error?.code, 'forbidden', `${method} must be admin-only`)
}
assert.equal((await request('memory/v1/clear-global', { access: admin, scope: { kind: 'project', project: beta } })).error?.code, 'invalid_request')
assert.equal((await request('memory/v1/clear-all', { access: admin, project: beta })).error?.code, 'invalid_request')
assert.equal((await request('memory/v1/deletion-capability', { access: admin })).result?.memoryStore?.operation, 'deletion-capability')

const typedEvents = messages
  .filter((message): message is Extract<PiHostMessage, { event: 'memory/changed' }> => 'event' in message && message.event === 'memory/changed')
  .map((message) => message.payload.operation)
assert.deepEqual(typedEvents.slice(-4), ['delete-entry', 'clear-project', 'clear-global', 'clear-all'])

let mutationCalls = 0
assert.equal(await confirmMemoryClear(() => false, { operation: 'clear-all', scope: { kind: 'all' } }, 12, async () => { mutationCalls += 1 }), false)
assert.equal(mutationCalls, 0, 'cancelled confirmation must not call Host mutation')
assert.match(memoryClearConfirmation({ operation: 'clear-all', scope: { kind: 'all' } }, 12), /所有 scope.*12 筆.*USER profile.*memory document/s)
await store.close()

const stateDir = await mkdtemp(join(tmpdir(), 'subagents-memory-hard-delete-'))
try {
  const databasePath = join(stateDir, 'memory.sqlite')
  const sqlite = await SqliteDurableMemoryStore.open(databasePath)
  const markerText = 'deleted-private-body-8f4c7a'
  const markerTag = 'deleted-private-tag-51e2'
  await sqlite.upsert({
    access: admin, scope: { kind: 'project', project: alpha }, logicalKey: 'hard-delete-proof',
    kind: 'memory', text: markerText, tags: [markerTag], createdAt,
  })
  assert.equal((await sqlite.delete({ access: admin, scope: { kind: 'project', project: alpha }, logicalKey: 'hard-delete-proof' })).changed, 1)
  const capability = await sqlite.deletionCapability()
  assert.equal(capability.mode, 'best-effort')
  assert.equal(capability.secureDelete, true)
  assert.equal(capability.walCheckpoint, 'truncated')
  await sqlite.close()

  const restarted = await SqliteDurableMemoryStore.open(databasePath)
  assert.equal(await restarted.get({ access: admin, scope: { kind: 'project', project: alpha }, logicalKey: 'hard-delete-proof' }), undefined)
  await restarted.close()

  const databaseBytes = await readFile(databasePath)
  assert.equal(databaseBytes.includes(Buffer.from(markerText)), false)
  assert.equal(databaseBytes.includes(Buffer.from(markerTag)), false)
  const audit = new DatabaseSync(databasePath, { readOnly: true })
  const rows = audit.prepare("SELECT operation, scope_kind, project_id, logical_key, content_hash, provenance_json FROM memory_operations WHERE operation = 'delete'").all()
  audit.close()
  assert.equal(JSON.stringify(rows).includes(markerText), false)
  assert.equal(JSON.stringify(rows).includes(markerTag), false)
} finally {
  await rm(stateDir, { recursive: true, force: true })
}

console.log('scoped memory delete: typed authority, confirmation, isolation, audit, WAL, and restart passed')
