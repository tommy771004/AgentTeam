import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import {
  InMemoryInstructionRepository,
  SqliteInstructionRepository,
  InstructionRepositoryError,
  type InstructionRepository,
} from '../electron/instructionRepository.ts'

async function contract(repository: InstructionRepository) {
  const initial = await repository.read()
  assert.equal(initial.revision, 0)
  assert.equal(initial.globalCustomInstructions, '')

  const saved = await repository.save({
    expectedRevision: 0,
    globalCustomInstructions: '所有回覆先給結論。',
    advancedPersonalityInstructions: '語氣直接。',
  })
  assert.equal(saved.revision, 1)
  assert.match(saved.hash, /^[a-f0-9]{64}$/)
  assert.deepEqual(await repository.listAuthorizedIncludeTargets(), [])
  assert.deepEqual(await repository.authorizeIncludeTarget('/canonical/exact.md'), ['/canonical/exact.md'])

  await assert.rejects(
    repository.save({ expectedRevision: 0, globalCustomInstructions: 'stale' }),
    (error: unknown) => error instanceof InstructionRepositoryError && error.code === 'conflict',
  )
  assert.equal((await repository.read()).globalCustomInstructions, '所有回覆先給結論。')

  const exported = await repository.exportBundle()
  assert.equal(exported.kind, 'agentstudio-personalization')
  assert.equal(exported.schemaVersion, 1)
  assert.match(exported.bundleId, /^[0-9a-f-]{36}$/i)
  assert.match(exported.integrityHash, /^[a-f0-9]{64}$/)
  assert.equal(exported.snapshot.revision, saved.revision)
  assert.equal(exported.snapshot.hash, saved.hash)
  assert.deepEqual(exported.projectSources, [])
  assert.deepEqual(exported.authorizedIncludeTargets, ['/canonical/exact.md'])
  assert.equal((await repository.previewImport(exported)).status, 'unchanged')
  const unsupported = structuredClone(exported) as Record<string, unknown>
  unsupported.schemaVersion = 99
  const unsupportedPreview = await repository.previewImport(unsupported)
  assert.equal(unsupportedPreview.status, 'invalid')
  assert.equal(unsupportedPreview.errorCode, 'unsupported_schema')

  const tampered = structuredClone(exported) as Record<string, unknown>
  ;(tampered.snapshot as Record<string, unknown>).globalCustomInstructions = '未經授權竄改'
  const tamperedPreview = await repository.previewImport(tampered)
  assert.equal(tamperedPreview.status, 'invalid')
  assert.equal(tamperedPreview.errorCode, 'integrity_failure')

  const malformed = structuredClone(exported) as Record<string, unknown>
  ;(malformed.snapshot as Record<string, unknown>).revision = -1
  const { integrityHash: _oldIntegrity, ...malformedBase } = malformed
  malformed.integrityHash = createHash('sha256').update(JSON.stringify(malformedBase)).digest('hex')
  const malformedPreview = await repository.previewImport(malformed)
  assert.equal(malformedPreview.status, 'invalid')
  assert.equal(malformedPreview.errorCode, 'invalid_import')
}

async function importContract(source: InstructionRepository, target: InstructionRepository) {
  await source.save({ expectedRevision: 0, globalCustomInstructions: '只匯出 global，不匯出 project。' })
  await source.authorizeIncludeTarget('/source-only/include.md')
  const bundle = await source.exportBundle()
  const preview = await target.previewImport(bundle)
  assert.equal(preview.status, 'add')
  const imported = await target.applyImport(preview, 0)
  assert.equal(imported.revision, 1)
  assert.equal(imported.globalCustomInstructions, '只匯出 global，不匯出 project。')
  assert.deepEqual(await target.listAuthorizedIncludeTargets(), [], 'import metadata must not silently grant local-file authority')

  const repeatedPreview = await target.previewImport(bundle)
  assert.equal(repeatedPreview.status, 'unchanged')
  const repeated = await target.applyImport(repeatedPreview, imported.revision)
  assert.equal(repeated.revision, imported.revision)
  return bundle
}

async function migrationContract(repository: InstructionRepository) {
  const input = { soul: '語氣沉著。', agents: '先檢查證據。', personality: 'direct' }
  const first = await repository.migrateLegacy(input)
  assert.equal(first.report.status, 'migrated')
  assert.equal(first.report.backup.soul, input.soul)
  assert.match(first.report.sourceHash, /^[a-f0-9]{64}$/)
  assert.equal(first.instructions.advancedPersonalityInstructions, input.soul)
  assert.equal(first.instructions.globalCustomInstructions, input.agents)
  const repeated = await repository.migrateLegacy({ soul: '不得覆寫' })
  assert.equal(repeated.report.status, 'already_migrated')
  assert.equal(repeated.instructions.revision, first.instructions.revision)
  assert.equal(repeated.instructions.advancedPersonalityInstructions, input.soul)
}

await contract(new InMemoryInstructionRepository())
await importContract(new InMemoryInstructionRepository(), new InMemoryInstructionRepository())
await migrationContract(new InMemoryInstructionRepository())

