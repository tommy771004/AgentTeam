import { INTEGRATION_CREDENTIALS, LEGACY_CREDENTIAL_FIELDS, legacyIntegrationCredentials, withoutIntegrationCredentials } from '../src/agent/integrationCredentials'
import { handleCredentialVaultIntent, withIntegrationCredential } from './integrationCredentialVault'
import { credentialReference, type CredentialKind } from './credentialVaultAuthority'
import { safeStorage } from 'electron'
import {
  SettingsPersistence,
  SettingsPersistenceError,
  type SettingsReadResult,
} from './settingsPersistence'

/** Vault wins over stale settings. Caller persists the returned projection only on success. */
export function migrateIntegrationCredentials<T>(settings: T): T {
  const legacy = legacyIntegrationCredentials(settings)
  try {
    const migrate = (kind: CredentialKind, ownerId: string, secret: unknown) => {
      if (secret === '' || secret === '***REDACTED***') return
      if (typeof secret !== 'string') throw new Error('invalid legacy credential')
      const ref = credentialReference(kind, ownerId)
      const listed = handleCredentialVaultIntent({ action: 'list' })
      if (!listed.ok || !listed.availability.secureStorageAvailable) throw new Error('unavailable')
      if (!listed.metadata.some((item) => item.ref === ref && item.encrypted)) {
        const saved = handleCredentialVaultIntent({ action: 'store', kind, ownerId, secret })
        if (!saved.ok) throw new Error('write failed')
      }
      // Read-for-use remains main-only; no raw value is returned to the caller.
      withIntegrationCredential(ref, () => undefined)
    }
    for (const { kind, field } of INTEGRATION_CREDENTIALS) {
      if (legacy[field]) migrate(kind, 'primary', legacy[field])
    }
    // Decode only in main; never hydrate decrypted legacy values into the renderer.
    const encrypted = legacy.encryptedCustomToolSecrets
    const custom = encrypted
      ? JSON.parse(safeStorage.decryptString(Buffer.from(String(encrypted), 'base64')))
      : legacy.customToolSecrets
    if (custom != null) {
      if (typeof custom !== 'object' || Array.isArray(custom)) throw new Error('invalid legacy secrets')
      for (const [ownerId, secret] of Object.entries(custom)) migrate('custom-tool', ownerId, secret)
    }
    return withoutIntegrationCredentials(settings)
  } catch {
    throw new Error('憑證遷移失敗：安全儲存不可用或寫入失敗，原始資料已保留，請重試。')
  }
}

/** Scrub legacy disk fields only after vault verification; failed writes keep the original file. */
export function migrateIntegrationSettingsFileWithStatus(file: string): SettingsReadResult {
  const persistence = new SettingsPersistence(file)
  const read = persistence.read()
  if (read.state === 'corrupt-primary') {
    throw new SettingsPersistenceError('CORRUPT_PRIMARY', 'read')
  }
  if (read.value === null) return read
  const original = read.value
  const safe = migrateIntegrationCredentials(original)
  const hasLegacyFields = LEGACY_CREDENTIAL_FIELDS.some((field) => Object.hasOwn(original, field))
  if (
    read.state === 'recovered-last-good'
    || hasLegacyFields
  ) {
    persistence.write(safe, {
      lastGood: hasLegacyFields ? 'next' : 'current',
    })
  }
  return { state: read.state, value: safe }
}

/** Backward-compatible data projection for existing main-process consumers. */
export function migrateIntegrationSettingsFile(file: string): Record<string, unknown> | null {
  return migrateIntegrationSettingsFileWithStatus(file).value
}
