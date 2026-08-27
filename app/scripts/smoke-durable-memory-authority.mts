import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canonicalProjectId,
  DurableMemoryStoreError,
  InMemoryDurableMemoryStore,
  type DurableMemoryLimits,
  type DurableMemoryStore,
  type MemoryAccessContext,
  type MemoryScope,
} from '../electron/durableMemoryStore.ts'
import { SqliteDurableMemoryStore } from '../electron/sqliteDurableMemoryStore.ts'

type StoreFactory = (limits?: Partial<DurableMemoryLimits>) => Promise<DurableMemoryStore> | DurableMemoryStore
const expectCode = (code: DurableMemoryStoreError['code']) => (error: unknown) => error instanceof DurableMemoryStoreError && error.code === code

async function runAuthorityContract(createStore: StoreFactory): Promise<void> {
  const alpha = canonicalProjectId('/workspace/authority-alpha')
  const beta = canonicalProjectId('/workspace/authority-beta')
  const alphaScope: MemoryScope = { kind: 'project', project: alpha }
  const betaScope: MemoryScope = { kind: 'project', project: beta }
  const globalScope: MemoryScope = { kind: 'global' }
  const runtime = (project = alpha, overrides: Partial<MemoryAccessContext> = {}): MemoryAccessContext => ({
    origin: 'runtime', canonicalProject: project, memoryReadEnabled: true, memoryWriteEnabled: true,
    temporary: false, runId: 'run-authority', sessionId: 'session-authority', callId: 'call-authority', ...overrides,
  })
  const admin: MemoryAccessContext = { origin: 'admin', memoryReadEnabled: false, memoryWriteEnabled: false, temporary: true }
  const store = await createStore()
  const setInput = {
    access: runtime(), scope: alphaScope, logicalKey: 'same-key', kind: 'memory' as const,
    text: 'alpha value', tags: ['alpha'], createdAt: '2026-08-27T00:00:00.000Z',
  }
  const first = await store.upsert(setInput)
  const retried = await store.upsert(setInput)
  assert.equal(retried.id, first.id)
  assert.equal(retried.revision, first.revision)
  assert.equal(await store.revision(), 1)
  await assert.rejects(store.upsert({ ...setInput, text: 'conflicting retry' }), expectCode('invalid_input'))
  assert.equal(await store.revision(), 1)

  const appendInput = {
    ...setInput, access: runtime(alpha, { callId: 'call-append' }), text: 'second line', tags: ['second'],
    createdAt: '2026-08-27T00:01:00.000Z',
  }
  const appended = await store.append(appendInput)
  const appendRetry = await store.append(appendInput)
  assert.equal(appendRetry.revision, appended.revision)
  assert.equal(appendRetry.text, 'alpha value\nsecond line')
  assert.equal((appendRetry.text.match(/second line/g) || []).length, 1)

  await store.upsert({ ...setInput, access: runtime(beta), scope: betaScope, text: 'beta value' })
  assert.equal((await store.get({ access: runtime(beta), scope: betaScope, logicalKey: 'same-key' }))?.text, 'beta value')
  await assert.rejects(store.get({ access: runtime(), scope: betaScope, logicalKey: 'same-key' }), expectCode('forbidden'))
  await assert.rejects(store.list({ access: runtime(), scope: betaScope }), expectCode('forbidden'))
  await assert.rejects(store.delete({ access: runtime(), scope: betaScope, logicalKey: 'same-key' }), expectCode('forbidden'))
  await assert.rejects(store.clear({ access: runtime(), scope: alphaScope }), expectCode('forbidden'))
  await assert.rejects(store.recall({ access: runtime(alpha, { temporary: true }), query: 'alpha' }), expectCode('forbidden'))
  await assert.rejects(store.upsert({ ...setInput, access: runtime(alpha, { temporary: true, callId: 'temporary' }) }), expectCode('forbidden'))
  await assert.rejects(store.recall({ access: runtime(alpha, { memoryReadEnabled: false }), query: 'alpha' }), expectCode('forbidden'))
  await assert.rejects(store.upsert({ ...setInput, access: runtime(alpha, { memoryWriteEnabled: false, callId: 'write-off' }) }), expectCode('forbidden'))
  assert.equal((await store.list({ access: admin })).total, 2)
  assert.equal((await store.clear({ access: admin, scope: betaScope })).changed, 1)
  await assert.rejects(store.recall({ access: { ...admin, origin: 'migration' }, query: 'alpha' }), expectCode('forbidden'))
  await assert.rejects(store.upsert({ ...setInput, access: { ...admin, origin: 'consolidation' } }), expectCode('forbidden'))

  const revisionBeforeSecret = await store.revision()
  await assert.rejects(store.upsert({
    ...setInput, access: runtime(alpha, { callId: 'secret' }), logicalKey: 'secret',
    text: 'Authorization: Bearer sk-proj-abcdefghijklmnopqrstuvwxyz',
  }), expectCode('forbidden'))
  await assert.rejects(store.upsert({
    ...setInput, access: admin, logicalKey: 'admin-secret', text: 'password=hunter2',
  }), expectCode('forbidden'))
  await assert.rejects(store.importBundle({
    access: { ...admin, origin: 'migration' }, mode: 'merge',
    bundle: {
      version: 1, revision: 0, entries: [{
        id: 'import-secret', scope: globalScope, logicalKey: 'import-secret', kind: 'memory',
        text: 'api_key=sk-proj-abcdefghijklmnopqrstuvwxyz', tags: [], createdAt: '2026-08-27T00:00:00.000Z',
        updatedAt: '2026-08-27T00:00:00.000Z', revision: 0,
      }],
    },
  }), expectCode('forbidden'))
  await assert.rejects(store.consolidate({
    access: { ...runtime(), origin: 'consolidation' }, scope: alphaScope, sourceKeys: ['same-key'],
    merged: { logicalKey: 'merged-secret', kind: 'memory', text: 'secret_key=abcdefghijklmnopqrstuvwxyz', tags: [], createdAt: '2026-08-27T00:06:00.000Z' },
  }), expectCode('forbidden'))
  assert.equal(await store.revision(), revisionBeforeSecret)
  for (const invalid of [
    { ...setInput, access: runtime(alpha, { callId: 'invalid-key' }), logicalKey: '  ' },
    { ...setInput, access: runtime(alpha, { callId: 'long-key' }), logicalKey: 'x'.repeat(257) },
    { ...setInput, access: runtime(alpha, { callId: 'invalid-text' }), logicalKey: 'bad-text', text: '' },
    { ...setInput, access: runtime(alpha, { callId: 'long-text' }), logicalKey: 'long-text', text: 'x'.repeat(32_769) },
    { ...setInput, access: runtime(alpha, { callId: 'invalid-tag' }), logicalKey: 'bad-tag', tags: ['x'.repeat(65)] },
    { ...setInput, access: runtime(alpha, { callId: 'many-tags' }), logicalKey: 'many-tags', tags: Array.from({ length: 33 }, (_, index) => `tag-${index}`) },
    { ...setInput, access: runtime(alpha, { callId: 'invalid-time' }), logicalKey: 'bad-time', createdAt: 'yesterday' },
  ]) await assert.rejects(store.upsert(invalid), expectCode('invalid_input'))
  await assert.rejects(store.list({ access: runtime(), limit: 101 }), expectCode('invalid_input'))
  for (const cursor of ['-1', '1suffix', '1.5', '9007199254740992']) {
    await assert.rejects(store.list({ access: runtime(), cursor }), expectCode('invalid_input'))
  }
  for (const invalid of [
    { ...setInput, tags: [42] },
    { ...setInput, scope: { kind: 'invalid', project: alpha } },
    { ...setInput, text: null },
    { ...setInput, scope: globalScope, logicalKey: 'memory:document', kind: 'invalid' },
  ]) await assert.rejects(store.upsert(invalid as never), expectCode('invalid_input'))
  await assert.rejects(store.upsert({ ...setInput, access: { ...runtime(), memoryWriteEnabled: 'false' } } as never), expectCode('invalid_input'))
  await assert.rejects(store.upsert({
    ...setInput, access: admin, scope: globalScope, logicalKey: 'profile:user', kind: 'profile',
    tags: Array.from({ length: 32 }, (_, index) => `profile-tag-${index}`),
  }), expectCode('invalid_input'))
  const emptyBundle = { version: 1 as const, revision: 0, entries: [] }
  await assert.rejects(store.importBundle({ access: admin, mode: 'invalid' as never, bundle: emptyBundle }), expectCode('invalid_input'))
  await assert.rejects(store.importBundle({ access: admin, mode: 'merge', bundle: { ...emptyBundle, entries: [null] } } as never), expectCode('invalid_input'))

  const collisionBase = { ...setInput, logicalKey: 'identity-delimiters' }
  await store.upsert({ ...collisionBase, access: runtime(alpha, { runId: 'a:b', callId: 'c' }), text: 'first operation' })
  const distinct = await store.upsert({ ...collisionBase, access: runtime(alpha, { runId: 'a', callId: 'b:c' }), text: 'distinct operation' })
  assert.equal(distinct.text, 'distinct operation')
  const prose = await store.upsert({ ...setInput, access: admin, logicalKey: 'security-guidance', text: 'Use a password manager and review API key rotation policy.' })
  assert.equal(prose.text, 'Use a password manager and review API key rotation policy.')
  for (const text of ['{"api_key":"opaque-credential"}', '{"Authorization":"Bearer opaque-credential"}']) {
    await assert.rejects(store.upsert({ ...setInput, access: admin, logicalKey: 'quoted-secret', text }), expectCode('forbidden'))
  }

  const importLimited = await createStore({ maxImportBatch: 1 })
  await assert.rejects(importLimited.importBundle({
    access: { ...admin, origin: 'migration' }, mode: 'merge',
    bundle: {
      version: 1, revision: 0,
      entries: ['one', 'two'].map((logicalKey) => ({
        id: logicalKey, scope: globalScope, logicalKey, kind: 'memory' as const, text: logicalKey, tags: [],
        createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z', revision: 0,
      })),
    },
  }), expectCode('invalid_input'))
  await importLimited.close()

  const limited = await createStore({ maxEntriesPerScope: 2 })
  for (const [index, key] of ['one', 'two'].entries()) await limited.upsert({
    ...setInput, access: runtime(alpha, { callId: `quota-${key}` }), logicalKey: key, text: key,
    createdAt: `2026-08-27T00:0${index}:00.000Z`,
  })
  await assert.rejects(limited.upsert({
    ...setInput, access: runtime(alpha, { callId: 'quota-three' }), logicalKey: 'three', text: 'three',
  }), expectCode('quota_exceeded'))
  await limited.upsert({ ...setInput, access: runtime(beta, { callId: 'quota-beta' }), scope: betaScope, logicalKey: 'one', text: 'beta one' })
  await limited.upsert({ ...setInput, access: runtime(alpha, { callId: 'quota-global' }), scope: globalScope, logicalKey: 'global-one', text: 'global one' })
  const consolidation = {
    access: { ...runtime(), origin: 'consolidation' as const }, scope: alphaScope,
    sourceKeys: [] as string[], merged: { logicalKey: 'merged', kind: 'memory' as const, text: 'merged', tags: [], createdAt: setInput.createdAt },
  }
  const beforeEmptyConsolidation = await limited.revision()
  await assert.rejects(limited.consolidate(consolidation), expectCode('invalid_input'))
  assert.equal(await limited.revision(), beforeEmptyConsolidation)
  const consolidated = await limited.consolidate({
    ...consolidation, sourceKeys: ['one', ' one '], merged: { ...consolidation.merged, logicalKey: ' merged ' },
  })
  assert.equal(consolidated.changed, 2)
  assert.equal((await limited.get({ access: runtime(), scope: alphaScope, logicalKey: 'merged' }))?.id, consolidated.entry.id)
  assert.equal((await limited.list({ access: runtime(), scope: alphaScope })).total, 2)
  const sameKeyMerge = await limited.consolidate({ ...consolidation, sourceKeys: ['merged'] })
  assert.notEqual(sameKeyMerge.entry.id, consolidated.entry.id, 'a consolidated replacement gets a fresh identity even when its key matches a deleted source')
  const scopedMerge = await limited.consolidate({
    ...consolidation, sourceKeys: ['merged'], merged: { ...consolidation.merged, scope: betaScope },
  } as never)
  assert.deepEqual(scopedMerge.entry.scope, alphaScope, 'merged input cannot override the authorized scope')
  assert.equal((await limited.list({ access: runtime(beta), scope: betaScope })).total, 1)
  await limited.close()
  // A delayed retry must not return deleted content or undo a newer write.
  const delayedRetry = await store.upsert(setInput)
  assert.equal(delayedRetry.text, 'alpha value\nsecond line')
  assert.equal(delayedRetry.revision, appended.revision)
  await store.delete({ access: runtime(), scope: alphaScope, logicalKey: 'same-key' })
  const deletedRevision = await store.revision()
  await assert.rejects(store.upsert(setInput), expectCode('not_found'))
  await assert.rejects(store.append(appendInput), expectCode('not_found'))
  assert.equal(await store.revision(), deletedRevision)
  assert.equal(await store.get({ access: runtime(), scope: alphaScope, logicalKey: 'same-key' }), undefined)
  await store.close()
}

const temp = await mkdtemp(join(tmpdir(), 'subagents-memory-authority-'))
try {
  const target = join(temp, 'target')
  const alias = join(temp, 'alias')
  await mkdir(target)
  await symlink(target, alias, 'dir')
  assert.equal(canonicalProjectId(`${alias}/`), canonicalProjectId(target))
  assert.equal(canonicalProjectId(join(alias, 'missing-child')), canonicalProjectId(join(target, 'missing-child')))
  const nested = join(target, 'nested')
  const nestedAlias = join(temp, 'nested-alias')
  await mkdir(nested)
  await symlink(nested, nestedAlias, 'dir')
  assert.equal(canonicalProjectId(`${nestedAlias}/..`), canonicalProjectId(target))
  await runAuthorityContract((limits) => new InMemoryDurableMemoryStore(limits))
  let sqliteIndex = 0
  await runAuthorityContract((limits) => SqliteDurableMemoryStore.open(join(temp, `authority-${sqliteIndex++}.sqlite`), limits))
  console.log('durable memory authority: scope, policy, idempotency, validation, quota, sanitizer, and realpath passed')
} finally {
  await rm(temp, { recursive: true, force: true })
}
