import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildPiSyncEvidence, type PiSyncArtifact } from '../src/agent/piSyncEvidence.ts'
import { readBuildablePiUpstreamPin } from './piUpstreamPin.mts'
import { PI_GATE_NAMES, runPiQualificationGates } from './piQualificationRunner.mts'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const repositoryRoot = resolve(import.meta.dirname, '../..')
const pin = await readBuildablePiUpstreamPin(resolve(repositoryRoot, 'vendor/pi/PI_UPSTREAM_PIN.json'))
const artifactPath = resolve(import.meta.dirname, '../dist-electron/pi-host.js')
const artifactBytes = await readFile(artifactPath).catch(() => Buffer.from(''))
const artifact: PiSyncArtifact = { path: 'dist-electron/pi-host.js', sha256: createHash('sha256').update(artifactBytes).digest('hex') }
const fromCommit = argument('--from-commit') || ''
const toCommit = argument('--to-commit') || pin.commit || ''
if (process.argv.includes('--all-gates') || process.argv.includes('--gate-results')) {
  throw new Error('qualification conclusions cannot be supplied by the caller; fixed gates are executed by the runner')
}
const profile = process.argv.includes('--test-only-gates') ? 'test-only' as const : 'production' as const
const gateResults = await runPiQualificationGates({
  appRoot: resolve(import.meta.dirname, '..'),
  repositoryRoot,
  logDir: resolve(repositoryRoot, argument('--log-dir') || 'release-evidence/pi-sync-logs'),
  binding: { toCommit, treeSha256: pin.treeSha256, artifactSha256: artifact.sha256 },
  profile,
})
const gates = Object.fromEntries(PI_GATE_NAMES.map((name) => [name, gateResults[name]?.passed === true])) as Record<typeof PI_GATE_NAMES[number], boolean>
const evidence = buildPiSyncEvidence({
  fromCommit,
  toCommit,
  ...gates,
  removedPatches: ['No patch removal is asserted without reviewed upstream diff'],
  survivingPatches: ['Electron Pi Host bridge · smoke-pi-host-protocol.mts'],
  artifacts: artifactBytes.length ? [artifact] : [],
})
const record = {
  schemaVersion: 1,
  repository: pin.repository,
  tag: pin.tag,
  treeSha256: pin.treeSha256,
  modelDataManifestSha256: pin.releaseSourceArchive?.modelDataManifestSha256,
  gateResults,
  fromCommit,
  toCommit,
  artifact,
  decision: profile === 'production' ? evidence.decision : 'TEST-ONLY',
  ready: profile === 'production' && evidence.ready,
  failedCriteria: profile === 'production' ? evidence.failedCriteria : ['test-only qualification cannot release'],
  generatedAt: new Date().toISOString(),
}
const output = resolve(argument('--output') || 'release-evidence/pi-sync-release-record.json')
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
console.log(`Pi sync release record: ${record.decision} (${output})`)
