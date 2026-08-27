import assert from 'node:assert/strict'
import {
  canonicalProjectId,
  DurableMemoryStoreError,
  InMemoryDurableMemoryStore,
  type MemoryAccessContext,
  type MemoryScope,
  type MemoryUpsertInput,
} from '../electron/durableMemoryStore.ts'

const alphaProjectId = canonicalProjectId('/workspace/alpha/')
const betaProjectId = canonicalProjectId('\\workspace\\beta')
const globalScope: MemoryScope = { kind: 'global' }
const projectAlpha: MemoryScope = { kind: 'project', project: alphaProjectId }
const projectBeta: MemoryScope = { kind: 'project', project: betaProjectId }
assert.equal(alphaProjectId, '/workspace/alpha')
assert.equal(betaProjectId, '/workspace/beta')
assert.throws(
  () => canonicalProjectId('   '),
  (error: unknown) => error instanceof DurableMemoryStoreError && error.code === 'invalid_input',
)

const runtimeAccess = (canonicalProject: typeof alphaProjectId): MemoryAccessContext => ({
  origin: 'runtime',
  canonicalProject,
  memoryReadEnabled: true,
  memoryWriteEnabled: true,
  temporary: false,
  runId: 'run-1',
  sessionId: 'session-1',
  callId: 'call-1',
})

const store = new InMemoryDurableMemoryStore()
await store.upsert({
  access: runtimeAccess(alphaProjectId),
  scope: globalScope,
  logicalKey: 'profile:user',
  kind: 'profile',
  text: 'Always answer in Traditional Chinese',
  tags: [],
  createdAt: '2026-08-20T00:00:00.000Z',
})
await store.upsert({
  access: runtimeAccess(alphaProjectId),
  scope: projectAlpha,
  logicalKey: 'style',
  kind: 'memory',
  text: 'Use strict TypeScript for Alpha',
  tags: ['typescript'],
  createdAt: '2026-08-21T00:00:00.000Z',
})
await store.upsert({
  access: runtimeAccess(betaProjectId),
  scope: projectBeta,
  logicalKey: 'style',
  kind: 'memory',
  text: 'Use JavaScript for Beta',
  tags: ['javascript'],
  createdAt: '2026-08-22T00:00:00.000Z',
})

const alphaHits = await store.recall({
  access: runtimeAccess(alphaProjectId),
  query: 'typescript unrelated',
  limit: 5,
  nowMs: Date.parse('2026-08-27T00:00:00.000Z'),
})
assert.deepEqual(alphaHits.items.map((item) => item.logicalKey), ['profile:user', 'style'])
assert.equal(alphaHits.items.some((item) => item.text.includes('Beta')), false)

const alphaStyle = await store.get({
  access: runtimeAccess(alphaProjectId),
  scope: projectAlpha,
  logicalKey: 'style',
})
const betaStyle = await store.get({
  access: runtimeAccess(betaProjectId),
  scope: projectBeta,
  logicalKey: 'style',
})
assert.equal(alphaStyle?.text, 'Use strict TypeScript for Alpha')
assert.equal(betaStyle?.text, 'Use JavaScript for Beta')
assert.deepEqual((await store.get({ access: runtimeAccess(alphaProjectId), scope: globalScope, logicalKey: 'profile:user' }))?.tags, [
  'profile:user',
  'always-recall',
])
await assert.rejects(
  store.upsert({
    access: runtimeAccess(alphaProjectId),
    scope: projectAlpha,
    logicalKey: 'profile:user',
    kind: 'profile',
    text: 'invalid project profile',
    tags: [],
    createdAt: '2026-08-20T00:00:00.000Z',
  } as unknown as MemoryUpsertInput),
  (error: unknown) => error instanceof DurableMemoryStoreError && error.code === 'invalid_input',
)
await assert.rejects(
  store.upsert({
    access: runtimeAccess(alphaProjectId),
    scope: globalScope,
    logicalKey: 'profile:user',
    kind: 'memory',
    text: 'must not overwrite the special profile',
    tags: [],
    createdAt: '2026-08-20T00:00:00.000Z',
  }),
  (error: unknown) => error instanceof DurableMemoryStoreError && error.code === 'invalid_input',
)
assert.equal((await store.get({ access: runtimeAccess(alphaProjectId), scope: globalScope, logicalKey: 'profile:user' }))?.kind, 'profile')

