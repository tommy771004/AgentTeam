import assert from 'node:assert/strict'
import { canonicalProjectId, InMemoryDurableMemoryStore, type MemoryAccessContext, type MemoryScope } from '../electron/durableMemoryStore.ts'
import { createPiHostServer, PI_HOST_PROTOCOL_VERSION, type PiHostMessage } from '../electron/piHostProtocol.ts'

const messages: PiHostMessage[] = []
const store = new InMemoryDurableMemoryStore()
const server = createPiHostServer((message) => messages.push(message), undefined, undefined, undefined, undefined, store)
let nextId = 1
async function request(method: string, params: Record<string, unknown>): Promise<Extract<PiHostMessage, { id: string | number }>> {
  const id = nextId++
  await server.handle({ id, method, params })
  const response = messages.find((message): message is Extract<PiHostMessage, { id: string | number }> => 'id' in message && message.id === id)
  assert.ok(response, `missing response for ${method}`)
  return response
}
const expectForbidden = async (method: string, params: Record<string, unknown>) => assert.equal((await request(method, params)).error?.code, 'forbidden')

await request('initialize', { protocolVersion: PI_HOST_PROTOCOL_VERSION, capabilities: ['memory-store-v1'] })
const currentProject = canonicalProjectId('/workspace/matrix-current')
const otherProject = canonicalProjectId('/workspace/matrix-other')
const runtime: MemoryAccessContext = {
  origin: 'runtime', canonicalProject: currentProject, memoryReadEnabled: true, memoryWriteEnabled: true,
  temporary: false, runId: 'run-matrix', sessionId: 'session-matrix', callId: 'seed-runtime',
}
const admin: MemoryAccessContext = { origin: 'admin', memoryReadEnabled: false, memoryWriteEnabled: false, temporary: true }
const scope = { kind: 'project' as const, project: currentProject }
const otherScope = { kind: 'project' as const, project: otherProject }
const entry = (logicalKey: string, target: MemoryScope = scope, text = logicalKey) => ({
  scope: target, logicalKey, kind: 'memory', text, tags: ['matrix'], createdAt: '2026-08-27T01:00:00.000Z',
})

await request('memory/v1/upsert', { access: admin, entry: { ...entry('global'), scope: { kind: 'global' } } })
await request('memory/v1/upsert', { access: admin, entry: entry('current') })
await request('memory/v1/upsert', { access: admin, entry: entry('other', otherScope) })
assert.equal((await request('memory/v1/get', { access: runtime, scope: { kind: 'global' }, logicalKey: 'global' })).result?.memoryStore?.entry?.text, 'global')
assert.equal((await request('memory/v1/get', { access: runtime, scope, logicalKey: 'current' })).result?.memoryStore?.operation, 'get')
assert.equal((await request('memory/v1/recall', { access: runtime, query: 'matrix', limit: 10 })).result?.memoryStore?.recall?.items.some((item) => item.logicalKey === 'other'), false)
await expectForbidden('memory/v1/get', { access: runtime, scope: otherScope, logicalKey: 'other' })
await expectForbidden('memory/v1/list', { access: runtime, scope: otherScope })
await expectForbidden('memory/v1/upsert', { access: { ...runtime, callId: 'other-set' }, entry: entry('blocked-set', otherScope) })
await expectForbidden('memory/v1/append', { access: { ...runtime, callId: 'other-append' }, entry: entry('other', otherScope, 'blocked append') })
await expectForbidden('memory/v1/delete', { access: runtime, scope: otherScope, logicalKey: 'other' })
await expectForbidden('memory/v1/clear', { access: runtime, scope })

const readOff = { ...runtime, memoryReadEnabled: false }
await expectForbidden('memory/v1/get', { access: readOff, scope, logicalKey: 'current' })
await expectForbidden('memory/v1/recall', { access: readOff, query: 'matrix' })
const writeOff = { ...runtime, memoryWriteEnabled: false }
await expectForbidden('memory/v1/upsert', { access: { ...writeOff, callId: 'write-off-set' }, entry: entry('write-off') })
await expectForbidden('memory/v1/append', { access: { ...writeOff, callId: 'write-off-append' }, entry: entry('current', scope, 'blocked') })
await expectForbidden('memory/v1/delete', { access: writeOff, scope, logicalKey: 'current' })

const temporary = { ...runtime, temporary: true }
await expectForbidden('memory/v1/get', { access: temporary, scope, logicalKey: 'current' })
await expectForbidden('memory/v1/recall', { access: temporary, query: 'matrix' })
await expectForbidden('memory/v1/upsert', { access: { ...temporary, callId: 'temp-set' }, entry: entry('temp') })
await expectForbidden('memory/v1/append', { access: { ...temporary, callId: 'temp-append' }, entry: entry('current', scope, 'blocked') })
await expectForbidden('memory/v1/delete', { access: temporary, scope, logicalKey: 'current' })
await expectForbidden('memory/v1/clear', { access: temporary, scope })

