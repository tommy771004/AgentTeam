/**
 * Connector credential vault in the main process.
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
import { decideSecretPersistence } from './securityPolicy'

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
  /** Encoding of the loaded/persisted vault revision, not current keychain availability. */
  encrypted: boolean
}

type VaultMap = Record<string, VaultRecord>

function vaultPath(): string {
  return path.join(app.getPath('userData'), 'plugin-secrets.vault')
}

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
      && safeStorage.getSelectedStorageBackend?.() !== 'basic_text'
  } catch {
    return false
  }
}

let cache: VaultMap | null = null
let cacheEncrypted = false

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
    const encrypted = raw.subarray(0, 5).toString('utf8') !== 'PLAIN'
    if (!encrypted) {
      text = raw.subarray(5).toString('utf8')
    } else {
      text = safeStorage.decryptString(raw)
    }
    const parsed = JSON.parse(text) as VaultMap
    cache = parsed && typeof parsed === 'object' ? parsed : {}
    cacheEncrypted = encrypted
  } catch {
    // A locked/corrupt vault is not an empty vault. Keep it intact and retry
    // on the next request; never cache a fabricated empty revision.
    throw new Error('Credential vault could not be read')
  }
  return cache
}

/**
 * Issue 06 — 無 OS 鑰匙圈時預設拒絕落地（PLAINTEXT_REQUIRED），
 * 只有呼叫端帶使用者明確同意的 allowPlaintext 才寫 PLAIN 檔。
 * 新 credential namespace 不允許任何 legacy caller 將其降級為明文。
 */
function writeVault(map: VaultMap, opts?: { allowPlaintext?: boolean }) {
  const decision = decideSecretPersistence({
    encryptionAvailable: canEncrypt(),
    allowPlaintext: opts?.allowPlaintext && !Object.keys(map).some((id) => id.startsWith('credential:')),
  })
  if (decision.mode === 'refuse') {
    const err = new Error(decision.reason) as Error & { code?: string }
    err.code = decision.code
    throw err
  }
  const text = JSON.stringify(map)
  const p = vaultPath()
  if (decision.mode === 'encrypted') {
    fs.writeFileSync(p, safeStorage.encryptString(text), { mode: 0o600 })
  } else {
    // Degraded（使用者已明確同意）：仍是 main-only 檔案，metadata 標示未加密
    fs.writeFileSync(p, Buffer.concat([Buffer.from('PLAIN'), Buffer.from(text)]), {
      mode: 0o600,
    })
  }
  // Only publish a new in-memory revision after durable persistence succeeds.
  cache = map
  cacheEncrypted = decision.mode === 'encrypted'
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
    /** 使用者在 UI 明確同意後才可為 true（無 OS 鑰匙圈時的明文 fallback） */
    allowPlaintext?: boolean
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
  writeVault(map, { allowPlaintext: extra?.allowPlaintext })
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
  // Clearing must not decrypt the remaining records into a new plaintext file.
  const p = vaultPath()
  const alreadyPlain = fs.existsSync(p) && fs.readFileSync(p).subarray(0, 5).toString('utf8') === 'PLAIN'
  writeVault(map, { allowPlaintext: alreadyPlain || Object.keys(map).length === 0 })
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
    encrypted: cacheEncrypted,
  }
}

export function listVaultMeta(): VaultMeta[] {
  return Object.entries(readVault())
    .filter(([, rec]) => Boolean(rec?.token))
    .map(([id, rec]) => metaOf(id, rec))
}

/**
 * One-time import from legacy renderer localStorage.
 * 無 OS 鑰匙圈時拒絕匯入（回傳 0）：不得把 legacy 明文轉寫成新的明文檔；
 * 呼叫端（hydrate）此時必須保留 localStorage 原值。
 */
export function migrateIntoVault(map: Record<string, VaultRecord>): number {
  if (!canEncrypt()) return 0
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