const alphaPage = await store.list({
  access: runtimeAccess(alphaProjectId),
  limit: 1,
})
assert.equal(alphaPage.items.length, 1)
assert.equal(alphaPage.total, 2)
assert.equal(alphaPage.revision, 3)
assert.equal(typeof alphaPage.nextCursor, 'string')
const alphaSecondPage = await store.list({
  access: runtimeAccess(alphaProjectId),
  limit: 1,
  cursor: alphaPage.nextCursor,
})
assert.equal(alphaSecondPage.items.length, 1)

const deleted = await store.delete({
  access: runtimeAccess(alphaProjectId),
  scope: projectAlpha,
  logicalKey: 'style',
})
assert.deepEqual(deleted, { changed: 1, revision: 4 })
assert.equal(await store.get({ access: runtimeAccess(alphaProjectId), scope: projectAlpha, logicalKey: 'style' }), undefined)

const cleared = await store.clear({
  access: runtimeAccess(betaProjectId),
  scope: projectBeta,
})
assert.deepEqual(cleared, { changed: 1, revision: 5 })
assert.equal((await store.list({ access: runtimeAccess(betaProjectId) })).total, 1)
assert.equal(await store.revision(), 5)

const lifecycleStore = new InMemoryDurableMemoryStore()
await lifecycleStore.upsert({
  access: runtimeAccess(alphaProjectId),
  scope: projectAlpha,
  logicalKey: 'old-a',
  kind: 'memory',
  text: 'Use pnpm for the Alpha project',
  tags: ['auto'],
  createdAt: '2026-08-01T00:00:00.000Z',
})
await lifecycleStore.upsert({
  access: runtimeAccess(alphaProjectId),
  scope: projectAlpha,
  logicalKey: 'old-b',
  kind: 'memory',
  text: 'Alpha checks packages with pnpm',
  tags: ['auto'],
  createdAt: '2026-08-02T00:00:00.000Z',
})
const consolidation = await lifecycleStore.consolidate({
  access: { ...runtimeAccess(alphaProjectId), origin: 'consolidation' },
  scope: projectAlpha,
  sourceKeys: ['old-a', 'old-b'],
  merged: {
    logicalKey: 'package-manager',
    kind: 'memory',
    text: 'Alpha uses pnpm for package management',
    tags: ['curated'],
    createdAt: '2026-08-27T00:00:00.000Z',
  },
})
assert.equal(consolidation.changed, 3)
assert.equal(consolidation.entry.logicalKey, 'package-manager')
assert.equal((await lifecycleStore.list({ access: runtimeAccess(alphaProjectId) })).total, 1)

const bundle = await lifecycleStore.exportBundle({
  access: { ...runtimeAccess(alphaProjectId), origin: 'admin' },
})
assert.equal(bundle.version, 1)
assert.equal(bundle.entries[0]?.logicalKey, 'package-manager')

const importedStore = new InMemoryDurableMemoryStore()
const imported = await importedStore.importBundle({
  access: { ...runtimeAccess(alphaProjectId), origin: 'migration' },
  bundle,
  mode: 'replace',
})
assert.deepEqual(imported, { changed: 1, revision: 1 })
assert.equal((await importedStore.get({
  access: runtimeAccess(alphaProjectId),
  scope: projectAlpha,
  logicalKey: 'package-manager',
}))?.text, 'Alpha uses pnpm for package management')

assert.deepEqual(await importedStore.health(), { status: 'ready', revision: 1 })
await importedStore.close()
assert.deepEqual(await importedStore.health(), { status: 'closed', revision: 1 })
await assert.rejects(
  importedStore.get({ access: runtimeAccess(alphaProjectId), scope: projectAlpha, logicalKey: 'package-manager' }),
  (error: unknown) => error instanceof DurableMemoryStoreError && error.code === 'closed',
)

