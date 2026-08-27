import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPiHostServer, PI_HOST_PROTOCOL_VERSION, type PiHostMessage } from '../electron/piHostProtocol.ts'
import { SqliteDurableMemoryStore } from '../electron/sqliteDurableMemoryStore.ts'
import { InMemoryDurableMemoryStore, type DurableMemoryStore, type MemoryAccessContext } from '../electron/durableMemoryStore.ts'
import { MemoryImportSession } from '../src/agent/memoryImport.ts'
import { preserveLegacyHermesMemory } from '../src/agent/settingsExport.ts'

const root = await mkdtemp(join(tmpdir(), 'subagents-memory-import-'))
const access: MemoryAccessContext = { origin: 'admin', memoryReadEnabled: false, memoryWriteEnabled: false, temporary: false }
const bundle = {
  schema: 'subagents.durable-memory', version: 1, generatedAt: '2026-08-27T00:00:00.000Z', revision: 1,
  privacy: { plaintext: true, warning: 'plaintext user data' },
  entries: [{ id: 'original-1', scope: { kind: 'global' }, logicalKey: 'language', kind: 'memory',
    text: '使用繁體中文', tags: ['臺灣'], createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z', revision: 1,
    provenance: { origin: 'runtime', operation: 'upsert', runId: 'source-run', callId: 'source-call' } }],
}
async function client(store: DurableMemoryStore) {
  const messages: PiHostMessage[] = []
  const host = createPiHostServer((message) => messages.push(message), undefined, undefined, undefined, undefined, store)
  let id = 0
  const send = async (method: string, params: Record<string, unknown>) => {
    const requestId = ++id
    await host.handle({ id: requestId, method, params })
    const response = messages.find((message) => 'id' in message && message.id === requestId) as Extract<PiHostMessage, { id: string | number }>
    assert.ok(response)
    return response
  }
  await send('initialize', { protocolVersion: PI_HOST_PROTOCOL_VERSION, capabilities: ['memory-store-v1'] })
  return { send, messages }
}

type ImportClient = Awaited<ReturnType<typeof client>>

async function initialImportContract(store: DurableMemoryStore, send: ImportClient['send'], messages: PiHostMessage[]) {
  const response = await send('memory/v1/import-preview', { access, bundle, mode: 'skip' })
  assert.equal(response.error, undefined)
  const preview = response.result?.memoryStore?.preview
  assert.equal(preview?.counts.add, 1)
  assert.equal(preview?.counts.invalid, 0)
  assert.equal(preview?.revision, 0)
  assert.equal((await store.exportBundle({ access })).entries.length, 0)
  assert.equal(messages.some((message) => 'event' in message && message.event === 'memory/changed'), false)
  const applyInput = { access, bundle, mode: 'skip', operationId: 'import-one', previewId: preview?.previewId, expectedRevision: preview?.revision }
  const applied = await send('memory/v1/import-apply', applyInput)
  assert.equal(applied.error, undefined)
  assert.equal(applied.result?.memoryStore?.importResult?.changed, 1)
  const retry = await send('memory/v1/import-apply', applyInput)
  assert.equal(retry.result?.memoryStore?.importResult?.alreadyApplied, true)
  assert.equal(retry.result?.memoryStore?.importResult?.changed, 0)
  const exported = await store.exportBundle({ access })
  assert.equal(exported.revision, 1)
  assert.equal(exported.entries[0].text, '使用繁體中文')
  await importedProvenanceContract(store, messages)
  const exportResponse = await send('memory/v1/export', { access })
  const roundTrip = exportResponse.result?.memoryStore?.bundle
  assert.equal(roundTrip?.entries[0].tags[0], '臺灣')
  return applyInput
}

