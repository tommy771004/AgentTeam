/**
 * Chrome DevTools critique evidence — console, network, performance.
 * Pi Core owns the session; renderer never connects directly.
 * Evidence is adapter-issued only.
 */
import { isProviderEnabled } from './providerFlags.ts'
import type { ProviderAvailability, ProviderEvidence } from './providerContract.ts'

export const CDT_PINNED_VERSION = '0.0.1-pinned'

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
}

export type CdtAttachment = {
  locator: string
  bytes: number
}

export function cdtAvailability(): ProviderAvailability {
  if (!isProviderEnabled('chrome-devtools')) return { available: false, reason: 'Chrome DevTools provider 未啟用（feature flag 關閉）', code: 'unavailable' }
  return { available: true }
}

// Deterministic fixture normalizers
export function normalizeCdtFixtureraw(raw: unknown, runId: string, stageId: string): { findings: CdtFinding[]; attachments: CdtAttachment[]; warnings: string[] } {
  if (!raw || typeof raw !== 'object') return { findings: [], attachments: [], warnings: ['fixture 為空'] }
  const obj = raw as Record<string, unknown>
  const out: CdtFinding[] = []
  const atts: CdtAttachment[] = []
  const push = (kind: CdtFindingKind, severity: CdtFinding['severity'], message: string) => {
    out.push({ kind, severity, message: String(message).slice(0, 500), capturedAt: new Date().toISOString(), runId, stageId, providerId: 'chrome-devtools' })
  }
  if (Array.isArray(obj.console)) {
    for (const e of obj.console) {
      if (!e || typeof e !== 'object') continue
      const rec = e as Record<string, unknown>
      if (String(rec.level) === 'error') push('console', 'blocker', String(rec.message || rec.text || 'console error'))
    }
  }
  if (Array.isArray(obj.network)) {
    for (const e of obj.network) {
      if (!e || typeof e !== 'object') continue
      const rec = e as Record<string, unknown>
      if (rec.failed === true || (typeof rec.status === 'number' && rec.status >= 400)) push('network', 'blocker', `request failed: ${String(rec.url || rec.path || 'unknown')} ${String(rec.status || '')}`.trim())
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
  return findings.map((f, i) => ({
    evidenceId: `cdt_${runId}_${stageId}_${i}`,
    runId,
    stageId,
    providerId: 'chrome-devtools' as const,
    kind: 'execution' as const,
    summary: f.message,
    capturedAt: f.capturedAt,
    projectRelativeLocator: f.path,
    adapterIssued: true as const,
    severity: f.severity,
  }))
}
