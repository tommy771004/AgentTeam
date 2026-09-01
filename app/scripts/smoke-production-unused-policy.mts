import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import packageJson from '../package.json' with { type: 'json' }

assert.equal(
  packageJson.scripts['check:unused-production'],
  'oxlint src electron/. -A all -D no-unused-vars',
  'unused policy must stay narrow: production renderer/Electron only, and other warning classes remain separate',
)

const root = await mkdtemp(join(tmpdir(), 'agentstudio-unused-'))
try {
  const fixture = join(root, 'unused-fixture.ts')
  await writeFile(fixture, "import { readFile } from 'node:fs/promises'\nconst deadLocal = 1\nexport const live = 2\n")
  const result = spawnSync(
    process.execPath,
    [join(import.meta.dirname, '../node_modules/oxlint/bin/oxlint'), fixture, '--no-ignore', '-A', 'all', '-D', 'no-unused-vars'],
    { encoding: 'utf8' },
  )
  assert.notEqual(result.status, 0, 'a new production unused import/local must block qualification')
  assert.match(`${result.stdout}\n${result.stderr}`, /readFile|deadLocal/)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('production unused-code policy is zero-budget and fixture-proven')
