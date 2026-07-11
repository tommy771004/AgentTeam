/**
 * Connector secrets — stored separately from plugin manifests.
 * Desktop: prefer hermes payload slot; browser: localStorage.
 * Not a full KMS; tokens stay local to the machine/profile.
 */

const STORAGE_KEY = 'subagents.plugin-secrets.v1'

export type PluginSecretRecord = {
  /** Raw credential (PAT / API key / OAuth access token) */
  token: string
  /** Optional refresh token for OAuth refresh */
  refreshToken?: string
  /** Absolute expiry time (ms since epoch) when known */
  expiresAt?: number
  /** Bearer / etc. */
  tokenType?: string
  updatedAt: string
}

type SecretMap = Record<string, PluginSecretRecord>

/** In-memory fallback for Node tests / SSR without localStorage */
let memoryMap: SecretMap = {}

function storage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* ignore */
  }
  return null
}

function readMap(): SecretMap {
  const store = storage()
  if (!store) return { ...memoryMap }
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as SecretMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeMap(map: SecretMap) {
  memoryMap = map
  const store = storage()
  if (store) store.setItem(STORAGE_KEY, JSON.stringify(map))
}

export function getPluginSecret(id: string): PluginSecretRecord | null {
  const rec = readMap()[id]
  return rec?.token ? rec : null
}

export function listPluginSecrets(): Array<{ id: string; record: PluginSecretRecord }> {
  return Object.entries(readMap())
    .filter(([, rec]) => Boolean(rec?.token))
    .map(([id, record]) => ({ id, record }))
}

export function hasPluginSecret(id: string): boolean {
  return Boolean(getPluginSecret(id)?.token)
}

export function setPluginSecret(
  id: string,
  token: string,
  extra?: {
    refreshToken?: string
    expiresIn?: number
    expiresAt?: number
    tokenType?: string
    /** When true, keep existing refreshToken if not provided */
    keepRefreshToken?: boolean
  },
): PluginSecretRecord {
  const map = readMap()
  const prev = map[id]
  const expiresAt =
    extra?.expiresAt ??
    (typeof extra?.expiresIn === 'number' && extra.expiresIn > 0
      ? Date.now() + extra.expiresIn * 1000
      : prev?.expiresAt)
  const rec: PluginSecretRecord = {
    token: token.trim(),
    refreshToken:
      extra?.refreshToken !== undefined
        ? extra.refreshToken
        : extra?.keepRefreshToken
          ? prev?.refreshToken
          : prev?.refreshToken,
    expiresAt,
    tokenType: extra?.tokenType || prev?.tokenType,
    updatedAt: new Date().toISOString(),
  }
  map[id] = rec
  writeMap(map)
  return rec
}

export function clearPluginSecret(id: string) {
  const map = readMap()
  delete map[id]
  writeMap(map)
}

export function accountHintFromToken(token: string): string {
  const t = token.trim()
  if (t.length <= 8) return '••••'
  return `…${t.slice(-4)}`
}

/** True when token is missing expiry or expires within `skewMs`. */
export function secretNeedsRefresh(rec: PluginSecretRecord, skewMs = 5 * 60 * 1000): boolean {
  if (!rec.refreshToken) return false
  if (!rec.expiresAt) return true
  return Date.now() + skewMs >= rec.expiresAt
}
