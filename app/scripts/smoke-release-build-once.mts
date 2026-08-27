import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const scripts = packageJson.scripts
const read = (relative: string): string => readFileSync(resolve(appRoot, relative), 'utf8')

const exactBuildCalls = (body: string): string[] => body.match(/npm run build(?!:)/g) ?? []

assert.match(scripts.smoke ?? '', /npm run smoke:pi-electron-host-e2e(?:\s|$)/, 'the canonical smoke chain remains the single coverage owner')
assert.match(
  scripts['smoke:after-build'] ?? '',
  /run-after-build-smoke\.mts smoke$/,
  'the after-build entry must establish release artifact mode around the canonical smoke chain',
)
assert.equal(
  scripts['smoke:pi-electron-host-e2e'],
  'node --experimental-strip-types scripts/run-pi-electron-host-e2e.mts smoke:pi-electron-host-e2e:standalone smoke:pi-electron-host-e2e:built',
  'the Electron smoke must select its build policy from the explicit release mode',
)
assert.equal(
  scripts['smoke:pi-electron-host-e2e:built'],
  'node scripts/smoke-pi-electron-host-e2e.mjs',
  'the built Electron smoke must exercise the real packaged renderer/Host boundary',
)
assert.equal(
  scripts['smoke:pi-electron-host-e2e:standalone'],
  'npm run build && npm run smoke:pi-electron-host-e2e:built',
  'the standalone Electron smoke must remain self-contained outside release mode',
)

for (const name of ['dist', 'dist:mac', 'dist:win', 'dist:all']) {
  const body = scripts[name] ?? ''
  assert.equal(exactBuildCalls(body).length, 1, `${name} must perform exactly one full build`)
  assert.doesNotMatch(body, /npm run smoke(?:\s|&&)/, `${name} must not call the self-building smoke alias`)
  const buildAt = body.indexOf('npm run build')
  const smokeAt = body.indexOf('npm run smoke:after-build')
  const packageAt = body.indexOf('electron-builder')
  assert.ok(buildAt >= 0 && smokeAt > buildAt, `${name} must test only after compilation finishes`)
  assert.ok(packageAt > smokeAt, `${name} must package only after the after-build tests pass`)
}

assert.match(scripts['build:pi-host'] ?? '', /run-pi-host-build\.mts build:pi-host:actual$/, 'Pi Host builds must pass through the release-mode guard')
assert.match(scripts['build:pi-host:actual'] ?? '', /build-pi-host-bundle\.mts/, 'the real Pi Host build remains independently callable')

const afterBuildRunner = read('scripts/run-after-build-smoke.mts')
assert.match(afterBuildRunner, /missing\.length > 0/, 'after-build smoke must fail closed when compiled artifacts are missing')
assert.match(afterBuildRunner, /SUBAGENTS_RELEASE_AFTER_BUILD: '1'/, 'release mode must be scoped to the smoke child process')
const piBuildRunner = read('scripts/run-pi-host-build.mts')
assert.match(piBuildRunner, /SUBAGENTS_RELEASE_AFTER_BUILD === '1'/, 'nested Pi builds must recognize explicit release mode')
assert.match(piBuildRunner, /release smoke cannot reuse incomplete Pi Host artifacts/, 'nested Pi build skipping must validate reusable artifacts')
const electronRunner = read('scripts/run-pi-electron-host-e2e.mts')
assert.match(electronRunner, /\? builtTarget\s*:\s*standaloneTarget/, 'Electron E2E must select the already-built target only in release mode')

console.log('release build-once topology passed: compile once, test built artifacts, then package')
