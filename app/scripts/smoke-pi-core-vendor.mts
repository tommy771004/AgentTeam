import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../vendor/pi')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
  version?: string
  license?: string
  workspaces?: string[]
}

assert.equal(manifest.version, '0.0.3', 'vendor must retain the upstream monorepo manifest')
assert.equal(manifest.license, undefined, 'upstream monorepo license is represented by its LICENSE file')
assert.deepEqual(manifest.workspaces, [
  'packages/*',
  'packages/storage/*',
  'packages/coding-agent/examples/extensions/with-deps',
  'packages/coding-agent/examples/extensions/custom-provider-anthropic',
  'packages/coding-agent/examples/extensions/custom-provider-gitlab-duo',
  'packages/coding-agent/examples/extensions/sandbox',
  'packages/coding-agent/examples/extensions/gondolin',
])

const expectedPackages = new Map([
  ['ai', '@earendil-works/pi-ai'],
  ['agent', '@earendil-works/pi-agent-core'],
  ['coding-agent', '@earendil-works/pi-coding-agent'],
  ['tui', '@earendil-works/pi-tui'],
])

for (const [directory, expectedName] of expectedPackages) {
  const packageJson = JSON.parse(await readFile(resolve(root, 'packages', directory, 'package.json'), 'utf8')) as {
    name?: string
    version?: string
    license?: string
  }
  assert.equal(packageJson.name, expectedName)
  assert.equal(packageJson.version, '0.81.1')
  assert.equal(packageJson.license, 'MIT')
}

console.log('pi core vendor metadata is valid')
