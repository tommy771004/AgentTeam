/**
 * Monotonic merge: company floor always survives; supplement only adds/tightens.
 */

import type {
  CompanyBasePolicy,
  PolicyDetector,
  ProviderSupplementalPolicy,
} from './policySchema.ts'

export type ProviderSecurityProfile = {
  connectionId: string
  baseVersion: number
  baseChangeId: string
  supplementVersion: number
  supplementChangeId: string
  detectors: PolicyDetector[]
  denyImageVision: boolean
  /** From company base only — never from provider supplement. */
  visionAuthorization?: CompanyBasePolicy['visionAuthorization']
  baselineDetectorIds: string[]
  offlineCache?: CompanyBasePolicy['offlineCache']
  evidence?: CompanyBasePolicy['evidence']
}

export function mergePolicyMonotonic(
  base: CompanyBasePolicy,
  supplement: ProviderSupplementalPolicy,
): ProviderSecurityProfile {
  if (
    Array.isArray(supplement.disabledBaselineDetectorIds) &&
    supplement.disabledBaselineDetectorIds.length > 0
  ) {
    throw new Error(
      'supplement cannot relax/weaken baseline (disabledBaselineDetectorIds present)',
    )
  }

  // denyImageVision: only allow tightening (base true stays true; false + true → true)
  const denyImageVision = Boolean(base.denyImageVision) || Boolean(supplement.denyImageVision)

  const byId = new Map<string, PolicyDetector>()
  for (const d of base.detectors || []) byId.set(d.id, d)
  for (const d of supplement.extraDetectors || []) {
    if (base.baselineDetectorIds.includes(d.id)) {
      // may refine pattern only if explicitly tighter later; v1: reject overwrite of baseline ids
      throw new Error(`supplement cannot overwrite baseline detector id: ${d.id}`)
    }
    byId.set(d.id, d)
  }

  return {
    connectionId: supplement.connectionId,
    baseVersion: base.version,
    baseChangeId: base.changeId,
    supplementVersion: supplement.version,
    supplementChangeId: supplement.changeId,
    detectors: [...byId.values()],
    denyImageVision,
    // Vision auth is company-base only; supplements cannot enable it.
    visionAuthorization: base.visionAuthorization,
    baselineDetectorIds: [...base.baselineDetectorIds],
    offlineCache: base.offlineCache,
    evidence: base.evidence,
  }
}

export function compileProviderSecurityProfile(
  base: CompanyBasePolicy,
  supplement: ProviderSupplementalPolicy,
): ProviderSecurityProfile {
  return mergePolicyMonotonic(base, supplement)
}
