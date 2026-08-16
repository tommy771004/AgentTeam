/**
 * Issue 09 — 簽章 Subscription Feature Pack smoke.
 *
 * Mirrors scripts/smoke-update-migration.mts's real-RSA verification pattern
 * (electron/updateVerification.ts runs on plain node:crypto, no Electron
 * runtime needed) and reuses issue 07/08's entitlement boundary + the
 * existing tools/toolPackage.ts permission model — no parallel gating path.
 */
import assert from 'node:assert/strict'
import { readSettingsSurface } from './lib/settingsSurface.mjs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256Hex } from '../electron/updateVerification.ts'
import {
  verifyFeaturePackManifestSignature,
  verifyFeaturePackArtifactSignature,
} from '../electron/featurePackVerification.ts'
import {
  unsignedFeaturePackManifestPayload,
  featurePackArtifactSignaturePayload,
  validateFeaturePackManifest,
  type FeaturePackManifest,
} from '../src/agent/featurePackContracts.ts'
import {
  packMayActivate,
  installFeaturePack,
  disableFeaturePack,
  enableFeaturePack,
  rollbackFeaturePack,
  featurePackCapability,
  featurePackAuditEvent,
  isAppVersionCompatible,
  type FeaturePackRecord,
} from '../src/agent/featurePacks.ts'
import { resolveEntitlement, isCapabilityEntitled } from '../src/agent/entitlement.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.join(appRoot, rel), 'utf8')

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const sign = (payload: string) => crypto.createSign('RSA-SHA256').update(payload).end().sign(privateKey).toString('base64')

const toolPackage = {
  schemaVersion: 1 as const,
  id: 'pro-refactor-pack',
  version: '1.0.0',
  tools: [
    { name: 'pro_refactor_scan', description: 'Scan for refactor targets', operationClass: 'read' as const, kind: 'http_template' as const, template: { url: 'https://pro.example.test/scan', method: 'GET' } },
  ],
}

const bytes = Buffer.from('feature pack payload bytes')
function buildManifest(overrides: Partial<FeaturePackManifest> = {}): FeaturePackManifest {
  const artifact = {
    url: 'https://packs.example.test/pro-refactor-pack-1.0.0.zip',
    size: bytes.length,
    sha256: sha256Hex(bytes),
    signature: '',
    signatureAlgorithm: 'rsa-sha256' as const,
  }
  artifact.signature = sign(featurePackArtifactSignaturePayload(artifact))
  const manifest = {
    schemaVersion: 1 as const,
    id: 'pro-refactor-pack',
    name: 'Pro Refactor Pack',
    version: '1.0.0',
    minAppVersion: '1.0.0',
    requiredEntitlement: 'pro-refactor-pack',
    toolPackage,
    artifact,
    publishedAt: new Date().toISOString(),
    signature: '',
    ...overrides,
  } as FeaturePackManifest
  manifest.signature = sign(unsignedFeaturePackManifestPayload(manifest))
  return manifest
}

// ── 1. Manifest declares identity, version, compatibility, permissions, entitlement ──
{
  const manifest = buildManifest()
  const valid = validateFeaturePackManifest(manifest, { installedAppVersion: '1.0.0' })
  assert.equal(valid.ok, true)
  assert.equal(manifest.toolPackage.tools[0].operationClass, 'read', 'permissions come from the existing toolPackage operationClass model')
  const unknownField = validateFeaturePackManifest({ ...manifest, extra: 'nope' })
  assert.equal(unknownField.ok, false, 'unknown top-level fields must be rejected (allowlist, not blocklist)')
  const badToolPackage = validateFeaturePackManifest({ ...manifest, toolPackage: { schemaVersion: 1, id: 'x', version: '1.0.0', tools: [{ name: 'bad', description: 'd', kind: 'http_template' }] } })
  assert.equal(badToolPackage.ok, false, 'missing operationClass on a tool must fail validation')
}

// ── 2. Signature + hash verified before install/activation ──
{
  const manifest = buildManifest()
  assert.equal(verifyFeaturePackManifestSignature(manifest, publicKeyPem), true)
  assert.equal(verifyFeaturePackArtifactSignature(manifest.artifact, bytes, publicKeyPem), true)
  assert.equal(verifyFeaturePackManifestSignature({ ...manifest, name: 'tampered' }, publicKeyPem), false, 'tampering must invalidate the manifest signature')
  assert.equal(verifyFeaturePackArtifactSignature(manifest.artifact, Buffer.from('tampered bytes'), publicKeyPem), false, 'tampered bytes must fail the hash check even with a valid signature string')
}

// ── 3. Entitlement denial prevents download/activation without breaking Free Core ──
{
  const manifest = buildManifest()
  const free = resolveEntitlement(undefined)
  const denied = packMayActivate(manifest, free, '1.0.0')
  assert.equal(denied.ok, false)
  assert.equal(denied.ok ? '' : denied.status, 'entitlement-denied')
  // Free Core capabilities are never affected by a denied feature pack.
  assert.equal(isCapabilityEntitled(free, undefined), true)

  const paid = resolveEntitlement({ tier: 'paid', grantedFeatures: ['pro-refactor-pack'] })
  const allowed = packMayActivate(manifest, paid, '1.0.0')
  assert.equal(allowed.ok, true)
}