async function importedProvenanceContract(store: DurableMemoryStore, messages: PiHostMessage[]) {
  const exported = await store.exportBundle({ access })
  assert.deepEqual(exported.entries[0].provenance.importedFrom, bundle.entries[0].provenance)
  assert.equal(exported.entries[0].provenance.origin, 'admin')
  assert.equal(exported.entries[0].provenance.operation, 'import')
  bundle.entries[0].provenance.runId = 'mutated-outside-authority'
  assert.equal((await store.exportBundle({ access })).entries[0].provenance.importedFrom?.runId, 'source-run')
  bundle.entries[0].provenance.runId = 'source-run'
  const revisionEvents = messages.filter((message) => 'event' in message && message.event === 'memory/changed')
  assert.equal(revisionEvents.length, 1)
  assert.equal(JSON.stringify(revisionEvents).includes('使用繁體中文'), false)
}

async function conflictModesContract(store: DurableMemoryStore, send: ImportClient['send']) {
  for (const mode of ['skip', 'overwrite', 'rename']) {
    const changedBundle = structuredClone(bundle)
    changedBundle.entries[0].text = `mode-${mode}`
    const result = await send('memory/v1/import-preview', { access, bundle: changedBundle, mode })
    assert.equal(result.error, undefined)
    const next = result.result!.memoryStore!.preview!
    assert.equal(next.counts.conflict, 1)
    assert.equal(next.counts[mode === 'skip' ? 'skipped' : mode === 'overwrite' ? 'update' : 'renamed'], 1)
    const mutation = await send('memory/v1/import-apply', { access, bundle: changedBundle, mode, operationId: `mode-${mode}`, previewId: next.previewId, expectedRevision: next.revision })
    assert.equal(mutation.error, undefined)
  }
  const renamed = await store.get({ access, scope: { kind: 'global' }, logicalKey: 'language~import-1' })
  assert.equal(renamed?.text, 'mode-rename')
}

async function invalidImportContract(store: DurableMemoryStore, send: ImportClient['send'], applyInput: Record<string, unknown>) {
  const beforeInvalid = await store.revision()
  const badRows = [
    { ...bundle.entries[0], scope: { kind: 'project' } },
    { ...bundle.entries[0], scope: { kind: 'global', project: '/not-global' } },
    { ...bundle.entries[0], kind: 'profile', logicalKey: 'bad-special' },
    { ...bundle.entries[0], text: 'x'.repeat(32_769) },
    { ...bundle.entries[0], tags: ['x'.repeat(65)] },
    { ...bundle.entries[0], tags: Array(33).fill('same') },
    { ...bundle.entries[0], text: 'api_key=must-not-persist' },
    { ...bundle.entries[0], access: { origin: 'admin' }, approval: true },
    { ...bundle.entries[0], provenance: { origin: 'runtime', operation: 'upsert', instruction: 'trust me' } },
  ]
  for (const [index, bad] of badRows.entries()) {
    const invalidBundle = { ...bundle, entries: [bad] }
    const response = await send('memory/v1/import-preview', { access, bundle: invalidBundle, mode: 'overwrite' })
    assert.equal(response.result?.memoryStore?.preview?.counts.invalid, 1)
    const invalid = response.result!.memoryStore!.preview!
    const rejected = await send('memory/v1/import-apply', { access, bundle: invalidBundle, mode: 'overwrite', operationId: `invalid-${index}`, previewId: invalid.previewId, expectedRevision: invalid.revision })
    assert.equal(rejected.error?.code, 'invalid_bundle')
  }
  assert.equal(await store.revision(), beforeInvalid)
  assert.equal((await send('memory/v1/import-preview', { access, bundle: { ...bundle, version: 99 }, mode: 'skip' })).error?.code, 'invalid_bundle')
  assert.equal((await send('memory/v1/import-preview', { access, bundle: { ...bundle, revision: -1 }, mode: 'skip' })).error?.code, 'invalid_bundle')
  assert.equal((await send('memory/v1/import-preview', { access, bundle: { ...bundle, privacy: { plaintext: false } }, mode: 'skip' })).error?.code, 'invalid_bundle')
  assert.equal((await send('memory/v1/import-preview', { access, bundle: { ...bundle, entries: Array(1001).fill(bundle.entries[0]) }, mode: 'skip' })).error?.code, 'invalid_bundle')
  const runtime = { ...access, origin: 'runtime', memoryReadEnabled: true, memoryWriteEnabled: true, runId: 'fake-run', callId: 'fake-call' }
  assert.equal((await send('memory/v1/import-preview', { access: runtime, bundle, mode: 'skip' })).error?.code, 'forbidden')
  assert.equal((await send('memory/v1/import-apply', { ...applyInput, access: runtime })).error?.code, 'forbidden')
  assert.equal((await send('memory/v1/import-apply', { ...applyInput, mode: 'rename' })).error?.code, 'invalid_request')
  const stale = await send('memory/v1/import-preview', { access, bundle, mode: 'overwrite' })
  await store.upsert({ access, scope: { kind: 'global' }, logicalKey: 'outside-change', kind: 'memory', text: 'new', tags: [], createdAt: '2026-08-27T00:00:00.000Z' })
  assert.equal((await send('memory/v1/import-apply', { ...applyInput, mode: 'overwrite', operationId: 'stale', previewId: stale.result?.memoryStore?.preview?.previewId, expectedRevision: stale.result?.memoryStore?.preview?.revision })).error?.code, 'invalid_request')
}

