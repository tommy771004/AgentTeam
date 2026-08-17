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

/**
 * Type-level unrepresentability (ADR-0048 layer one): a successful side effect
 * cannot be constructed without adapter-issued evidence, mirroring how
 * `LoopRequest`'s 'time' / 'proactive' variants require a trigger snapshot.
 */
export type SideEffectOutcome<T> =
  | { ok: true; evidence: SideEffectEvidence; result: T }
  | { ok: false; reason: string }

export const MODEL_SUPPLIED_EVIDENCE_REFUSAL =
  'execution evidence cannot be supplied through tool arguments; it is issued by the adapter that performs the effect'

/**
 * Model tool arguments are never a credential. A model that names an evidence
 * field is refused with a reason rather than having the field silently dropped,
 * so the attempt is visible in the transcript.
 */
export function rejectModelSuppliedEvidence(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const keys = Object.keys(args as Record<string, unknown>)
  const offending = keys.find((key) => /^(evidence|evidenceId|attestation|issuedBy)$/i.test(key))
  return offending ? `${MODEL_SUPPLIED_EVIDENCE_REFUSAL} (rejected argument: ${offending})` : undefined
}

/**
 * Fail-closed runtime refusal (ADR-0048 layer two). Re-validates the snapshot
 * at the exit even when the type system said it was present, because IPC
 * payloads, casts and plain-JS callers erase layer one.
 */
export function gateSideEffect<T>(input: {
  kind: SideEffectKind
  evidence: unknown
  result: T
  runId?: string
}): SideEffectOutcome<T> {
  const validation = validateSideEffectEvidence(input.evidence)
  if (!validation.ok) return { ok: false, reason: validation.reason }
  if (validation.evidence.kind !== input.kind) {
    return { ok: false, reason: `evidence kind ${validation.evidence.kind} does not match ${input.kind}` }
  }
  if (input.runId && validation.evidence.runId && validation.evidence.runId !== input.runId) {
    return { ok: false, reason: 'evidence is scoped to a different run' }
  }
  return { ok: true, evidence: validation.evidence, result: input.result }
}
