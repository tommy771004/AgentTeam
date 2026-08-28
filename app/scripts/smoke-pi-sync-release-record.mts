import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const directory = await mkdtemp(join(tmpdir(), 'pi-sync-release-record-'))
const recordPath = join(directory, 'pi-sync-release-record.json')
const fromCommit = '3333333333333333333333333333333333333333'
try {
  const gateResultsPath = join(directory, 'gate-results.json')
  const completedAt = new Date().toISOString()
  const gateNames = ['ledgerReconciled', 'upstreamTests', 'protocolCompatibility', 'equivalentToolParity', 'settingsSessionMigration', 'electronSmoke', 'recovery', 'security', 'packaging']
  await writeFile(gateResultsPath, JSON.stringify(Object.fromEntries(gateNames.map((name) => [name, {
    passed: true, command: `smoke fixture for ${name}`, completedAt,
  }]))))
  execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/qualify-pi-sync.mts', '--from-commit', fromCommit, '--gate-results', gateResultsPath, '--output', recordPath], { cwd: process.cwd(), stdio: 'pipe' })
  const record = JSON.parse(await readFile(recordPath, 'utf8')) as { decision?: string; fromCommit?: string; toCommit?: string; artifact?: { sha256?: string } }
  assert.equal(record.decision, 'GO')
  assert.equal(record.fromCommit, fromCommit)
  assert.match(record.toCommit || '', /^[0-9a-f]{40}$/)
  assert.notEqual(record.toCommit, fromCommit)
  assert.match(record.artifact?.sha256 || '', /^[0-9a-f]{64}$/)

  const noGoPath = join(directory, 'no-go.json')
  execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/qualify-pi-sync.mts', '--output', noGoPath], { cwd: process.cwd(), stdio: 'pipe' })
  const noGo = JSON.parse(await readFile(noGoPath, 'utf8')) as { decision?: string }
  assert.equal(noGo.decision, 'NO-GO')
} finally {
  await rm(directory, { recursive: true, force: true })
}
console.log('Pi sync release record smoke passed')
