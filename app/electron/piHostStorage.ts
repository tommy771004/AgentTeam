import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { decodePiHostState, loadPiHostState, type PiHostSnapshot } from './piHostState.ts'
import { SqliteDurableMemoryStore } from './sqliteDurableMemoryStore.ts'

/** Startup owns this transition; no request is served until both authorities agree. */
export type PiStorageTransition = 'backup-ready' | 'memory-committed' | 'legacy-retired' | 'state-installed'

export async function openPiHostStorage(
  statePath: string,
  databasePath: string,
  onTransition?: (phase: PiStorageTransition) => void,
): Promise<{
  snapshot: PiHostSnapshot
  memoryStore: SqliteDurableMemoryStore
}> {
  if (await isDirectory(statePath)) return openInstalledStorage(statePath, databasePath)
  const backupPath = `${statePath}.pre-sqlite.json`
  const source = await legacySource(statePath, backupPath)
  const snapshot = decodePiHostState(source)
  if (snapshot.schemaVersion === 3) throw new Error('SQLite Host state 佈局不完整；請使用原始備份復原。')
  await preserveBackup(backupPath, source)
  onTransition?.('backup-ready')
  const sourceHash = createHash('sha256').update(source).digest('hex')
  const memoryStore = await SqliteDurableMemoryStore.open(databasePath)
  try {
    await restrictDatabaseFiles(databasePath)
    const migrated = await memoryStore.migrateLegacy({
      access: { origin: 'migration', memoryReadEnabled: false, memoryWriteEnabled: false, temporary: false },
      sourceHash, sourceSchema: snapshot.schemaVersion as 1 | 2,
      // Raw rows are intentional: invalid rows must reach the quarantine report.
      memories: (JSON.parse(source) as { memories?: unknown[] }).memories || [],
    })
    onTransition?.('memory-committed')
    const next: PiHostSnapshot = { ...snapshot, memories: [], memoryAuthority: { backend: 'sqlite', sourceHash } }
    const staged = `${statePath}.cutover`
    await isDirectory(staged)
    await mkdir(staged, { recursive: true, mode: 0o700 })
    await atomicWrite(join(staged, 'snapshot.json'), JSON.stringify({ ...next, schemaVersion: 3 }))
    await atomicWrite(join(staged, 'migration-report.json'), JSON.stringify(migrated.report))
    await atomicWrite(join(staged, 'README.txt'), '此目錄阻擋舊版覆寫 SQLite 記憶。請使用相容版本；降級前須明確匯出。原始 JSON 備份位於同層 .pre-sqlite.json，僅供復原，不是 live authority。\n')
    const current = await optionalRead(statePath)
    if (current !== undefined) {
      if (current !== source) throw new Error('Host state 在遷移途中變更；拒絕覆寫，請保留來源與備份。')
      await chmod(statePath, 0o600)
      await rename(statePath, backupPath)
      await syncDirectory(dirname(statePath))
    }
    onTransition?.('legacy-retired')
    await rename(staged, statePath)
    await syncDirectory(dirname(statePath))
    onTransition?.('state-installed')
    return { snapshot: next, memoryStore }
  } catch (error) {
    await memoryStore.close()
    throw error
  }
}

async function openInstalledStorage(statePath: string, databasePath: string) {
  const snapshot = await loadPiHostState(statePath)
  if (!snapshot.memoryAuthority) throw new Error('Host state 目錄缺少 SQLite authority marker；拒絕啟動。')
  // Do not create an empty replacement database after a completed cutover.
  if (!(await lstat(databasePath)).isFile()) throw new Error('SQLite 記憶資料庫必須是一般檔案；拒絕啟動。')
  const memoryStore = await SqliteDurableMemoryStore.open(databasePath)
  try {
    const report = await memoryStore.migrationStatus()
    if (!report || report.sourceHash !== snapshot.memoryAuthority.sourceHash) throw new Error('Host state 與 SQLite migration marker 不一致；請從相符備份復原。')
    return { snapshot, memoryStore }
  } catch (error) {
    await memoryStore.close()
    throw error
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path)
    if (!metadata.isDirectory() && !metadata.isFile()) throw new Error('Host state 不允許符號連結或特殊檔案。')
    return metadata.isDirectory()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function optionalRead(path: string): Promise<string | undefined> {
  try {
    if (!(await lstat(path)).isFile()) throw new Error('Host state／backup 必須是一般檔案。')
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function legacySource(statePath: string, backupPath: string): Promise<string> {
  return await optionalRead(statePath) ?? await optionalRead(backupPath) ?? JSON.stringify(await loadPiHostState(statePath))
}

async function preserveBackup(path: string, source: string): Promise<void> {
  const previous = await optionalRead(path)
  if (previous !== undefined && previous !== source) throw new Error('原始 JSON 備份與來源不符；拒絕覆寫備份。')
  if (previous === undefined) await atomicWrite(path, source)
  await chmod(path, 0o600)
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try { await file.writeFile(content, 'utf8'); await file.sync() } finally { await file.close() }
  await rename(temporary, path)
  await syncDirectory(dirname(path))
}

async function syncDirectory(path: string): Promise<void> {
  // Windows does not support opening directories for fsync; rename is still atomic.
  if (process.platform === 'win32') return
  const directory = await open(path, 'r')
  try { await directory.sync() } finally { await directory.close() }
}

async function restrictDatabaseFiles(path: string): Promise<void> {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    try { await chmod(file, 0o600) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
