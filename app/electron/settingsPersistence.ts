import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export type SettingsPersistenceCheckpoint =
  | 'before-temp-write'
  | 'during-temp-write'
  | 'before-rename'
  | 'after-rename'

export type SettingsReadResult =
  | { state: 'no-settings'; value: null }
  | { state: 'primary'; value: Record<string, unknown> }
  | { state: 'recovered-last-good'; value: Record<string, unknown> }
  | { state: 'corrupt-primary'; value: null }

export type SettingsPersistenceErrorCode = 'CORRUPT_PRIMARY' | 'WRITE_FAILED'

export class SettingsPersistenceError extends Error {
  readonly code: SettingsPersistenceErrorCode
  readonly stage: SettingsPersistenceCheckpoint | 'read' | 'backup' | 'flush'

  constructor(code: SettingsPersistenceErrorCode, stage: SettingsPersistenceError['stage']) {
    super(code === 'CORRUPT_PRIMARY'
      ? '設定檔損壞且沒有可用的 last-good；原始檔案已保留。'
      : `設定儲存失敗（${stage}）；舊值或新值仍保持完整。`)
    this.name = 'SettingsPersistenceError'
    this.code = code
    this.stage = stage
  }
}

export type SettingsPersistenceOptions = Readonly<{
  /** Deterministic durability-test seam; production callers omit it. */
  checkpoint?: (checkpoint: SettingsPersistenceCheckpoint) => void
}>

export type SettingsWriteOptions = Readonly<{
  /** Credential migration writes a sanitized next generation to both slots. */
  lastGood?: 'current' | 'next'
}>

function parseSettings(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function optionalFile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function syncDirectory(directory: string): void {
  if (process.platform === 'win32') return
  const fd = fs.openSync(directory, 'r')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

function writeBuffer(fd: number, value: Buffer, start: number, length: number): void {
  let written = 0
  while (written < length) {
    const count = fs.writeSync(fd, value, start + written, length - written)
    if (count === 0) throw new Error('zero-byte write')
    written += count
  }
}

function closeQuietly(fd: number | null): void {
  if (fd === null) return
  try { fs.closeSync(fd) } catch { /* best-effort cleanup */ }
}

function removeQuietly(file: string): void {
  try { fs.rmSync(file, { force: true }) } catch { /* best-effort cleanup */ }
}

function durableReplace(file: string, payload: string): void {
  const temporary = `${file}.${randomUUID()}.tmp`
  const bytes = Buffer.from(payload, 'utf8')
  let fd: number | null = null
  try {
    fd = fs.openSync(temporary, 'wx', 0o600)
    writeBuffer(fd, bytes, 0, bytes.length)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = null
    fs.renameSync(temporary, file)
    fs.chmodSync(file, 0o600)
    syncDirectory(path.dirname(file))
  } finally {
    closeQuietly(fd)
    removeQuietly(temporary)
  }
}

export class SettingsPersistence {
  private readonly file: string
  private readonly options: SettingsPersistenceOptions
  private readonly lastGoodFile: string

  constructor(
    file: string,
    options: SettingsPersistenceOptions = {},
  ) {
    this.file = file
    this.options = options
    this.lastGoodFile = `${file}.last-good`
  }

  read(): SettingsReadResult {
    const primaryRaw = optionalFile(this.file)
    const primary = primaryRaw === null ? null : parseSettings(primaryRaw)
    if (primary) return { state: 'primary', value: primary }
    const lastGoodRaw = optionalFile(this.lastGoodFile)
    const lastGood = lastGoodRaw === null ? null : parseSettings(lastGoodRaw)
    if (lastGood) return { state: 'recovered-last-good', value: lastGood }
    return primaryRaw === null && lastGoodRaw === null
      ? { state: 'no-settings', value: null }
      : { state: 'corrupt-primary', value: null }
  }

  write(value: Record<string, unknown>, writeOptions: SettingsWriteOptions = {}): void {
    const payload = JSON.stringify(value, null, 2)
    const directory = path.dirname(this.file)
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    let stage: SettingsPersistenceError['stage'] = 'backup'
    let fd: number | null = null
    try {
      const currentRaw = optionalFile(this.file)
      if (writeOptions.lastGood === 'next') {
        durableReplace(this.lastGoodFile, payload)
      } else if (currentRaw !== null && parseSettings(currentRaw)) {
        durableReplace(this.lastGoodFile, currentRaw)
      }

      stage = 'before-temp-write'
      this.options.checkpoint?.('before-temp-write')
      fd = fs.openSync(temporary, 'wx', 0o600)
      const bytes = Buffer.from(payload, 'utf8')
      const firstLength = Math.max(1, Math.floor(bytes.length / 2))
      writeBuffer(fd, bytes, 0, firstLength)

      stage = 'during-temp-write'
      this.options.checkpoint?.('during-temp-write')
      writeBuffer(fd, bytes, firstLength, bytes.length - firstLength)
      fs.fsyncSync(fd)
      fs.closeSync(fd)
      fd = null

      stage = 'before-rename'
      this.options.checkpoint?.('before-rename')
      fs.renameSync(temporary, this.file)
      fs.chmodSync(this.file, 0o600)

      stage = 'after-rename'
      this.options.checkpoint?.('after-rename')
      stage = 'flush'
      syncDirectory(directory)
    } catch {
      throw new SettingsPersistenceError('WRITE_FAILED', stage)
    } finally {
      closeQuietly(fd)
      removeQuietly(temporary)
    }
  }
}