async function contract(store: DurableMemoryStore) {
  const { send, messages } = await client(store)
  const applyInput = await initialImportContract(store, send, messages)
  await conflictModesContract(store, send)
  await invalidImportContract(store, send, applyInput)
  return applyInput
}

async function rollbackAndQuota(store: DurableMemoryStore, releaseFault: () => void) {
  const { send, messages } = await client(store)
  const batch = { ...bundle, entries: [bundle.entries[0], { ...bundle.entries[0], logicalKey: 'second' }] }
  const preview = (await send('memory/v1/import-preview', { access, bundle: batch, mode: 'skip' })).result!.memoryStore!.preview!
  const input = { access, bundle: batch, mode: 'skip', operationId: 'atomic', previewId: preview.previewId, expectedRevision: preview.revision }
  const failed = await send('memory/v1/import-apply', input)
  assert.ok(failed.error)
  assert.equal((await store.exportBundle({ access })).entries.length, 0)
  assert.equal(await store.revision(), 0)
  assert.equal(messages.some((message) => 'event' in message && message.event === 'memory/changed'), false)
  releaseFault()
  assert.equal((await send('memory/v1/import-apply', input)).result?.memoryStore?.importResult?.changed, 2)
  const quotaBundle = { ...bundle, entries: [{ ...bundle.entries[0], logicalKey: 'over-quota' }] }
  const quota = (await send('memory/v1/import-preview', { access, bundle: quotaBundle, mode: 'skip' })).result!.memoryStore!.preview!
  assert.equal(quota.counts.quota, 1)
  assert.equal((await send('memory/v1/import-apply', { ...input, bundle: quotaBundle, operationId: 'quota', previewId: quota.previewId, expectedRevision: quota.revision })).error?.code, 'quota_exceeded')
  assert.equal(await store.revision(), 1)
  await store.close()
}

