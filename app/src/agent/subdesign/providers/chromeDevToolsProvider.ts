/**
 * SubDesign Chrome DevTools critique evidence — console, network, performance.
 * Pi Core owns the session; renderer never connects directly.
 * Evidence is adapter-issued only.
 */
import { issueProviderEvidence, type ProviderAvailability, type ProviderEvidence } from './providerContract.ts'
import type { SubDesignPluginExecutionProjection } from '../pluginExecution.ts'

export const CDT_PINNED_VERSION = '1.3'

export type CdtFindingKind = 'console' | 'network' | 'performance'

export type CdtFinding = {
  kind: CdtFindingKind
  severity: 'info' | 'warning' | 'blocker'
  message: string
  path?: string
  capturedAt: string
  runId: string
  stageId: string
  providerId: 'chrome-devtools'
  artifactId?: string
}

export type CdtAttachment = {
  locator: string
  bytes: number
}

export function cdtAvailability(enabled: boolean | undefined): ProviderAvailability {
  if (!enabled) return { available: false, reason: 'Chrome DevTools provider 未啟用（feature flag 關閉）', code: 'unavailable' }
  return { available: true }
}

// Deterministic fixture normalizers
function safeObservedPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return `${url.origin}${url.pathname}`.slice(0, 500)
  } catch {
    return value.replace(/[?#].*$/, '').slice(0, 500)
  }
}

export function normalizeCdtFixtureRaw(raw: unknown, runId: string, stageId: string, artifactId?: string): { findings: CdtFinding[]; attachments: CdtAttachment[]; warnings: string[] } {
  if (!raw || typeof raw !== 'object') return { findings: [], attachments: [], warnings: ['fixture 為空'] }
  const obj = raw as Record<string, unknown>
  const out: CdtFinding[] = []
  const atts: CdtAttachment[] = []
  const push = (kind: CdtFindingKind, severity: CdtFinding['severity'], message: string, observedPath?: unknown) => {
    out.push({ kind, severity, message: String(message).slice(0, 500), path: safeObservedPath(observedPath), capturedAt: new Date().toISOString(), runId, stageId, providerId: 'chrome-devtools', artifactId })
  }
  if (Array.isArray(obj.console)) {
    for (const e of obj.console) {
      if (!e || typeof e !== 'object') continue
      const rec = e as Record<string, unknown>
      if (String(rec.level) === 'error') push('console', 'blocker', String(rec.message || rec.text || 'console error'), rec.url)
    }
  }
  if (Array.isArray(obj.network)) {
    for (const e of obj.network) {
      if (!e || typeof e !== 'object') continue
      const rec = e as Record<string, unknown>
      if (rec.failed === true || (typeof rec.status === 'number' && rec.status >= 400)) push('network', 'blocker', `request failed: ${safeObservedPath(rec.url || rec.path) || 'unknown'} ${String(rec.status || '')}`.trim(), rec.url || rec.path)
    }
  }
  if (Array.isArray(obj.performance)) {
    for (const e of obj.performance) {
      if (!e || typeof e !== 'object') continue
      const rec = e as Record<string, unknown>
      if (typeof rec.metric === 'string' && typeof rec.value === 'number') {
        const sev: CdtFinding['severity'] = rec.value > (typeof rec.threshold === 'number' ? rec.threshold : 1000) ? 'warning' : 'info'
        push('performance', sev, `${String(rec.metric)}=${rec.value}`)
      }
    }
  }
  // Large traces go to locator, not inline
  if (typeof obj.trace === 'string' && obj.trace.length > 1000) {
    atts.push({ locator: `evidence/${runId}/${stageId}/trace.json`, bytes: new TextEncoder().encode(String(obj.trace)).length })
  }
  // Redaction: never include cookies/authorization headers
  for (const f of out) {
    f.message = f.message.replace(/authorization:\s*[^\s]+/gi, 'authorization: [redacted]')
    f.message = f.message.replace(/cookie:\s*[^\n]+/gi, 'cookie: [redacted]')
  }
  return { findings: out.slice(0, 50), attachments: atts.slice(0, 10), warnings: [] }
}

export function cdtToProviderEvidence(findings: CdtFinding[], runId: string, stageId: string): ProviderEvidence[] {
  return findings.map((f, i) => issueProviderEvidence({
    evidenceId: `cdt_${runId}_${stageId}_${i}`,
    runId,
    stageId,
    providerId: 'chrome-devtools' as const,
    kind: 'execution' as const,
    summary: f.message,
    capturedAt: f.capturedAt,
    severity: f.severity,
  }))
}

/**
 * Final Critique gate for explicitly requested runtime evidence. A missing,
 * blocked, partial, cross-artifact, or blocker-bearing Host projection cannot
 * be converted into a passing claim by model output.
 */
export function chromeDevToolsEvidenceAllowsPass(
  projection: SubDesignPluginExecutionProjection | undefined,
  expected: { runId: string; artifactId: string },
): { allowed: true } | { allowed: false; reason: string } {
  if (!projection || projection.providerId !== 'chrome-devtools' || projection.runId !== expected.runId) {
    return { allowed: false, reason: '找不到本次 round 的 Chrome DevTools Host projection。' }
  }
  if (projection.state !== 'completed') {
    return { allowed: false, reason: projection.summary || `Chrome DevTools evidence ${projection.state}。` }
  }
  if (projection.partial) return { allowed: false, reason: 'Chrome DevTools evidence 為 partial，需重新收集完整證據。' }
  const findings = projection.findings || []
  if (findings.some((finding) => finding.artifactId && finding.artifactId !== expected.artifactId)) {
    return { allowed: false, reason: 'Chrome DevTools finding 的 artifact scope 不符合本次 Critique。' }
  }
  const blockers = findings.filter((finding) => finding.severity === 'blocker')
  if (blockers.length) return { allowed: false, reason: `Chrome DevTools 尚有 ${blockers.length} 個 blocker。` }
  return { allowed: true }
}
