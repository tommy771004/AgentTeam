/**
 * Atomic Workspace Policy Bundle sync (ticket 10).
 * local/workspace authority never auto-switches.
 */

import type { CompanyBasePolicy, ProviderSupplementalPolicy } from './policySchema.ts'
import {
  validateCompanyBasePolicy,
  validateProviderSupplementalPolicy,
} from './policySchema.ts'
import { compileProviderSecurityProfile, type ProviderSecurityProfile } from './policyMerge.ts'
import type { PolicySourceMode } from './policySourceMode.ts'

export type PolicyBundle = {
  schemaVersion: 1
  kind: 'policy-bundle'
  workspaceId: string
  connectionId: string
  bundleVersion: number
  changeId: string
  etag: string
  companyBase: CompanyBasePolicy
  providerSupplement: ProviderSupplementalPolicy
  fetchedAtUtc?: string
}

export type OfflineCacheAction = 'block' | 'basic' | 'use-stale'

export type BundleCacheEntry = {
  bundle: PolicyBundle
  profile: ProviderSecurityProfile
  storedAtMs: number
}

export function validatePolicyBundle(raw: unknown): PolicyBundle {
  if (!raw || typeof raw !== 'object') throw new Error('bundle not an object')
  const b = raw as Partial<PolicyBundle>
  if (b.schemaVersion !== 1 || b.kind !== 'policy-bundle') {
    throw new Error('invalid bundle schema/kind')
  }
  if (!b.workspaceId || !b.connectionId) throw new Error('bundle missing identity')
  if (typeof b.bundleVersion !== 'number' || b.bundleVersion < 1) {
    throw new Error('invalid bundleVersion')
  }
  if (!b.changeId || !b.etag) throw new Error('bundle missing changeId/etag')
  const companyBase = validateCompanyBasePolicy(b.companyBase)
  const providerSupplement = validateProviderSupplementalPolicy(b.providerSupplement)
  if (providerSupplement.connectionId !== b.connectionId) {
    throw new Error('supplement connectionId mismatch')
  }
  return {
    schemaVersion: 1,
    kind: 'policy-bundle',
    workspaceId: b.workspaceId,
    connectionId: b.connectionId,
    bundleVersion: b.bundleVersion,
    changeId: b.changeId,
    etag: b.etag,
    companyBase,
    providerSupplement,
    fetchedAtUtc: b.fetchedAtUtc,
  }
}

export function compileBundleProfile(bundle: PolicyBundle): ProviderSecurityProfile {
  return compileProviderSecurityProfile(bundle.companyBase, bundle.providerSupplement)
}

/**
 * Decide offline use of last-known-good. Never switches policy source mode.
 */
export function resolveOfflineBundleAccess(opts: {
  policySource: PolicySourceMode
  cache: BundleCacheEntry | null
  nowMs?: number
  /** When source is workspace but network failed */
  networkAvailable: boolean
  effectiveGuardMode: 'off' | 'demo' | 'optional' | 'required'
}):
  | { action: 'use'; profile: ProviderSecurityProfile; from: 'live' | 'cache' | 'basic' }
  | { action: 'block'; reason: string } {
  if (opts.policySource !== 'workspace') {
    return { action: 'block', reason: 'offline bundle resolver only applies to workspace source' }
  }
  if (opts.networkAvailable && opts.cache) {
    return { action: 'use', profile: opts.cache.profile, from: 'live' }
  }
  if (!opts.cache) {
    return { action: 'block', reason: 'no last-known-good Workspace bundle' }
  }
  const offline = opts.cache.bundle.companyBase.offlineCache || {
    maxAgeHours: 72,
    onExpired: opts.effectiveGuardMode === 'required' ? 'block' : 'basic',
  }
  const now = opts.nowMs ?? Date.now()
  const ageH = (now - opts.cache.storedAtMs) / 3_600_000
  const expired = ageH > offline.maxAgeHours
  if (!expired) {
    return { action: 'use', profile: opts.cache.profile, from: 'cache' }
  }
  const onExpired: OfflineCacheAction =
    offline.onExpired || (opts.effectiveGuardMode === 'required' ? 'block' : 'basic')
  if (onExpired === 'use-stale') {
    return { action: 'use', profile: opts.cache.profile, from: 'cache' }
  }
  if (onExpired === 'basic') {
    // Caller should compile builtin baseline for connection — we mark basic
    return { action: 'use', profile: opts.cache.profile, from: 'basic' }
  }
  return {
    action: 'block',
    reason: 'Workspace policy cache expired (required default: block AI egress only)',
  }
}