const olderSource = new InMemoryInstructionRepository()
await olderSource.save({ expectedRevision: 0, globalCustomInstructions: '舊 revision' })
const olderBundle = await olderSource.exportBundle()
const newerTarget = new InMemoryInstructionRepository()
await newerTarget.save({ expectedRevision: 0, globalCustomInstructions: '新 revision 1' })
await newerTarget.save({ expectedRevision: 1, globalCustomInstructions: '新 revision 2' })
const conflictPreview = await newerTarget.previewImport(olderBundle)
assert.equal(conflictPreview.status, 'conflict')
await assert.rejects(newerTarget.applyImport(conflictPreview, 2), (error: unknown) =>
  error instanceof InstructionRepositoryError && error.code === 'invalid_import')
assert.equal((await newerTarget.read()).globalCustomInstructions, '新 revision 2')

const dir = await mkdtemp(join(tmpdir(), 'agentstudio-instructions-'))
const databasePath = join(dir, 'instructions.sqlite')
try {
  const first = await SqliteInstructionRepository.open(databasePath)
  await contract(first)
  await first.close()

  const restarted = await SqliteInstructionRepository.open(databasePath)
  const snapshot = await restarted.read()
  assert.equal(snapshot.revision, 1)
  assert.equal(snapshot.globalCustomInstructions, '所有回覆先給結論。')
  assert.deepEqual(await restarted.listAuthorizedIncludeTargets(), ['/canonical/exact.md'])
  await restarted.close()

  // Two independent SQLite clients model two renderer windows sharing the
  // durable Host repository. Both use the same observed revision; exactly one
  // transaction commits and the loser re-reads the winner then returns the
  // public typed conflict. Reopen proves the winner is durable.
  const concurrentA = await SqliteInstructionRepository.open(databasePath)
  const concurrentB = await SqliteInstructionRepository.open(databasePath)
  const concurrentResults = await Promise.allSettled([
    concurrentA.save({ expectedRevision: 1, globalCustomInstructions: 'DB_WINDOW_A' }),
    concurrentB.save({ expectedRevision: 1, globalCustomInstructions: 'DB_WINDOW_B' }),
  ])
  assert.equal(concurrentResults.filter((result) => result.status === 'fulfilled').length, 1, 'concurrent SQLite save has one winner')
  assert.equal(concurrentResults.filter((result) => result.status === 'rejected' && result.reason instanceof InstructionRepositoryError && result.reason.code === 'conflict').length, 1, 'concurrent SQLite save has one typed conflict')
  const winnerReader = await SqliteInstructionRepository.open(databasePath)
  const winnerSnapshot = await winnerReader.read()
  await winnerReader.close()
  assert.ok(['DB_WINDOW_A', 'DB_WINDOW_B'].includes(winnerSnapshot.globalCustomInstructions))
  assert.equal(winnerSnapshot.revision, 2)
  await concurrentA.close()
  await concurrentB.close()
  const durableConcurrent = await SqliteInstructionRepository.open(databasePath)
  assert.equal((await durableConcurrent.read()).globalCustomInstructions, winnerSnapshot.globalCustomInstructions, 'concurrent DB winner survives restart')
  await durableConcurrent.close()

  const importSource = new InMemoryInstructionRepository()
  const importTarget = await SqliteInstructionRepository.open(join(dir, 'import.sqlite'))
  const importedBundle = await importContract(importSource, importTarget)
  await importTarget.close()

  const reopenedTarget = await SqliteInstructionRepository.open(join(dir, 'import.sqlite'))
  const repeatedAfterRestart = await reopenedTarget.previewImport(importedBundle)
  assert.equal(repeatedAfterRestart.status, 'unchanged')
  await reopenedTarget.close()

  const rollbackPath = join(dir, 'import-rollback.sqlite')
  const rollbackSeed = await SqliteInstructionRepository.open(rollbackPath)
  await rollbackSeed.save({ expectedRevision: 0, globalCustomInstructions: '原本 committed 值' })
  await rollbackSeed.close()
  const rollbackRaw = new DatabaseSync(rollbackPath)
  rollbackRaw.exec(`CREATE TRIGGER reject_import_marker BEFORE INSERT ON instruction_imports
    BEGIN SELECT RAISE(ABORT, 'forced operation marker failure'); END;`)
  rollbackRaw.close()
  const rollbackTarget = await SqliteInstructionRepository.open(rollbackPath)
  const rollbackSource = new InMemoryInstructionRepository()
  await rollbackSource.save({ expectedRevision: 0, globalCustomInstructions: '新的匯入值' })
  const rollbackBundle = await rollbackSource.exportBundle()
  const rollbackPreview = await rollbackTarget.previewImport(rollbackBundle)
  assert.equal(rollbackPreview.status, 'update')
  await assert.rejects(rollbackTarget.applyImport(rollbackPreview, 1), (error: unknown) =>
    error instanceof InstructionRepositoryError && error.code === 'io_error')
  const afterFailedImport = await rollbackTarget.read()
  assert.equal(afterFailedImport.revision, 1, 'failed operation marker must roll back the state row revision')
  assert.equal(afterFailedImport.globalCustomInstructions, '原本 committed 值')
  assert.equal((await rollbackTarget.previewImport(rollbackBundle)).status, 'update', 'failed transaction must not persist its bundle marker')
  await rollbackTarget.close()
  const restartedAfterFailure = await SqliteInstructionRepository.open(rollbackPath)
  assert.equal((await restartedAfterFailure.read()).globalCustomInstructions, '原本 committed 值')
  assert.equal((await restartedAfterFailure.previewImport(rollbackBundle)).status, 'update')
  await restartedAfterFailure.close()

  const migrationPath = join(dir, 'migration.sqlite')
  const migrationTarget = await SqliteInstructionRepository.open(migrationPath)
  await migrationContract(migrationTarget)
  await migrationTarget.close()
  const restartedMigration = await SqliteInstructionRepository.open(migrationPath)
  const repeatedMigration = await restartedMigration.migrateLegacy({ soul: '重啟後也不得覆寫' })
  assert.equal(repeatedMigration.report.status, 'already_migrated')
  assert.equal(repeatedMigration.instructions.advancedPersonalityInstructions, '語氣沉著。')
  await restartedMigration.close()

  const corruptPath = join(dir, 'corrupt.sqlite')
  const corruptTarget = await SqliteInstructionRepository.open(corruptPath)
  await corruptTarget.save({ expectedRevision: 0, globalCustomInstructions: '原始值' })
  await corruptTarget.close()
  const raw = new DatabaseSync(corruptPath)
  raw.prepare('UPDATE instruction_state SET global_custom = ? WHERE singleton = 1').run('未授權竄改')
  raw.close()
  const detected = await SqliteInstructionRepository.open(corruptPath)
  await assert.rejects(detected.read(), (error: unknown) => error instanceof InstructionRepositoryError && error.code === 'corrupt')
  await detected.close()

  const missingSchemaPath = join(dir, 'missing-schema.sqlite')
  const missingSchema = new DatabaseSync(missingSchemaPath)
  missingSchema.exec('CREATE TABLE instruction_state (singleton INTEGER PRIMARY KEY); PRAGMA user_version = 1;')
  missingSchema.close()
  await assert.rejects(SqliteInstructionRepository.open(missingSchemaPath), (error: unknown) =>
    error instanceof InstructionRepositoryError && error.code === 'corrupt')
  const preservedMissingSchema = new DatabaseSync(missingSchemaPath)
  const preservedTables = (preservedMissingSchema.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name)
  preservedMissingSchema.close()
  assert.deepEqual(preservedTables, ['instruction_state'], 'corrupt v1 schema must not be filled with blank authority tables')

  const migrationFailurePath = join(dir, 'migration-failure.sqlite')
  const migrationFailure = new DatabaseSync(migrationFailurePath)
  migrationFailure.exec('CREATE TABLE unknown_legacy_authority (body TEXT);')
  migrationFailure.prepare('INSERT INTO unknown_legacy_authority (body) VALUES (?)').run('保留這份 evidence')
  migrationFailure.close()
  await assert.rejects(SqliteInstructionRepository.open(migrationFailurePath), (error: unknown) =>
    error instanceof InstructionRepositoryError && error.code === 'migration_failed')
  const preservedMigration = new DatabaseSync(migrationFailurePath)
  assert.equal((preservedMigration.prepare('SELECT body FROM unknown_legacy_authority').get() as { body: string }).body, '保留這份 evidence')
  preservedMigration.close()

  const unsupportedPath = join(dir, 'unsupported.sqlite')
  const unsupportedDb = new DatabaseSync(unsupportedPath)
  unsupportedDb.exec('PRAGMA user_version = 99;')
  unsupportedDb.close()
  await assert.rejects(SqliteInstructionRepository.open(unsupportedPath), (error: unknown) =>
    error instanceof InstructionRepositoryError && error.code === 'unsupported_schema')

  const recoveryPath = join(dir, 'recovery.sqlite')
  const recoveryWriter = await SqliteInstructionRepository.open(recoveryPath)
  await recoveryWriter.save({ expectedRevision: 0, globalCustomInstructions: '可匯出的 recovery 值' })
  await recoveryWriter.close()
  await chmod(recoveryPath, 0o444)
  const recovery = await SqliteInstructionRepository.openReadOnly(recoveryPath)
  assert.equal((await recovery.read()).globalCustomInstructions, '可匯出的 recovery 值')
  assert.equal((await recovery.exportBundle()).snapshot.globalCustomInstructions, '可匯出的 recovery 值')
  await assert.rejects(recovery.save({ expectedRevision: 1, globalCustomInstructions: '不得寫入' }), (error: unknown) => error instanceof InstructionRepositoryError && error.code === 'read_only')
  await recovery.close()
} finally {
  await rm(dir, { recursive: true, force: true })
}

console.log('instruction repository smoke: ok')
