import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canonicalProjectId,
  InMemoryDurableMemoryStore,
  type DurableMemoryStore,
  type MemoryAccessContext,
} from '../electron/durableMemoryStore.ts'
import { createPiHostServer, PI_HOST_PROTOCOL_VERSION, type PiHostMessage } from '../electron/piHostProtocol.ts'
import { SqliteDurableMemoryStore } from '../electron/sqliteDurableMemoryStore.ts'

const alpha = canonicalProjectId('/workspace/dream-alpha')
const beta = canonicalProjectId('/workspace/dream-beta')
const admin: MemoryAccessContext = { origin: 'admin', memoryReadEnabled: false, memoryWriteEnabled: false, temporary: true }
const consolidation = (project = alpha): MemoryAccessContext => ({
  origin: 'consolidation', canonicalProject: project,
  memoryReadEnabled: false, memoryWriteEnabled: false, temporary: false,
})
const createdAt = (index: number) => `2026-08-27T00:${String(index).padStart(2, '0')}:00.000Z`

async function seed(store: DurableMemoryStore, count = 26) {
  for (let index = 0; index < count; index += 1) {
    await store.upsert({
      access: admin, scope: { kind: 'project', project: alpha }, logicalKey: `alpha-${index}`,
      kind: 'memory', text: `project convention number ${index}`, tags: ['auto'], createdAt: createdAt(index),
    })
  }
  await store.upsert({
    access: admin, scope: { kind: 'project', project: alpha }, logicalKey: 'alpha-duplicate',
    kind: 'memory', text: 'project convention number 0', tags: ['flush'], createdAt: createdAt(40),
  })
  await store.upsert({
    access: admin, scope: { kind: 'project', project: beta }, logicalKey: 'beta-safe',
    kind: 'memory', text: 'other project remains untouched', tags: ['auto'], createdAt: createdAt(41),
  })
  await store.upsert({
    access: admin, scope: { kind: 'global' }, logicalKey: 'profile:user', kind: 'profile',
    text: 'special profile remains untouched', tags: ['auto'], createdAt: createdAt(42),
  })
}

async function assertAtomicDream(open: () => Promise<DurableMemoryStore>) {
  for (const faultAt of ['after-source-read', 'after-source-delete', 'after-merged-write'] as const) {
    const store = await open()
    await seed(store)
    const before = await store.list({ access: admin, scope: { kind: 'project', project: alpha }, limit: 100 })
    await assert.rejects(store.consolidateDream({
      access: consolidation(), scope: { kind: 'project', project: alpha },
      operationId: `fault-${faultAt}`, faultAt,
    }), /Injected dream fault/)
    const afterFault = await store.list({ access: admin, scope: { kind: 'project', project: alpha }, limit: 100 })
    assert.equal(afterFault.revision, before.revision)
    assert.deepEqual(afterFault.items.map((entry) => entry.logicalKey).sort(), before.items.map((entry) => entry.logicalKey).sort())
    const success = await store.consolidateDream({
      access: consolidation(), scope: { kind: 'project', project: alpha }, operationId: `fault-${faultAt}`,
    })
    assert.equal(success.deduped.includes('alpha-duplicate'), true)
    assert.equal(success.merged, 12)
    assert.equal(success.changed, 14)
    const retry = await store.consolidateDream({
      access: consolidation(), scope: { kind: 'project', project: alpha }, operationId: `fault-${faultAt}`,
    })
    assert.equal(retry.alreadyApplied, true)
    assert.equal(retry.changed, 0)
    assert.equal((await store.list({ access: admin, scope: { kind: 'project', project: beta } })).total, 1)
    assert.equal((await store.get({ access: admin, scope: { kind: 'global' }, logicalKey: 'profile:user' }))?.kind, 'profile')
    await store.close()
  }
}

let memoryIndex = 0
await assertAtomicDream(async () => new InMemoryDurableMemoryStore())
const stateDir = await mkdtemp(join(tmpdir(), 'subagents-dream-consolidation-'))
try {
  await assertAtomicDream(() => SqliteDurableMemoryStore.open(join(stateDir, `dream-${memoryIndex++}.sqlite`)))
} finally {
  await rm(stateDir, { recursive: true, force: true })
}

const noOp = new InMemoryDurableMemoryStore()
await noOp.upsert({
  access: admin, scope: { kind: 'project', project: alpha }, logicalKey: 'decay-is-not-delete',
  kind: 'memory', text: 'old but unique', tags: ['auto'], createdAt: createdAt(0),
})
const noOpResult = await noOp.consolidateDream({
  access: consolidation(), scope: { kind: 'project', project: alpha }, operationId: 'no-op',
})
assert.equal(noOpResult.changed, 0)
assert.equal((await noOp.list({ access: admin, scope: { kind: 'project', project: alpha } })).total, 1)
await noOp.close()

const messages: PiHostMessage[] = []
const hostStore = new InMemoryDurableMemoryStore()
const server = createPiHostServer((message) => messages.push(message), undefined, undefined, undefined, undefined, hostStore)
let nextId = 1
async function request(method: string, params: Record<string, unknown>) {
  const id = nextId++
  await server.handle({ id, method, params })
  const response = messages.find((message): message is Extract<PiHostMessage, { id: string | number }> => 'id' in message && message.id === id)
  assert.ok(response)
  return response
}
await request('initialize', { protocolVersion: PI_HOST_PROTOCOL_VERSION, capabilities: ['memory-store-v1'] })
for (const [logicalKey, text] of [['one', 'same exact convention'], ['two', 'same exact convention'], ['three', 'unique third convention']]) {
  await request('memory/v1/upsert', { access: admin, entry: {
    scope: { kind: 'project', project: alpha }, logicalKey, kind: 'memory', text, tags: ['auto'], createdAt: createdAt(nextId),
  } })
}
const hostResult = await request('memory/v1/consolidate-dream', {
  access: consolidation(), scope: { kind: 'project', project: alpha }, operationId: 'host-dream-1',
})
assert.equal(hostResult.result?.memoryStore?.operation, 'consolidate-dream')
assert.equal(hostResult.result?.memoryStore?.consolidation?.deduped.length, 1)
assert.equal((await request('memory/v1/consolidate-dream', {
  access: consolidation(), scope: { kind: 'project', project: alpha }, operationId: 'host-dream-1',
})).result?.memoryStore?.consolidation?.alreadyApplied, true)
assert.equal((await request('memory/v1/consolidate-dream', {
  access: consolidation(), scope: { kind: 'project', project: beta }, operationId: 'cross-scope',
})).error?.code, 'forbidden')
const dreamEvents = messages.filter((message): message is Extract<PiHostMessage, { event: 'memory/changed' }> => 'event' in message && message.event === 'memory/changed' && message.payload.operation === 'consolidate-dream')
assert.equal(dreamEvents.length, 1)
await hostStore.close()

console.log('Host Dream consolidation: atomic faults, retry, no-op, scope isolation, retention and revision passed')
