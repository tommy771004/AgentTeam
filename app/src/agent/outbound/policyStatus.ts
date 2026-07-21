/**
 * Non-sensitive status strings for Settings / diagnostics (no secrets, no policy bodies).
 */

import type { PolicySourceMode } from './policySourceMode.ts'
import type { ProviderSecurityProfile } from './policyMerge.ts'

export function formatProviderPolicyStatus(input: {
  connectionId: string
  policySource: PolicySourceMode
  profile?: ProviderSecurityProfile | null
  error?: string | null
}): {
  connectionId: string
  policySource: PolicySourceMode
  baseVersion: number | null
  supplementVersion: number | null
  ok: boolean
  summary: string
} {
  if (input.error) {
    return {
      connectionId: input.connectionId,
      policySource: input.policySource,
      baseVersion: null,
      supplementVersion: null,
      ok: false,
      summary: `錯誤 · ${input.error.slice(0, 120)}`,
    }
  }
  if (!input.profile) {
    return {
      connectionId: input.connectionId,
      policySource: input.policySource,
      baseVersion: null,
      supplementVersion: null,
      ok: false,
      summary: '尚未載入 Provider Security Profile',
    }
  }
  return {
    connectionId: input.connectionId,
    policySource: input.policySource,
    baseVersion: input.profile.baseVersion,
    supplementVersion: input.profile.supplementVersion,
    ok: true,
    summary: `${input.policySource} · base v${input.profile.baseVersion} · supp v${input.profile.supplementVersion}`,
  }
}
