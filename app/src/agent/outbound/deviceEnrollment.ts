/**
 * Managed Device enrollment and Workspace Secure Envelope.
 */

import crypto from 'node:crypto'

/** Opaque random device id — never derived from hostname/MAC/disk. */
export function createManagedDeviceId(): string {
  return `mdv_${crypto.randomBytes(16).toString('hex')}`
}

export type ManagedDevice = {
  deviceId: string
  /** Human label — rename does not change deviceId */
  label: string
  /** Per-device evidence HMAC key (raw bytes; store via safeStorage in main) */
  evidenceHmacKey: Buffer
  /** Envelope key material */
  envelopeKey: Buffer
  createdAtUtc: string
}

export function enrollManagedDevice(label = 'This computer'): ManagedDevice {
  return {
    deviceId: createManagedDeviceId(),
    label: String(label || 'This computer').slice(0, 80),
    evidenceHmacKey: crypto.randomBytes(32),
    envelopeKey: crypto.randomBytes(32),
    createdAtUtc: new Date().toISOString(),
  }
}

export function renameDeviceLabel(device: ManagedDevice, label: string): ManagedDevice {
  return { ...device, label: String(label || device.label).slice(0, 80) }
}

/** Parse SUBAGENTS_WORKSPACE_PUBLIC_KEYS = keyId:BASE64,keyId2:BASE64 */
export function parseWorkspacePublicKeys(
  raw: string | undefined | null,
): Map<string, Buffer> {
  const map = new Map<string, Buffer>()
  if (!raw || !String(raw).trim()) return map
  for (const part of String(raw).split(',')) {
    const idx = part.indexOf(':')
    if (idx <= 0) continue
    const keyId = part.slice(0, idx).trim()
    const b64 = part.slice(idx + 1).trim()
    try {
      map.set(keyId, Buffer.from(b64, 'base64'))
    } catch {
      /* skip bad entry */
    }
  }
  return map
}

export type SecureEnvelope = {
  v: 1
  keyId: string
  nonce: string
  ciphertext: string
  sequence: number
}

const _seenNonces = new Set<string>()

export function sealWorkspaceEnvelope(opts: {
  keyId: string
  key: Buffer
  plaintext: Buffer | string
  sequence: number
}): SecureEnvelope {
  const nonce = crypto.randomBytes(12)
  const key = opts.key.length === 32 ? opts.key : crypto.createHash('sha256').update(opts.key).digest()
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const pt = typeof opts.plaintext === 'string' ? Buffer.from(opts.plaintext, 'utf8') : opts.plaintext
  const enc = Buffer.concat([cipher.update(pt), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    v: 1,
    keyId: opts.keyId,
    nonce: nonce.toString('base64'),
    ciphertext: Buffer.concat([enc, tag]).toString('base64'),
    sequence: opts.sequence,
  }
}

export function openWorkspaceEnvelope(opts: {
  envelope: SecureEnvelope
  keys: Map<string, Buffer>
  /** Reject if sequence already used for this keyId */
  acceptSequence: (keyId: string, sequence: number) => boolean
}): { ok: true; plaintext: Buffer } | { ok: false; reason: string } {
  const env = opts.envelope
  if (!env || env.v !== 1 || !env.keyId || !env.nonce || !env.ciphertext) {
    return { ok: false, reason: 'malformed envelope' }
  }
  const key = opts.keys.get(env.keyId)
  if (!key) return { ok: false, reason: 'no matching workspace public/private key' }

  const nonceKey = `${env.keyId}:${env.nonce}`
  if (_seenNonces.has(nonceKey)) {
    return { ok: false, reason: 'replay rejected' }
  }
  if (!opts.acceptSequence(env.keyId, env.sequence)) {
    return { ok: false, reason: 'sequence rejected' }
  }

  try {
    const nonce = Buffer.from(env.nonce, 'base64')
    const raw = Buffer.from(env.ciphertext, 'base64')
    if (raw.length < 17) return { ok: false, reason: 'ciphertext too short' }
    const tag = raw.subarray(raw.length - 16)
    const data = raw.subarray(0, raw.length - 16)
    const k = key.length === 32 ? key : crypto.createHash('sha256').update(key).digest()
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, nonce)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()])
    _seenNonces.add(nonceKey)
    return { ok: true, plaintext }
  } catch {
    return { ok: false, reason: 'decrypt/auth failure — do not interpret as plaintext' }
  }
}

/** HTTP Workspace requires envelope; HTTPS may use normal TLS without app envelope. */
export function requiresSecureEnvelope(transport: 'http' | 'https'): boolean {
  return transport === 'http'
}
