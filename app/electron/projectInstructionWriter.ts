import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, copyFile, lstat, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'

const ALLOWED_TARGETS = new Set(['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md'])
const MAX_PROJECT_INSTRUCTION_BYTES = 128 * 1024
/**
 * Main-process windows share this module, so serialize writes to one
 * canonical target before the first CAS read. The file CAS remains the final
 * authority; this lock only prevents two local renderer requests from both
 * passing their final read before either atomic rename.
 */
const projectWriteLocks = new Map<string, Promise<void>>()

async function withProjectWriteLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = projectWriteLocks.get(key)
  let release!: () => void
  const current = new Promise<void>((resolveRelease) => { release = resolveRelease })
  projectWriteLocks.set(key, current)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (projectWriteLocks.get(key) === current) projectWriteLocks.delete(key)
  }
}

export type ProjectInstructionWriteFailureCode =
  | 'invalid_target'
  | 'invalid_content'
  | 'project_missing'
  | 'conflict'
  | 'permission_denied'
  | 'read_only'
  | 'disk_full'
  | 'rename_failure'
  | 'encoding_failure'
  | 'integrity_failure'
  | 'io_error'

export class ProjectInstructionWriteError extends Error {
  readonly code: ProjectInstructionWriteFailureCode
  readonly cause?: unknown

  constructor(code: ProjectInstructionWriteFailureCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'ProjectInstructionWriteError'
    this.code = code
    this.cause = cause
  }
}

export type ProjectInstructionWriteResult = Readonly<{
  path: string
  hash: string
  bytes: number
  created: boolean
}>

export type ProjectInstructionReadResult = Readonly<{
  path: string
  hash: string
  bytes: number
  content: string
}>

type WriteHooks = Readonly<{
  /** Deterministic contract-test seam immediately before the atomic rename. */
  beforeCommit?: (input: { temporaryPath: string; targetPath: string }) => Promise<void>
  /** Production rename seam used only by deterministic fault-injection tests. */
  renameFile?: (temporaryPath: string, targetPath: string) => Promise<void>
  /** Directory fsync seam used to qualify post-rename durability failures. */
  openDirectory?: (directoryPath: string) => Promise<{ sync: () => Promise<void>; close: () => Promise<void> }>
}>

type RecoveryJournal = Readonly<{
  version: 1
  phase: 'replace-pending' | 'degraded'
  target: string
  transactionId: string
  hasBackup: boolean
  expectedHash: string
  expectedBytes: number
  expectedMode: number
  originalMode: number
  originalHash: string
  originalBytes: number
  originalExists: boolean
}>

type CurrentInstruction = Awaited<ReturnType<typeof readCurrent>>

type WriteTransaction = Readonly<{
  input: { projectRoot: string; target: string; expectedHash: string; content: string }
  hooks: WriteHooks
  bytes: number
  projectRoot: string
  targetPath: string
  temporaryPath: string
  backupPath?: string
  journalPath: string
  transactionId: string
  observed: CurrentInstruction
}>

function recoveryJournalPath(targetPath: string): string {
  return join(dirname(targetPath), `.${basename(targetPath)}.recovery.json`)
}

function artifactPaths(root: string, target: string, transactionId: string): { temporaryPath: string; backupPath?: string } {
  const prefix = `.${target}.${transactionId}`
  return {
    temporaryPath: join(root, `${prefix}.tmp`),
    ...(target ? { backupPath: join(root, `${prefix}.backup.tmp`) } : {}),
  }
}

function validTransactionId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[4-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

function inside(root: string, target: string): boolean {
  const relation = relative(root, target)
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

async function assertSafeArtifact(root: string, path: string, optional = true): Promise<void> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isFile() || !inside(root, path)) {
      throw new ProjectInstructionWriteError('integrity_failure', 'Project instruction recovery artifact 不是 canonical regular file。')
    }
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException)?.code === 'ENOENT') return
    if (error instanceof ProjectInstructionWriteError) throw error
    throw new ProjectInstructionWriteError('integrity_failure', 'Project instruction recovery artifact 無法驗證。', error)
  }
}

async function cleanupRecoveryArtifacts(root: string, journalPath: string, artifacts: { temporaryPath: string; backupPath?: string }): Promise<void> {
  try {
    if (artifacts.backupPath) await unlink(artifacts.backupPath).catch((error) => {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
    })
    await unlink(artifacts.temporaryPath).catch((error) => {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
    })
    await syncDirectory(root, {})
    await unlink(journalPath)
    await syncDirectory(root, {})
  } catch (error) {
    throw new ProjectInstructionWriteError('integrity_failure', 'Project instruction recovery cleanup 無法 durable 完成；Host 維持 degraded 狀態。', error)
  }
}

