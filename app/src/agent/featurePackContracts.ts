/**
 * Issue 09 — Signed Subscription Feature Pack manifest.
 *
 * Browser-safe contract, mirroring updateContracts.ts's signed-manifest
 * pattern (canonicalJson, allowlisted validation) instead of reinventing it.
 * Permissions reuse the existing tools/toolPackage.ts operationClass model —
 * a feature pack's tool surface IS a ToolPackageManifest, not a new shape.
 */

import { canonicalJson, compareVersions, type UpdateArtifactDescriptor } from './updateContracts.ts'
import { validateToolPackage, type ToolPackageManifest } from './tools/toolPackage.ts'
import type { FeatureId } from './entitlement.ts'

export interface FeaturePackManifest {
  schemaVersion: 1
  id: string
  name: string
  version: string
  minAppVersion: string
  maxAppVersion?: string
  /** Feature id checked via issue 07's isFeatureEntitled — the only gate. */
  requiredEntitlement: FeatureId
  toolPackage: ToolPackageManifest
  artifact: UpdateArtifactDescriptor
  publishedAt: string
  signature: string
}

export type FeaturePackManifestValidation =
  | { ok: true; manifest: FeaturePackManifest }
  | { ok: false; errors: string[] }

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const SHA256 = /^[a-f0-9]{64}$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const HTTPS = /^https:\/\/[^\s]+$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function unsignedFeaturePackManifestPayload(manifest: FeaturePackManifest): string {
  const { signature: _signature, ...unsigned } = manifest
  return canonicalJson(unsigned)
}

export function featurePackArtifactSignaturePayload(artifact: UpdateArtifactDescriptor): string {
  return canonicalJson({ sha256: artifact.sha256, size: artifact.size, url: artifact.url })
}

export function validateFeaturePackManifest(
  raw: unknown,
  target?: { installedAppVersion: string },
): FeaturePackManifestValidation {
  const errors: string[] = []
  if (!isRecord(raw)) return { ok: false, errors: ['manifest must be an object'] }

  const manifestKeys = new Set([
    'schemaVersion', 'id', 'name', 'version', 'minAppVersion', 'maxAppVersion',
    'requiredEntitlement', 'toolPackage', 'artifact', 'publishedAt', 'signature',
  ])
  for (const key of Object.keys(raw)) if (!manifestKeys.has(key)) errors.push(`unknown manifest field: ${key}`)

  if (raw.schemaVersion !== 1) errors.push('unsupported schemaVersion')
  if (typeof raw.id !== 'string' || !NAME.test(raw.id)) errors.push('invalid id')
  if (typeof raw.name !== 'string' || !raw.name.trim()) errors.push('name is required')
  if (typeof raw.version !== 'string' || !VERSION.test(raw.version)) errors.push('invalid version')
  if (typeof raw.minAppVersion !== 'string' || !VERSION.test(raw.minAppVersion)) errors.push('invalid minAppVersion')
  if (raw.maxAppVersion !== undefined && (typeof raw.maxAppVersion !== 'string' || !VERSION.test(raw.maxAppVersion))) {
    errors.push('invalid maxAppVersion')
  }
  if (typeof raw.requiredEntitlement !== 'string' || !raw.requiredEntitlement.trim()) errors.push('requiredEntitlement is required')

  const toolPackageResult = validateToolPackage(raw.toolPackage)
  if (!toolPackageResult.ok) errors.push(...toolPackageResult.errors.map((e) => `toolPackage: ${e}`))

  const artifact = isRecord(raw.artifact) ? raw.artifact : null
  if (!artifact) {
    errors.push('artifact is required')
  } else {
    const artifactKeys = new Set(['url', 'size', 'sha256', 'signature', 'signatureAlgorithm'])
    for (const key of Object.keys(artifact)) if (!artifactKeys.has(key)) errors.push(`unknown artifact field: ${key}`)
    if (typeof artifact.url !== 'string' || !HTTPS.test(artifact.url)) errors.push('artifact url must use https')
    if (typeof artifact.size !== 'number' || !Number.isSafeInteger(artifact.size) || artifact.size <= 0 || artifact.size > 200_000_000) {
      errors.push('invalid artifact size')
    }
    if (typeof artifact.sha256 !== 'string' || !SHA256.test(artifact.sha256)) errors.push('invalid artifact sha256')
    if (typeof artifact.signature !== 'string' || !BASE64.test(artifact.signature)) errors.push('invalid artifact signature')
    if (artifact.signatureAlgorithm !== 'rsa-sha256' && artifact.signatureAlgorithm !== 'ed25519') {
      errors.push('unsupported signature algorithm')
    }
  }

  if (typeof raw.publishedAt !== 'string' || Number.isNaN(Date.parse(raw.publishedAt))) errors.push('invalid publishedAt')
  if (typeof raw.signature !== 'string' || !BASE64.test(raw.signature)) errors.push('invalid manifest signature')

  if (target && typeof raw.minAppVersion === 'string' && VERSION.test(raw.minAppVersion)) {
    if (compareVersions(target.installedAppVersion, raw.minAppVersion) < 0) errors.push('app version is older than pack minAppVersion')
    if (
      typeof raw.maxAppVersion === 'string' &&
      VERSION.test(raw.maxAppVersion) &&
      compareVersions(target.installedAppVersion, raw.maxAppVersion) > 0
    ) {
      errors.push('app version is newer than pack maxAppVersion')
    }
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, manifest: raw as unknown as FeaturePackManifest }
}
