import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildPiSyncEvidence, type PiSyncArtifact } from '../src/agent/piSyncEvidence.ts'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const repositoryRoot = resolve(import.meta.dirname, '../..')
const pin = JSON.parse(await readFile(resolve(repositoryRoot, 'vendor/pi/PI_UPSTREAM_PIN.json'), 'utf8')) as { repository?: string; commit?: string; tag?: string; treeSha256?: string; releaseSourceArchive?: { modelDataManifestSha256?: string } }
const artifactPath = resolve(import.meta.dirname, '../dist-electron/pi-host.js')
const artifactBytes = await readFile(artifactPath).catch(() => Buffer.from(''))
const artifact: PiSyncArtifact = { path: 'dist-electron/pi-host.js', sha256: createHash('sha256').update(artifactBytes).digest('hex') }
const fromCommit = argument('--from-commit') || ''
const toCommit = argument('--to-commit') || pin.commit || ''
if (process.argv.includes('--all-gates')) throw new Error('--all-gates was removed because a flag is not qualification evidence; supply --gate-results')
const gateResultPath = argument('--gate-results')
type GateName = 'ledgerReconciled' | 'upstreamTests' | 'protocolCompatibility' | 'equivalentToolParity' | 'settingsSessionMigration' | 'electronSmoke' | 'recovery' | 'security' | 'packaging'
type GateResult = { passed: boolean; command: string; completedAt: string }
const gateNames: GateName[] = ['ledgerReconciled', 'upstreamTests', 'protocolCompatibility', 'equivalentToolParity', 'settingsSessionMigration', 'electronSmoke', 'recovery', 'security', 'packaging']
const gateResults = gateResultPath
  ? JSON.parse(await readFile(resolve(gateResultPath), 'utf8')) as Partial<Record<GateName, GateResult>>
  : {}
const gates = Object.fromEntries(gateNames.map((name) => {
  const result = gateResults[name]
  const valid = result?.passed === true && typeof result.command === 'string' && result.command.trim().length > 0
    && typeof result.completedAt === 'string' && Number.isFinite(Date.parse(result.completedAt))
  return [name, valid]
})) as Record<GateName, boolean>
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
  decision: evidence.decision,
  ready: evidence.ready,
  failedCriteria: evidence.failedCriteria,
  generatedAt: new Date().toISOString(),
}
const output = resolve(argument('--output') || 'release-evidence/pi-sync-release-record.json')
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
console.log(`Pi sync release record: ${record.decision} (${output})`)
