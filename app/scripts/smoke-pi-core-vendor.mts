import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { validateGeneratedModelData } from '../../vendor/pi/packages/ai/scripts/model-data.ts'

const root = resolve(import.meta.dirname, '../../vendor/pi')
const runtimeSource = await readFile(resolve(import.meta.dirname, '../electron/piCoreRuntime.ts'), 'utf8')
const adapterSource = await readFile(resolve(import.meta.dirname, '../electron/piCoreAdapter.ts'), 'utf8')
assert.doesNotMatch(runtimeSource, /dist\/core\/auth-storage\.js/, 'runtime callers stay behind the Pi compatibility Adapter')
assert.match(adapterSource, /dist\/core\/auth-storage\.js/, 'the deep import has one qualified owner')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
  version?: string
  license?: string
  workspaces?: string[]
}

assert.equal(manifest.version, '0.0.3', 'vendor must retain the upstream monorepo manifest')
assert.equal(manifest.license, undefined, 'upstream monorepo license is represented by its LICENSE file')
assert.deepEqual(manifest.workspaces, [
  'packages/*',
  'packages/session-backends/*',
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
  ['client', '@earendil-works/pi-client'],
  ['protocol', '@earendil-works/pi-protocol'],
  ['server', '@earendil-works/pi-server'],
  ['session-backends/sqlite-node', '@earendil-works/pi-session-backend-sqlite-node'],
  ['telemetry', '@earendil-works/pi-telemetry'],
  ['tui', '@earendil-works/pi-tui'],
])

for (const [directory, expectedName] of expectedPackages) {
  const packageJson = JSON.parse(await readFile(resolve(root, 'packages', directory, 'package.json'), 'utf8')) as {
    name?: string
    version?: string
    license?: string
  }
  assert.equal(packageJson.name, expectedName)
  assert.equal(packageJson.version, '0.84.3')
  assert.equal(packageJson.license, 'MIT')
}

validateGeneratedModelData(resolve(root, 'packages/ai'))
const tamperRoot = await mkdtemp(join(tmpdir(), 'pi-model-data-'))
try {
  await cp(resolve(root, 'packages/ai/src'), resolve(tamperRoot, 'src'), { recursive: true })
  const dataDir = resolve(tamperRoot, 'src/providers/data')
  const provider = (await readdir(dataDir)).find((entry) => entry.endsWith('.json') && entry !== '.manifest.json')
  assert.ok(provider)
  const providerPath = resolve(dataDir, provider)
  await writeFile(providerPath, `${await readFile(providerPath, 'utf8')}\n`)
  assert.throws(() => validateGeneratedModelData(tamperRoot), /manifest hash/i)
} finally {
  await rm(tamperRoot, { recursive: true, force: true })
}

console.log('pi core vendor metadata is valid')
