/** Non-model execution evidence issued only at a trusted adapter boundary. */

export type SideEffectKind = 'message_send' | 'content_publish' | 'merge' | 'push' | 'deploy'

export type SideEffectEvidence = {
  evidenceId: string
  runId?: string
  kind: SideEffectKind
  source: string
  issuedBy: 'adapter'
  attestation: 'non-model'
  issuedAt: string
  metadata: Record<string, string | number | boolean | undefined>
}

export type EvidenceValidation =
  | { ok: true; evidence: SideEffectEvidence }
  | { ok: false; reason: string }

function text(value: unknown, max = 180): string {
  return String(value ?? '').trim().slice(0, max)
}

export function createSideEffectEvidence(input: {
  runId?: string
  kind: SideEffectKind
  source: string
  metadata?: Record<string, string | number | boolean | undefined>
  issuedAt?: string
}): SideEffectEvidence {
  const issuedAt = input.issuedAt || new Date().toISOString()
  const runPart = text(input.runId || 'unbound', 80).replace(/[^a-zA-Z0-9._:-]/g, '_')
  return {
    evidenceId: `effect:${input.kind}:${runPart}:${Date.parse(issuedAt) || Date.now()}`,
    runId: input.runId,
    kind: input.kind,
    source: text(input.source),
    issuedBy: 'adapter',
    attestation: 'non-model',
    issuedAt,
    metadata: { ...(input.metadata || {}) },
  }
}

export function validateSideEffectEvidence(value: unknown): EvidenceValidation {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'side-effect evidence is required' }
  const evidence = value as Partial<SideEffectEvidence>
  if (typeof evidence.evidenceId !== 'string' || !evidence.evidenceId.trim()) return { ok: false, reason: 'evidenceId is required' }
  if (evidence.issuedBy !== 'adapter') return { ok: false, reason: 'evidence must be issued by a trusted adapter' }
  if (evidence.attestation !== 'non-model') return { ok: false, reason: 'model-attested evidence is not accepted' }
  if (!['message_send', 'content_publish', 'merge', 'push', 'deploy'].includes(String(evidence.kind))) return { ok: false, reason: 'invalid side-effect kind' }
  if (typeof evidence.source !== 'string' || !evidence.source.trim()) return { ok: false, reason: 'evidence source is required' }
  if (typeof evidence.issuedAt !== 'string' || Number.isNaN(Date.parse(evidence.issuedAt))) return { ok: false, reason: 'invalid evidence timestamp' }
  if (!evidence.metadata || typeof evidence.metadata !== 'object' || Array.isArray(evidence.metadata)) return { ok: false, reason: 'evidence metadata is required' }
  return { ok: true, evidence: evidence as SideEffectEvidence }
}

export function requireSideEffectEvidence(value: unknown): SideEffectEvidence {
  const result = validateSideEffectEvidence(value)
  if (!result.ok) throw new Error(result.reason)
  return result.evidence
}
