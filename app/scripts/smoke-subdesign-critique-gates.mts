/**
 * Critique verification gates：gate evidence contract、fail-closed verdict、
 * 以及 contrast gate 的註冊合約。
 * Seam：agent/subdesign critique 純函式（normalizeSubDesignCritique / critiqueGateStatus /
 * SUBDESIGN_CRITIQUE_GATE_REGISTRY），與 smoke-subdesign-studio 直接 import shipped
 * modules 的慣例相同。
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildSubDesignPack } from '../electron/piExtensionPacks/subdesignPack.ts'
import { configurePiHostServiceTransport, resolvePiHostServiceResponse } from '../electron/piHostServices.ts'
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

await test('Pi gate schema cannot accept a model-supplied verdict and uses Host measurement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'subdesign-gate-'))
  const artifactId = 'artifact_host_gate_qa'
  const manifest = {
    id: artifactId,
    briefId: 'brief_host_gate_qa',
    kind: 'html',
    title: 'Host gate QA',
    entry: 'subdesign/gate.html',
    renderer: 'html',
    exports: ['html'],
    supportingFiles: [],
    status: 'complete',
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const manifestDir = join(root, '.subagents/subdesign/artifacts', artifactId)
  await mkdir(manifestDir, { recursive: true })
  await writeFile(join(manifestDir, 'manifest.json'), JSON.stringify(manifest), 'utf8')

  const gate = buildSubDesignPack().tools.find((tool) => tool.name === 'design_gate_contrast')
  assert.ok(gate)
  const properties = (gate.parameters.properties || {}) as Record<string, unknown>
  assert.deepEqual(Object.keys(properties), ['artifactId'])
  assert.deepEqual(gate.parameters.required, ['artifactId'])

  configurePiHostServiceTransport((request) => {
    assert.equal(request.payload.service, 'subdesign/run-gate')
    assert.equal(request.payload.input.gateId, 'contrast')
    queueMicrotask(() => resolvePiHostServiceResponse({
      event: 'host/service-response',
      payload: {
        id: request.payload.id,
        result: {
          ok: true,
          evidence: {
            kind: 'gate', gateId: 'contrast', passed: false, summary: 'Host measured a violation.',
            path: '.subagents/subdesign/artifacts/evidence.json', sha256: 'a'.repeat(64),
            evidenceId: 'evidence_hostmeasure000001', capturedAt: new Date().toISOString(),
          },
        },
      },
    }))
  })
  const output = await gate.execute(
    { artifactId, passed: true, summary: '模型宣稱通過' },
    { sessionId: 'session_gate_qa', cwd: root },
  )
  assert.equal((output.details as { passed?: boolean }).passed, false)
})
