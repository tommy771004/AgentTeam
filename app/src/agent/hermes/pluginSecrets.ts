/**
 * Connector secrets vault client.
 *
 * Electron: raw tokens live ONLY in the main-process vault (safeStorage file).
 * The renderer holds a metadata mirror (hint / expiry / hasRefreshToken) and can
 * store / clear / trigger refresh — it can never read a raw token back.
 * Legacy localStorage records are migrated into the vault once, then removed.
 *
 * Browser (non-Electron dev): falls back to the old localStorage records so the
 * app remains usable without IPC. Records never enter export payloads.
 */

const STORAGE_KEY = 'subagents.plugin-secrets.v1'

export type PluginSecretRecord = {
  /** Raw credential — browser fallback only; Electron never exposes it */
  token: string
  refreshToken?: string
  expiresAt?: number
  tokenType?: string
  updatedAt: string
}

export type PluginSecretMeta = {
  id: string
  tokenHint: string
  expiresAt?: number
  tokenType?: string
  updatedAt: string
  hasRefreshToken: boolean
  encrypted: boolean
}

type SecretMap = Record<string, PluginSecretRecord>

/** Minimal structural view of the preload vault API (DOM lib not guaranteed here). */
type VaultApi = {
  list: () => Promise<PluginSecretMeta[]>
  store: (input: {
    id: string
    token: string
    refreshToken?: string
    expiresIn?: number
    expiresAt?: number
    tokenType?: string
    keepRefreshToken?: boolean
    allowPlaintext?: boolean
  }) => Promise<{ ok: true; meta: PluginSecretMeta } | { ok: false; error: string; code?: string }>
  clear: (id: string) => Promise<{ ok: boolean }>
  migrate: (map: Record<string, unknown>) => Promise<{ ok: boolean; imported: number; error?: string }>
  refresh: (input: {
    pluginId: string
    clientId: string
    clientSecret?: string
    tokenUrl: string
    tokenAuth?: 'body' | 'basic'
  }) => Promise<{ ok: true; meta: PluginSecretMeta } | { ok: false; error: string }>
}

/** In-memory fallback for Node tests / SSR without localStorage */
let memoryMap: SecretMap = {}
/** Electron metadata mirror (hydrated from vault) */
let metaMap: Record<string, PluginSecretMeta> = {}
let hydratedFromVault = false

function vaultApi(): VaultApi | undefined {
  const g = globalThis as unknown as { subagents?: { secrets?: VaultApi } }
  return g.subagents?.secrets
}

/** Shared accessor for sibling modules (DOM-lib-free). */
export function pluginSecretsVaultApi(): VaultApi | undefined {
  return vaultApi()
}

function storage(): Storage | null {
  try {
    if (
      typeof localStorage !== 'undefined' &&
      typeof localStorage.getItem === 'function' &&
      typeof localStorage.setItem === 'function'
    ) {
      return localStorage
    }
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

export function accountHintFromToken(token: string): string {
  const t = token.trim()
  if (t.length <= 8) return '••••'
  return `…${t.slice(-4)}`
}

function metaFromRecord(id: string, rec: PluginSecretRecord): PluginSecretMeta {
  return {
    id,
    tokenHint: accountHintFromToken(rec.token),
    expiresAt: rec.expiresAt,
    tokenType: rec.tokenType,
    updatedAt: rec.updatedAt,
    hasRefreshToken: Boolean(rec.refreshToken),
    encrypted: false,
  }
}

/**
 * Hydrate the metadata mirror from the main-process vault.
 * Also performs the one-time localStorage → vault migration.
 * Call at app bootstrap; safe to call repeatedly.
 */
export async function hydratePluginSecrets(): Promise<number> {
  const api = vaultApi()
  if (!api) return 0
  try {
    // One-time migration of legacy renderer-persisted tokens.
    // Issue 06：migrate 被拒（無 OS 鑰匙圈）時保留 localStorage，不清資料。
    const store = storage()
    const legacyRaw = store?.getItem(STORAGE_KEY)
    if (legacyRaw) {
      let migrated = true
      try {
        const legacy = JSON.parse(legacyRaw) as SecretMap
        if (legacy && typeof legacy === 'object' && Object.keys(legacy).length) {
          const r = await api.migrate(legacy)
          migrated = r.ok
        }
      } catch {
        /* unparseable legacy blob — safe to remove */
      }
      if (migrated) {
        store?.removeItem(STORAGE_KEY)
        memoryMap = {}
      }
    }
    const metas = await api.list()
    metaMap = Object.fromEntries(metas.map((m) => [m.id, m]))
    hydratedFromVault = true
    return metas.length
  } catch {
    return 0
  }
}

export function getPluginSecretMeta(id: string): PluginSecretMeta | null {
  if (vaultApi()) return metaMap[id] || null
  const rec = readMap()[id]
  return rec?.token ? metaFromRecord(id, rec) : null
}

export function listPluginSecretMeta(): PluginSecretMeta[] {
  if (vaultApi()) return Object.values(metaMap)
  return Object.entries(readMap())
    .filter(([, rec]) => Boolean(rec?.token))
    .map(([id, rec]) => metaFromRecord(id, rec))
}

export function hasPluginSecret(id: string): boolean {
  return Boolean(getPluginSecretMeta(id))
}

export function pluginSecretsHydrated(): boolean {
  return !vaultApi() || hydratedFromVault
}

/**
 * Raw record — BROWSER FALLBACK ONLY. On Electron this always returns null:
 * raw tokens are injected main-side ({{secret:key}} placeholders).
 */
export function getPluginSecret(id: string): PluginSecretRecord | null {
  if (vaultApi()) return null
  const rec = readMap()[id]
  return rec?.token ? rec : null
}

export async function setPluginSecret(
  id: string,
  token: string,
  extra?: {
    refreshToken?: string
    expiresIn?: number
    expiresAt?: number
    tokenType?: string
    keepRefreshToken?: boolean
    /** 無 OS 鑰匙圈時的明文 fallback — 僅在使用者於 UI 明確確認後帶入 */
    allowPlaintext?: boolean
  },
): Promise<PluginSecretMeta> {
  const api = vaultApi()
  if (api) {
    const r = await api.store({ id, token, ...extra })
    if (r.ok) {
      metaMap[id] = r.meta
      return r.meta
    }
    const err = new Error(r.error) as Error & { code?: string }
    err.code = r.code
    throw err
  }
  // Browser fallback (legacy behavior)
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
  return metaFromRecord(id, rec)
}

export async function clearPluginSecret(id: string): Promise<void> {
  const api = vaultApi()
  if (api) {
    await api.clear(id)
    delete metaMap[id]
    return
  }
  const map = readMap()
  delete map[id]
  writeMap(map)
}

/** True when token is missing expiry or expires within `skewMs`. */
export function secretNeedsRefresh(
  rec: Pick<PluginSecretMeta, 'hasRefreshToken' | 'expiresAt'> | PluginSecretRecord,
  skewMs = 5 * 60 * 1000,
): boolean {
  const hasRefresh =
    'hasRefreshToken' in rec ? rec.hasRefreshToken : Boolean(rec.refreshToken)
  if (!hasRefresh) return false
  if (!rec.expiresAt) return true
  return Date.now() + skewMs >= rec.expiresAt
}
