import assert from 'node:assert/strict'
import { isCompletePiHostReleaseEvidence } from '../src/agent/piHostReleaseEvidence.ts'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const directory = await mkdtemp(join(tmpdir(), 'pi-host-evidence-output-'))
try {
  const file = join(directory, 'pi-host-qualification.json')
  execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/qualify-pi-host.mts', '--output', file], { cwd: process.cwd(), stdio: 'pipe' })
  const evidence = JSON.parse(await readFile(file, 'utf8')) as unknown
  assert.equal(isCompletePiHostReleaseEvidence(evidence), true)
  assert.equal((evidence as { utilityProcess: boolean }).utilityProcess, true)
} finally {
  await rm(directory, { recursive: true, force: true })
}
console.log('Pi Host release evidence smoke passed')
