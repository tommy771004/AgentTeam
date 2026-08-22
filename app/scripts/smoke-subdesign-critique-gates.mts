/**
 * Critique verification gates：gate evidence contract、fail-closed verdict、
 * 以及 contrast gate 的註冊合約。
 * Seam：agent/subdesign critique 純函式（normalizeSubDesignCritique / critiqueGateStatus /
 * SUBDESIGN_CRITIQUE_GATE_REGISTRY），與 smoke-subdesign-studio 直接 import shipped
 * modules 的慣例相同。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SUBDESIGN_CRITIQUE_GATE_REGISTRY,
  SUBDESIGN_SCORE_GATE_MAP,
  critiqueGateStatus,
  normalizeSubDesignCritique,
} from '../src/agent/subdesign/critique.ts'
import type { SubDesignCritiqueEvidence } from '../src/agent/subdesign/types.ts'

function baseCritiqueInput(overrides: Record<string, unknown> = {}) {
  return {
    artifactId: 'artifact_gate_qa',
    verdict: 'pass',
    briefCoverage: 90,
    brandConformance: 88,
    accessibility: 95,
    implementationReadiness: 92,
    findings: [],
    evidence: [
      { kind: 'screenshot', summary: 'cover screenshot', path: 'subdesign/cover.png' },
      { kind: 'dom', summary: 'dom snapshot', path: 'subdesign/cover.dom' },
      { kind: 'lint', summary: 'lint clean', path: 'subdesign/lint.json' },
    ],
    ...overrides,
  }
}

await test('contrast gate is registered and drives default required gates', () => {
  assert.ok(SUBDESIGN_CRITIQUE_GATE_REGISTRY.some((gate) => gate.id === 'contrast'))
})

await test('gate evidence kind is accepted only with a known registered gateId', () => {
  const result = normalizeSubDesignCritique(baseCritiqueInput({
    evidence: [
      ...baseCritiqueInput().evidence as unknown[],
      { kind: 'gate', gateId: 'not-a-real-gate', passed: true, summary: 'forged measurement' },
    ],
  }))
  assert.equal(result.ok, true)
  if (!result.ok) return
  const gateEvidence = result.critique.evidence.filter((item) => item.kind === 'gate')
  assert.equal(gateEvidence.length, 0)
})

await test('pass without contrast gate evidence is downgraded fail-closed by the registry default', () => {
  const result = normalizeSubDesignCritique(baseCritiqueInput())
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.critique.verdict, 'needs-revision')
  assert.ok(result.critique.findings.some((finding) => finding.severity === 'blocker' && finding.message.includes('contrast')))
})

const ATTESTED_FIELDS = (gateId: string, index: number) => ({
  path: `.subagents/subdesign/evidence/artifact_gate_qa/evidence/artifact_gate_qa-r1-gate-${gateId}.json`,
  sha256: `${String(index + 1).padStart(2, '0')}${'a'.repeat(62)}`,
  evidenceId: `evidence_gate${String(index).padStart(12, '0')}`,
})

await test('pass with all required gates passed keeps verdict pass', () => {
  const allGateEvidence = SUBDESIGN_CRITIQUE_GATE_REGISTRY.map((gate, index) => ({
    kind: 'gate',
    gateId: gate.id,
    passed: true,
    summary: `${gate.id} 通過。`,
    ...ATTESTED_FIELDS(gate.id, index),
  }))
  const result = normalizeSubDesignCritique(baseCritiqueInput({
    evidence: [...baseCritiqueInput().evidence as unknown[], ...allGateEvidence],
  }))
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.critique.verdict, 'pass')
  const contrast = result.critique.evidence.find((item) => item.kind === 'gate' && item.gateId === 'contrast')
  assert.equal(contrast?.passed, true)
})

await test('critiqueGateStatus reports missing, failed, and unbacked scores for a synthetic requirement set', () => {
  const required = ['contrast', 'build-success'] as const
  const allPass = [
    { kind: 'gate', gateId: 'contrast', passed: true, summary: 'ok' },
    { kind: 'gate', gateId: 'build-success', passed: true, summary: 'ok' },
  ] as SubDesignCritiqueEvidence[]
  const status = critiqueGateStatus({ scores: { briefCoverage: 90, brandConformance: 80, accessibility: 95, implementationReadiness: 70 }, evidence: allPass }, [...required])
  assert.deepEqual(status.missingGates, [])
  assert.deepEqual(status.failedGates, [])
  assert.deepEqual(status.unbackedScores, [])

  const missingOne = [
    { kind: 'gate', gateId: 'contrast', passed: true, summary: 'ok' },
  ] as SubDesignCritiqueEvidence[]
  const statusMissing = critiqueGateStatus({ scores: { briefCoverage: 90, brandConformance: 80, accessibility: 95, implementationReadiness: 70 }, evidence: missingOne }, [...required])
  assert.deepEqual(statusMissing.missingGates, ['build-success'])

  const failedGate = [
    { kind: 'gate', gateId: 'contrast', passed: false, summary: 'ratio too low' },
    { kind: 'gate', gateId: 'build-success', passed: true, summary: 'ok' },
  ] as SubDesignCritiqueEvidence[]
  const statusFailed = critiqueGateStatus({ scores: { briefCoverage: 90, brandConformance: 80, accessibility: 40, implementationReadiness: 70 }, evidence: failedGate }, [...required])
  assert.deepEqual(statusFailed.failedGates, ['contrast'])
})

await test('pass verdict is downgraded when a required gate ran but failed', () => {
  const result = normalizeSubDesignCritique(baseCritiqueInput({
    evidence: [
      ...baseCritiqueInput().evidence as unknown[],
      { kind: 'gate', gateId: 'contrast', passed: false, summary: 'ratio 2.1 < 4.5 on .cta:hover' },
    ],
  }), undefined, { requiredGates: ['contrast'] })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.critique.verdict, 'needs-revision')
  assert.ok(result.critique.findings.some((finding) => finding.severity === 'blocker' && finding.message.includes('contrast')))
})

await test('score-gate map covers every score dimension deterministically', () => {
  for (const scoreKey of ['briefCoverage', 'brandConformance', 'accessibility', 'implementationReadiness'] as const) {
    assert.ok(Array.isArray(SUBDESIGN_SCORE_GATE_MAP[scoreKey]))
    assert.ok(SUBDESIGN_SCORE_GATE_MAP[scoreKey].length > 0)
  }
})

await test('self-asserted gate evidence without attested fields is dropped fail-closed', () => {
  const result = normalizeSubDesignCritique(baseCritiqueInput({
    evidence: [
      ...(baseCritiqueInput().evidence as unknown[]),
      { kind: 'gate', gateId: 'contrast', passed: true, summary: '模型自己宣稱的對比度通過' },
    ],
  }))
  assert.equal(result.ok, true)
  if (!result.ok) return
  const gateEvidence = result.critique.evidence.filter((item) => item.kind === 'gate')
  assert.equal(gateEvidence.length, 0)
})
