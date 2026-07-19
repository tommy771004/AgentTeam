export const PERSIST_NAMESPACE = 'subagents'

export interface PersistOptions<T> {
  /** Fallback value when key doesn't exist or parse fails */
  fallback: T
  /** Optional migration from legacy key */
  migrateFrom?: string
  /** Transform function for migrated data */
  migrate?: (raw: unknown) => T
}

/**
 * Read JSON from localStorage with fallback and optional one-time migration.
 * Migration runs at most once per key (tracked in sessionStorage).
 */
export function readJson<T>(key: string, options: PersistOptions<T>): T {
  const fullKey = `${PERSIST_NAMESPACE}:${key}`
  try {
    if (typeof localStorage === 'undefined') return options.fallback
    const raw = localStorage.getItem(fullKey)
    if (!raw) {
      // Attempt one-time migration from legacy key
      if (options.migrateFrom && !migrationDone(options.migrateFrom)) {
        const legacyRaw = localStorage.getItem(options.migrateFrom)
        if (legacyRaw) {
          const migrated = options.migrate ? options.migrate(JSON.parse(legacyRaw)) : (JSON.parse(legacyRaw) as T)
          writeJson(key, migrated)
          markMigrationDone(options.migrateFrom)
          return migrated
        }
        markMigrationDone(options.migrateFrom)
      }
      return options.fallback
    }
    return JSON.parse(raw) as T
  } catch {
    return options.fallback
  }
}

/**
 * Write JSON to localStorage. Silent fail on quota/expiry/unavailable.
 */
export function writeJson(key: string, value: unknown): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`${PERSIST_NAMESPACE}:${key}`, JSON.stringify(value))
    }
  } catch {
    /* unavailable localStorage: state stays in-memory only */
  }
}

/**
 * One-time migration guard using sessionStorage.
 * Returns true if migration already attempted for this key.
 */
function migrationDone(legacyKey: string): boolean {
  try {
    if (typeof sessionStorage === 'undefined') return false
    return sessionStorage.getItem(`persist:migrated:${legacyKey}`) === '1'
  } catch {
    return false
  }
}

function markMigrationDone(legacyKey: string): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(`persist:migrated:${legacyKey}`, '1')
    }
  } catch {
    /* ignore */
  }
}