import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildPiSyncEvidence, type PiSyncArtifact } from '../src/agent/piSyncEvidence.ts'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const repositoryRoot = resolve(import.meta.dirname, '../..')
const pin = JSON.parse(await readFile(resolve(repositoryRoot, 'vendor/pi/PI_UPSTREAM_PIN.json'), 'utf8')) as { repository?: string; commit?: string; tag?: string; treeSha256?: string }
const artifactPath = resolve(import.meta.dirname, '../dist-electron/pi-host.js')
const artifactBytes = await readFile(artifactPath).catch(() => Buffer.from(''))
const artifact: PiSyncArtifact = { path: 'dist-electron/pi-host.js', sha256: createHash('sha256').update(artifactBytes).digest('hex') }
const fromCommit = pin.commit || ''
const toCommit = argument('--to-commit') || ''
const allGates = process.argv.includes('--all-gates')
const evidence = buildPiSyncEvidence({
  fromCommit,
  toCommit,
  ledgerReconciled: allGates,
  upstreamTests: allGates,
  protocolCompatibility: allGates,
  equivalentToolParity: allGates,
  settingsSessionMigration: allGates,
  electronSmoke: allGates,
  recovery: allGates,
  security: allGates,
  packaging: allGates,
  removedPatches: ['No patch removal is asserted without reviewed upstream diff'],
  survivingPatches: ['Electron Pi Host bridge · smoke-pi-host-protocol.mts'],
  artifacts: artifactBytes.length ? [artifact] : [],
})
const record = {
  schemaVersion: 1,
  repository: pin.repository,
  tag: pin.tag,
  treeSha256: pin.treeSha256,
  fromCommit,
  toCommit,
  artifact,
  decision: evidence.decision,
  ready: evidence.ready,
  failedCriteria: evidence.failedCriteria,
  generatedAt: new Date().toISOString(),
}
const output = resolve(argument('--output') || 'release-evidence/pi-sync-release-record.json')
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
console.log(`Pi sync release record: ${record.decision} (${output})`)