// ── 4. Install / update / disable / enable / uninstall / rollback ──
{
  const manifest = buildManifest()
  const paid = resolveEntitlement({ tier: 'paid', grantedFeatures: ['pro-refactor-pack'] })

  const installed = installFeaturePack(null, manifest, true, paid, '1.0.0')
  assert.equal(installed.ok, true)
  const active: FeaturePackRecord = installed.ok ? installed.record : (null as never)
  assert.equal(active.status, 'active')

  const disabled = disableFeaturePack(active)
  assert.equal(disabled.status, 'disabled')
  const reenabled = enableFeaturePack(disabled, paid, '1.0.0')
  assert.equal(reenabled.status, 'active')

  const v2 = buildManifest({ version: '1.1.0' })
  const updated = installFeaturePack(active, v2, true, paid, '1.0.0')
  assert.equal(updated.ok, true)
  const updatedRecord: FeaturePackRecord = updated.ok ? updated.record : (null as never)
  assert.equal(updatedRecord.manifest.version, '1.1.0')
  assert.equal(updatedRecord.previousManifest?.version, '1.0.0', 'previous version retained for rollback')

  const rolledBack = rollbackFeaturePack(updatedRecord, paid, '1.0.0')
  assert.equal(rolledBack.ok, true)
  assert.equal(rolledBack.ok ? rolledBack.record.manifest.version : '', '1.0.0')

  const noRollback = rollbackFeaturePack(active, paid, '1.0.0')
  assert.equal(noRollback.ok, false, 'a pack with no previous version cannot roll back')
}

// ── 5. Failed / incompatible pack cannot strand the app or local data ──
{
  const manifest = buildManifest()
  const paid = resolveEntitlement({ tier: 'paid', grantedFeatures: ['pro-refactor-pack'] })
  const failedVerify = installFeaturePack(null, manifest, false, paid, '1.0.0')
  assert.equal(failedVerify.ok, false, 'unverified signature/hash must never install')

  const tooOld = buildManifest({ minAppVersion: '9.0.0' })
  assert.equal(isAppVersionCompatible(tooOld, '1.0.0'), false)
  const incompatibleInstall = installFeaturePack(null, tooOld, true, paid, '1.0.0')
  assert.equal(incompatibleInstall.ok, true, 'incompatible packs still install as a record — just never activate')
  assert.equal(incompatibleInstall.ok ? incompatibleInstall.record.status : '', 'incompatible')
  // Nothing here throws, and a pack (denied, incompatible, or failed) never touches settings/export.
}
assert.ok(!read('src/agent/settingsExport.ts').includes('featurePack') && !read('src/agent/settingsExport.ts').includes('feature-pack'),
  'export/redaction must stay feature-pack-agnostic — local data readability never depends on pack state')

// ── 6. Audit evidence: version + digest only, never raw secrets or full prompts ──
{
  const manifest = buildManifest()
  const event = featurePackAuditEvent('install', manifest)
  assert.equal(event.packId, manifest.id)
  assert.equal(event.version, manifest.version)
  assert.equal(event.digest, manifest.artifact.sha256)
  const keys = Object.keys(event).sort()
  assert.deepEqual(keys, ['action', 'at', 'digest', 'packId', 'reason', 'version'].sort())
  assert.ok(!Object.prototype.hasOwnProperty.call(event, 'reason') || typeof event.reason !== 'string' || event.reason.length < 400,
    'reason must stay a short fixed explanation, never raw prompt/transcript content')
}

// ── 7. Runtime seam: feature packs reuse the existing capability + entitlement gate ──
{
  const manifest = buildManifest()
  const paid = resolveEntitlement({ tier: 'paid', grantedFeatures: ['pro-refactor-pack'] })
  const installed = installFeaturePack(null, manifest, true, paid, '1.0.0')
  const record: FeaturePackRecord = installed.ok ? installed.record : (null as never)
  const capability = featurePackCapability(record, 'feature-pack-owner')
  assert.ok(capability)
  assert.equal(capability?.requiresEntitlement, manifest.requiredEntitlement, 'must gate through the same requiresEntitlement field issue 07 wired into assembleCapabilities')
}
const runtimeSrc = read('src/agent/capabilities/runtime.ts')
assert.ok(!runtimeSrc.includes('featurePack') && !runtimeSrc.includes('feature-pack'),
  'capabilities/runtime.ts must NOT know about feature packs specifically — it already gates any requiresEntitlement generically')

// ── 8. Store + UI seams ──
const storeSrc = read('src/store/featurePackStore.ts')
assert.ok(storeSrc.includes('installFeaturePack') && storeSrc.includes('featurePackAuditEvent'),
  'featurePackStore must route through the shared pure lifecycle + audit builder, not reimplement them')
const settingsPageSrc = readSettingsSurface(appRoot)
assert.ok(settingsPageSrc.includes('useFeaturePackStore'), 'SettingsPage must surface feature pack lifecycle state')

console.log('Feature pack smoke: 9 groups passed')
