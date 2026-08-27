import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SqliteDurableMemoryStore } from '../electron/sqliteDurableMemoryStore.ts'
import { canonicalProjectId, type MemoryAccessContext } from '../electron/durableMemoryStore.ts'
import { MemoryStorageLifecycleError, permissionFailure } from '../electron/memoryStorageLifecycle.ts'
import { createPiHostServer, PI_HOST_PROTOCOL_VERSION, type PiHostMessage } from '../electron/piHostProtocol.ts'

const root = await mkdtemp(join(tmpdir(), 'memory-storage-lifecycle-'))
const project = canonicalProjectId('/workspace/lifecycle')
const access: MemoryAccessContext = {
  origin: 'runtime', canonicalProject: project,
  memoryReadEnabled: true, memoryWriteEnabled: true, temporary: false,
  runId: 'lifecycle-run', sessionId: 'lifecycle-session', callId: 'lifecycle-call',
}

function draft(logicalKey: string) {
  return {
    access, scope: { kind: 'project' as const, project }, logicalKey, kind: 'memory' as const,
    text: logicalKey, tags: ['lifecycle'], createdAt: '2026-08-27T00:00:00.000Z',
  }
}

async function expectHealthCode(action: () => Promise<unknown>, code: MemoryStorageLifecycleError['health']['code']) {
  await assert.rejects(action, (error: unknown) => error instanceof MemoryStorageLifecycleError && error.health.code === code)
}

