import { isProjectRelativePath } from './artifactManifest.ts'
import type { SubDesignCritique, SubDesignCritiqueEvidence, SubDesignCritiqueFinding } from './types.ts'

export function clampScore(value: unknown): number {
  const score = Number(value)
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(100, Math.round(score)))
}

export function normalizeFindings(value: unknown): SubDesignCritiqueFinding[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): SubDesignCritiqueFinding | null => {
      if (!item || typeof item !== 'object') return null
      const raw = item as Record<string, unknown>
      const message = String(raw.message || raw.title || '').trim().slice(0, 1000)
      if (!message) return null
      const severity = raw.severity === 'blocker' || raw.severity === 'warning' ? raw.severity : 'note'
      const path = raw.path ? String(raw.path).trim().replaceAll('\\', '/') : undefined
      const finding: SubDesignCritiqueFinding = {
        severity,
        message,
      }
      if (path && isProjectRelativePath(path)) finding.path = path.slice(0, 600)
      return finding
    })
    .filter((item): item is SubDesignCritiqueFinding => item !== null)
    .slice(0, 40)
}

export function normalizeEvidence(value: unknown): SubDesignCritiqueEvidence[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<SubDesignCritiqueEvidence['kind']>([
    'screenshot', 'dom', 'lint', 'build', 'manual',
    'template-attribution', 'design-system', 'asset-license',
  ])
  return value
    .map((item): SubDesignCritiqueEvidence | null => {
      if (!item || typeof item !== 'object') return null
      const raw = item as Record<string, unknown>
      const kind = raw.kind as SubDesignCritiqueEvidence['kind']
      const summary = String(raw.summary || raw.description || '').trim().slice(0, 1000)
      if (!allowed.has(kind) || !summary) return null
      const path = raw.path ? String(raw.path).trim().replaceAll('\\', '/') : undefined
      return {
        kind,
        summary,
        path: path && isProjectRelativePath(path) ? path.slice(0, 600) : undefined,
        capturedAt: String(raw.capturedAt || '').trim().slice(0, 40) || undefined,
        evidenceId: /^evidence_[a-zA-Z0-9]{12,64}$/.test(String(raw.evidenceId || '')) ? String(raw.evidenceId) : undefined,
        sha256: /^[a-f0-9]{64}$/i.test(String(raw.sha256 || '')) ? String(raw.sha256).toLowerCase() : undefined,
        source: String(raw.source || '').trim().slice(0, 120) || undefined,
        artifactId: String(raw.artifactId || '').trim().slice(0, 120) || undefined,
        revision: Number.isFinite(Number(raw.revision)) ? Math.max(1, Math.floor(Number(raw.revision))) : undefined,
      }
    })
    .filter((item): item is SubDesignCritiqueEvidence => item !== null)
    .slice(0, 30)
}

export function critiqueHasRequiredEvidence(critique: Pick<SubDesignCritique, 'evidence'>): boolean {
  const kinds = new Set(critique.evidence.map((item) => item.kind))
  return kinds.has('screenshot') && kinds.has('dom') && kinds.has('lint')
}

export function normalizeSubDesignCritique(
  input: unknown,
  defaults?: { briefId?: string },
): { ok: true; critique: SubDesignCritique } | { ok: false; errors: string[] } {
  if (!input || typeof input !== 'object') return { ok: false, errors: ['critique 必須是 object。'] }
  const raw = input as Record<string, unknown>
  const artifactId = String(raw.artifactId || '').trim()
  const errors: string[] = []
  if (!artifactId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(artifactId)) {
    errors.push('artifactId 不合法。')
  }
  const findings = normalizeFindings(raw.findings)
  const evidence = normalizeEvidence(raw.evidence)
  const hasBlocker = findings.some((finding) => finding.severity === 'blocker')
  const missingEvidence = !critiqueHasRequiredEvidence({ evidence })
  const verdict = raw.verdict === 'pass' && !hasBlocker && !missingEvidence ? 'pass' : 'needs-revision'
  if (missingEvidence && !findings.some((finding) => finding.path === '.subagents/subdesign/evidence')) {
    findings.push({
      severity: 'blocker',
      message: 'Critique 必須包含 screenshot、DOM 與 lint evidence，才能通過 Deliver gate。',
      path: '.subagents/subdesign/evidence',
    })
  }
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    critique: {
      artifactId,
      briefId: String(raw.briefId || '').trim() || defaults?.briefId,
      revision: Math.max(1, Math.floor(Number(raw.revision) || 1)),
      createdAt: String(raw.createdAt || '').trim() || new Date().toISOString(),
      briefCoverage: clampScore(raw.briefCoverage),
      brandConformance: clampScore(raw.brandConformance),
      accessibility: clampScore(raw.accessibility ?? raw.a11y),
      implementationReadiness: clampScore(raw.implementationReadiness ?? raw.readiness),
      findings,
      evidence,
      verdict,
    },
  }
}

export function critiqueAllowsDeliver(critique: SubDesignCritique): boolean {
  return critique.verdict === 'pass' && critiqueHasRequiredEvidence(critique) && !critique.findings.some((finding) => finding.severity === 'blocker')
}
