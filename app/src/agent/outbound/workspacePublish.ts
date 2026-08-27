/**
 * Workspace publish + evidence verification helpers.
 */

import type { PolicyDraft, ActivePolicySlot, PolicyAdminStore } from './policyAdmin.ts'
import { verifyLedgerFile, type HmacKeyProvider } from './evidenceLedger.ts'

export type PublishResult =
  | { ok: true; publishedVersion: number; changeId: string; etag: string }
  | { ok: false; reason: string }

/**
 * Explicit publish action — draft must already pass activate validation.
 * Does not reveal protected content.
 */
export async function publishPolicyToWorkspace(opts: {
  store: PolicyAdminStore
  draftId: string
  companyBaseForMerge?: import('./policySchema.ts').CompanyBasePolicy
  publishImpl?: (slot: ActivePolicySlot) => Promise<{ etag: string } | { error: string }>
}): Promise<PublishResult> {
  const activated = opts.store.activateDraft(opts.draftId, {
    companyBaseForMerge: opts.companyBaseForMerge,
  })
  if (!activated.ok) return { ok: false, reason: activated.reason }

  const publish =
    opts.publishImpl ||
    (async (slot) => ({
      etag: `W/"${slot.changeId}-${slot.version}"`,
    }))

  const res = await publish(activated.slot)
  if ('error' in res) return { ok: false, reason: res.error }
  return {
    ok: true,
    publishedVersion: activated.slot.version,
    changeId: activated.slot.changeId,
    etag: res.etag,
  }
}

export async function verifyEvidenceForAdmin(opts: {
  ledgerFilePath: string
  keyProvider: HmacKeyProvider
}): Promise<{ ok: boolean; reason?: string }> {
  return verifyLedgerFile(opts.ledgerFilePath, opts.keyProvider)
}

export function summarizeDraftForReview(draft: PolicyDraft): {
  id: string
  kind: string
  connectionId?: string
  fieldNames: string[]
} {
  const body = draft.body as unknown as Record<string, unknown>
  return {
    id: draft.id,
    kind: draft.kind,
    connectionId: draft.connectionId,
    fieldNames: Object.keys(body).filter((k) => k !== 'detectors' && k !== 'extraDetectors'),
  }
}
