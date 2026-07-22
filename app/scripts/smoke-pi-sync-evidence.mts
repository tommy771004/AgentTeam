import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildPiSyncEvidence, type PiSyncEvidenceInput } from '../src/agent/piSyncEvidence.ts'

const artifactPath = 'dist-electron/pi-host.js'
const artifactBytes = await readFile(resolve(import.meta.dirname, '../dist-electron/pi-host.js'))
const artifactSha256 = createHash('sha256').update(artifactBytes).digest('hex')
const base: PiSyncEvidenceInput = {
  fromCommit: '1111111111111111111111111111111111111111',
  toCommit: '2222222222222222222222222222222222222222',
  ledgerReconciled: true,
  upstreamTests: true,
  protocolCompatibility: true,
  equivalentToolParity: true,
  settingsSessionMigration: true,
  electronSmoke: true,
  recovery: true,
  security: true,
  packaging: true,
  removedPatches: ['upstream-provided session compaction patch removed'],
  survivingPatches: ['Electron Host protocol bridge retained; smoke-pi-host-protocol.mts'],
  artifacts: [{ path: artifactPath, sha256: artifactSha256 }],
}
const noGo = buildPiSyncEvidence({ ...base, toCommit: base.fromCommit, artifacts: [] })
assert.equal(noGo.decision, 'NO-GO')
assert.ok(noGo.failedCriteria.includes('synchronization must advance to a different commit'))
assert.ok(noGo.failedCriteria.includes('at least one reproducible artifact is required'))
const go = buildPiSyncEvidence(base)
assert.equal(go.decision, 'GO')
assert.equal(go.failedCriteria.length, 0)
assert.match(go.artifacts[0].sha256, /^[0-9a-f]{64}$/)

console.log(`Pi sync evidence gate: ${go.decision} (${go.toCommit}, ${go.artifacts.length} reproducible artifact)`)
