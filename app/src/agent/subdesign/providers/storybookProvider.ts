/**
 * SubDesign Storybook component context provider — read-only, bounded, cacheable.
 * Upstream is experimental; we normalize to internal ComponentEvidence.
 * Flag-gated: the project's persisted Storybook setting must be enabled.
 */
import { issueProviderEvidence, type ProviderAvailability, type ProviderEvidence } from './providerContract.ts'

export const STORYBOOK_PINNED_VERSION = '8.6.0'
export const STORYBOOK_CONTEXT_BUDGET_BYTES = 64 * 1024
export const STORYBOOK_CACHE_LIMIT = 24

export type ComponentEvidence = {
  provider: 'storybook'
  version: typeof STORYBOOK_PINNED_VERSION
  capturedAt: string
  components: Array<{ id: string; title: string; docs?: string; controls?: string[] }>
  summary: string
  sourceFingerprint?: string
  truncated?: boolean
}

const cache = new Map<string, { fp: string; evidence: ComponentEvidence }>()

/**
 * The one availability gate, called by the Host adapter with the project's
 * persisted setting. Experimental providers stay off unless the project
 * explicitly enabled them.
 */
export function storybookAvailability(enabled: boolean | undefined): ProviderAvailability {
  if (!enabled) return { available: false, reason: 'Storybook provider 未啟用（feature flag 關閉）', code: 'unavailable' }
  return { available: true }
}

export type RawStorybookResponse = {
  components?: unknown[]
  version?: string
  extraFutureField?: unknown
}

export function normalizeStorybookResponse(raw: RawStorybookResponse, opts: { projectId: string; fingerprint: string }): ComponentEvidence {
  const comps = Array.isArray(raw.components) ? raw.components.slice(0, 100) : []
  const normalized = comps
    .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
    .map((c, index) => ({
      id: String((c as Record<string, unknown>).id || '').slice(0, 80) || `comp_${index + 1}`,
      title: String((c as Record<string, unknown>).title || 'Untitled').slice(0, 120),
      docs: typeof (c as Record<string, unknown>).docs === 'string' ? String((c as Record<string, unknown>).docs).slice(0, 2000) : undefined,
      controls: Array.isArray((c as Record<string, unknown>).controls) ? ((c as Record<string, unknown>).controls as unknown[]).map((x) => String(x).slice(0, 80)).slice(0, 20) : undefined,
    }))
    .slice(0, 50)

  let json = JSON.stringify(normalized)
  let truncated = false
  if (new TextEncoder().encode(json).length > STORYBOOK_CONTEXT_BUDGET_BYTES) {
    // Summarize / locator handling: keep first 20, mark truncated
    const head = normalized.slice(0, 20)
    json = JSON.stringify(head)
    truncated = true
  }

  return {
    provider: 'storybook',
    version: STORYBOOK_PINNED_VERSION,
    capturedAt: new Date().toISOString(),
    components: truncated ? normalized.slice(0, 20) : normalized,
    summary: `Storybook：${normalized.length} components${truncated ? '（已截斷，符合 budget）' : ''}`,
    sourceFingerprint: opts.fingerprint,
    truncated,
  }
}

export function getStorybookContext(projectId: string, raw: RawStorybookResponse, fingerprint: string): { evidence: ComponentEvidence; fromCache: boolean } {
  const key = `${projectId}:${fingerprint}`
  const hit = cache.get(key)
  if (hit && hit.fp === fingerprint) return { evidence: hit.evidence, fromCache: true }
  for (const existing of cache.keys()) {
    if (existing.startsWith(`${projectId}:`) && existing !== key) cache.delete(existing)
  }
  const evidence = normalizeStorybookResponse(raw, { projectId, fingerprint })
  cache.set(key, { fp: fingerprint, evidence })
  while (cache.size > STORYBOOK_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (!oldest) break
    cache.delete(oldest)
  }
  return { evidence, fromCache: false }
}

export function clearStorybookCache(): void {
  cache.clear()
}

export function toProviderEvidence(ev: ComponentEvidence, runId: string): ProviderEvidence {
  return issueProviderEvidence({
    evidenceId: `sb_${runId}_${Date.now()}`,
    runId,
    stageId: 'context',
    providerId: 'storybook' as const,
    kind: 'context',
    summary: ev.summary,
    capturedAt: ev.capturedAt,
  })
}