async function writeRecoveryJournal(path: string, journal: RecoveryJournal): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify(journal), 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

function isRecoveryJournal(value: Partial<RecoveryJournal>): value is RecoveryJournal {
  return value.version === 1
    && (value.phase === 'replace-pending' || value.phase === 'degraded')
    && typeof value.target === 'string'
    && ALLOWED_TARGETS.has(value.target)
    && validTransactionId(value.transactionId)
    && typeof value.hasBackup === 'boolean'
    && typeof value.expectedHash === 'string'
    && Number.isSafeInteger(value.expectedBytes)
    && Number(value.expectedBytes) >= 0
    && Number.isSafeInteger(value.expectedMode)
    && Number(value.expectedMode) >= 0
    && Number(value.expectedMode) <= 0o777
    && Number.isSafeInteger(value.originalMode)
    && Number(value.originalMode) >= 0
    && Number(value.originalMode) <= 0o777
    && typeof value.originalHash === 'string'
    && Number.isSafeInteger(value.originalBytes)
    && Number(value.originalBytes) >= 0
    && typeof value.originalExists === 'boolean'
}

async function readRecoveryJournal(path: string): Promise<RecoveryJournal | undefined> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new ProjectInstructionWriteError('integrity_failure', 'Project instruction recovery journal 必須是 canonical regular file。')
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<RecoveryJournal>
    if (!isRecoveryJournal(parsed)) {
      throw new ProjectInstructionWriteError('integrity_failure', 'Project instruction recovery journal schema 無效；Host 維持 degraded 狀態。')
    }
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined
    if (error instanceof ProjectInstructionWriteError) throw error
    throw new ProjectInstructionWriteError('integrity_failure', 'Project instruction recovery journal 無法讀取；Host 維持 degraded 狀態。', error)
  }
}

function recoveryMetadataMatches(current: CurrentInstruction, journal: RecoveryJournal): boolean {
  return current.exists
    && current.hash === journal.originalHash
    && Buffer.byteLength(current.content) === journal.originalBytes
    && current.mode === journal.originalMode
}

async function assertRecoveryBackup(backupPath: string | undefined, journal: RecoveryJournal, required: boolean): Promise<void> {
  if (!backupPath) {
    if (required) throw new ProjectInstructionWriteError('integrity_failure', 'Project instruction recovery 尚未完成；Host 維持 degraded/read-only 狀態。')
    return
  }
  const backup = await readCurrent(backupPath)
  if ((required && !backup.exists) || (backup.exists && !recoveryMetadataMatches(backup, journal))) {
    throw new ProjectInstructionWriteError('integrity_failure', required
      ? 'Project instruction safe recovery backup metadata 不符。'
      : 'Project instruction recovery backup metadata 不符；Host 維持 degraded 狀態。')
  }
}

async function recoverDegradedInstruction(input: {
  root: string
  targetPath: string
  journalPath: string
  temporaryPath: string
  backupPath?: string
  journal: RecoveryJournal
}): Promise<void> {
  try {
    await assertRecoveryBackup(input.backupPath, input.journal, true)
    await rename(input.backupPath!, input.targetPath)
    await chmod(input.targetPath, input.journal.originalMode)
    const restored = await readCurrent(input.targetPath)
    if (!recoveryMetadataMatches(restored, input.journal)) throw new ProjectInstructionWriteError('integrity_failure', 'Project instruction safe recovery restore metadata 不符。')
    await syncDirectory(dirname(input.targetPath), {})
    await cleanupRecoveryArtifacts(input.root, input.journalPath, { temporaryPath: input.temporaryPath })
  } catch (error) {
    throw new ProjectInstructionWriteError('integrity_failure', 'Project instruction safe recovery 失敗；Host 維持 degraded/read-only 狀態。', error)
  }
}

function committedMetadataMatches(current: CurrentInstruction, journal: RecoveryJournal): boolean {
  return current.exists
    && current.hash === journal.expectedHash
    && Buffer.byteLength(current.content) === journal.expectedBytes
    && current.mode === journal.expectedMode
}

