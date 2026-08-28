import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const directory = await mkdtemp(join(tmpdir(), 'pi-sync-workflow-'))
const upstream = join(directory, 'upstream')
const vendor = join(directory, 'vendor', 'pi')
const output = join(directory, 'evidence', 'synchronized.json')
const git = (args: string[]) => execFileSync('git', args, { cwd: upstream, encoding: 'utf8' }).trim()
const run = (args: string[]) => execFileSync('git', args, { cwd: upstream, stdio: 'pipe' })

try {
  await mkdir(upstream, { recursive: true })
  await mkdir(vendor, { recursive: true })
  await mkdir(join(upstream, 'packages', 'coding-agent'), { recursive: true })
  await mkdir(join(vendor, 'packages', 'coding-agent'), { recursive: true })
  run(['init', '-q'])
  run(['config', 'user.email', 'pi-sync-smoke@example.invalid'])
  run(['config', 'user.name', 'Pi Sync Smoke'])
  await writeFile(join(upstream, 'README.md'), 'old upstream\n')
  await writeFile(join(upstream, 'package.json'), JSON.stringify({ name: 'pi-sync-fixture', version: '0.0.3', scripts: { test: 'node --test' } }) + '\n')
  await writeFile(join(upstream, 'packages', 'coding-agent', 'package.json'), JSON.stringify({ name: '@fixture/pi-coding-agent', version: '1.0.0' }) + '\n')
  await writeFile(join(upstream, 'fixture.test.mjs'), "import test from 'node:test'; test('fixture upstream tests', () => {})\n")
  await writeFile(join(upstream, 'test.sh'), '#!/usr/bin/env bash\nset -euo pipefail\nnpm test\n')
  run(['add', '.'])
  run(['commit', '-qm', 'old'])
  const fromCommit = git(['rev-parse', 'HEAD'])
  await writeFile(join(upstream, 'README.md'), 'new upstream\n')
  await writeFile(join(upstream, 'packages', 'coding-agent', 'package.json'), JSON.stringify({ name: '@fixture/pi-coding-agent', version: '2.0.0' }) + '\n')
  run(['add', '.'])
  run(['commit', '-qm', 'new'])
  const toCommit = git(['rev-parse', 'HEAD'])

  await writeFile(join(vendor, 'README.md'), 'old upstream\n')
  await writeFile(join(vendor, 'package.json'), JSON.stringify({ name: 'pi-sync-fixture', version: '0.0.3', scripts: { test: 'node --test' } }) + '\n')
  await writeFile(join(vendor, 'packages', 'coding-agent', 'package.json'), JSON.stringify({ name: '@fixture/pi-coding-agent', version: '1.0.0' }) + '\n')
  await writeFile(join(vendor, 'fixture.test.mjs'), "import test from 'node:test'; test('fixture upstream tests', () => {})\n")
  await writeFile(join(vendor, 'test.sh'), '#!/usr/bin/env bash\nset -euo pipefail\nnpm test\n')
  await writeFile(join(vendor, 'PI_UPSTREAM_PIN.json'), JSON.stringify({ repository: 'fixture', tag: null, commit: fromCommit, packageVersion: '1.0.0', treeSha256: 'fixture' }) + '\n')
  await writeFile(join(vendor, 'PI_CORE_PATCH_LEDGER.md'), '# Core Patch Ledger\nNo undocumented core edits.\n')

  execFileSync(process.execPath, [
    '--experimental-strip-types', resolve(import.meta.dirname, 'sync-pi.mts'),
    '--from-commit', fromCommit, '--to-commit', toCommit,
    '--release-source-asset', 'pi-2.0.0-source.tar.gz',
    '--release-source-sha256', 'a'.repeat(64),
    '--source-dir', upstream, '--vendor-dir', vendor, '--output', output,
  ], { cwd: resolve(import.meta.dirname, '..'), stdio: 'pipe' })
  const manifest = JSON.parse(await readFile(output, 'utf8')) as Record<string, unknown>
  assert.equal(manifest.status, 'synchronized')
  assert.equal(manifest.vendorUpdated, true)
  assert.equal(manifest.ledgerReconciled, true)
  assert.equal(manifest.upstreamTests, true)
  assert.equal(manifest.upstreamTestCommand, 'bash test.sh')
  assert.equal(await readFile(join(vendor, 'README.md'), 'utf8'), 'new upstream\n')
  const pin = JSON.parse(await readFile(join(vendor, 'PI_UPSTREAM_PIN.json'), 'utf8')) as {
    commit: string
    packageVersion: string
    releaseSourceArchive: { asset: string, sha256: string }
  }
  assert.equal(pin.commit, toCommit)
  assert.equal(pin.packageVersion, '2.0.0')
  assert.deepEqual(pin.releaseSourceArchive, {
    asset: 'pi-2.0.0-source.tar.gz',
    sha256: 'a'.repeat(64),
  })
} finally {
  await rm(directory, { recursive: true, force: true })
}
console.log('Pi synchronization workflow updates a pinned vendor tree and runs upstream tests')
