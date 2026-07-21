/**
 * Build flavor matrix — standard | policy-admin; unknown fails (ADR-0016).
 * Run: node --experimental-strip-types scripts/smoke-build-flavor-matrix.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseBuildFlavorStrict,
  policyAdminSurfacesEnabled,
} from '../src/agent/outbound/policyAdmin.ts'
import { parseBuildFlavor } from '../src/agent/outbound/outboundGate.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  }
}

console.log('smoke-build-flavor-matrix')

await test('matrix: empty/standard/policy-admin', () => {
  assert.equal(parseBuildFlavorStrict(undefined), 'standard')
  assert.equal(parseBuildFlavorStrict(''), 'standard')
  assert.equal(parseBuildFlavorStrict('standard'), 'standard')
  assert.equal(parseBuildFlavorStrict('policy-admin'), 'policy-admin')
  assert.equal(parseBuildFlavor(undefined), 'standard')
  assert.equal(parseBuildFlavor('policy-admin'), 'policy-admin')
})

await test('unknown flavor fails closed (build must fail)', () => {
  assert.throws(() => parseBuildFlavorStrict('pro'), /SUBAGENTS_BUILD_FLAVOR/)
  assert.throws(() => parseBuildFlavorStrict('enterprise'), /SUBAGENTS_BUILD_FLAVOR/)
  assert.throws(() => parseBuildFlavor('free'), /SUBAGENTS_BUILD_FLAVOR/)
})

await test('policy-admin surfaces only on policy-admin flavor', () => {
  assert.equal(policyAdminSurfacesEnabled('standard'), false)
  assert.equal(policyAdminSurfacesEnabled('policy-admin'), true)
})

await test('Settings gates Policy Admin nav by flavor (static contract)', () => {
  const t = fs.readFileSync(path.join(appRoot, 'src/pages/SettingsPage.tsx'), 'utf8')
  assert.match(t, /isPolicyAdminBuild/)
  assert.match(t, /filter\(\(s\) => s\.id !== 'policyAdmin'\)/)
  assert.match(t, /id: 'policyAdmin'/)
})

await test('check-build-flavor script exists and uses strict parser', () => {
  const p = path.join(appRoot, 'scripts/check-build-flavor.mts')
  assert.ok(fs.existsSync(p), 'missing scripts/check-build-flavor.mts')
  const t = fs.readFileSync(p, 'utf8')
  assert.match(t, /parseBuildFlavorStrict/)
  assert.match(t, /process\.exit\(1\)/)
})

await test('package.json build invokes flavor check', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  const build = pkg.scripts.build || ''
  assert.match(build, /check-build-flavor|check:build-flavor/)
})

console.log(`\n${passed} tests passed`)
