export type MemoryStorageHealthCode =
  | 'json_parse_failure'
  | 'sqlite_integrity_failure'
  | 'unsupported_schema'
  | 'migration_failure'
  | 'permission_error'
  | 'shutdown_timeout'
  | 'checkpoint_failure'
  | 'storage_unavailable'

export type MemoryStorageHealth =
  | { status: 'ready'; revision: number }
  | { status: 'closing'; revision: number }
  | { status: 'closed'; revision: number }
  | {
      status: 'degraded'
      code: MemoryStorageHealthCode
      message: string
      recovery: 'preserve-storage' | 'use-compatible-version' | 'explicit-export'
      readOnlyExport: boolean
    }

export class MemoryStorageLifecycleError extends Error {
  readonly health: Extract<MemoryStorageHealth, { status: 'degraded' }>

  constructor(
    code: MemoryStorageHealthCode,
    message: string,
    options: { cause?: unknown; recovery?: Extract<MemoryStorageHealth, { status: 'degraded' }>['recovery']; readOnlyExport?: boolean } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'MemoryStorageLifecycleError'
    this.health = {
      status: 'degraded',
      code,
      message,
      recovery: options.recovery || (code === 'unsupported_schema' ? 'use-compatible-version' : 'preserve-storage'),
      readOnlyExport: options.readOnlyExport === true,
    }
  }
}

export function permissionFailure(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code
  const sqliteCode = (error as { errcode?: unknown })?.errcode
  return code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || sqliteCode === 8 || sqliteCode === 14
}

export function storageLifecycleError(
  error: unknown,
  fallback: MemoryStorageHealthCode,
  fallbackMessage: string,
): MemoryStorageLifecycleError {
  if (error instanceof MemoryStorageLifecycleError) return error
  if (permissionFailure(error)) {
    return new MemoryStorageLifecycleError(
      'permission_error',
      '長期記憶儲存空間無法讀寫；未覆寫原資料，請檢查檔案與目錄權限。',
      { cause: error },
    )
  }
  return new MemoryStorageLifecycleError(
    fallback,
    error instanceof Error && error.message ? error.message : fallbackMessage,
    { cause: error },
  )
}