assert.equal((await request('memory/v1/list', { access: admin })).result?.memoryStore?.page?.total, 3)
assert.equal((await request('memory/v1/get', { access: admin, scope: otherScope, logicalKey: 'other' })).result?.memoryStore?.entry?.text, 'other')
assert.equal((await request('memory/v1/append', { access: admin, entry: entry('other', otherScope, 'admin append') })).result?.memoryStore?.entry?.text, 'other\nadmin append')
assert.equal((await request('memory/v1/delete', { access: admin, scope: otherScope, logicalKey: 'other' })).result?.memoryStore?.mutation?.changed, 1)
assert.equal((await request('memory/v1/clear', { access: admin, scope })).result?.memoryStore?.mutation?.changed, 1)

for (const origin of ['migration', 'consolidation'] as const) {
  const denied = { ...admin, origin }
  await expectForbidden('memory/v1/get', { access: denied, scope: { kind: 'global' }, logicalKey: 'global' })
  await expectForbidden('memory/v1/recall', { access: denied, query: 'matrix' })
  await expectForbidden('memory/v1/upsert', { access: denied, entry: entry(`${origin}-set`) })
  await expectForbidden('memory/v1/append', { access: denied, entry: entry('global', { kind: 'global' } as const, 'blocked') })
  await expectForbidden('memory/v1/delete', { access: denied, scope: { kind: 'global' }, logicalKey: 'global' })
  await expectForbidden('memory/v1/clear', { access: denied, scope: { kind: 'all' } })
}

const revisions = messages
  .filter((message): message is Extract<PiHostMessage, { event: 'memory/changed' }> => 'event' in message && message.event === 'memory/changed')
  .map((event) => event.payload.revision)
assert.deepEqual(revisions, [1, 2, 3, 4, 5, 6])

for (const params of [{ limit: '10' }, { limit: null }, { cursor: 3 }, { cursor: '2suffix' }]) {
  assert.equal((await request('memory/v1/list', { access: admin, ...params })).error?.code, 'invalid_request')
}
assert.equal((await request('memory/v1/recall', { access: admin, query: 'matrix', limit: '10' })).error?.code, 'invalid_request')

// Full cross-product, not only representative flag combinations. Ordinary
// runtime clear is always denied; recall has no caller-selectable project.
let matrixCases = 0
for (const origin of ['runtime', 'admin', 'migration', 'consolidation'] as const) {
  for (const memoryReadEnabled of [true, false]) {
    for (const memoryWriteEnabled of [true, false]) {
      for (const temporary of [true, false]) {
        const access = { ...runtime, origin, memoryReadEnabled, memoryWriteEnabled, temporary }
        for (const target of [{ kind: 'global' } as const, scope, otherScope]) {
          assert.equal((await request('memory/v1/upsert', { access: admin, entry: entry('matrix-probe', target) })).error, undefined)
          for (const operation of ['get', 'list', 'recall', 'upsert', 'append', 'delete', 'clear'] as const) {
            const read = ['get', 'list', 'recall'].includes(operation)
            const scopeAllowed = operation === 'recall' || target !== otherScope
            const allowed = origin === 'admin' || (origin === 'runtime' && !temporary && operation !== 'clear' && scopeAllowed && (read ? memoryReadEnabled : memoryWriteEnabled))
            const beforeRevision = await store.revision()
            const eventCount = messages.filter((message) => 'event' in message && message.event === 'memory/changed').length
            const response = await request(`memory/v1/${operation}`, {
              access: { ...access, callId: `matrix-${matrixCases++}` },
              scope: target, logicalKey: 'matrix-probe', query: 'matrix', entry: entry('matrix-probe', target),
            })
            const label = JSON.stringify({ origin, memoryReadEnabled, memoryWriteEnabled, temporary, target, operation })
            assert.equal(response.error?.code, allowed ? undefined : 'forbidden', label)
            if (!allowed) {
              assert.equal(await store.revision(), beforeRevision, label)
              assert.equal(messages.filter((message) => 'event' in message && message.event === 'memory/changed').length, eventCount, label)
            }
            if (origin === 'runtime' && operation === 'recall' && allowed) {
              assert.equal(response.result?.memoryStore?.recall?.items.some((item) => item.scope.kind === 'project' && item.scope.project === otherProject), false, label)
            }
          }
        }
      }
    }
  }
}
await store.close()
console.log(`Pi Host durable memory policy matrix passed (${matrixCases} combinations)`)
