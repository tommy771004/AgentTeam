import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildReleaseQualification,
  type ReleaseQualificationInput,
} from '../src/agent/releaseQualification.ts'
import { buildQualificationInputFromEvidence } from './release-qualification-input.mts'
import {
  PACKAGED_INSTALL_EVIDENCE_SCHEMA_VERSION,
  buildPackagedFirstTaskEvidence,
} from './packaged-install-evidence.mjs'

const incomplete: ReleaseQualificationInput = {
  releaseVersion: '1.0.0-beta',
  owner: 'release-engineering',
  platforms: [
    { platform: 'windows', architecture: 'x64', signed: false, checksum: false, cleanInstall: false, firstRunTask: false },
    { platform: 'macos', architecture: 'arm64', signed: false, checksum: false, cleanInstall: false, firstRunTask: false },
  ],
  recovery: { restart: false, crash: false, queueExactlyOnce: false, schedulerOnceJob: false },
  piHost: { protocol: false, utilityProcess: false, sessions: false, extensions: false },
  update: { nMinusOneToN: false, signatureVerified: false, failedRecovery: false, rollback: false },
  entitlement: { freeCore: false, activePro: false, offlineGrace: false, expired: false, cancelled: false, packRollback: false },
  workflow: { spec: false, tickets: false, tdd: false, review: false, artifactIndex: false, handoff: false, userApprovalBeforeRelease: false },
  trust: { privacy: false, security: false, eula: false, terms: false, refund: false, support: false, releaseNotes: false, checksums: false, sbom: false, provenance: false },
  hardening: { releasePromotion: false, credentialBoundary: false, settingsRecovery: false, deterministicGuards: false, mergeBaseComplexity: false, shippedRuntimeCiCoverage: false },
  warnings: [{ id: 'signed-artifacts', summary: '實機簽章證據尚未提供', owner: 'release-engineering', mitigation: '完成雙平台 clean-machine proof 後重跑 qualification' }],
}

const noGo = buildReleaseQualification(incomplete, '2026-07-19T06:00:00.000Z')
assert.equal(noGo.decision, 'NO-GO')
assert.equal(noGo.ready, false)
assert.ok(noGo.failedCriteria.length >= 8)
assert.ok(noGo.failedCriteria.some((criterion) => criterion.startsWith('piHost-')))
assert.ok(noGo.warnings.some((warning) => warning.id === 'signed-artifacts'))
assert.match(noGo.report, /NO-GO/)

const complete: ReleaseQualificationInput = {
  ...incomplete,
  platforms: incomplete.platforms.map((platform) => ({ ...platform, signed: true, checksum: true, cleanInstall: true, firstRunTask: true })),
  recovery: { restart: true, crash: true, queueExactlyOnce: true, schedulerOnceJob: true },
  piHost: { protocol: true, utilityProcess: true, sessions: true, extensions: true },
  update: { nMinusOneToN: true, signatureVerified: true, failedRecovery: true, rollback: true },
  entitlement: { freeCore: true, activePro: true, offlineGrace: true, expired: true, cancelled: true, packRollback: true },
  workflow: { spec: true, tickets: true, tdd: true, review: true, artifactIndex: true, handoff: true, userApprovalBeforeRelease: true },
  trust: { privacy: true, security: true, eula: true, terms: true, refund: true, support: true, releaseNotes: true, checksums: true, sbom: true, provenance: true },
  hardening: { releasePromotion: true, credentialBoundary: true, settingsRecovery: true, deterministicGuards: true, mergeBaseComplexity: true, shippedRuntimeCiCoverage: true },
  warnings: [],
}
const go = buildReleaseQualification(complete, '2026-07-19T06:01:00.000Z')
assert.equal(go.decision, 'GO')
assert.equal(go.ready, true)
assert.equal(go.failedCriteria.length, 0)
assert.match(go.report, /GO/) 

const missingEvidence = await buildQualificationInputFromEvidence({
  evidenceRoot: '/tmp/subagents-ai-no-release-evidence',
  releaseVersion: '1.0.0-beta',
})
assert.equal(missingEvidence.platforms.length, 0)
assert.equal(missingEvidence.recovery.restart, false)
assert.equal(missingEvidence.trust.checksums, false)

const evidenceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'packaged-qualification-input-'))
try {
  await fs.writeFile(path.join(evidenceRoot, 'release-manifest.json'), JSON.stringify({
    platform: 'macos',
    arch: 'arm64',
    artifacts: [{ name: 'AgentStudio.dmg' }],
    checksums: 'checksums.txt',
    provenance: { commit: 'fixture' },
  }))
  const currentInstall = {
    schemaVersion: PACKAGED_INSTALL_EVIDENCE_SCHEMA_VERSION,
    platform: 'macos',
    firstTask: buildPackagedFirstTaskEvidence({
      resultVisible: true,
      changedFileCount: 1,
      additions: 2,
      removals: 1,
      changedLines: ['reports/packaged-smoke-report.md', 'Packaged runtime wrote this report.'],
      firstTaskSessionMessages: 2,
      settingsPersisted: true,
      restartedSessionMessages: 2,
      platform: 'macos',
    }),
    uninstall: { removed: true },
  }
  await fs.writeFile(
    path.join(evidenceRoot, 'install-launch-restart-uninstall.json'),
    JSON.stringify(currentInstall),
  )
  const currentInput = await buildQualificationInputFromEvidence({ evidenceRoot })
  assert.equal(currentInput.platforms[0]?.firstRunTask, true)
  assert.equal(currentInput.platforms[0]?.cleanInstall, true)

  await fs.writeFile(path.join(evidenceRoot, 'install-launch-restart-uninstall.json'), JSON.stringify({
    platform: 'macos',
    firstTask: { resultVisible: true, diffVisible: true, diffPreview: 'diff --git a/a b/a' },
    uninstall: { removed: true },
  }))
  const legacyInput = await buildQualificationInputFromEvidence({ evidenceRoot })
  assert.equal(legacyInput.platforms[0]?.firstRunTask, false)
  assert.equal(legacyInput.platforms[0]?.cleanInstall, false)
} finally {
  await fs.rm(evidenceRoot, { recursive: true, force: true })
}

console.log('release-qualification smoke: 15 assertions passed')
