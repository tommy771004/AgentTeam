/**
 * Policy Admin local lifecycle — draft / validate / activate / rollback.
 * Does not bypass Outbound Data Gate; never exposes protected content.
 * Writes only when build flavor is policy-admin.
 */

import { parseBuildFlavor } from './outboundGate.ts'
import type { CompanyBasePolicy, ProviderSupplementalPolicy } from './policySchema.ts'

/**
 * Main/hard gate for Policy Admin mutations (ADR-0016).
 * Standard builds must not activate/save/rollback company policy.
 */
export function assertPolicyAdminWriteAllowed(
  flavorRaw?: string | null,
): { ok: true } | { ok: false; reason: string } {
  try {
    const flavor = parseBuildFlavor(flavorRaw)
    if (flavor !== 'policy-admin') {
      return {
        ok: false,
        reason:
          'Policy Admin 寫入僅限 SUBAGENTS_BUILD_FLAVOR=policy-admin（standard 硬拒絕，非僅 UI 隱藏）。',
      }
    }
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    }
  }
}
import {
  validateCompanyBasePolicy,
  validateProviderSupplementalPolicy,
} from './policySchema.ts'
import { compileProviderSecurityProfile } from './policyMerge.ts'

export type PolicyDraft = {
  id: string
  kind: 'company-base' | 'provider-supplement'
  connectionId?: string
  body: CompanyBasePolicy | ProviderSupplementalPolicy
  createdAtUtc: string
  updatedAtUtc: string
}

export type ActivePolicySlot = {
  kind: 'company-base' | 'provider-supplement'
  connectionId?: string
  version: number
  changeId: string
  body: CompanyBasePolicy | ProviderSupplementalPolicy
  activatedAtUtc: string
  rollbackOf?: { version: number; changeId: string; reason: string }
}

export class PolicyAdminStore {
  drafts = new Map<string, PolicyDraft>()
  active = new Map<string, ActivePolicySlot>()

  private slotKey(kind: string, connectionId?: string) {
    return kind === 'company-base' ? 'company-base' : `provider:${connectionId || ''}`
  }

  saveDraft(input: {
    id: string
    kind: 'company-base' | 'provider-supplement'
    connectionId?: string
    body: unknown
  }): { ok: true; draft: PolicyDraft } | { ok: false; reason: string } {
    try {
      const body =
        input.kind === 'company-base'
          ? validateCompanyBasePolicy(input.body)
          : validateProviderSupplementalPolicy(input.body)
      const now = new Date().toISOString()
      const prev = this.drafts.get(input.id)
      const draft: PolicyDraft = {
        id: input.id,
        kind: input.kind,
        connectionId: input.connectionId,
        body,
        createdAtUtc: prev?.createdAtUtc || now,
        updatedAtUtc: now,
      }
      this.drafts.set(input.id, draft)
      return { ok: true, draft }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * Activation: schema + identity + monotonic merge + synthetic fixture gate.
   * Saving a draft alone never activates.
   */
  activateDraft(
    draftId: string,
    opts?: { companyBaseForMerge?: CompanyBasePolicy },
  ): { ok: true; slot: ActivePolicySlot } | { ok: false; reason: string } {
    const draft = this.drafts.get(draftId)
    if (!draft) return { ok: false, reason: 'draft not found' }

    try {
      if (draft.kind === 'company-base') {
        const body = validateCompanyBasePolicy(draft.body)
        // synthetic fixture: must include baseline detectors
        if (!body.baselineDetectorIds?.length) {
          return { ok: false, reason: 'synthetic validation: missing baselineDetectorIds' }
        }
        const key = this.slotKey('company-base')
        const prev = this.active.get(key)
        if (prev && body.version <= prev.version) {
          return { ok: false, reason: 'version must increase on activation' }
        }
        const slot: ActivePolicySlot = {
          kind: 'company-base',
          version: body.version,
          changeId: body.changeId,
          body,
          activatedAtUtc: new Date().toISOString(),
        }
        this.active.set(key, slot)
        return { ok: true, slot }
      }

      const body = validateProviderSupplementalPolicy(draft.body)
      if (draft.connectionId && body.connectionId !== draft.connectionId) {
        return { ok: false, reason: 'connection identity mismatch' }
      }
      const base = opts?.companyBaseForMerge
      if (base) {
        compileProviderSecurityProfile(base, body)
      }
      const key = this.slotKey('provider-supplement', body.connectionId)
      const prev = this.active.get(key)
      if (prev && body.version <= prev.version) {
        return { ok: false, reason: 'version must increase on activation' }
      }
      const slot: ActivePolicySlot = {
        kind: 'provider-supplement',
        connectionId: body.connectionId,
        version: body.version,
        changeId: body.changeId,
        body,
        activatedAtUtc: new Date().toISOString(),
      }
      this.active.set(key, slot)
      return { ok: true, slot }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * Rollback creates a NEW increasing version with metadata (never rewrite history).
   */
  rollback(opts: {
    kind: 'company-base' | 'provider-supplement'
    connectionId?: string
    targetVersion: number
    targetBody: CompanyBasePolicy | ProviderSupplementalPolicy
    reason: string
  }): { ok: true; slot: ActivePolicySlot } | { ok: false; reason: string } {
    const key = this.slotKey(opts.kind, opts.connectionId)
    const prev = this.active.get(key)
    if (!prev) return { ok: false, reason: 'no active policy to rollback from' }
    const nextVersion = prev.version + 1
    let body = opts.targetBody
    if (opts.kind === 'company-base') {
      body = { ...(opts.targetBody as CompanyBasePolicy), version: nextVersion }
      validateCompanyBasePolicy(body)
    } else {
      body = { ...(opts.targetBody as ProviderSupplementalPolicy), version: nextVersion }
      validateProviderSupplementalPolicy(body)
    }
    const slot: ActivePolicySlot = {
      kind: opts.kind,
      connectionId: opts.connectionId,
      version: nextVersion,
      changeId: `rollback-${prev.changeId}-to-${opts.targetVersion}`,
      body,
      activatedAtUtc: new Date().toISOString(),
      rollbackOf: {
        version: opts.targetVersion,
        changeId: prev.changeId,
        reason: opts.reason.slice(0, 200),
      },
    }
    this.active.set(key, slot)
    return { ok: true, slot }
  }

  /** Diff by rule id / field names only — no secret values. */
  diffActiveFields(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): string[] {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    const changed: string[] = []
    for (const k of keys) {
      if (k === 'detectors' || k === 'extraDetectors') {
        // compare ids only
        const bIds = new Set(
          (Array.isArray(before[k]) ? before[k] : []).map((d: { id?: string }) => d?.id),
        )
        const aIds = new Set(
          (Array.isArray(after[k]) ? after[k] : []).map((d: { id?: string }) => d?.id),
        )
        for (const id of aIds) if (id && !bIds.has(id)) changed.push(`${k}+${id}`)
        for (const id of bIds) if (id && !aIds.has(id)) changed.push(`${k}-${id}`)
        continue
      }
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k)
    }
    return changed
  }
}

export type BuildFlavor = 'standard' | 'policy-admin'

export function parseBuildFlavorStrict(raw: string | undefined | null): BuildFlavor {
  if (raw == null || String(raw).trim() === '' || raw === 'standard') return 'standard'
  if (raw === 'policy-admin') return 'policy-admin'
  throw new Error(`Invalid SUBAGENTS_BUILD_FLAVOR="${raw}" — build must fail`)
}

export function policyAdminSurfacesEnabled(flavor: BuildFlavor): boolean {
  return flavor === 'policy-admin'
}
