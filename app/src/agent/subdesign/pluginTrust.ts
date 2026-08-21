/**
 * Plugin trust decisions — the one place that decides whether a resolved
 * snapshot may execute, and the only writer of grant state (issue 02).
 *
 * Two rules this module exists to keep:
 *  - A vendor update never silently replaces an adopted snapshot. A changed
 *    content hash or capability fingerprint reports `refresh-required`; only an
 *    explicit user refresh writes the new snapshot and drops the old grants.
 *  - Deny-by-default capabilities reach the existing HITL approval path
 *    (permissionAskStore) with run/thread scope and the unattended timeout,
 *    and fail closed when the ask times out.
 */

import { usePermissionAskStore } from '../../store/permissionAskStore.ts'
import {
  DENY_BY_DEFAULT,
  grantCapabilities,
  isCapabilityGranted,
  revokeGrants,
  type GrantScope,
  type PluginResolvedSnapshot,
} from './pluginSnapshot.ts'
import { persistPluginSnapshot } from './pluginSnapshotStore.ts'

/** What changed between the adopted snapshot and the vendor content on disk. */
export type SnapshotDrift = 'content' | 'capabilities' | 'both'

export type PluginTrustState =
  /** Never adopted in this project — adopting is the user's explicit act. */
  | { state: 'adopt-required'; candidate: PluginResolvedSnapshot }
  /** Adopted, but vendor content moved. The stored snapshot stays authoritative. */
  | {
      state: 'refresh-required'
      stored: PluginResolvedSnapshot
      candidate: PluginResolvedSnapshot
      drift: SnapshotDrift
    }
  /** Adopted and current, but sensitive capabilities are not granted for this scope. */
  | { state: 'grant-required'; snapshot: PluginResolvedSnapshot; denied: string[] }
  | { state: 'trusted'; snapshot: PluginResolvedSnapshot }

export function describeDrift(
  stored: PluginResolvedSnapshot,
  candidate: Pick<PluginResolvedSnapshot, 'contentHash' | 'capabilityFingerprint'>,
): SnapshotDrift | null {
  const contentChanged = stored.contentHash !== candidate.contentHash
  const capabilitiesChanged = stored.capabilityFingerprint !== candidate.capabilityFingerprint
  if (contentChanged && capabilitiesChanged) return 'both'
  if (contentChanged) return 'content'
  if (capabilitiesChanged) return 'capabilities'
  return null
}

/** Capabilities this scope still needs an approval for. */
export function deniedCapabilities(snapshot: PluginResolvedSnapshot, scope: GrantScope): string[] {
  return snapshot.requestedCapabilities.filter(
    (capability) => DENY_BY_DEFAULT.has(capability) && !isCapabilityGranted(snapshot, capability, scope),
  )
}

/**
 * Pure decision. Never writes — callers act on the returned state, so a vendor
 * update cannot overwrite an adopted snapshot as a side effect of preparing a run.
 */
export function resolvePluginTrust(
  stored: PluginResolvedSnapshot | null,
  candidate: PluginResolvedSnapshot,
  scope: GrantScope,
): PluginTrustState {
  if (!stored) return { state: 'adopt-required', candidate }
  const drift = describeDrift(stored, candidate)
  if (drift) return { state: 'refresh-required', stored, candidate, drift }
  const denied = deniedCapabilities(stored, scope)
  if (denied.length) return { state: 'grant-required', snapshot: stored, denied }
  return { state: 'trusted', snapshot: stored }
}

export function trustStateMessage(trust: PluginTrustState): string {
  switch (trust.state) {
    case 'adopt-required':
      return `尚未採用此 plugin（${trust.candidate.pluginId}）；採用後才會建立 project snapshot。`
    case 'refresh-required':
      return `${driftLabel(trust.drift)}已變更，仍使用既有 snapshot ${trust.stored.snapshotId}。請明確 refresh 後重新核准。`
    case 'grant-required':
      return `尚未核准：${trust.denied.join('、')}。`
    case 'trusted':
      return `已採用並核准（${trust.snapshot.snapshotId}）。`
  }
}

function driftLabel(drift: SnapshotDrift): string {
  if (drift === 'both') return '來源內容與 capability 需求'
  return drift === 'content' ? '來源內容' : 'capability 需求'
}

// ── Explicit user actions ───────────────────────────────────────────────

/** First adoption. Writes the snapshot with no capability granted. */
export async function adoptPluginSnapshot(
  candidate: PluginResolvedSnapshot,
  projectRoot: string,
): Promise<PluginResolvedSnapshot> {
  await persistPluginSnapshot(candidate, projectRoot)
  return candidate
}

/**
 * The explicit refresh. Replaces the stored snapshot with the new vendor
 * content and drops every prior grant, because the hash or fingerprint the
 * user approved no longer describes what would run.
 */
export async function refreshPluginSnapshot(
  candidate: PluginResolvedSnapshot,
  projectRoot: string,
): Promise<PluginResolvedSnapshot> {
  const refreshed = revokeGrants(candidate)
  await persistPluginSnapshot(refreshed, projectRoot)
  return refreshed
}

/** Revoking makes the next run ask again, or fail closed if it is unattended. */
export async function revokePluginGrants(
  snapshot: PluginResolvedSnapshot,
  projectRoot: string,
): Promise<PluginResolvedSnapshot> {
  const revoked = revokeGrants(snapshot)
  await persistPluginSnapshot(revoked, projectRoot)
  return revoked
}

export type CapabilityGrantOutcome = {
  snapshot: PluginResolvedSnapshot
  granted: string[]
  denied: string[]
}

/**
 * Route each still-denied capability through the existing HITL ask. A timeout
 * auto-denies (the store's own policy), so an unattended run fails closed
 * rather than inheriting authority it was never given.
 */
export async function requestCapabilityGrants(input: {
  snapshot: PluginResolvedSnapshot
  scope: GrantScope
  projectRoot: string
  unattended?: boolean
  hitlTimeoutMs?: number
}): Promise<CapabilityGrantOutcome> {
  const pending = deniedCapabilities(input.snapshot, input.scope)
  if (!pending.length) return { snapshot: input.snapshot, granted: [], denied: [] }

  const timeoutMs = input.hitlTimeoutMs ?? (input.unattended ? 45_000 : 90_000)
  const ask = usePermissionAskStore.getState().requestAsk
  const granted: string[] = []
  const denied: string[] = []
  for (const capability of pending) {
    const decision = await ask({
      threadId: input.scope.threadId,
      runId: input.scope.runId,
      tool: `open-design:capability:${capability}`,
      args: {
        plugin: input.snapshot.pluginId,
        snapshotId: input.snapshot.snapshotId,
        capability,
        // Redacted metadata only — a snapshot never carries a raw token.
        source: input.snapshot.source.sourcePath,
      },
      reason: `Plugin「${input.snapshot.pluginId}」要求 ${capability} 權限，預設不授權。`,
      timeoutMs,
    })
    if (decision === 'allow') granted.push(capability)
    else denied.push(capability)
  }

  const next = granted.length
    ? grantCapabilities(input.snapshot, granted, input.scope)
    : input.snapshot
  if (granted.length) await persistPluginSnapshot(next, input.projectRoot)
  return { snapshot: next, granted, denied }
}
