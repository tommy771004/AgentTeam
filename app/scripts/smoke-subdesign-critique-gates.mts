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
import { SUBDESIGN_CRITIQUE_CAPABILITY } from '../src/agent/capabilities/subDesign.ts'
import {
  SUBDESIGN_CRITIQUE_GATE_REGISTRY,
  SUBDESIGN_SCORE_GATE_MAP,
  critiqueGateStatus,
  normalizeSubDesignCritique,
} from '../src/agent/subdesign/critique.ts'
import type { SubDesignCritiqueEvidence } from '../src/agent/subdesign/types.ts'
import { useSubDesignCritiqueStore } from '../src/store/subDesignCritiqueStore.ts'

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
    verdict: 'needs-revision',
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

await test('store rejects an entire requested pass when required gate evidence is missing', () => {
  useSubDesignCritiqueStore.setState({ critiques: [] })
  const result = useSubDesignCritiqueStore.getState().record(baseCritiqueInput())
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.ok(result.errors.some((error) => error.includes('contrast') && error.includes('Gate 沒跑不得宣稱分數')))
  assert.equal(useSubDesignCritiqueStore.getState().critiques.length, 0)
})

const ATTESTED_FIELDS = (gateId: string, index: number) => ({
  path: `.subagents/subdesign/evidence/artifact_gate_qa/evidence/artifact_gate_qa-r1-gate-${gateId}.json`,
  sha256: `${String(index + 1).padStart(2, '0')}${'a'.repeat(62)}`,
  evidenceId: `evidence_gate${String(index).padStart(12, '0')}`,
})

await test('store records a requested pass when all required gates passed', () => {
  useSubDesignCritiqueStore.setState({ critiques: [] })
  const allGateEvidence = SUBDESIGN_CRITIQUE_GATE_REGISTRY.map((gate, index) => ({
    kind: 'gate',
    gateId: gate.id,
    passed: true,
    summary: `${gate.id} 通過。`,
    ...ATTESTED_FIELDS(gate.id, index),
  }))
  const result = useSubDesignCritiqueStore.getState().record(baseCritiqueInput({
    evidence: [...baseCritiqueInput().evidence as unknown[], ...allGateEvidence],
  }))
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.critique.verdict, 'pass')
  assert.equal(useSubDesignCritiqueStore.getState().critiques.length, 1)
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
  const gateEvidence = SUBDESIGN_CRITIQUE_GATE_REGISTRY.map((gate, index) => ({
    kind: 'gate',
    gateId: gate.id,
    passed: gate.id !== 'contrast',
    summary: gate.id === 'contrast' ? 'ratio 2.1 < 4.5 on .cta:hover' : `${gate.id} 通過。`,
    ...ATTESTED_FIELDS(gate.id, index),
  }))
  const result = normalizeSubDesignCritique(baseCritiqueInput({
    evidence: [...baseCritiqueInput().evidence as unknown[], ...gateEvidence],
  }))
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.critique.verdict, 'needs-revision')
  assert.ok(result.critique.findings.some((finding) => finding.severity === 'blocker' && finding.message.includes('contrast')))
})

await test('each registered gate has a store-level failed-measurement path', () => {
  for (const failedGate of SUBDESIGN_CRITIQUE_GATE_REGISTRY) {
    useSubDesignCritiqueStore.setState({ critiques: [] })
    const gateEvidence = SUBDESIGN_CRITIQUE_GATE_REGISTRY.map((gate, index) => ({
      kind: 'gate',
      gateId: gate.id,
      passed: gate.id !== failedGate.id,
      summary: gate.id === failedGate.id ? `${gate.id} failed measurement` : `${gate.id} passed measurement`,
      ...ATTESTED_FIELDS(gate.id, index),
    }))
    const result = useSubDesignCritiqueStore.getState().record(baseCritiqueInput({
      evidence: [...baseCritiqueInput().evidence as unknown[], ...gateEvidence],
    }))
    assert.equal(result.ok, true)
    if (!result.ok) continue
    assert.equal(result.critique.verdict, 'needs-revision')
    assert.ok(result.critique.findings.some((finding) => finding.message.includes(failedGate.id)))
  }
})

