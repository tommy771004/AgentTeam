/** Main-process credential authority for integration secrets. */

export const CREDENTIAL_KINDS = ['telegram', 'webhook', 'custom-tool'] as const

export type CredentialKind = (typeof CREDENTIAL_KINDS)[number]
export type CredentialRef = `credential:${CredentialKind}:${string}`

export type CredentialVaultMetadata = {
  ref: CredentialRef
  kind: CredentialKind
  ownerId: string
  configured: true
  tokenHint: string
  updatedAt: string
  encrypted: boolean
}

export type CredentialVaultAvailability = {
  secureStorageAvailable: boolean
  persistence: 'encrypted' | 'unavailable'
  reason?: string
}

export type CredentialVaultIntent =
  | { action: 'list' }
  | { action: 'store'; kind: CredentialKind; ownerId: string; secret: string }
  | { action: 'rotate'; ref: CredentialRef; secret: string }
  | { action: 'clear'; ref: CredentialRef }

export type CredentialVaultIntentResult =
  | {
      ok: true
      metadata: CredentialVaultMetadata[]
      availability: CredentialVaultAvailability
    }
  | {
      ok: false
      code: 'INVALID_INTENT' | 'SECURE_STORAGE_UNAVAILABLE' | 'NOT_CONFIGURED' | 'VAULT_ERROR'
      error: string
      availability: CredentialVaultAvailability
    }

type CredentialVaultErrorCode = Extract<CredentialVaultIntentResult, { ok: false }>['code']

export type CredentialVaultDriverMetadata = {
  ref: string
  tokenHint: string
  updatedAt: string
  encrypted: boolean
}

export type CredentialVaultDriver = {
  secureStorageAvailable: () => boolean
  list: () => CredentialVaultDriverMetadata[]
  readForUse: (ref: string) => string | null
  store: (ref: string, secret: string) => CredentialVaultDriverMetadata
  clear: (ref: string) => void
}

const OWNER_ID = /^[A-Za-z0-9_.-]{1,128}$/
const KIND_SET = new Set<string>(CREDENTIAL_KINDS)
const UNAVAILABLE_REASON = 'OS 安全儲存不可用，憑證未保存'

class InvalidCredentialIntentError extends Error {}

function availability(driver: CredentialVaultDriver): CredentialVaultAvailability {
  const secureStorageAvailable = driver.secureStorageAvailable()
  return secureStorageAvailable
    ? { secureStorageAvailable: true, persistence: 'encrypted' }
    : {
        secureStorageAvailable: false,
        persistence: 'unavailable',
        reason: UNAVAILABLE_REASON,
      }
}

export function credentialReference(kind: unknown, ownerId: unknown): CredentialRef {
  if (typeof kind !== 'string' || !KIND_SET.has(kind)) throw new InvalidCredentialIntentError('credential kind 無效')
  if (typeof ownerId !== 'string' || !OWNER_ID.test(ownerId)) throw new InvalidCredentialIntentError('credential ownerId 無效')
  return `credential:${kind as CredentialKind}:${ownerId}`
}

function parseCredentialRef(value: unknown): {
  ref: CredentialRef
  kind: CredentialKind
  ownerId: string
} {
  if (typeof value !== 'string') throw new InvalidCredentialIntentError('credential ref 無效')
  const match = value.match(/^credential:([^:]+):([^:]+)$/)
  if (!match) throw new InvalidCredentialIntentError('credential ref 無效')
  const ref = credentialReference(match[1], match[2])
  if (ref !== value) throw new InvalidCredentialIntentError('credential ref 無效')
  return { ref, kind: match[1] as CredentialKind, ownerId: match[2] }
}

function validateSecret(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new InvalidCredentialIntentError('credential secret 必填')
  if (value.length > 65_536) throw new InvalidCredentialIntentError('credential secret 過長')
  return value.trim()
}

function metadata(driver: CredentialVaultDriver): CredentialVaultMetadata[] {
  return driver.list().flatMap((item) => {
    try {
      const parsed = parseCredentialRef(item.ref)
      return [{
        ...parsed,
        configured: true as const,
        tokenHint: String(item.tokenHint || '••••'),
        updatedAt: String(item.updatedAt || ''),
        encrypted: item.encrypted === true,
      }]
    } catch {
      return []
    }
  }).sort((left, right) => left.ref.localeCompare(right.ref))
}

export function createCredentialVaultAuthority(driver: CredentialVaultDriver) {
  const fail = (
    code: CredentialVaultErrorCode,
    error: string,
  ): CredentialVaultIntentResult => ({ ok: false, code, error, availability: availability(driver) })

  const handleIntent = (intent: CredentialVaultIntent): CredentialVaultIntentResult => {
    try {
      if (!intent || typeof intent !== 'object' || !('action' in intent)) {
        return fail('INVALID_INTENT', 'credential intent 無效')
      }
      if (intent.action === 'list') {
        return { ok: true, metadata: metadata(driver), availability: availability(driver) }
      }
      if (intent.action === 'clear') {
        const { ref } = parseCredentialRef(intent.ref)
        driver.clear(ref)
        return { ok: true, metadata: metadata(driver), availability: availability(driver) }
      }
      if (intent.action !== 'store' && intent.action !== 'rotate') {
        return fail('INVALID_INTENT', 'credential intent 無效')
      }
      const state = availability(driver)
      if (!state.secureStorageAvailable) return fail('SECURE_STORAGE_UNAVAILABLE', UNAVAILABLE_REASON)
      const ref = intent.action === 'store'
        ? credentialReference(intent.kind, intent.ownerId)
        : parseCredentialRef(intent.ref).ref
      if (intent.action === 'rotate' && !driver.list().some((item) => item.ref === ref)) {
        return fail('NOT_CONFIGURED', `credential 尚未設定：${ref}`)
      }
      driver.store(ref, validateSecret(intent.secret))
      return { ok: true, metadata: metadata(driver), availability: availability(driver) }
    } catch (error) {
      const invalidIntent = error instanceof InvalidCredentialIntentError
      return fail(
        invalidIntent ? 'INVALID_INTENT' : 'VAULT_ERROR',
        invalidIntent && error instanceof Error ? error.message : 'credential vault operation failed',
      )
    }
  }

  const use = <Result>(refValue: CredentialRef, consumer: (secret: string) => Result): Result => {
    const { ref } = parseCredentialRef(refValue)
    const secret = driver.readForUse(ref)
    if (!secret) throw new Error(`credential not configured: ${ref}`)
    return consumer(secret)
  }

  return { handleIntent, use }
}
