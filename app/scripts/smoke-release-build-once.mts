import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const scripts = packageJson.scripts
const exactBuildCalls = (body: string): string[] => body.match(/npm run build(?!:)/g) ?? []

assert.equal(scripts.build, 'npm run build:compile', 'the default build must be compilation-only')
assert.equal(scripts['build:compile'], 'npm run build:pi-host && tsc -b && vite build', 'the compile graph must contain no qualification commands')
assert.equal(scripts['build:pi-vendor'], 'node --experimental-strip-types scripts/build-pi-vendor.mts', 'Pi vendor compilation must not run smoke tests')
assert.doesNotMatch(scripts['build:pi-host:actual'] ?? '', /smoke|qualif|electron/, 'Pi Host compilation must not run tests or launch Electron')

for (const name of ['dist', 'dist:mac', 'dist:win', 'dist:all']) {
  const body = scripts[name] ?? ''
  assert.equal(exactBuildCalls(body).length, 1, `${name} must perform exactly one full build`)
  assert.doesNotMatch(body, /smoke|qualif|test|e2e|npm run icons|verify-mac-release-signature/, `${name} must compile/package without tests, UI launch, icon rendering, or post-build qualification`)
  assert.ok(body.indexOf('electron-builder') > body.indexOf('npm run build'), `${name} must package after compilation`)
}

assert.match(scripts['build:pi-host'] ?? '', /run-pi-host-build\.mts build:pi-host:actual$/, 'Pi Host builds must pass through the release-mode guard')
assert.match(scripts['build:pi-host:actual'] ?? '', /build-pi-host-bundle\.mts/, 'the real Pi Host build remains independently callable')
assert.match(scripts.check ?? '', /npm run smoke:pi-build-contract/, 'removed build-time checks must remain reachable from the independent check command')

console.log('release topology passed: compile/package only; qualification stays independent')
