import { INTEGRATION_CREDENTIALS, legacyIntegrationCredentials, withoutIntegrationCredentials } from '../src/agent/integrationCredentials'
import { handleCredentialVaultIntent, withIntegrationCredential } from './integrationCredentialVault'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

/** Vault wins over stale settings. Caller persists the returned projection only on success. */
export function migrateIntegrationCredentials<T>(settings: T): T {
  const legacy = legacyIntegrationCredentials(settings)
  try {
    for (const { kind, field, ref } of INTEGRATION_CREDENTIALS) {
      if (!legacy[field]) continue
      const listed = handleCredentialVaultIntent({ action: 'list' })
      if (!listed.ok || !listed.availability.secureStorageAvailable) throw new Error('unavailable')
      if (!listed.metadata.some((item) => item.ref === ref && item.encrypted)) {
        const saved = handleCredentialVaultIntent({ action: 'store', kind, ownerId: 'primary', secret: legacy[field] })
        if (!saved.ok) throw new Error('write failed')
      }
      // Read-for-use remains main-only; no raw value is returned to the caller.
      withIntegrationCredential(ref, () => undefined)
    }
    return withoutIntegrationCredentials(settings)
  } catch {
    throw new Error('憑證遷移失敗：安全儲存不可用或寫入失敗，原始資料已保留，請重試。')
  }
}

/** Scrub legacy disk fields only after vault verification; failed writes keep the original file. */
export function migrateIntegrationSettingsFile(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return null
  let original: Record<string, unknown>
  try {
    original = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    if (!original || typeof original !== 'object' || Array.isArray(original)) throw new Error('invalid settings')
  } catch {
    throw new Error('設定或憑證資料無法讀取，原始檔案已保留。')
  }
  const safe = migrateIntegrationCredentials(original)
  if (INTEGRATION_CREDENTIALS.some(({ field }) => Object.hasOwn(original, field))) {
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify(safe, null, 2), { mode: 0o600 })
      fs.renameSync(temporary, file)
    } finally {
      fs.rmSync(temporary, { force: true })
    }
  }
  return safe
}
