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
    'template-attribution', 'asset-license', 'gate',
  ])
  const knownGateIds = new Set(SUBDESIGN_CRITIQUE_GATE_REGISTRY.map((gate) => gate.id))
  return value
    .map((item): SubDesignCritiqueEvidence | null => {
      if (!item || typeof item !== 'object') return null
      const raw = item as Record<string, unknown>
      const kind = raw.kind as SubDesignCritiqueEvidence['kind']
      const summary = String(raw.summary || raw.description || '').trim().slice(0, 1000)
      if (!allowed.has(kind) || !summary) return null
      const path = raw.path ? String(raw.path).trim().replaceAll('\\', '/') : undefined
      // Gate 證據必須指向已註冊的 gate；未知的 gateId 一律丟棄（fail-closed）。
      if (kind === 'gate') {
        const gateId = String(raw.gateId || '').trim()
        if (!knownGateIds.has(gateId)) return null
        const gatePath = path && isProjectRelativePath(path) ? path.slice(0, 600) : undefined
        const gateSha256 = /^[a-f0-9]{64}$/i.test(String(raw.sha256 || '')) ? String(raw.sha256).toLowerCase() : undefined
        const evidenceId = /^evidence_[a-zA-Z0-9]{12,64}$/.test(String(raw.evidenceId || '')) ? String(raw.evidenceId) : undefined
        // Gate 證據必須由工具產生並帶 attested 欄位；缺任何一項即丟棄（ADR-0048：
        // model 不能憑空製造 execution evidence——含「省略可追溯欄位」這條路）。
        if (!gatePath || !gateSha256 || !evidenceId) return null
        return {
          kind,
          gateId,
          passed: raw.passed === true,
          summary,
          path: gatePath,
          sha256: gateSha256,
          evidenceId,
          capturedAt: String(raw.capturedAt || '').trim().slice(0, 40) || undefined,
          source: String(raw.source || '').trim().slice(0, 120) || undefined,
          artifactId: String(raw.artifactId || '').trim().slice(0, 120) || undefined,
          revision: Number.isFinite(Number(raw.revision)) ? Math.max(1, Math.floor(Number(raw.revision))) : undefined,
        }
      }
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

/**
 * 已註冊的 critique verification gates（ADR-0048：model cannot manufacture
 * execution evidence）。Registry 為空時 fail-closed 規則不生效，行為與未導入
 * gates 前完全一致；每註冊一個 gate，pass verdict 就多一道必須通過的量測。
 */
export type SubDesignCritiqueGate = {
  id: string
  description: string
}

export const SUBDESIGN_CRITIQUE_GATE_REGISTRY: readonly SubDesignCritiqueGate[] = [
  { id: 'contrast', description: 'WCAG 對比度量測（含 hover/focus/active 互動狀態）。' },
  { id: 'console-error', description: '載入期間的 console error 收集。' },
  { id: 'build-success', description: 'entry 存在且結構完整。' },
  { id: 'responsive-overflow', description: '窄視窗水平溢出檢查。' },
  { id: 'token-consistency', description: '色彩與專案 DTCG palette 一致性（無 palette 時不適用）。' },
]

/** 分數 ↔ gate 對應表：briefCoverage 的可驗證部分即各項客觀 gates 的聯集。 */
export const SUBDESIGN_SCORE_GATE_MAP: Record<'briefCoverage' | 'brandConformance' | 'accessibility' | 'implementationReadiness', readonly string[]> = {
  briefCoverage: ['contrast', 'console-error', 'build-success', 'responsive-overflow', 'token-consistency'],
  brandConformance: ['token-consistency'],
  accessibility: ['contrast'],
  implementationReadiness: ['console-error', 'build-success', 'responsive-overflow'],
}

const SCORE_KEYS = ['briefCoverage', 'brandConformance', 'accessibility', 'implementationReadiness'] as const

export type CritiqueGateInputs = {
  scores: Partial<Record<(typeof SCORE_KEYS)[number], number>>
  evidence: SubDesignCritiqueEvidence[]
}

export type CritiqueGateStatus = {
  missingGates: string[]
  failedGates: string[]
  unbackedScores: string[]
}

export function critiqueGateStatus(
  critique: CritiqueGateInputs,
  requiredGates: readonly string[],
): CritiqueGateStatus {
  if (!requiredGates.length) return { missingGates: [], failedGates: [], unbackedScores: [] }
  const gateById = new Map(
    critique.evidence
      .filter((item): item is SubDesignCritiqueEvidence & { kind: 'gate'; gateId: string } => item.kind === 'gate' && Boolean(item.gateId))
      .map((item) => [item.gateId, item]),
  )
  const missingGates = requiredGates.filter((gateId) => !gateById.has(gateId))
  const failedGates = [...gateById.values()]
    .filter((item) => item.passed !== true)
    .map((item) => item.gateId)
  const unbackedScores = SCORE_KEYS.filter((scoreKey) => {
    const scoreValue = critique.scores[scoreKey]
    if (scoreValue == null) return false
    const allowed = new Set(SUBDESIGN_SCORE_GATE_MAP[scoreKey])
    // 分數的對應 gates 都不在需求集內時，尚無從要求佐證——不算 unbacked。
    if (!requiredGates.some((gateId) => allowed.has(gateId))) return false
    const backed = [...gateById.values()].some((item) => item.passed === true && allowed.has(item.gateId))
    return !backed
  })
  return { missingGates, failedGates, unbackedScores }
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
  const requiredGates = SUBDESIGN_CRITIQUE_GATE_REGISTRY.map((gate) => gate.id)
  const gateStatus = critiqueGateStatus(
    {
      scores: {
        briefCoverage: clampScore(raw.briefCoverage),
        brandConformance: clampScore(raw.brandConformance),
        accessibility: clampScore(raw.accessibility ?? raw.a11y),
        implementationReadiness: clampScore(raw.implementationReadiness ?? raw.readiness),
      },
      evidence,
    },
    requiredGates,
  )
  const gatesUnmet = gateStatus.missingGates.length > 0
    || gateStatus.failedGates.length > 0
    || gateStatus.unbackedScores.length > 0
  const verdict = raw.verdict === 'pass' && !hasBlocker && !missingEvidence && !gatesUnmet ? 'pass' : 'needs-revision'
  if (missingEvidence && !findings.some((finding) => finding.path === '.subagents/subdesign/evidence')) {
    findings.push({
      severity: 'blocker',
      message: 'Critique 必須包含 screenshot、DOM 與 lint evidence，才能通過 Deliver gate。',
      path: '.subagents/subdesign/evidence',
    })
  }
  if (gateStatus.missingGates.length && raw.verdict === 'pass') {
    findings.push({
      severity: 'blocker',
      message: `Critique pass 缺少已執行的 verification gates：${gateStatus.missingGates.join('、')}。Gate 沒跑不得宣稱分數。`,
      path: '.subagents/subdesign/evidence',
    })
  }
  if (gateStatus.failedGates.length) {
    for (const gateId of gateStatus.failedGates) {
      findings.push({
        severity: 'blocker',
        message: `Verification gate 未通過：${gateId}。修正後重新執行 gate 才能通過 Critique。`,
        path: '.subagents/subdesign/evidence',
      })
    }
  }
  if (gateStatus.unbackedScores.length && raw.verdict === 'pass') {
    findings.push({
      severity: 'blocker',
      message: `分數缺少對應的 gate 證據：${gateStatus.unbackedScores.join('、')}。每項分數必須由 gate 量測支撐。`,
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
      createdAt: new Date().toISOString(),
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
