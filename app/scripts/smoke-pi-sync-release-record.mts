import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const directory = await mkdtemp(join(tmpdir(), 'pi-sync-release-record-'))
const recordPath = join(directory, 'pi-sync-release-record.json')
const fromCommit = '3333333333333333333333333333333333333333'
try {
  execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/qualify-pi-sync.mts', '--from-commit', fromCommit, '--test-only-gates', '--log-dir', join(directory, 'logs'), '--output', recordPath], { cwd: process.cwd(), stdio: 'pipe' })
  const record = JSON.parse(await readFile(recordPath, 'utf8')) as { decision?: string; ready?: boolean; fromCommit?: string; toCommit?: string; artifact?: { sha256?: string }; gateResults?: Record<string, { exitCode?: number; logSha256?: string; toCommit?: string }> }
  assert.equal(record.decision, 'TEST-ONLY')
  assert.equal(record.ready, false)
  assert.equal(record.fromCommit, fromCommit)
  assert.match(record.toCommit || '', /^[0-9a-f]{40}$/)
  assert.notEqual(record.toCommit, fromCommit)
  assert.match(record.artifact?.sha256 || '', /^[0-9a-f]{64}$/)
  assert.equal(Object.keys(record.gateResults || {}).length, 9)
  for (const result of Object.values(record.gateResults || {})) {
    assert.equal(result.exitCode, 0)
    assert.match(result.logSha256 || '', /^[0-9a-f]{64}$/)
    assert.equal(result.toCommit, record.toCommit)
  }

  const forgedPath = join(directory, 'forged.json')
  await writeFile(forgedPath, JSON.stringify({ packaging: { passed: true } }))
  assert.throws(() => execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/qualify-pi-sync.mts', '--gate-results', forgedPath], { cwd: process.cwd(), stdio: 'pipe' }))

  const noGoPath = join(directory, 'no-go.json')
  execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/qualify-pi-sync.mts', '--test-only-gates', '--log-dir', join(directory, 'no-go-logs'), '--output', noGoPath], { cwd: process.cwd(), stdio: 'pipe' })
  const noGo = JSON.parse(await readFile(noGoPath, 'utf8')) as { decision?: string }
  assert.equal(noGo.decision, 'TEST-ONLY')
} finally {
  await rm(directory, { recursive: true, force: true })
}
console.log('Pi sync release record smoke passed')