function originalMetadataMatches(current: CurrentInstruction, journal: RecoveryJournal): boolean {
  if (current.exists !== journal.originalExists || current.hash !== journal.originalHash) return false
  return !current.exists || (Buffer.byteLength(current.content) === journal.originalBytes && current.mode === journal.originalMode)
}

/**
 * Recover an interrupted project instruction replacement before any Host
 * resolve/write operation observes the target. The target is never moved to a
 * backup: the backup is a durable copy and rollback is one atomic replacement.
 */
async function recoverProjectInstructionUnlocked(root: string, target: string): Promise<void> {
  const targetPath = join(root, target)
  const journalPath = recoveryJournalPath(targetPath)
  const journal = await readRecoveryJournal(journalPath)
  if (!journal) return
  if (journal.target !== target) {
    throw new ProjectInstructionWriteError('integrity_failure', 'Project instruction recovery target identity 不符；需要人工復原。')
  }
  const artifacts = artifactPaths(root, target, journal.transactionId)
  const backupPath = journal.hasBackup ? artifacts.backupPath : undefined
  await assertSafeArtifact(root, artifacts.temporaryPath)
  if (backupPath) await assertSafeArtifact(root, backupPath)
  if (journal.phase === 'degraded') {
    // A fresh Host may safely finish the operator-visible recovery when the
    // durable original copy is still present. Until this succeeds, every
    // resolve/write remains fenced by integrity_failure.
    await recoverDegradedInstruction({ root, targetPath, journalPath, temporaryPath: artifacts.temporaryPath, backupPath, journal })
    return
  }
  const current = await readCurrent(targetPath)
  if (committedMetadataMatches(current, journal)) {
    // The replace reached the target before a crash. Keep the committed body,
    // then remove only recovery artefacts.
    await assertRecoveryBackup(backupPath, journal, false)
    await cleanupRecoveryArtifacts(root, journalPath, artifacts)
    return
  }
  if (!originalMetadataMatches(current, journal)) {
    throw new ProjectInstructionWriteError('integrity_failure', 'Project instruction recovery 無法判定 target truth；Host 維持 degraded/read-only 狀態。')
  }
  // Replace did not happen. The original target was left in place, so only
  // discard staged artefacts and the journal.
  await assertRecoveryBackup(backupPath, journal, false)
  await cleanupRecoveryArtifacts(root, journalPath, artifacts)
}

export async function recoverProjectInstruction(projectRoot: string, target: string): Promise<void> {
  if (!ALLOWED_TARGETS.has(target) || target !== basename(target)) {
    throw new ProjectInstructionWriteError('invalid_target', '只允許明確建立或編輯 AGENTS.md、AGENTS.override.md 或 CLAUDE.md。')
  }
  const root = await realpath(projectRoot).catch((error) => {
    throw new ProjectInstructionWriteError('project_missing', '目前 canonical project root 不存在。', error)
  })
  return withProjectWriteLock(`${root}\u0000${target}`, () => recoverProjectInstructionUnlocked(root, target))
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function failureFor(error: unknown, fallback: string): ProjectInstructionWriteError {
  if (error instanceof ProjectInstructionWriteError) return error
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'EACCES' || code === 'EPERM') return new ProjectInstructionWriteError('permission_denied', fallback, error)
  if (code === 'EROFS') return new ProjectInstructionWriteError('read_only', fallback, error)
  if (code === 'ENOSPC') return new ProjectInstructionWriteError('disk_full', fallback, error)
  if (code === 'EILSEQ' || code === 'ERR_INVALID_ARG_VALUE') return new ProjectInstructionWriteError('encoding_failure', fallback, error)
  return new ProjectInstructionWriteError('io_error', fallback, error)
}

function renameFailureFor(error: unknown): ProjectInstructionWriteError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'EACCES' || code === 'EPERM') return new ProjectInstructionWriteError('permission_denied', 'Project instruction rename 被拒絕；原檔保持不變。', error)
  if (code === 'EROFS') return new ProjectInstructionWriteError('read_only', 'Project instruction filesystem 為唯讀；原檔保持不變。', error)
  if (code === 'ENOSPC') return new ProjectInstructionWriteError('disk_full', 'Project instruction filesystem 空間不足；原檔保持不變。', error)
  if (code === 'EILSEQ' || code === 'ERR_INVALID_ARG_VALUE') return new ProjectInstructionWriteError('encoding_failure', 'Project instruction encoding 失敗；原檔保持不變。', error)
  return new ProjectInstructionWriteError('rename_failure', 'Project instruction rename 失敗；原檔保持不變。', error)
}

