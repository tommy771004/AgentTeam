/**
 * Issue 09 — Signed Subscription Feature Pack lifecycle.
 *
 * Mirrors agent/openDesign/packs.ts's install/enable/disable/uninstall/audit
 * shape. Gating reuses issue 07's entitlement boundary (`isFeatureEntitled`)
 * and the compatibility check reuses updateContracts.ts's `compareVersions`
 * — this module adds no new verification or gating primitive of its own.
 */

import { compareVersions } from './updateContracts.ts'
import type { FeaturePackManifest } from './featurePackContracts.ts'
import { isFeatureEntitled, type EntitlementSnapshot } from './entitlement.ts'
import type { AgentCapability } from './capabilities/types.ts'
import { compileToolPackage, type PackageReview } from './tools/toolPackage.ts'

export type FeaturePackStatus =
  | 'active'
  | 'disabled'
  | 'entitlement-denied'
  | 'incompatible'
  | 'uninstalled'

export interface FeaturePackRecord {
  id: string
  manifest: FeaturePackManifest
  status: FeaturePackStatus
  installedAt: string
  /** Retained for rollback after an update. */
  previousManifest?: FeaturePackManifest
}

export type FeaturePackAuditAction = 'install' | 'update' | 'enable' | 'disable' | 'uninstall' | 'rollback' | 'reject'

export interface FeaturePackAuditEvent {
  at: string
  action: FeaturePackAuditAction
  packId: string
  version: string
  /** Artifact digest only — never a raw secret or prompt/transcript content. */
  digest: string
  reason?: string
}

export function featurePackDigest(manifest: FeaturePackManifest): string {
  return manifest.artifact.sha256
}

/** Short, fixed-vocabulary audit event — never carries raw secrets or user content. */
export function featurePackAuditEvent(
  action: FeaturePackAuditAction,
  manifest: FeaturePackManifest,
  reason?: string,
): FeaturePackAuditEvent {
  return { at: new Date().toISOString(), action, packId: manifest.id, version: manifest.version, digest: featurePackDigest(manifest), reason }
}

export function isAppVersionCompatible(manifest: FeaturePackManifest, appVersion: string): boolean {
  if (compareVersions(appVersion, manifest.minAppVersion) < 0) return false
  if (manifest.maxAppVersion && compareVersions(appVersion, manifest.maxAppVersion) > 0) return false
  return true
}

export type PackActivationCheck =
  | { ok: true }
  | { ok: false; reason: string; status: 'entitlement-denied' | 'incompatible' }

/**
 * The one gate checked before download, before install, and before every
 * (re)activation. Denial never touches Free Core — callers simply don't
 * activate this pack; nothing else in the app is affected.
 */
export function packMayActivate(
  manifest: FeaturePackManifest,
  entitlement: EntitlementSnapshot,
  appVersion: string,
): PackActivationCheck {
  if (!isAppVersionCompatible(manifest, appVersion)) {
    return {
      ok: false,
      status: 'incompatible',
      reason: `此功能包需要 app 版本 ${manifest.minAppVersion}${manifest.maxAppVersion ? `–${manifest.maxAppVersion}` : '+'}，目前為 ${appVersion}。`,
    }
  }
  if (!isFeatureEntitled(entitlement, manifest.requiredEntitlement)) {
    return {
      ok: false,
      status: 'entitlement-denied',
      reason: `此功能包需要授權「${manifest.requiredEntitlement}」，目前方案未包含。Free Core 不受影響。`,
    }
  }
  return { ok: true }
}

export type InstallResult =
  | { ok: true; record: FeaturePackRecord }
  | { ok: false; error: string }

/**
 * `verified` must come from a real signature+hash check (electron/featurePackVerification.ts).
 * An unverified pack is refused outright — it never becomes a record, active or not.
 */
export function installFeaturePack(
  existing: FeaturePackRecord | null,
  manifest: FeaturePackManifest,
  verified: boolean,
  entitlement: EntitlementSnapshot,
  appVersion: string,
): InstallResult {
  if (!verified) {
    return { ok: false, error: '功能包簽章或雜湊驗證失敗，未安裝；既有版本（如有）保持不變。' }
  }
  const gate = packMayActivate(manifest, entitlement, appVersion)
  return {
    ok: true,
    record: {
      id: manifest.id,
      manifest,
      status: gate.ok ? 'active' : gate.status,
      installedAt: new Date().toISOString(),
      previousManifest: existing?.manifest,
    },
  }
}

export function disableFeaturePack(record: FeaturePackRecord): FeaturePackRecord {
  return { ...record, status: 'disabled' }
}

export function enableFeaturePack(
  record: FeaturePackRecord,
  entitlement: EntitlementSnapshot,
  appVersion: string,
): FeaturePackRecord {
  const gate = packMayActivate(record.manifest, entitlement, appVersion)
  return { ...record, status: gate.ok ? 'active' : gate.status }
}

export function uninstallFeaturePack(record: FeaturePackRecord): FeaturePackRecord {
  return { ...record, status: 'uninstalled' }
}

export type RollbackResult =
  | { ok: true; record: FeaturePackRecord }
  | { ok: false; error: string }

export function rollbackFeaturePack(
  record: FeaturePackRecord,
  entitlement: EntitlementSnapshot,
  appVersion: string,
): RollbackResult {
  if (!record.previousManifest) {
    return { ok: false, error: '沒有可回復的先前版本。' }
  }
  const gate = packMayActivate(record.previousManifest, entitlement, appVersion)
  return {
    ok: true,
    record: {
      id: record.id,
      manifest: record.previousManifest,
      status: gate.ok ? 'active' : gate.status,
      installedAt: new Date().toISOString(),
    },
  }
}

/**
 * Compile an installed pack's tool surface into a capability. Gating reuses
 * `requiresEntitlement` — the same field/filter capabilities/runtime.ts
 * already applies for issue 07; this file adds no separate gate for it.
 */
export function featurePackCapability(
  record: FeaturePackRecord,
  ownerId: string,
  review?: PackageReview | null,
): AgentCapability | null {
  if (record.status === 'uninstalled') return null
  const compiled = compileToolPackage(record.manifest.toolPackage, ownerId, review)
  return {
    id: `feature-pack:${record.id}`,
    description: record.manifest.name,
    toolNames: compiled.tools.map((t) => t.name),
    deferLoading: true,
    source: 'user',
    group: 'feature-pack',
    requiresEntitlement: record.manifest.requiredEntitlement,
  }
}
