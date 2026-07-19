/** Shared, browser-safe contracts for the signed Beta update channel. */

export type UpdatePlatform = 'win32' | 'darwin'
export type UpdateArch = 'x64' | 'arm64'

export interface UpdateArtifactDescriptor {
  url: string
  size: number
  sha256: string
  signature: string
  signatureAlgorithm: 'rsa-sha256' | 'ed25519'
}

export interface SignedUpdateManifest {
  schemaVersion: 1
  product: 'SubAgents AI'
  channel: 'beta'
  version: string
  platform: UpdatePlatform
  arch: UpdateArch
  mandatory: boolean
  releaseNotes: string
  publishedAt: string
  artifact: UpdateArtifactDescriptor
  signature: string
}

export interface UpdateTarget {
  platform: UpdatePlatform
  arch: UpdateArch
  currentVersion: string
}

export type ManifestValidation =
  | { ok: true; manifest: SignedUpdateManifest }
  | { ok: false; errors: string[] }

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const SHA256 = /^[a-f0-9]{64}$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const HTTPS = /^https:\/\/[^\s]+$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/** Stable JSON used for both metadata and detached artifact signatures. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function unsignedManifestPayload(manifest: SignedUpdateManifest): string {
  const { signature: _signature, ...unsigned } = manifest
  return canonicalJson(unsigned)
}

export function artifactSignaturePayload(artifact: UpdateArtifactDescriptor): string {
  return canonicalJson({
    sha256: artifact.sha256,
    size: artifact.size,
    url: artifact.url,
  })
}

export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [withoutBuild] = value.split('+', 1)
    const [core, prerelease = ''] = withoutBuild.split('-', 2)
    return { core: core.split('.').map(Number), prerelease: prerelease ? prerelease.split('.') : [] as string[] }
  }
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < 3; i += 1) {
    if ((left.core[i] || 0) !== (right.core[i] || 0)) return (left.core[i] || 0) - (right.core[i] || 0)
  }
  if (!left.prerelease.length && right.prerelease.length) return 1
  if (left.prerelease.length && !right.prerelease.length) return -1
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i += 1) {
    const l = left.prerelease[i]
    const r = right.prerelease[i]
    if (l == null) return -1
    if (r == null) return 1
    const lNumeric = /^\d+$/.test(l)
    const rNumeric = /^\d+$/.test(r)
    if (lNumeric && rNumeric && Number(l) !== Number(r)) return Number(l) - Number(r)
    if (lNumeric !== rNumeric) return lNumeric ? -1 : 1
    if (l !== r) return l < r ? -1 : 1
  }
  return 0
}

export function validateUpdateManifest(raw: unknown, target?: UpdateTarget): ManifestValidation {
  const errors: string[] = []
  if (!isRecord(raw)) return { ok: false, errors: ['manifest must be an object'] }
  const artifact = isRecord(raw.artifact) ? raw.artifact : null
  const manifestKeys = new Set(['schemaVersion', 'product', 'channel', 'version', 'platform', 'arch', 'mandatory', 'releaseNotes', 'publishedAt', 'artifact', 'signature'])
  for (const key of Object.keys(raw)) if (!manifestKeys.has(key)) errors.push(`unknown manifest field: ${key}`)
  if (raw.schemaVersion !== 1) errors.push('unsupported schemaVersion')
  if (raw.product !== 'SubAgents AI') errors.push('unexpected product')
  if (raw.channel !== 'beta') errors.push('only beta channel is supported')
  if (typeof raw.version !== 'string' || !VERSION.test(raw.version)) errors.push('invalid version')
  if (raw.platform !== 'win32' && raw.platform !== 'darwin') errors.push('unsupported platform')
  if (raw.arch !== 'x64' && raw.arch !== 'arm64') errors.push('unsupported architecture')
  if (typeof raw.mandatory !== 'boolean') errors.push('mandatory must be boolean')
  if (typeof raw.releaseNotes !== 'string' || raw.releaseNotes.length > 100_000) errors.push('invalid release notes')
  if (typeof raw.publishedAt !== 'string' || Number.isNaN(Date.parse(raw.publishedAt))) errors.push('invalid publishedAt')
  if (typeof raw.signature !== 'string' || !BASE64.test(raw.signature)) errors.push('invalid manifest signature')
  if (!artifact) {
    errors.push('artifact is required')
  } else {
    const artifactKeys = new Set(['url', 'size', 'sha256', 'signature', 'signatureAlgorithm'])
    for (const key of Object.keys(artifact)) if (!artifactKeys.has(key)) errors.push(`unknown artifact field: ${key}`)
    if (typeof artifact.url !== 'string' || !HTTPS.test(artifact.url)) errors.push('artifact url must use https')
    if (typeof artifact.size !== 'number' || !Number.isSafeInteger(artifact.size) || artifact.size <= 0 || artifact.size > 1_000_000_000) errors.push('invalid artifact size')
    if (typeof artifact.sha256 !== 'string' || !SHA256.test(artifact.sha256)) errors.push('invalid artifact sha256')
    if (typeof artifact.signature !== 'string' || !BASE64.test(artifact.signature)) errors.push('invalid artifact signature')
    if (artifact.signatureAlgorithm !== 'rsa-sha256' && artifact.signatureAlgorithm !== 'ed25519') errors.push('unsupported signature algorithm')
  }
  if (target) {
    if (raw.platform !== target.platform) errors.push('manifest platform does not match this app')
    if (raw.arch !== target.arch) errors.push('manifest architecture does not match this app')
    if (typeof raw.version === 'string' && VERSION.test(raw.version) && compareVersions(raw.version, target.currentVersion) <= 0) {
      errors.push('manifest is not newer than the installed version')
    }
  }
  if (errors.length) return { ok: false, errors }
  return { ok: true, manifest: raw as unknown as SignedUpdateManifest }
}

export interface MigrationSnapshot {
  schemaVersion: 1
  capturedAt: string
  appVersion: string
  rendererStorage: Record<string, string>
  vaultMetadata: unknown[]
  projects: Array<{ root: string; name?: string; branch?: string | null }>
  /** Exact persisted queue payload (`{v,items}` in Electron; array in browser preview). */
  queue: unknown
  schedules: unknown[]
  artifactIndex: unknown
}

