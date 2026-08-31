import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'
import { credentialReference } from './credentialVaultAuthority'
import { handleCredentialVaultIntent, withIntegrationCredential } from './integrationCredentialVault'

type SettingsRecord = Record<string, unknown>

function asSettings(value: unknown): SettingsRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Custom-tool 憑證遷移失敗：設定格式無效，原始資料已保留。')
  }
  return value as SettingsRecord
}

function parseSecretMap(value: unknown): Record<string, string> {
  if (value == null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('customToolSecrets 格式無效')
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, secret]) => {
    credentialReference('custom-tool', key)
    if (typeof secret !== 'string' || !secret.trim()) throw new Error(`custom-tool credential 無效：${key}`)
    return [key, secret]
  }))
}

function legacySecrets(settings: SettingsRecord): Record<string, string> {
  const direct = parseSecretMap(settings.customToolSecrets)
  const encrypted = settings.encryptedCustomToolSecrets
  if (encrypted == null) return direct
  if (typeof encrypted !== 'string' || !safeStorage.isEncryptionAvailable()) {
    throw new Error('OS 安全儲存不可用')
  }
  const decoded = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  return { ...parseSecretMap(JSON.parse(decoded)), ...direct }
}

export function withoutLegacyCustomToolCredentials<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const { customToolSecrets: _raw, encryptedCustomToolSecrets: _encrypted, ...safe } = value as SettingsRecord
  return safe as T
}

/** Test/legacy writer helper. New production settings never call this. */
export function encryptLegacyCustomToolSecrets(secrets: Record<string, string>): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS 安全儲存不可用')
  return safeStorage.encryptString(JSON.stringify(secrets)).toString('base64')
}

/** Vault wins over stale settings; scrub is returned only after main-side readback. */
export function migrateCustomToolCredentials<T>(value: T): T {
  const settings = asSettings(value)
  const secrets = legacySecrets(settings)
  try {
    for (const [ownerId, secret] of Object.entries(secrets)) {
      const ref = credentialReference('custom-tool', ownerId)
      const listed = handleCredentialVaultIntent({ action: 'list' })
      if (!listed.ok || !listed.availability.secureStorageAvailable) throw new Error('unavailable')
      if (!listed.metadata.some((item) => item.ref === ref && item.encrypted)) {
        const stored = handleCredentialVaultIntent({ action: 'store', kind: 'custom-tool', ownerId, secret })
        if (!stored.ok) throw new Error('write failed')
      }
      withIntegrationCredential(ref, () => undefined)
    }
    return withoutLegacyCustomToolCredentials(value)
  } catch {
    throw new Error('Custom-tool 憑證遷移失敗：安全儲存不可用或寫入失敗，原始資料已保留。')
  }
}

/** Replace settings atomically only after every credential is durable and readable. */
export function migrateCustomToolSettingsFile(file: string): SettingsRecord | null {
  if (!fs.existsSync(file)) return null
  let original: SettingsRecord
  try { original = asSettings(JSON.parse(fs.readFileSync(file, 'utf8'))) }
  catch { throw new Error('Custom-tool 設定或憑證資料無法讀取，原始檔案已保留。') }
  const safe = migrateCustomToolCredentials(original)
  if (Object.hasOwn(original, 'customToolSecrets') || Object.hasOwn(original, 'encryptedCustomToolSecrets')) {
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify(safe, null, 2), { mode: 0o600 })
      fs.renameSync(temporary, file)
    } finally { fs.rmSync(temporary, { force: true }) }
  }
  return safe
}
