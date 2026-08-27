import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = await mkdtemp(join(tmpdir(), 'pi-memory-migration-'))
const statePath = join(root, 'state.json')
const hostBundle = resolve(import.meta.dirname, '../dist-electron/pi-host.js')

async function startup(requests: unknown[] = [], directory = root): Promise<{ code: number | null; stdout: string }> {
  const child = spawn(process.execPath, [hostBundle], {
    env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(directory, 'state.json'), SUBAGENTS_DURABLE_MEMORY_DB_PATH: join(directory, 'durable-memory.sqlite'), SUBAGENTS_PI_AGENT_DIR: join(directory, 'agent') },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let sent = 0
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk)
    const responses = stdout.split('\n').filter((line) => line.trim()).flatMap((line) => {
      try { const value = JSON.parse(line); return value.id !== undefined ? [value] : [] } catch { return [] }
    })
    if (responses.length === requests.length + 1) child.stdin.end()
    else if (responses.length === sent + 1) child.stdin.write(`${JSON.stringify(requests[sent++])}\n`)
  })
  child.stderr.resume()
  const closed = once(child, 'close')
  const timeout = setTimeout(() => child.kill('SIGKILL'), 20_000)
  child.stdin.on('error', () => {})
  child.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { protocolVersion: 5, capabilities: ['memory-store-v1'] } })}\n`)
  try {
    const [code, signal] = await closed
    assert.equal(signal, null, 'Host startup must finish without hitting the test timeout')
    return { code, stdout }
  } finally {
    clearTimeout(timeout)
  }
}

const admin = { origin: 'admin', memoryReadEnabled: false, memoryWriteEnabled: false, temporary: false }
const list = { id: 2, method: 'memory/v1/list', params: { access: admin } }

function responseFor(stdout: string, id: number) {
  return stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line)).find((message) => message.id === id)
}

async function assertCrashRecovery(): Promise<void> {
  for (const phase of ['backup-ready', 'memory-committed', 'legacy-retired', 'state-installed']) {
    const directory = join(root, phase)
    await mkdir(directory)
    const original = JSON.stringify({ schemaVersion: 1, cursor: 0, sessions: [], settings: { model: 'test', activeTools: [] }, memories: [
      { id: 'recover', text: 'survives cutover', tags: [], createdAt: '2026-08-27T00:00:00.000Z' },
    ] })
    await writeFile(join(directory, 'state.json'), original, { mode: 0o644 })
    const crashed = spawn(process.execPath, ['--experimental-strip-types', resolve(import.meta.dirname, 'pi-memory-cutover-crash-fixture.mts'), directory, phase], { stdio: 'pipe' })
    const [code] = await once(crashed, 'close')
    assert.equal(code, 73, `crash boundary ${phase}`)
    for (let retry = 0; retry < 2; retry++) {
      const result = await startup([list], directory)
      assert.equal(result.code, 0, `restart after ${phase}`)
      assert.equal(responseFor(result.stdout, 2).result.memoryStore.page.total, 1)
      assert.equal(responseFor(result.stdout, 2).result.memoryStore.revision, 1)
      assert.equal(await readFile(join(directory, 'state.json.pre-sqlite.json'), 'utf8'), original)
      if (process.platform !== 'win32') assert.equal((await stat(join(directory, 'state.json.pre-sqlite.json'))).mode & 0o777, 0o600)
    }
  }
}

async function assertCutover(): Promise<void> {
  const original = JSON.stringify({
    schemaVersion: 2, cursor: 7, sessions: [], queue: [],
    settings: { provider: 'openai', model: 'test', activeTools: [] },
    memories: [
      { id: 'same', project: '/workspace/alpha', text: 'Alpha memory', tags: [], createdAt: '2026-08-27T00:00:00.000Z' },
      { id: 'same', project: '/workspace/beta', text: 'Beta memory', tags: [], createdAt: '2026-08-27T00:00:00.000Z' },
      { id: 'profile:user', text: '繁體中文', tags: [], createdAt: '2026-08-27T00:00:00.000Z' },
      { id: 'bad-date', text: 'Quarantine this row', tags: [], createdAt: 'yesterday' },
    ],
  })
  await writeFile(statePath, original, { mode: 0o600 })
  for (let restart = 0; restart < 2; restart++) {
    const result = await startup([list, { id: 3, method: 'memory/list' }])
    assert.equal(result.code, 0)
    const response = result.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line)).find((message) => message.id === 2)
    assert.equal(response.result.memoryStore.page.total, 3)
    assert.equal(response.result.memoryStore.revision, 1)
    const legacy = result.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line)).find((message) => message.id === 3)
    assert.equal(legacy.error.code, 'unknown_method', 'whole-bundle legacy management is retired after cutover')
    assert.equal((await stat(statePath)).isDirectory(), true, 'the legacy pathname becomes a downgrade barrier')
    assert.equal(await readFile(`${statePath}.pre-sqlite.json`, 'utf8'), original)
    const snapshot = JSON.parse(await readFile(join(statePath, 'snapshot.json'), 'utf8'))
    assert.equal(snapshot.schemaVersion, 4)
    assert.equal(snapshot.memoryAuthority.backend, 'sqlite')
    assert.equal(Object.hasOwn(snapshot, 'memories'), false)
    const report = JSON.parse(await readFile(join(statePath, 'migration-report.json'), 'utf8'))
    assert.deepEqual(report.rejected, [{ index: 3, code: 'invalid_input' }])
  }
  const mutation = await startup([
    { id: 2, method: 'memory/v1/upsert', params: { access: admin, entry: { scope: { kind: 'global' }, logicalKey: 'live', kind: 'memory', text: 'SQLite-only live write', tags: [], createdAt: '2026-08-27T01:00:00.000Z' } } },
    { ...list, id: 3 },
    { id: 4, method: 'memory/delete', params: { id: 'same' } },
  ])
  assert.equal(responseFor(mutation.stdout, 2).error, undefined)
  assert.equal(responseFor(mutation.stdout, 3).result.memoryStore.page.total, 4)
  assert.equal(responseFor(mutation.stdout, 4).error.code, 'unknown_method', 'retired unscoped delete cannot erase any scope')
  const cleared = await startup([{ id: 2, method: 'memory/v1/clear-all', params: { access: admin } }])
  assert.equal(responseFor(cleared.stdout, 2).result.memoryStore.mutation.changed, 4)
  const restarted = await startup([list])
  assert.equal(responseFor(restarted.stdout, 2).result.memoryStore.page.total, 0, 'backup is never replayed after live clear')
  assert.equal(Object.hasOwn(JSON.parse(await readFile(join(statePath, 'snapshot.json'), 'utf8')), 'memories'), false)
  assert.equal(await readFile(`${statePath}.pre-sqlite.json`, 'utf8'), original)

  // The historical writer uses temp-file + rename. Prove the OS barrier itself,
  // independently of whether an older parser recognizes the new schema.
  const oldTemporary = `${statePath}.old-version.tmp`
  await writeFile(oldTemporary, JSON.stringify({ schemaVersion: 2, memories: [] }))
  await assert.rejects(rename(oldTemporary, statePath))
  assert.equal((await stat(statePath)).isDirectory(), true)
  assert.match(await readFile(join(statePath, 'README.txt'), 'utf8'), /相容版本.*匯出/)
  await rename(join(root, 'durable-memory.sqlite'), join(root, 'saved-database.sqlite'))
  const missingDatabase = await startup()
  assert.notEqual(missingDatabase.code, 0, 'missing live SQLite must not recreate an empty store or replay backup')
}

try {
  const invalidMemoryCollection = JSON.stringify({ schemaVersion: 2, cursor: 0, sessions: [], settings: { model: 'test', activeTools: [] }, memories: { unexpected: 'object' } })
  for (const source of ['{"schemaVersion":2,"memories":[', '{"schemaVersion":999}', invalidMemoryCollection]) {
    await writeFile(statePath, source, { mode: 0o600 })
    const result = await startup()
    assert.notEqual(result.code, 0, 'unreadable or unsupported state must refuse startup')
    assert.equal(result.stdout.includes('"id":1'), false, 'unreadable state must not acknowledge initialize')
    assert.equal(await readFile(statePath, 'utf8'), source, 'refused startup must preserve the source bytes')
  }
  await assertCutover()
  await assertCrashRecovery()
  console.log('Pi Host memory migration: fail-closed startup, backup, cutover, and restart passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