const SENSITIVE_SETTING_KEY = /(?:apiKey|token|secret|password|clientSecret|accessKey|privateKey)/i

function redactSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveValue)
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_SETTING_KEY.test(key)) continue
    result[key] = redactSensitiveValue(child)
  }
  return result
}

/** Keep settings structure but never place raw credentials in a migration backup. */
export function sanitizeRendererStorage(storage: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(storage || {})) {
    if (!key.startsWith('subagents.')) {
      next[key] = value
      continue
    }
    try {
      // App-owned blobs may contain legacy connector credentials even when
      // their key is not a settings key (for example plugin-secrets.v1).
      // Redact recursively so the plaintext fallback remains safe too.
      next[key] = JSON.stringify(redactSensitiveValue(JSON.parse(value)))
    } catch {
      // A malformed credential-like blob must not be copied into a backup.
      next[key] = /(?:secret|token|credential|auth|password|apikey)/i.test(key) ? '' : value
    }
  }
  return next
}

export function buildMigrationSnapshot(input: Omit<MigrationSnapshot, 'schemaVersion' | 'capturedAt'>): MigrationSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    appVersion: String(input.appVersion || '0.0.0'),
    rendererStorage: sanitizeRendererStorage(Object.fromEntries(
      Object.entries(input.rendererStorage || {}).filter(([key, value]) => key.length <= 200 && typeof value === 'string' && value.length <= 8_000_000),
    )),
    vaultMetadata: Array.isArray(input.vaultMetadata) ? input.vaultMetadata : [],
    projects: Array.isArray(input.projects) ? input.projects : [],
    queue: input.queue ?? [],
    schedules: Array.isArray(input.schedules) ? input.schedules : [],
    artifactIndex: input.artifactIndex ?? null,
  }
}

export function validateMigrationSnapshot(value: unknown): value is MigrationSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.appVersion !== 'string' || typeof value.capturedAt !== 'string') return false
  return isRecord(value.rendererStorage) && Array.isArray(value.vaultMetadata) && Array.isArray(value.projects) && 'queue' in value && Array.isArray(value.schedules) && 'artifactIndex' in value
}

export function normalizeMigrationSnapshot(value: unknown): MigrationSnapshot | null {
  if (!validateMigrationSnapshot(value)) return null
  if (value.appVersion.length > 80 || value.capturedAt.length > 80 || value.vaultMetadata.length > 200 || value.projects.length > 200 || value.schedules.length > 500) return null
  const rendererEntries = Object.entries(value.rendererStorage).filter(([key, item]) => key.length > 0 && key.length <= 200 && typeof item === 'string' && item.length <= 8_000_000)
  if (rendererEntries.length > 500 || rendererEntries.reduce((total, [, item]) => total + item.length, 0) > 16_000_000) return null
  try {
    if (JSON.stringify(value.queue).length > 4_000_000 || JSON.stringify(value.artifactIndex).length > 4_000_000 || JSON.stringify(value.vaultMetadata).length > 2_000_000 || JSON.stringify(value.projects).length > 2_000_000 || JSON.stringify(value.schedules).length > 4_000_000) return null
  } catch { return null }
  return buildMigrationSnapshot({
    appVersion: value.appVersion,
    rendererStorage: Object.fromEntries(rendererEntries),
    vaultMetadata: value.vaultMetadata,
    projects: value.projects,
    queue: value.queue,
    schedules: value.schedules,
    artifactIndex: value.artifactIndex,
  })
}
