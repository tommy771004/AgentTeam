import { createHash, sign, verify } from 'node:crypto'

export const RELEASE_HARDENING_CHECK_IDS = [
  'releasePromotion',
  'credentialBoundary',
  'settingsRecovery',
  'deterministicGuards',
  'mergeBaseComplexity',
  'shippedRuntimeCiCoverage',
] as const

export type ReleaseHardeningCheckId = typeof RELEASE_HARDENING_CHECK_IDS[number]

export const RELEASE_HARDENING_EVIDENCE_FILES: Record<ReleaseHardeningCheckId, string> = {
  releasePromotion: 'release-hardening-owners.log',
  credentialBoundary: 'release-hardening-owners.log',
  settingsRecovery: 'deterministic-qualification.log',
  deterministicGuards: 'deterministic-qualification.log',
  mergeBaseComplexity: 'deterministic-qualification.log',
  shippedRuntimeCiCoverage: 'deterministic-qualification.log',
}

export type ReleaseHardeningIdentity = {
  commit: string
  runId: string
  runAttempt: string
  version: string
  platform: 'windows' | 'macos'
  arch: string
}

export type ReleaseHardeningReceipt = ReleaseHardeningIdentity & {
  schemaVersion: 2
  authority: {
    kind: 'github-actions'
    workflow: '.github/workflows/release.yml'
    job: 'package'
    signatureAlgorithm: 'ed25519'
    keyId: string
  }
  checks: Array<{ id: ReleaseHardeningCheckId; passed: true; evidenceFile: string }>
  issuedAt: string
  receiptId: string
  signature: string
}

export type ReleaseHardeningSigningAuthority = { privateKeyPem: string; keyId: string }
export type ReleaseHardeningTrust = { publicKeyPem: string; keyId: string }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

type UnsignedReleaseHardeningReceipt = Omit<ReleaseHardeningReceipt, 'receiptId' | 'signature'>

function receiptId(value: UnsignedReleaseHardeningReceipt): string {
  return `hardening_${createHash('sha256').update(canonical(value)).digest('hex')}`
}

export function buildReleaseHardeningReceipt(
  identity: ReleaseHardeningIdentity,
  signingAuthority: ReleaseHardeningSigningAuthority,
  issuedAt = new Date().toISOString(),
): ReleaseHardeningReceipt {
  if (!signingAuthority.privateKeyPem.trim() || !signingAuthority.keyId.trim()) {
    throw new Error('release hardening signing authority is required')
  }
  const body: UnsignedReleaseHardeningReceipt = {
    schemaVersion: 2,
    authority: {
      kind: 'github-actions',
      workflow: '.github/workflows/release.yml',
      job: 'package',
      signatureAlgorithm: 'ed25519',
      keyId: signingAuthority.keyId,
    },
    ...identity,
    checks: RELEASE_HARDENING_CHECK_IDS.map((id) => ({ id, passed: true, evidenceFile: RELEASE_HARDENING_EVIDENCE_FILES[id] })),
    issuedAt,
  }
  const id = receiptId(body)
  const signature = sign(null, Buffer.from(id, 'utf8'), signingAuthority.privateKeyPem).toString('base64')
  return { ...body, receiptId: id, signature }
}

function hasTrustedAuthority(receipt: Partial<ReleaseHardeningReceipt>, trust?: ReleaseHardeningTrust): boolean {
  return receipt.schemaVersion === 2
    && Boolean(trust?.publicKeyPem.trim())
    && Boolean(trust?.keyId.trim())
    && receipt.authority?.kind === 'github-actions'
    && receipt.authority.workflow === '.github/workflows/release.yml'
    && receipt.authority.job === 'package'
    && receipt.authority.signatureAlgorithm === 'ed25519'
    && receipt.authority.keyId === trust?.keyId
}

function hasExpectedIdentity(
  receipt: Partial<ReleaseHardeningReceipt>,
  expected: ReleaseHardeningIdentity,
): boolean {
  return Object.entries(expected).every(([key, expectedValue]) =>
    receipt[key as keyof ReleaseHardeningIdentity] === expectedValue)
}

function hasCompleteChecks(receipt: Partial<ReleaseHardeningReceipt>): boolean {
  if (!Array.isArray(receipt.checks) || receipt.checks.length !== RELEASE_HARDENING_CHECK_IDS.length) return false
  const ids = receipt.checks.map((check) => check?.id)
  if (JSON.stringify(ids) !== JSON.stringify(RELEASE_HARDENING_CHECK_IDS)) return false
  return receipt.checks.every((check) =>
    check?.passed === true && check?.evidenceFile === RELEASE_HARDENING_EVIDENCE_FILES[check.id])
}

function hasValidSignature(receipt: ReleaseHardeningReceipt, trust: ReleaseHardeningTrust): boolean {
  const { receiptId: actualId, signature, ...body } = receipt
  if (actualId !== receiptId(body)) return false
  try {
    return verify(null, Buffer.from(actualId, 'utf8'), trust.publicKeyPem, Buffer.from(signature, 'base64'))
  } catch {
    return false
  }
}

export function validateReleaseHardeningReceipt(
  value: unknown,
  expected: ReleaseHardeningIdentity,
  trust?: ReleaseHardeningTrust,
): value is ReleaseHardeningReceipt {
  if (!value || typeof value !== 'object') return false
  const receipt = value as Partial<ReleaseHardeningReceipt>
  if (!hasTrustedAuthority(receipt, trust) || !hasExpectedIdentity(receipt, expected) || !hasCompleteChecks(receipt)) return false
  if (typeof receipt.issuedAt !== 'string' || !Number.isFinite(Date.parse(receipt.issuedAt))) return false
  if (typeof receipt.receiptId !== 'string' || typeof receipt.signature !== 'string') return false
  return hasValidSignature(receipt as ReleaseHardeningReceipt, trust!)
}
