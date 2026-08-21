/**
 * Internal provider contracts — normalises all external systems into
 * product-owned vocabulary (context, evidence, surface, streaming).
 *
 * Every provider implements:
 *  identity, availability, timeout, outputBudget, cancellation,
 *  structured result, adapter-issued evidence.
 *
 * Spec 03 requires a highest-level seam: SubDesign → coordinator → Pi Core →
 * fake provider → activity/evidence/artifact → settlement.
 * Provider success != stage success != Goal-DoD.
 */

export type ProviderId = 'storybook' | 'chrome-devtools' | 'harness' | 'mcp-apps' | 'fake-pipeline'

export type ProviderAvailability =
  | { available: true }
  | { available: false; reason: string; code?: 'unavailable' | 'timeout' | 'permission-denied' | 'unsupported-platform' | 'blocked' }

export type ProviderResultKind = 'success' | 'failure' | 'blocked' | 'cancelled'

export type ProviderExecutionReceipt = {
  providerId: ProviderId
  runId: string
  stageId?: string
  kind: ProviderResultKind
  startedAt: string
  finishedAt: string
  summary: string
  /** Project-relative locator for large output */
  evidenceLocator?: string
  /** Project-relative artifact locator */
  artifactLocator?: string
  // raw output budget enforcement happens before this
  truncated?: boolean
}

export type ProviderEvidence = {
  evidenceId: string
  runId: string
  stageId: string
  providerId: ProviderId
  kind: 'context' | 'execution' | 'goal' | 'surface' | 'stream'
  summary: string
  capturedAt: string
  projectRelativeLocator?: string
  /** Only adapter (trusted) may set true; model text never accepted */
  adapterIssued: true
  severity?: 'info' | 'warning' | 'blocker'
}

export type ProviderHandle = {
  providerId: ProviderId
  runId: string
  stageId?: string
  cancel: () => Promise<{ cancelled: boolean; reason?: string }>
}

export type ProviderSession = {
  handle: ProviderHandle
  promise: Promise<ProviderExecutionReceipt>
  evidence: ProviderEvidence[]
}

export type ProviderOptions = {
  runId: string
  stageId: string
  threadId?: string
  timeoutMs: number
  outputBudgetBytes: number
  signal: AbortSignal
}

export const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000
export const DEFAULT_OUTPUT_BUDGET_BYTES = 256 * 1024

export function checkOutputBudget(text: string, budget: number): { ok: boolean; truncated?: string } {
  const bytes = new TextEncoder().encode(text).length
  if (bytes <= budget) return { ok: true }
  const enc = new TextEncoder().encode(text)
  const slice = enc.slice(0, budget)
  return { ok: false, truncated: new TextDecoder().decode(slice) + '\n…[truncated: output budget exceeded]' }
}

export function isProviderCancellationError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.message.includes('cancelled') || e.message.includes('aborted'))
}

// Adapter-issued evidence guard
export function isAdapterEvidence(value: unknown): value is ProviderEvidence {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return v.adapterIssued === true && typeof v.evidenceId === 'string' && typeof v.runId === 'string' && typeof v.providerId === 'string'
}

export function rejectModelAttestedEvidence(value: unknown): { accepted: false; reason: string } | { accepted: true; evidence: ProviderEvidence } {
  if (!isAdapterEvidence(value)) {
    return { accepted: false, reason: 'Evidence 必須由可信 adapter 簽發；model text 不能製造 evidence。' }
  }
  return { accepted: true, evidence: value }
}