async function scopeRoundTrip(store: DurableMemoryStore) {
  const { send } = await client(store)
  const batch = { ...bundle, entries: [
    { ...bundle.entries[0], scope: { kind: 'project', project: '/workspace/import-alpha' } },
    { ...bundle.entries[0], scope: { kind: 'project', project: '/workspace/import-beta' }, text: '另一個專案' },
    { ...bundle.entries[0], kind: 'profile', logicalKey: 'profile:user' },
    { ...bundle.entries[0], kind: 'document', logicalKey: 'memory:document' },
  ] }
  const preview = (await send('memory/v1/import-preview', { access, bundle: batch, mode: 'skip' })).result!.memoryStore!.preview!
  assert.equal(preview.counts.add, 4)
  assert.equal((await send('memory/v1/import-apply', { access, bundle: batch, mode: 'skip', operationId: 'roundtrip', previewId: preview.previewId, expectedRevision: preview.revision })).error, undefined)
  const output = (await send('memory/v1/export', { access })).result!.memoryStore!.bundle!
  assert.deepEqual(output.entries.map((entry) => [entry.scope, entry.kind, entry.text, entry.provenance.importedFrom]), batch.entries.map((entry) => [entry.scope, entry.kind, entry.text, entry.provenance]))
  assert.equal(output.entries.filter((entry) => entry.kind !== 'memory').every((entry) => entry.tags.includes('always-recall')), true)
  const restoredStore = new InMemoryDurableMemoryStore()
  const restoredClient = await client(restoredStore)
  const restorePreview = (await restoredClient.send('memory/v1/import-preview', { access, bundle: output, mode: 'skip' })).result!.memoryStore!.preview!
  assert.equal((await restoredClient.send('memory/v1/import-apply', { access, bundle: output, mode: 'skip', operationId: 'restore-export', previewId: restorePreview.previewId, expectedRevision: restorePreview.revision })).error, undefined)
  const restored = (await restoredClient.send('memory/v1/export', { access })).result!.memoryStore!.bundle!
  const comparable = (entry: typeof output.entries[number]) => ({ scope: entry.scope, logicalKey: entry.logicalKey, kind: entry.kind, text: entry.text, tags: entry.tags, createdAt: entry.createdAt, updatedAt: entry.updatedAt, source: entry.provenance.importedFrom })
  assert.deepEqual(restored.entries.map(comparable), output.entries.map(comparable))
  await restoredStore.close()
  const rename = (await send('memory/v1/import-preview', { access, bundle: output, mode: 'rename' })).result!.memoryStore!.preview!
  assert.equal(rename.counts.invalid, 2)
  assert.equal(rename.counts.renamed, 2)
  assert.deepEqual(rename.targets.map((entry) => entry.scope), batch.entries.slice(0, 2).map((entry) => entry.scope))
  await store.close()
}

async function uiContract(database: string) {
  let failDuringWrite = false
  let dropAcknowledgement = false
  const hooks = { afterImportEntryWrite: () => { if (failDuringWrite) throw new Error('Injected write failure') } }
  let uiStore = await SqliteDurableMemoryStore.open(database, { maxEntriesPerScope: 3 }, hooks)
  let uiHost = await client(uiStore)
  let refetched = 0
  const session = new MemoryImportSession({
    previewImport: async (input) => {
      const response = await uiHost.send('memory/v1/import-preview', { ...input, access })
      if (response.error) throw new Error(response.error.message)
      return response.result!.memoryStore!.preview!
    },
    applyImport: async (input) => {
      const response = await uiHost.send('memory/v1/import-apply', { ...input, access })
      if (response.error) throw new Error(response.error.message)
      if (dropAcknowledgement) { dropAcknowledgement = false; throw new Error('Lost acknowledgement after commit') }
      return response.result!.memoryStore!.importResult!
    },
  }, async () => { refetched += 1 })
  await session.select(JSON.stringify({ version: 3, canonicalMemory: bundle }))
  assert.equal(session.snapshot().phase, 'ready')
  session.cancel()
  assert.equal(session.snapshot().phase, 'empty')
  assert.equal(await uiStore.revision(), 0)
  let finishRead!: (text: string) => void
  const pendingRead = session.selectFile({ size: 100, text: () => new Promise<string>((resolve) => { finishRead = resolve }) })
  session.cancel()
  finishRead(JSON.stringify(bundle))
  await pendingRead
  assert.equal(session.snapshot().phase, 'empty')
  await session.select(JSON.stringify(bundle))
  dropAcknowledgement = true
  await session.apply()
  assert.equal(session.snapshot().phase, 'failed')
  assert.equal(session.snapshot().canApply, true)
  assert.equal(await uiStore.revision(), 1)
  await uiStore.close()
  uiStore = await SqliteDurableMemoryStore.open(database, { maxEntriesPerScope: 3 }, hooks)
  uiHost = await client(uiStore)
  await session.apply()
  assert.equal(session.snapshot().phase, 'applied')
  assert.equal(await uiStore.revision(), 1)
  assert.equal(refetched, 1)
  for (const mode of ['skip', 'overwrite', 'rename'] as const) {
    await session.select(JSON.stringify(bundle))
    await session.changeMode(mode)
    assert.equal(session.snapshot().preview?.mode, mode)
    assert.equal(session.snapshot().canApply, true)
    assert.equal(session.snapshot().preview?.counts[mode === 'skip' ? 'skipped' : mode === 'overwrite' ? 'update' : 'renamed'], 1)
    await session.apply()
    assert.equal(session.snapshot().phase, 'applied')
  }
  const beforeError = await uiStore.revision()
  await session.select(JSON.stringify({ ...bundle, entries: [{ ...bundle.entries[0], text: 'password=protected' }] }))
  assert.equal(session.snapshot().preview?.counts.invalid, 1)
  assert.equal(session.snapshot().canApply, false)
  await session.apply()
  assert.equal(await uiStore.revision(), beforeError)
  const newEntry = { ...bundle.entries[0], logicalKey: 'third' }
  await session.select(JSON.stringify({ ...bundle, entries: [newEntry, { ...newEntry, logicalKey: 'fourth' }] }))
  assert.equal(session.snapshot().preview?.counts.quota, 1)
  assert.equal(session.snapshot().canApply, false)
  await session.apply()
  assert.equal(await uiStore.revision(), beforeError)
  await session.select(JSON.stringify({ ...bundle, entries: [newEntry] }))
  failDuringWrite = true
  await session.apply()
  assert.equal(session.snapshot().phase, 'failed')
  assert.equal(await uiStore.revision(), beforeError)
  assert.equal(await uiStore.get({ access, scope: { kind: 'global' }, logicalKey: 'third' }), undefined)
  failDuringWrite = false
  await session.apply()
  assert.equal(session.snapshot().phase, 'applied')
  assert.equal(await uiStore.revision(), beforeError + 1)
  await session.selectFile({ size: 16 * 1024 * 1024 + 1, text: async () => { throw new Error('Must not read oversized file') } })
  assert.equal(session.snapshot().canApply, false)
  assert.match(session.snapshot().message, /16 MiB/)
  const browserSession = new MemoryImportSession(undefined, async () => {})
  await browserSession.select(JSON.stringify(bundle))
  assert.equal(browserSession.snapshot().phase, 'failed')
  assert.equal(browserSession.snapshot().canApply, false)
  await uiStore.close()
}

