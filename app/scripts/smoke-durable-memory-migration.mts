import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { canonicalProjectId, DurableMemoryStoreError, InMemoryDurableMemoryStore, type DurableMemoryStore, type MemoryAccessContext } from '../electron/durableMemoryStore.ts'
import { SqliteDurableMemoryStore } from '../electron/sqliteDurableMemoryStore.ts'

const access: MemoryAccessContext = { origin: 'migration', memoryReadEnabled: false, memoryWriteEnabled: false, temporary: false }
const admin: MemoryAccessContext = { ...access, origin: 'admin' }
const createdAt = '2026-08-27T00:00:00.000Z'
const errorCode = (code: DurableMemoryStoreError['code']) => (error: unknown) => error instanceof DurableMemoryStoreError && error.code === code
const source = {
  access, sourceHash: 'a'.repeat(64), sourceSchema: 2 as const,
  memories: [
    { id: 'shared', project: '/workspace/alpha', text: 'Alpha', tags: [], createdAt },
    { id: 'shared', project: '/workspace/beta', text: 'Beta', tags: [], createdAt },
    { id: 'profile:user', text: '繁體中文', tags: [], createdAt },
    { id: 'broken-date', text: 'Do not silently repair dates', tags: [], createdAt: 'yesterday' },
  ],
}

async function migrationContract(store: DurableMemoryStore) {
  const migrated = await store.migrateLegacy(source)
  assert.equal(migrated.alreadyApplied, false)
  assert.equal(migrated.report.imported, 3)
  assert.deepEqual(migrated.report.rejected, [{ index: 3, code: 'invalid_input' }])
  assert.equal(migrated.report.revision, 1)
  assert.equal((await store.get({ access: admin, scope: { kind: 'project', project: canonicalProjectId('/workspace/alpha') }, logicalKey: 'shared' }))?.text, 'Alpha')
  assert.equal((await store.get({ access: admin, scope: { kind: 'project', project: canonicalProjectId('/workspace/beta') }, logicalKey: 'shared' }))?.text, 'Beta')
  const profile = await store.get({ access: admin, scope: { kind: 'global' }, logicalKey: 'profile:user' })
  assert.equal(profile?.kind, 'profile')
  assert.ok(profile?.tags.includes('always-recall'))
  const retried = await store.migrateLegacy(source)
  assert.equal(retried.alreadyApplied, true)
  assert.deepEqual(retried.report, migrated.report)
  assert.equal(await store.revision(), 1)
  await assert.rejects(store.migrateLegacy({ ...source, sourceHash: 'b'.repeat(64) }), errorCode('invalid_input'))
  await assert.rejects(store.migrateLegacy({ ...source, access: admin }), errorCode('forbidden'))
  assert.deepEqual(await store.migrationStatus(), migrated.report)
}

async function rejectedRowsContract(store: DurableMemoryStore) {
  const row = { id: 'same', text: 'Earlier', tags: [], createdAt }
  const result = await store.migrateLegacy({ ...source, sourceSchema: 1, memories: [
    row, { ...row, text: 'Last duplicate wins' },
    { ...row, id: 'memory:document', text: 'Document' },
    { ...row, id: 'private', text: 'password=do-not-persist' },
    { ...row, id: 'bad-tags', tags: [42] },
    { ...row, id: 'too-long', text: 'x'.repeat(32_769) },
    null,
  ] })
  assert.equal(result.report.imported, 2)
  assert.deepEqual(result.report.rejected, [
    { index: 0, code: 'duplicate_key' }, { index: 3, code: 'forbidden' },
    { index: 4, code: 'invalid_input' }, { index: 5, code: 'invalid_input' }, { index: 6, code: 'invalid_input' },
  ])
  assert.equal((await store.get({ access: admin, scope: { kind: 'global' }, logicalKey: 'same' }))?.text, 'Last duplicate wins')
  assert.equal((await store.get({ access: admin, scope: { kind: 'global' }, logicalKey: 'memory:document' }))?.kind, 'document')
  assert.equal(JSON.stringify(result.report).includes('do-not-persist'), false)
}