const parityStore = new InMemoryDurableMemoryStore()
const parityAccess = runtimeAccess(alphaProjectId)
for (const fixture of [
  {
    scope: globalScope,
    logicalKey: 'profile:user',
    kind: 'profile' as const,
    text: 'Always answer in Traditional Chinese',
    tags: [],
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  {
    scope: globalScope,
    logicalKey: 'memory:document',
    kind: 'document' as const,
    text: 'Shared conventions use TypeScript',
    tags: [],
    createdAt: '2026-08-02T00:00:00.000Z',
  },
  {
    scope: projectAlpha,
    logicalKey: 'alpha-new',
    kind: 'memory' as const,
    text: 'Strict TypeScript in Alpha',
    tags: ['typescript', 'curated'],
    createdAt: '2026-08-26T00:00:00.000Z',
  },
  {
    scope: projectAlpha,
    logicalKey: 'alpha-old',
    kind: 'memory' as const,
    text: 'Strict TypeScript was already preferred',
    tags: ['curated'],
    createdAt: '2026-08-10T00:00:00.000Z',
  },
  {
    scope: projectAlpha,
    logicalKey: 'tag-only',
    kind: 'memory' as const,
    text: 'Alpha compiler preference',
    tags: ['typescript', 'tag-only-token'],
    createdAt: '2026-08-05T00:00:00.000Z',
  },
  {
    scope: projectAlpha,
    logicalKey: 'traditional-ui',
    kind: 'memory' as const,
    text: '介面一律使用繁體中文 UI',
    tags: ['ui', 'curated'],
    createdAt: '2026-08-24T00:00:00.000Z',
  },
  {
    scope: projectAlpha,
    logicalKey: 'unicode-style',
    kind: 'memory' as const,
    text: 'Café uses ＴｙｐｅＳｃｒｉｐｔ',
    tags: ['mixed-language'],
    createdAt: '2026-08-23T00:00:00.000Z',
  },
  {
    scope: projectAlpha,
    logicalKey: 'old-auto',
    kind: 'memory' as const,
    text: 'Legacy deployment used canary',
    tags: ['auto'],
    createdAt: '2026-08-06T00:00:00.000Z',
  },
  {
    scope: projectBeta,
    logicalKey: 'alpha-new',
    kind: 'memory' as const,
    text: 'Beta has an unrelated TypeScript rule',
    tags: ['typescript'],
    createdAt: '2026-08-27T00:00:00.000Z',
  },
]) {
  await parityStore.upsert({ access: parityAccess, ...fixture })
}

const ranked = await parityStore.recall({
  access: parityAccess,
  query: 'typescript',
  limit: 10,
  nowMs: Date.parse('2026-08-27T00:00:00.000Z'),
})
assert.deepEqual(ranked.items.map((item) => item.logicalKey), [
  'memory:document',
  'profile:user',
  'alpha-new',
  'tag-only',
  'alpha-old',
])
assert.equal(ranked.items.some((item) => item.text.includes('Beta')), false)
assert.equal(ranked.items.find((item) => item.logicalKey === 'profile:user')?.kind, 'profile')
assert.equal(ranked.items.find((item) => item.logicalKey === 'memory:document')?.kind, 'document')

const mixedLanguage = await parityStore.recall({ access: parityAccess, query: '繁體中文 ui', limit: 10 })
assert.equal(mixedLanguage.items.some((item) => item.logicalKey === 'traditional-ui'), true)
const tagOnly = await parityStore.recall({ access: parityAccess, query: 'tag-only-token', limit: 10 })
assert.equal(tagOnly.items.some((item) => item.logicalKey === 'tag-only'), true)
// Parity means preserving the current owner's plain lowercase behavior: this
// normalization mismatch is documented by the corpus, not silently improved.
const unicode = await parityStore.recall({ access: parityAccess, query: 'Cafe\u0301 typescript', limit: 10 })
assert.equal(unicode.items.some((item) => item.logicalKey === 'unicode-style'), false)

const oldAuto = (await parityStore.recall({
  access: parityAccess,
  query: 'canary',
  limit: 10,
  nowMs: Date.parse('2026-08-27T00:00:00.000Z'),
})).items.find((item) => item.logicalKey === 'old-auto')
assert.equal(oldAuto?.decayFactor, 0.125)
assert.equal(oldAuto?.stalenessNote, '（21 天前的自動記憶，使用前請先驗證現況）')
assert.equal(ranked.items.find((item) => item.logicalKey === 'alpha-new')?.decayFactor, 1)

const oneHit = await parityStore.recall({ access: parityAccess, query: 'typescript', limit: 1 })
assert.deepEqual(oneHit.items.map((item) => item.logicalKey), ['memory:document'])
oneHit.items[0]!.tags.push('mutated-outside-store')
assert.equal((await parityStore.get({ access: parityAccess, scope: globalScope, logicalKey: 'memory:document' }))?.tags.includes('mutated-outside-store'), false)

await assert.rejects(
  parityStore.importBundle({
    access: { ...parityAccess, origin: 'migration' },
    bundle: { version: 2, revision: 0, entries: [] } as unknown as Parameters<typeof parityStore.importBundle>[0]['bundle'],
    mode: 'merge',
  }),
  (error: unknown) => error instanceof DurableMemoryStoreError && error.code === 'invalid_bundle',
)

console.log('durable memory contract: scoped recall, lifecycle, consolidation and transfer')