async function syncDirectory(directoryPath: string, hooks: WriteHooks): Promise<void> {
  const directory = await (hooks.openDirectory || (async (path: string) => await open(path, 'r')))(directoryPath)
  let failure: unknown
  try {
    await directory.sync()
  } catch (error) {
    failure = error
  }
  try {
    await directory.close()
  } catch (error) {
    failure ||= error
  }
  if (failure) throw failure
}

async function renameAtomically(
  from: string,
  to: string,
  hooks: WriteHooks,
): Promise<void> {
  try {
    await (hooks.renameFile || rename)(from, to)
  } catch (error) {
    if (error instanceof ProjectInstructionWriteError) throw error
    throw renameFailureFor(error)
  }
}

async function readCurrent(targetPath: string): Promise<{
  exists: boolean
  content: string
  hash: string
  mode: number
  signature: string
}> {
  try {
    const linkInfo = await lstat(targetPath)
    if (linkInfo.isSymbolicLink() || !linkInfo.isFile()) throw new ProjectInstructionWriteError('invalid_target', 'Instruction target 必須是 canonical 一般檔案。')
    const info = await stat(targetPath)
    const content = await readFile(targetPath, 'utf8')
    return {
      exists: true,
      content,
      hash: contentHash(content),
      mode: info.mode & 0o777,
      signature: `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { exists: false, content: '', hash: '', mode: 0o600, signature: 'missing' }
    }
    throw failureFor(error, '無法讀取目前 project instruction。')
  }
}

function validateWriteContent(input: { target: string; content: string }): number {
  if (!ALLOWED_TARGETS.has(input.target) || input.target !== basename(input.target)) {
    throw new ProjectInstructionWriteError('invalid_target', '只允許明確建立或編輯 AGENTS.md、AGENTS.override.md 或 CLAUDE.md。')
  }
  if (typeof input.content !== 'string') {
    throw new ProjectInstructionWriteError('invalid_content', 'Project instruction content 必須是文字。')
  }
  const bytes = Buffer.byteLength(input.content)
  if (bytes > MAX_PROJECT_INSTRUCTION_BYTES) {
    throw new ProjectInstructionWriteError('invalid_content', `Project instruction 超過 ${MAX_PROJECT_INSTRUCTION_BYTES} bytes。`)
  }
  return bytes
}

async function canonicalProjectRoot(path: string): Promise<string> {
  try {
    const root = await realpath(path)
    if (!(await stat(root)).isDirectory()) throw new Error('project root 不是目錄')
    return root
  } catch (error) {
    throw new ProjectInstructionWriteError('project_missing', '目前 canonical project root 不存在。', error)
  }
}

function transactionJournal(transaction: WriteTransaction, phase: RecoveryJournal['phase']): RecoveryJournal {
  return {
    version: 1,
    phase,
    target: transaction.input.target,
    transactionId: transaction.transactionId,
    hasBackup: Boolean(transaction.backupPath),
    expectedHash: contentHash(transaction.input.content),
    expectedBytes: transaction.bytes,
    expectedMode: transaction.observed.mode,
    originalMode: transaction.observed.mode,
    originalHash: transaction.observed.hash,
    originalBytes: Buffer.byteLength(transaction.observed.content),
    originalExists: transaction.observed.exists,
  }
}

async function stageInstruction(transaction: WriteTransaction): Promise<void> {
  const handle = await open(transaction.temporaryPath, 'wx', transaction.observed.mode)
  try {
    await handle.writeFile(transaction.input.content, 'utf8')
    await handle.chmod(transaction.observed.mode)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function sameObservedFile(current: CurrentInstruction, observed: CurrentInstruction): boolean {
  return current.hash === observed.hash && current.signature === observed.signature
}

async function assertTargetUnchanged(transaction: WriteTransaction): Promise<void> {
  const current = await readCurrent(transaction.targetPath)
  if (!sameObservedFile(current, transaction.observed)) {
    throw new ProjectInstructionWriteError('conflict', 'Instruction file conflict：檔案在儲存期間被外部修改，原檔保持不變。')
  }
}

async function prepareDurableRecovery(transaction: WriteTransaction): Promise<void> {
  await assertTargetUnchanged(transaction)
  if (transaction.backupPath) {
    // Copy (rather than rename) keeps target present until the single atomic
    // temp -> target replacement. The backup is synced before replacement.
    await copyFile(transaction.targetPath, transaction.backupPath)
    await chmod(transaction.backupPath, transaction.observed.mode)
    const backup = await open(transaction.backupPath, 'r+')
    try { await backup.sync() } finally { await backup.close() }
  }
  await writeRecoveryJournal(transaction.journalPath, transactionJournal(transaction, 'replace-pending'))
  await syncDirectory(dirname(transaction.targetPath), transaction.hooks)
}

async function assertTransactionBackup(transaction: WriteTransaction): Promise<void> {
  if (!transaction.backupPath) return
  const backup = await readCurrent(transaction.backupPath)
  const observedBytes = Buffer.byteLength(transaction.observed.content)
  if (!backup.exists || backup.hash !== transaction.observed.hash || Buffer.byteLength(backup.content) !== observedBytes || backup.mode !== transaction.observed.mode) {
    throw new ProjectInstructionWriteError('integrity_failure', 'Project instruction backup identity/hash 不符；原檔保持不變。')
  }
}

async function commitInstruction(transaction: WriteTransaction): Promise<void> {
  await transaction.hooks.beforeCommit?.({ temporaryPath: transaction.temporaryPath, targetPath: transaction.targetPath })
  // The hook models an external editor and is intentionally followed by the
  // last possible CAS read. No fallible work is allowed between this check
  // and the single atomic replacement.
  await assertTransactionBackup(transaction)
  await assertTargetUnchanged(transaction)
  await renameAtomically(transaction.temporaryPath, transaction.targetPath, transaction.hooks)
}

async function verifyAndFinalizeCommit(transaction: WriteTransaction): Promise<void> {
  const committed = await readCurrent(transaction.targetPath)
  const expectedHash = contentHash(transaction.input.content)
  if (!committed.exists || committed.hash !== expectedHash || Buffer.byteLength(committed.content) !== transaction.bytes || committed.mode !== transaction.observed.mode) {
    throw new ProjectInstructionWriteError('integrity_failure', 'Project instruction committed target metadata 不符。')
  }
  await syncDirectory(dirname(transaction.targetPath), transaction.hooks)
  if (transaction.backupPath) await unlink(transaction.backupPath)
  await unlink(transaction.journalPath)
  await syncDirectory(dirname(transaction.targetPath), transaction.hooks)
}

async function rollbackInstruction(transaction: WriteTransaction, installed: boolean): Promise<boolean> {
  try {
    if (installed && !transaction.observed.exists) await unlink(transaction.targetPath)
    if (installed && transaction.backupPath) {
      // The backup is the original body. Replacing the target with it is a
      // single atomic rollback and never exposes a missing target window.
      await renameAtomically(transaction.backupPath, transaction.targetPath, transaction.hooks)
      await chmod(transaction.targetPath, transaction.observed.mode)
    }
    await syncDirectory(dirname(transaction.targetPath), transaction.hooks)
    return true
  } catch {
    return false
  }
}

async function cleanupFailedTransaction(transaction: WriteTransaction, restored: boolean): Promise<void> {
  try { await unlink(transaction.temporaryPath) } catch { /* already committed or never created */ }
  if (!restored) return
  try { if (transaction.backupPath) await unlink(transaction.backupPath) } catch { /* integrity failure reports any leak */ }
  try { await unlink(transaction.journalPath) } catch { /* recovery will retry on reopen */ }
}

async function persistDegradedTransaction(transaction: WriteTransaction): Promise<void> {
  try {
    await writeRecoveryJournal(transaction.journalPath, transactionJournal(transaction, 'degraded'))
    await syncDirectory(dirname(transaction.targetPath), transaction.hooks)
  } catch { /* existing replace-pending journal remains a fail-closed fence */ }
}

/** Read an editable source through the Host boundary without adding its body
 * to the model-facing instruction projection. Membership and openability are
 * checked by the protocol owner before this helper is called. */
export async function readProjectInstruction(input: {
  projectRoot: string
  target: string
}): Promise<ProjectInstructionReadResult> {
  if (!ALLOWED_TARGETS.has(input.target) || input.target !== basename(input.target)) {
    throw new ProjectInstructionWriteError('invalid_target', '只允許明確建立或編輯 AGENTS.md、AGENTS.override.md 或 CLAUDE.md。')
  }
  const root = await realpath(input.projectRoot).catch((error) => {
    throw new ProjectInstructionWriteError('project_missing', '目前 canonical project root 不存在。', error)
  })
  await recoverProjectInstruction(root, input.target)
  const targetPath = join(root, input.target)
  let canonicalTarget: string
  try { canonicalTarget = await realpath(targetPath) } catch (error) {
    throw new ProjectInstructionWriteError('project_missing', '目前 project instruction source 不存在。', error)
  }
  if (canonicalTarget !== targetPath) throw new ProjectInstructionWriteError('invalid_target', 'project instruction source 必須是 project root 內 canonical regular file。')
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(targetPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    const before = await handle.stat()
    if (!before.isFile()) throw new ProjectInstructionWriteError('invalid_target', 'project instruction source 必須是一般檔案。')
    const content = await handle.readFile('utf8')
    const after = await handle.stat()
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
      throw new ProjectInstructionWriteError('conflict', 'project instruction source 在讀取期間變更，請重新載入。')
    }
    return Object.freeze({ path: targetPath, hash: contentHash(content), bytes: Buffer.byteLength(content), content })
  } catch (error) {
    if (error instanceof ProjectInstructionWriteError) throw error
    throw failureFor(error, 'project instruction source 無法安全讀取。')
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/**
 * Compare-and-swap an explicitly selected root instruction file.
 *
 * The replacement is written and fsynced under a sibling temporary name. The
 * observed file is checked again immediately before rename, so changes made by
 * an external editor during draft preparation or temporary-file writing win.
 */
async function writeProjectInstructionUnlocked(
  input: { projectRoot: string; target: string; expectedHash: string; content: string },
  hooks: WriteHooks = {},
): Promise<ProjectInstructionWriteResult> {
  const bytes = validateWriteContent(input)
  const projectRoot = await canonicalProjectRoot(input.projectRoot)
  const targetPath = join(projectRoot, input.target)
  // The public recovery entry also takes this target's lock. This write path
  // already owns it, so call the unlocked core to avoid re-entrant deadlock.
  await recoverProjectInstructionUnlocked(projectRoot, input.target)
  const observed = await readCurrent(targetPath)
  if (input.expectedHash !== observed.hash) {
    throw new ProjectInstructionWriteError('conflict', 'Instruction file conflict：檔案已被外部修改，請重新載入後再套用草稿。')
  }

  const transactionId = randomUUID()
  const artifacts = artifactPaths(projectRoot, input.target, transactionId)
  const temporaryPath = artifacts.temporaryPath
  const backupPath = observed.exists ? artifacts.backupPath : undefined
  const journalPath = recoveryJournalPath(targetPath)
  const transaction: WriteTransaction = { input, hooks, bytes, projectRoot, targetPath, temporaryPath, backupPath, journalPath, transactionId, observed }
  let installed = false
  try {
    await stageInstruction(transaction)
    await prepareDurableRecovery(transaction)
    await commitInstruction(transaction)
    installed = true
    await verifyAndFinalizeCommit(transaction)
  } catch (error) {
    const restored = await rollbackInstruction(transaction, installed)
    await cleanupFailedTransaction(transaction, restored)
    if (!restored) {
      // Persist degraded state when rollback cannot be proven. A later Host
      // instance refuses resolve/write until an operator-safe recovery occurs.
      await persistDegradedTransaction(transaction)
    }
    if (!restored) throw new ProjectInstructionWriteError('integrity_failure', 'Project instruction commit durability 無法確認；Host 必須維持 degraded 狀態。', error)
    throw failureFor(error, 'Project instruction atomic replacement 失敗；原檔保持不變。')
  }

  return Object.freeze({ path: targetPath, hash: contentHash(input.content), bytes, created: !observed.exists })
}

/**
 * Serialize same-process renderer windows by canonical target. Invalid or
 * missing roots deliberately fall through so the unlocked implementation
 * preserves its original typed validation/error ordering.
 */
export async function writeProjectInstruction(
  input: { projectRoot: string; target: string; expectedHash: string; content: string },
  hooks: WriteHooks = {},
): Promise<ProjectInstructionWriteResult> {
  let key: string | undefined
  if (ALLOWED_TARGETS.has(input.target) && input.target === basename(input.target)) {
    try {
      const root = await realpath(input.projectRoot)
      if ((await stat(root)).isDirectory()) key = `${root}\u0000${input.target}`
    } catch { /* unlocked validation reports the typed root error */ }
  }
  return key ? withProjectWriteLock(key, () => writeProjectInstructionUnlocked(input, hooks)) : writeProjectInstructionUnlocked(input, hooks)
}
