/**
 * Ticket 17 — required Restricted Project View admission fail-closed.
 * Seam: decideRestrictedViewAdmission + resolveProfileForProtectedView (pure).
 * Run: node --experimental-strip-types scripts/smoke-outbound-view-admission.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decideRestrictedViewAdmission,
  resolveProfileForProtectedView,
} from '../src/agent/outbound/outboundGate.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
async function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  }
}

console.log('smoke-outbound-view-admission')

await test('off → skip (no view required)', () => {
  const r = decideRestrictedViewAdmission({
    effectiveMode: 'off',
    projectRoot: '/proj',
    prepare: null,
  })
  assert.equal(r.action, 'skip')
})

await test('required + missing projectRoot → block', () => {
  const r = decideRestrictedViewAdmission({
    effectiveMode: 'required',
    projectRoot: undefined,
    prepare: null,
  })
  assert.equal(r.action, 'block')
  if (r.action === 'block') assert.match(r.reason, /projectRoot|project root/i)
})

await test('optional + missing projectRoot → continue-degraded', () => {
  const r = decideRestrictedViewAdmission({
    effectiveMode: 'optional',
    projectRoot: '',
    prepare: null,
  })
  assert.equal(r.action, 'continue-degraded')
  if (r.action === 'continue-degraded') assert.match(r.reason, /projectRoot|project root/i)
})

await test('required + prepare fail → block', () => {
  const r = decideRestrictedViewAdmission({
    effectiveMode: 'required',
    projectRoot: '/proj',
    prepare: { ok: false, reason: 'disk full' },
  })
  assert.equal(r.action, 'block')
  if (r.action === 'block') assert.match(r.reason, /disk full/)
})

await test('demo + prepare fail → continue-degraded', () => {
  const r = decideRestrictedViewAdmission({
    effectiveMode: 'demo',
    projectRoot: '/proj',
    prepare: { ok: false, reason: 'no fs' },
  })
  assert.equal(r.action, 'continue-degraded')
})

await test('required + prepare ok → use-view', () => {
  const r = decideRestrictedViewAdmission({
    effectiveMode: 'required',
    projectRoot: '/proj',
    prepare: { ok: true, viewRoot: '/view/x' },
  })
  assert.equal(r.action, 'use-view')
  if (r.action === 'use-view') assert.equal(r.viewRoot, '/view/x')
})

await test('required + bridge missing (prepare null with root) → block', () => {
  const r = decideRestrictedViewAdmission({
    effectiveMode: 'required',
    projectRoot: '/proj',
    prepare: null,
    bridgeAvailable: false,
  })
  assert.equal(r.action, 'block')
})

await test('required + policy ensure fail → block profile (no silent baseline)', () => {
  const r = resolveProfileForProtectedView({
    effectiveMode: 'required',
    ensureOk: false,
    ensureReason: 'malformed company-base policy: bad json',
  })
  assert.equal(r.action, 'block')
  if (r.action === 'block') assert.match(r.reason, /malformed|company-base/i)
})

await test('optional + policy ensure fail → use-baseline degraded', () => {
  const r = resolveProfileForProtectedView({
    effectiveMode: 'optional',
    ensureOk: false,
    ensureReason: 'malformed company-base',
  })
  assert.equal(r.action, 'use-baseline')
  if (r.action === 'use-baseline') assert.equal(r.degraded, true)
})

await test('required + ensure ok → use-ensured', () => {
  const r = resolveProfileForProtectedView({
    effectiveMode: 'required',
    ensureOk: true,
  })
  assert.equal(r.action, 'use-ensured')
})

await test('wiring: prepareOutboundRunView consults profile admission under required', () => {
  const t = fs.readFileSync(path.join(appRoot, 'electron/outboundBridge.ts'), 'utf8')
  assert.match(t, /resolveProfileForProtectedView/)
  assert.match(t, /effectiveMode/)
  assert.match(t, /profileDecision\.action === 'block'/)
})

await test('wiring: coordinator uses decideRestrictedViewAdmission', () => {
  const t = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(t, /decideRestrictedViewAdmission/)
  // required + missing root must not silently skip the whole block
  assert.match(t, /isProtectionActive/)
})

console.log(`\n${passed} tests passed`)
