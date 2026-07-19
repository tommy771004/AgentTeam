import type { MigrationSnapshot } from './updateContracts.ts'

const SENSITIVE_KEY = /(?:apiKey|token|secret|password|clientSecret|accessKey|privateKey)/i

function mergePreservingSensitive(existing: unknown, incoming: unknown): unknown {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing) || !incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming
  const result: Record<string, unknown> = { ...(incoming as Record<string, unknown>) }
  for (const [key, value] of Object.entries(existing as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key) && !(key in result)) result[key] = value
    else if (key in result) result[key] = mergePreservingSensitive(value, result[key])
  }
  return result
}

export type MigrationTransaction = {
  id: string
  previousVersion: string
  targetVersion: string
  snapshot: MigrationSnapshot
  status: 'prepared' | 'applied' | 'failed' | 'rolled-back'
  launchable: boolean
}

/** Pure transaction semantics used by the Electron file-backed updater and smoke tests. */
export function prepareMigrationTransaction(input: {
  id: string
  previousVersion: string
  targetVersion: string
  snapshot: MigrationSnapshot
}): MigrationTransaction {
  return { ...input, status: 'prepared', launchable: true }
}

export function markMigrationApplied(transaction: MigrationTransaction): MigrationTransaction {
  return { ...transaction, status: 'applied', launchable: true }
}

export function rollbackMigrationTransaction(transaction: MigrationTransaction): MigrationTransaction & { restoredSnapshot: MigrationSnapshot } {
  if (transaction.status !== 'failed' && transaction.status !== 'applied') throw new Error('migration transaction is not rollbackable')
  return { ...transaction, status: 'rolled-back', launchable: true, restoredSnapshot: structuredClone(transaction.snapshot) }
}

/** Apply only the app-owned renderer namespace, preserving unrelated site data. */
export function applyRendererStorageSnapshot(existing: Record<string, string>, snapshot: Record<string, string>): Record<string, string> {
  const next = Object.fromEntries(Object.entries(existing).filter(([key]) => !key.startsWith('subagents.')))
  for (const [key, value] of Object.entries(snapshot)) {
    if (key.includes('settings')) {
      try {
        const currentValue = existing[key]
        next[key] = JSON.stringify(mergePreservingSensitive(currentValue ? JSON.parse(currentValue) : {}, JSON.parse(value)))
        continue
      } catch { /* fall through to the exact snapshot value */ }
    }
    next[key] = value
  }
  return next
}
