/**
 * P1-A (W5) — connector credential vault in the MAIN process.
 *
 * Tokens (PAT / API key / OAuth access+refresh) are stored in a
 * safeStorage-encrypted file under userData. The renderer can only:
 *   list metadata / store / clear / trigger refresh — never read raw tokens.
 * Raw tokens are injected main-side:
 *   - tools:httpRequest resolves {{secret:key}} placeholders
 *   - mcpBridge resolves env placeholders at spawn time
 */

import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export type VaultRecord = {
  token: string
  refreshToken?: string
  /** OAuth client credentials stay in the same encrypted main-process vault. */
  clientId?: string
  clientSecret?: string
  expiresAt?: number
  tokenType?: string
  updatedAt: string
}

export type VaultMeta = {
  id: string
  tokenHint: string
  expiresAt?: number
  tokenType?: string
  updatedAt: string
  hasRefreshToken: boolean
  hasClientCredentials: boolean
  /** encrypted-at-rest? false only when OS keychain unavailable */
  encrypted: boolean
}

type VaultMap = Record<string, VaultRecord>

function vaultPath(): string {
  return path.join(app.getPath('userData'), 'plugin-secrets.vault')
}

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

let cache: VaultMap | null = null

function readVault(): VaultMap {
  if (cache) return cache
  try {
    const p = vaultPath()
    if (!fs.existsSync(p)) {
      cache = {}
      return cache
    }
    const raw = fs.readFileSync(p)
    let text: string
    if (raw.subarray(0, 5).toString('utf8') === 'PLAIN') {
      text = raw.subarray(5).toString('utf8')
    } else {
      text = safeStorage.decryptString(raw)
    }
    const parsed = JSON.parse(text) as VaultMap
    cache = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    cache = {}
  }
  return cache
}

function writeVault(map: VaultMap) {
  cache = map
  try {
    const text = JSON.stringify(map)
    const p = vaultPath()
    if (canEncrypt()) {
      fs.writeFileSync(p, safeStorage.encryptString(text), { mode: 0o600 })
    } else {
      // Degraded (no OS keychain): still main-only file, flagged in metadata
      fs.writeFileSync(p, Buffer.concat([Buffer.from('PLAIN'), Buffer.from(text)]), {
        mode: 0o600,
      })
    }
  } catch {
    /* keep in-memory cache */
  }
}

function hint(token: string): string {
  const t = (token || '').trim()
  return t.length <= 8 ? '••••' : `…${t.slice(-4)}`
}

export function getVaultSecret(id: string): VaultRecord | null {
  const rec = readVault()[id]
  return rec?.token ? rec : null
}

export function setVaultSecret(
  id: string,
  token: string,
  extra?: {
    refreshToken?: string
    expiresIn?: number
    expiresAt?: number
    tokenType?: string
    keepRefreshToken?: boolean
  },
): VaultMeta {
  const map = { ...readVault() }
  const prev = map[id]
  const expiresAt =
    extra?.expiresAt ??
    (typeof extra?.expiresIn === 'number' && extra.expiresIn > 0
      ? Date.now() + extra.expiresIn * 1000
      : prev?.expiresAt)
  map[id] = {
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
  writeVault(map)
  return metaOf(id, map[id])
}

export function isVaultEncryptionAvailable(): boolean {
  return canEncrypt()
}

/** Store an OAuth credential set without exposing client secrets to the renderer. */
export function setVaultOAuthSecret(
  id: string,
  token: string,
  extra: {
    clientId: string
    clientSecret?: string
    refreshToken?: string
    expiresIn?: number
    expiresAt?: number
    tokenType?: string
  },
): VaultMeta {
  if (!canEncrypt()) {
    throw new Error('OS secure storage unavailable; OAuth token was not saved')
  }
  const map = { ...readVault() }
  const prev = map[id]
  const expiresAt =
    extra.expiresAt ??
    (typeof extra.expiresIn === 'number' && extra.expiresIn > 0
      ? Date.now() + extra.expiresIn * 1000
      : prev?.expiresAt)
  map[id] = {
    token: token.trim(),
    refreshToken: extra.refreshToken ?? prev?.refreshToken,
    clientId: extra.clientId.trim() || prev?.clientId,
    clientSecret:
      extra.clientSecret !== undefined ? extra.clientSecret : prev?.clientSecret,
    expiresAt,
    tokenType: extra.tokenType || prev?.tokenType,
    updatedAt: new Date().toISOString(),
  }
  writeVault(map)
  return metaOf(id, map[id])
}

export function clearVaultSecret(id: string) {
  const map = { ...readVault() }
  delete map[id]
  writeVault(map)
}

function metaOf(id: string, rec: VaultRecord): VaultMeta {
  return {
    id,
    tokenHint: hint(rec.token),
    expiresAt: rec.expiresAt,
    tokenType: rec.tokenType,
    updatedAt: rec.updatedAt,
    hasRefreshToken: Boolean(rec.refreshToken),
    hasClientCredentials: Boolean(rec.clientId),
    encrypted: canEncrypt(),
  }
}

export function listVaultMeta(): VaultMeta[] {
  return Object.entries(readVault())
    .filter(([, rec]) => Boolean(rec?.token))
    .map(([id, rec]) => metaOf(id, rec))
}

/** One-time import from legacy renderer localStorage. */
export function migrateIntoVault(map: Record<string, VaultRecord>): number {
  let n = 0
  const cur = { ...readVault() }
  for (const [id, rec] of Object.entries(map || {})) {
    if (!rec?.token) continue
    if (cur[id]?.token) continue // vault wins over stale localStorage
    cur[id] = {
      token: String(rec.token),
      refreshToken: rec.refreshToken ? String(rec.refreshToken) : undefined,
      expiresAt: typeof rec.expiresAt === 'number' ? rec.expiresAt : undefined,
      tokenType: rec.tokenType ? String(rec.tokenType) : undefined,
      updatedAt: rec.updatedAt || new Date().toISOString(),
    }
    n += 1
  }
  if (n) writeVault(cur)
  return n
}

const SECRET_TOKEN = /{{\s*secret:([A-Za-z0-9_.-]+)\s*}}/g

/**
 * Resolve {{secret:key}} placeholders main-side.
 * Order: settings customToolSecrets → vault[key] → vault[`${key}-connector`].
 */
export function resolveSecretPlaceholders(
  text: string,
  customToolSecrets?: Record<string, string> | null,
): { text: string; missing: string[] } {
  const missing: string[] = []
  const out = (text || '').replace(SECRET_TOKEN, (_all, key: string) => {
    const fromSettings = customToolSecrets?.[key]
    if (fromSettings != null && String(fromSettings).length > 0) return String(fromSettings)
    const rec = getVaultSecret(key) || getVaultSecret(`${key}-connector`)
    if (rec?.token) return rec.token
    missing.push(key)
    return ''
  })
  return { text: out, missing }
}

export function hasSecretPlaceholder(text: string | undefined | null): boolean {
  if (!text) return false
  SECRET_TOKEN.lastIndex = 0
  return SECRET_TOKEN.test(text)
}