try {
  assert.deepEqual(preserveLegacyHermesMemory({ memory: { entries: ['keep-local'] }, skills: ['old'] }, { memory: { entries: ['ignore-import'] }, skills: ['new'] }), { memory: { entries: ['keep-local'] }, skills: ['new'] })
  await uiContract(join(root, 'ui.sqlite'))
  const memory = new InMemoryDurableMemoryStore()
  await contract(memory)
  await memory.close()
  const database = join(root, 'memory.sqlite')
  const store = await SqliteDurableMemoryStore.open(database)
  const applyInput = await contract(store)
  await store.close()
  const restarted = await SqliteDurableMemoryStore.open(database)
  const { send } = await client(restarted)
  const retry = await send('memory/v1/import-apply', applyInput)
  assert.equal(retry.result?.memoryStore?.importResult?.alreadyApplied, true)
  assert.equal(retry.result?.memoryStore?.importResult?.changed, 0)
  await restarted.close()
  for (const adapter of ['memory', 'sqlite']) {
    let fail = true
    const hooks = { afterImportEntryWrite: (index: number) => { if (fail && index === 0) throw new Error('Injected transaction failure') } }
    const atomic = adapter === 'memory' ? new InMemoryDurableMemoryStore({ maxEntriesPerScope: 2 }, hooks)
      : await SqliteDurableMemoryStore.open(join(root, 'atomic.sqlite'), { maxEntriesPerScope: 2 }, hooks)
    await rollbackAndQuota(atomic, () => { fail = false })
    await scopeRoundTrip(adapter === 'memory' ? new InMemoryDurableMemoryStore() : await SqliteDurableMemoryStore.open(join(root, 'roundtrip.sqlite')))
  }
  console.log('canonical memory import: preview, conflicts, authority, retry and restart passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