const root = await mkdtemp(join(tmpdir(), 'durable-memory-migration-'))
try {
  const memory = new InMemoryDurableMemoryStore()
  await migrationContract(memory)
  await memory.close()
  const path = join(root, 'memory.sqlite')
  const sqlite = await SqliteDurableMemoryStore.open(path)
  await migrationContract(sqlite)
  await sqlite.close()
  const restarted = await SqliteDurableMemoryStore.open(path)
  assert.equal((await restarted.migrateLegacy(source)).alreadyApplied, true)
  assert.equal((await restarted.list({ access: admin })).total, 3)
  assert.equal(await restarted.revision(), 1)
  await restarted.close()
  const rejectedMemory = new InMemoryDurableMemoryStore()
  await rejectedRowsContract(rejectedMemory)
  await rejectedMemory.close()
  const rejectedSqlite = await SqliteDurableMemoryStore.open(join(root, 'rejected.sqlite'))
  await rejectedRowsContract(rejectedSqlite)
  await rejectedSqlite.close()
  for (const empty of [new InMemoryDurableMemoryStore(), await SqliteDurableMemoryStore.open(join(root, 'empty.sqlite'))]) {
    const input = { ...source, memories: [] }
    const migrated = await empty.migrateLegacy(input)
    assert.equal(migrated.report.imported, 0)
    assert.equal(migrated.report.revision, 0)
    assert.equal((await empty.migrateLegacy(input)).alreadyApplied, true)
    await empty.close()
  }
  for (const limited of [new InMemoryDurableMemoryStore({ maxEntriesPerScope: 1 }), await SqliteDurableMemoryStore.open(join(root, 'quota.sqlite'), { maxEntriesPerScope: 1 })]) {
    await limited.upsert({ access: admin, scope: { kind: 'global' }, logicalKey: 'existing', kind: 'memory', text: 'Keep SQLite content', tags: [], createdAt })
    const migrated = await limited.migrateLegacy({ ...source, memories: [
      { id: 'existing', text: 'Do not overwrite', tags: [], createdAt },
      { id: 'new', text: 'Over quota', tags: [], createdAt },
    ] })
    assert.equal(migrated.report.imported, 0)
    assert.deepEqual(migrated.report.rejected, [{ index: 0, code: 'existing_entry' }, { index: 1, code: 'quota_exceeded' }])
    assert.equal((await limited.get({ access: admin, scope: { kind: 'global' }, logicalKey: 'existing' }))?.text, 'Keep SQLite content')
    assert.equal(await limited.revision(), 1)
    await limited.close()
  }

  // Inject a database write failure at the marker boundary, then observe only
  // the public store contract. No private rows are read to assert correctness.
  const rollbackPath = join(root, 'rollback.sqlite')
  const rollback = await SqliteDurableMemoryStore.open(rollbackPath)
  const faults = new DatabaseSync(rollbackPath)
  try {
    faults.exec("CREATE TRIGGER refuse_migration BEFORE INSERT ON memory_meta WHEN NEW.key = 'legacy_json_migration' BEGIN SELECT RAISE(ABORT, 'injected marker failure'); END;")
    await assert.rejects(rollback.migrateLegacy(source), errorCode('unavailable'))
    assert.equal(await rollback.revision(), 0)
    assert.equal((await rollback.list({ access: admin })).total, 0)
    assert.equal(await rollback.migrationStatus(), undefined)
    faults.exec('DROP TRIGGER refuse_migration')
    assert.equal((await rollback.migrateLegacy(source)).report.imported, 3)
  } finally {
    faults.close()
    await rollback.close()
  }
  console.log('durable memory migration: scoped legacy rows, quarantine report, atomic marker and restart-safe retry passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