export type WorkspaceAuth =
  | { type: 'bearer'; token: string }
  | { type: 'mtls'; /* placeholder for main-process cert handles */ certRef: string }

export async function fetchWorkspacePolicyBundle(opts: {
  endpointUrl: string
  connectionId: string
  workspaceId: string
  auth: WorkspaceAuth
  etag?: string
  fetchImpl?: typeof fetch
}): Promise<
  | { ok: true; status: 200; bundle: PolicyBundle }
  | { ok: true; status: 304; etag: string }
  | { ok: false; reason: string }
> {
  const url = String(opts.endpointUrl || '').trim()
  if (!url) return { ok: false, reason: 'workspace endpoint missing' }
  // Anonymous not allowed
  if (!opts.auth) return { ok: false, reason: 'workspace authentication required' }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Connection-Id': opts.connectionId,
    'X-Workspace-Id': opts.workspaceId,
  }
  if (opts.auth.type === 'bearer') {
    headers.Authorization = `Bearer ${opts.auth.token}`
  }
  if (opts.etag) headers['If-None-Match'] = opts.etag

  const fetchImpl = opts.fetchImpl || fetch
  let res: Response
  try {
    res = await fetchImpl(url, { method: 'GET', headers, redirect: 'error' })
  } catch (e) {
    return {
      ok: false,
      reason: `workspace fetch failed: ${e instanceof Error ? e.message : e}`,
    }
  }
  if (res.status === 304) {
    return { ok: true, status: 304, etag: opts.etag || '' }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: `workspace authentication failed (${res.status})` }
  }
  if (!res.ok) {
    return { ok: false, reason: `workspace HTTP ${res.status}` }
  }
  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    return { ok: false, reason: 'workspace invalid JSON' }
  }
  try {
    const bundle = validatePolicyBundle(raw)
    if (bundle.connectionId !== opts.connectionId) {
      return { ok: false, reason: 'bundle connectionId mismatch — not stored' }
    }
    if (bundle.workspaceId !== opts.workspaceId) {
      return { ok: false, reason: 'bundle workspaceId mismatch — not stored' }
    }
    return { ok: true, status: 200, bundle }
  } catch (e) {
    return {
      ok: false,
      reason: `bundle validation failed: ${e instanceof Error ? e.message : e}`,
    }
  }
}

/** In-memory per-connection LKG cache (Electron main would persist). */
export class WorkspaceBundleCache {
  private map = new Map<string, BundleCacheEntry>()

  key(workspaceId: string, connectionId: string) {
    return `${workspaceId}::${connectionId}`
  }

  get(workspaceId: string, connectionId: string): BundleCacheEntry | null {
    return this.map.get(this.key(workspaceId, connectionId)) || null
  }

  /**
   * Store only after validation. Rejects lower bundleVersion (rollback replay).
   */
  put(bundle: PolicyBundle, nowMs = Date.now()): { ok: true } | { ok: false; reason: string } {
    try {
      validatePolicyBundle(bundle)
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
    const k = this.key(bundle.workspaceId, bundle.connectionId)
    const prev = this.map.get(k)
    if (prev && bundle.bundleVersion < prev.bundle.bundleVersion) {
      return { ok: false, reason: 'bundleVersion not monotonic — refuse rollback replay' }
    }
    const profile = compileBundleProfile(bundle)
    this.map.set(k, { bundle, profile, storedAtMs: nowMs })
    return { ok: true }
  }
}