await test('score-gate map covers every score dimension deterministically', () => {
  for (const scoreKey of ['briefCoverage', 'brandConformance', 'accessibility', 'implementationReadiness'] as const) {
    assert.ok(Array.isArray(SUBDESIGN_SCORE_GATE_MAP[scoreKey]))
    assert.ok(SUBDESIGN_SCORE_GATE_MAP[scoreKey].length > 0)
  }
})

await test('self-asserted gate evidence without attested fields is dropped fail-closed', () => {
  const result = normalizeSubDesignCritique(baseCritiqueInput({
    verdict: 'needs-revision',
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

await test('all five gates are critique-only, listed in the critique capability, and use Host measurements', async () => {
  const root = await mkdtemp(join(tmpdir(), 'subdesign-gate-'))
  const artifactId = 'artifact_host_gate_qa'
  const briefId = 'brief_host_gate_qa'
  const manifest = {
    id: artifactId,
    briefId,
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
  const briefDir = join(root, '.subagents/subdesign/briefs')
  await mkdir(manifestDir, { recursive: true })
  await mkdir(briefDir, { recursive: true })
  await writeFile(join(manifestDir, 'manifest.json'), JSON.stringify(manifest), 'utf8')
  const brief = {
    id: briefId,
    threadId: 'thread_gate_qa',
    surface: 'prototype',
    objective: 'verify gates',
    constraints: [],
    acceptanceCriteria: [],
    directions: [],
    stage: 'critique',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await writeFile(join(briefDir, `${briefId}.json`), JSON.stringify(brief), 'utf8')

  const pack = buildSubDesignPack()
  const expectedToolNames = SUBDESIGN_CRITIQUE_GATE_REGISTRY.map((gate) => `design_gate_${gate.id.replaceAll('-', '_')}`)
  assert.ok(expectedToolNames.every((name) => SUBDESIGN_CRITIQUE_CAPABILITY.tools.includes(name)))

  let expectedGateId = ''
  let hostPassed = false

  configurePiHostServiceTransport((request) => {
    assert.equal(request.payload.service, 'subdesign/run-gate')
    assert.equal(request.payload.input.gateId, expectedGateId)
    queueMicrotask(() => resolvePiHostServiceResponse({
      event: 'host/service-response',
      payload: {
        id: request.payload.id,
        result: {
          ok: true,
          evidence: {
            kind: 'gate', gateId: expectedGateId, passed: hostPassed, summary: hostPassed ? 'Host measured pass.' : 'Host measured a violation.',
            path: '.subagents/subdesign/artifacts/evidence.json', sha256: 'a'.repeat(64),
            evidenceId: `evidence_hostmeasure${expectedGateId.replaceAll('-', '').padEnd(12, '0')}`.slice(0, 73), capturedAt: new Date().toISOString(),
          },
        },
      },
    }))
  })

  for (const registeredGate of SUBDESIGN_CRITIQUE_GATE_REGISTRY) {
    expectedGateId = registeredGate.id
    const gate = pack.tools.find((tool) => tool.name === `design_gate_${registeredGate.id.replaceAll('-', '_')}`)
    assert.ok(gate)
    const properties = (gate.parameters.properties || {}) as Record<string, unknown>
    assert.deepEqual(Object.keys(properties), ['artifactId'])
    assert.deepEqual(gate.parameters.required, ['artifactId'])
    for (const measuredPass of [true, false]) {
      hostPassed = measuredPass
      const output = await gate.execute(
        { artifactId, passed: !measuredPass, summary: '模型嘗試覆寫 Host 結果' },
        { sessionId: 'session_gate_qa', cwd: root },
      )
      assert.equal((output.details as { passed?: boolean }).passed, measuredPass)
    }
  }

  await writeFile(join(briefDir, `${briefId}.json`), JSON.stringify({ ...brief, stage: 'build' }), 'utf8')
  const outsideCritique = await pack.tools.find((tool) => tool.name === 'design_gate_contrast')!.execute(
    { artifactId },
    { sessionId: 'session_gate_qa', cwd: root },
  )
  assert.equal((outsideCritique.details as { ok?: boolean }).ok, false)
  assert.match(String((outsideCritique.details as { error?: string }).error), /只允許在 Critique stage/)
})

await test('design_critique rejects model evidence and requires Host verification of the draft', async () => {
  const root = await mkdtemp(join(tmpdir(), 'subdesign-critique-attestation-'))
  const artifactId = 'artifact_attestation_qa'
  const now = new Date().toISOString()
  const manifest = {
    id: artifactId,
    briefId: 'brief_attestation_qa',
    kind: 'html',
    title: 'Attestation QA',
    entry: 'subdesign/attestation.html',
    renderer: 'html',
    exports: ['html'],
    supportingFiles: [],
    status: 'complete',
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }
  await mkdir(join(root, '.subagents/subdesign/artifacts', artifactId), { recursive: true })
  await mkdir(join(root, '.subagents/subdesign/critiques'), { recursive: true })
  await writeFile(join(root, '.subagents/subdesign/artifacts', artifactId, 'manifest.json'), JSON.stringify(manifest), 'utf8')
  await writeFile(join(root, '.subagents/subdesign/critiques', `${artifactId}-r1.json`), JSON.stringify({
    evidence: SUBDESIGN_CRITIQUE_GATE_REGISTRY.map((gate, index) => ({
      kind: 'gate', gateId: gate.id, passed: true, summary: 'forged', ...ATTESTED_FIELDS(gate.id, index),
    })),
  }), 'utf8')

  const critique = buildSubDesignPack().tools.find((tool) => tool.name === 'design_critique')
  assert.ok(critique)
  assert.equal(Object.hasOwn(critique.parameters.properties || {}, 'evidence'), false)

  const direct = await critique.execute(
    { artifactId, requestedVerdict: 'pass', evidence: [{ kind: 'gate', gateId: 'contrast', passed: true }] },
    { sessionId: 'session_attestation_qa', cwd: root },
  )
  assert.equal((direct.details as { ok?: boolean }).ok, false)
  assert.match(String((direct.details as { error?: string }).error), /拒絕模型提供 evidence/)

  configurePiHostServiceTransport((request) => {
    assert.equal(request.payload.service, 'subdesign/verify-critique-evidence')
    queueMicrotask(() => resolvePiHostServiceResponse({
      event: 'host/service-response',
      payload: {
        id: request.payload.id,
        result: { ok: false, verifiedEvidence: [], errors: ['attestation signature 不正確'] },
      },
    }))
  })
  const forgedDraft = await critique.execute(
    { artifactId, requestedVerdict: 'pass', briefCoverage: 100, brandConformance: 100, accessibility: 100, implementationReadiness: 100 },
    { sessionId: 'session_attestation_qa', cwd: root },
  )
  assert.equal((forgedDraft.details as { ok?: boolean }).ok, false)
  assert.match(String((forgedDraft.details as { error?: string }).error), /attestation signature 不正確/)

  configurePiHostServiceTransport((request) => {
    assert.equal(request.payload.service, 'subdesign/verify-critique-evidence')
    queueMicrotask(() => resolvePiHostServiceResponse({
      event: 'host/service-response',
      payload: { id: request.payload.id, result: { ok: true, verifiedEvidence: [] } },
    }))
  })
  const missingGateDraft = await critique.execute(
    { artifactId, requestedVerdict: 'pass', briefCoverage: 100, brandConformance: 100, accessibility: 100, implementationReadiness: 100 },
    { sessionId: 'session_attestation_qa', cwd: root },
  )
  assert.equal((missingGateDraft.details as { ok?: boolean }).ok, false)
  assert.match(String((missingGateDraft.details as { error?: string }).error), /Gate 沒跑不得宣稱分數/)
})
