import { isProjectRelativePath } from './artifactManifest'
import type { SubDesignCritique, SubDesignCritiqueFinding } from './types'

function clampScore(value: unknown): number {
  const score = Number(value)
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(100, Math.round(score)))
}

function normalizeFindings(value: unknown): SubDesignCritiqueFinding[] {
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
  const hasBlocker = findings.some((finding) => finding.severity === 'blocker')
  const verdict = raw.verdict === 'pass' && !hasBlocker ? 'pass' : 'needs-revision'
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    critique: {
      artifactId,
      briefId: String(raw.briefId || '').trim() || defaults?.briefId,
      revision: Math.max(1, Math.floor(Number(raw.revision) || 1)),
      createdAt: new Date().toISOString(),
      briefCoverage: clampScore(raw.briefCoverage),
      brandConformance: clampScore(raw.brandConformance),
      accessibility: clampScore(raw.accessibility ?? raw.a11y),
      implementationReadiness: clampScore(raw.implementationReadiness ?? raw.readiness),
      findings,
      verdict,
    },
  }
}

export function critiqueAllowsDeliver(critique: SubDesignCritique): boolean {
  return critique.verdict === 'pass' && !critique.findings.some((finding) => finding.severity === 'blocker')
}
