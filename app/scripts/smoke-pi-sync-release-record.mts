import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const directory = await mkdtemp(join(tmpdir(), 'pi-sync-release-record-'))
const recordPath = join(directory, 'pi-sync-release-record.json')
const toCommit = '3333333333333333333333333333333333333333'
try {
  execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/qualify-pi-sync.mts', '--to-commit', toCommit, '--all-gates', '--output', recordPath], { cwd: process.cwd(), stdio: 'pipe' })
  const record = JSON.parse(await readFile(recordPath, 'utf8')) as { decision?: string; fromCommit?: string; toCommit?: string; artifact?: { sha256?: string } }
  assert.equal(record.decision, 'GO')
  assert.match(record.fromCommit || '', /^[0-9a-f]{40}$/)
  assert.equal(record.toCommit, toCommit)
  assert.match(record.artifact?.sha256 || '', /^[0-9a-f]{64}$/)

  const noGoPath = join(directory, 'no-go.json')
  execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/qualify-pi-sync.mts', '--output', noGoPath], { cwd: process.cwd(), stdio: 'pipe' })
  const noGo = JSON.parse(await readFile(noGoPath, 'utf8')) as { decision?: string }
  assert.equal(noGo.decision, 'NO-GO')
} finally {
  await rm(directory, { recursive: true, force: true })
}
console.log('Pi sync release record smoke passed')