async function cleanAndBoundedShutdown() {
  const database = join(root, 'bounded.sqlite')
  let hold = false
  let entered!: () => void
  let release!: () => void
  const enteredWrite = new Promise<void>((resolve) => { entered = resolve })
  const releaseWrite = new Promise<void>((resolve) => { release = resolve })
  const store = await SqliteDurableMemoryStore.open(database, undefined, {
    beforeWrite: async () => { if (hold) { entered(); await releaseWrite } },
  })
  assert.deepEqual(await store.health(), { status: 'ready', revision: 0 })
  hold = true
  const accepted = store.upsert(draft('accepted-before-close'))
  await enteredWrite
  await expectHealthCode(() => store.close(5), 'shutdown_timeout')
  await assert.rejects(store.upsert(draft('refused-after-close-start')), /closing/)
  release()
  await accepted
  for (let attempt = 0; attempt < 20 && (await store.health()).status !== 'closed'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  assert.deepEqual(await store.health(), { status: 'closed', revision: 1 })
  const restarted = await SqliteDurableMemoryStore.open(database)
  assert.equal((await restarted.get({ access, scope: draft('x').scope, logicalKey: 'accepted-before-close' }))?.text, 'accepted-before-close')
  await restarted.close()
}

async function walAndTransactionRecovery() {
  const crashDatabase = join(root, 'crash.sqlite')
  const child = spawn(process.execPath, ['--experimental-strip-types', resolve(import.meta.dirname, 'memory-wal-crash-fixture.mts'), crashDatabase], { stdio: 'ignore' })
  const [code] = await once(child, 'close')
  assert.equal(code, 73)
  const recovered = await SqliteDurableMemoryStore.open(crashDatabase)
  const crashProject = canonicalProjectId('/workspace/wal-crash')
  assert.equal((await recovered.get({ access: { ...access, canonicalProject: crashProject }, scope: { kind: 'project', project: crashProject }, logicalKey: 'committed-before-kill' }))?.text, 'committed WAL survives immediate kill')
  await recovered.close()

  const rollbackDatabase = join(root, 'rollback.sqlite')
  const initialized = await SqliteDurableMemoryStore.open(rollbackDatabase)
  await initialized.close()
  const raw = new DatabaseSync(rollbackDatabase)
  raw.exec('BEGIN IMMEDIATE')
  raw.prepare(`INSERT INTO memory_entries(id, scope_kind, project_id, logical_key, kind, text, created_at, updated_at, revision, content_hash, provenance_json, operation, migration_version)
    VALUES (?, 'project', ?, 'uncommitted', 'memory', 'must rollback', ?, ?, 1, 'hash', '{}', 'test', 2)`)
    .run('uncommitted-id', project, '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z')
  raw.close()
  const rolledBack = await SqliteDurableMemoryStore.open(rollbackDatabase)
  assert.equal(await rolledBack.get({ access, scope: { kind: 'project', project }, logicalKey: 'uncommitted' }), undefined)
  await rolledBack.close()
}

async function corruptionAndVersionMatrix() {
  assert.equal(permissionFailure({ errcode: 8 }), true)
  assert.equal(permissionFailure({ errcode: 14 }), true)

  const corrupt = join(root, 'corrupt.sqlite')
  await writeFile(corrupt, 'not a sqlite database')
  const corruptBytes = await readFile(corrupt)
  await expectHealthCode(() => SqliteDurableMemoryStore.open(corrupt), 'sqlite_integrity_failure')
  assert.deepEqual(await readFile(corrupt), corruptBytes)

  const future = join(root, 'future.sqlite')
  const raw = new DatabaseSync(future)
  raw.exec('CREATE TABLE memory_schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  raw.prepare('INSERT INTO memory_schema_migrations VALUES (99, ?, ?)').run('future', '2026-08-27T00:00:00.000Z')
  raw.close()
  const futureBytes = await readFile(future)
  await expectHealthCode(() => SqliteDurableMemoryStore.open(future), 'unsupported_schema')
  assert.deepEqual(await readFile(future), futureBytes)

  const migration = join(root, 'migration-failure.sqlite')
  const malformed = new DatabaseSync(migration)
  malformed.exec(`
    CREATE TABLE memory_schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    CREATE TABLE memory_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE memory_entries(id TEXT PRIMARY KEY);
    CREATE TABLE memory_tags(memory_id TEXT, position INTEGER, tag TEXT, normalized_tag TEXT);
    CREATE TABLE memory_operations(sequence INTEGER PRIMARY KEY, operation_id TEXT);
    INSERT INTO memory_schema_migrations VALUES (1, 'malformed-v1', '2026-08-27T00:00:00.000Z');
  `)
  malformed.close()
  const migrationBytes = await readFile(migration)
  await expectHealthCode(() => SqliteDurableMemoryStore.open(migration), 'migration_failure')
  assert.deepEqual(await readFile(migration), migrationBytes)

  if (process.platform !== 'win32') {
    const denied = join(root, 'denied')
    await mkdir(denied, { mode: 0o700 })
    await chmod(denied, 0o500)
    try {
      await expectHealthCode(() => SqliteDurableMemoryStore.open(join(denied, 'memory.sqlite')), 'permission_error')
    } finally {
      await chmod(denied, 0o700)
    }
  }
}

async function publicHealthAndJsonFailure() {
  const store = await SqliteDurableMemoryStore.open(join(root, 'protocol.sqlite'))
  const messages: PiHostMessage[] = []
  const server = createPiHostServer((message) => messages.push(message), undefined, undefined, undefined, undefined, store)
  await server.handle({ id: 1, method: 'initialize', params: { protocolVersion: PI_HOST_PROTOCOL_VERSION, capabilities: ['memory-store-v1'] } })
  await server.handle({ id: 2, method: 'health/get', params: {} })
  const health = messages.find((message) => 'id' in message && message.id === 2)
  assert.equal('result' in health! && health.result?.memoryHealth?.status, 'ready')
  await server.handle({ id: 3, method: 'lifecycle/shutdown', params: {} })
  assert.equal(messages.find((message) => 'id' in message && message.id === 3 && message.result?.memoryHealth?.status === 'closed') !== undefined, true)
  await server.handle({ id: 4, method: 'memory/v1/list', params: { access } })
  assert.equal(messages.find((message) => 'id' in message && message.id === 4 && message.error?.code === 'closed') !== undefined, true)

  const directory = join(root, 'bad-json-host')
  await mkdir(directory)
  const state = join(directory, 'state.json')
  const source = '{"schemaVersion":2,"memories":['
  await writeFile(state, source, { mode: 0o600 })
  const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
    env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: state, SUBAGENTS_DURABLE_MEMORY_DB_PATH: join(directory, 'memory.sqlite'), SUBAGENTS_PI_AGENT_DIR: join(directory, 'agent') },
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  let stdout = ''
  host.stdout.on('data', (chunk) => { stdout += String(chunk) })
  const [exitCode] = await once(host, 'close')
  assert.notEqual(exitCode, 0)
  const event = stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line)).find((message) => message.event === 'host/storage-health')
  assert.equal(event.payload.code, 'json_parse_failure')
  assert.equal(event.payload.readOnlyExport, false)
  assert.equal(await readFile(state, 'utf8'), source)
  assert.equal((await stat(state)).isFile(), true)
}

try {
  await cleanAndBoundedShutdown()
  await walAndTransactionRecovery()
  await corruptionAndVersionMatrix()
  await publicHealthAndJsonFailure()
  console.log('memory storage lifecycle: readiness, typed degradation, WAL recovery and bounded shutdown passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
