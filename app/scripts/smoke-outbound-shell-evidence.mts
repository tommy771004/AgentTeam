/**
 * Tickets 21 + 23 — builtin shell under protection + privileged evidence IPC deny.
 * Run: node --experimental-strip-types scripts/smoke-outbound-shell-evidence.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decideBuiltinShellUnderProtection } from '../src/agent/outbound/cliSandbox.ts'
import { buildRunContextPolicy, withRunShellPolicy } from '../src/agent/runSettingsSnapshot.ts'
import { parsePiTurnContextPolicy } from '../electron/piSessionContext.ts'
import type { LlmSettings } from '../src/agent/types.ts'
import { allowEvidenceAppendFromIpc } from '../src/agent/outbound/evidenceLedger.ts'
import { assertPolicyAdminWriteAllowed } from '../src/agent/outbound/policyAdmin.ts'

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

console.log('smoke-outbound-shell-evidence')

await test('ticket21: required denies unisolated bash', () => {
  const r = decideBuiltinShellUnderProtection({
    effectiveMode: 'required',
    command: 'ls',
    viewRoot: '/tmp/view',
  })
  assert.equal(r.allow, false)
  assert.match(r.reason || '', /Required|shell|isolation/i)
})

await test('ticket21: required denies absolute path outside view', () => {
  const r = decideBuiltinShellUnderProtection({
    effectiveMode: 'optional',
    command: 'cat /Users/secret/.env',
    viewRoot: '/tmp/view-only',
  })
  assert.equal(r.allow, false)
  assert.match(r.reason || '', /絕對路徑|View/i)
})

await test('ticket21: optional allows degraded without isolation', () => {
  const r = decideBuiltinShellUnderProtection({
    effectiveMode: 'optional',
    command: 'ls src',
    viewRoot: '/tmp/view',
  })
  assert.equal(r.allow, true)
  assert.equal(r.degraded, true)
})

await test('ticket21: off allows freely', () => {
  const r = decideBuiltinShellUnderProtection({
    effectiveMode: 'off',
    command: 'cat /etc/passwd',
  })
  assert.equal(r.allow, true)
})

// A gate nothing feeds is a gate that always allows. These exercise the SHIPPED
// producer, the IPC crossing and the Host decision on one policy object, so a
// missing renderer-side producer fails here instead of passing silently.
const baseSettings = { model: 'test-model' } as unknown as LlmSettings

await test('ADR-0047: the run policy carries the admitted shell posture', () => {
  const policy = withRunShellPolicy(
    buildRunContextPolicy(baseSettings, { temporary: false }),
    { effectiveMode: 'required', viewRoot: '/tmp/view' },
  )
  assert.equal(policy.outboundShellMode, 'required')
  assert.equal(policy.viewRoot, '/tmp/view')
  // Structural, not behavioural: `RunContextPolicy` carries no
  // `shellIsolationVerified` field at all, so the renderer cannot claim
  // filesystem isolation even by mistake. Asserting the value was undefined
  // only proved this producer did not set it; removing the field proves no
  // producer can. Isolation is issued Host-side as evidence (ADR-0051).
  assert.equal(
    (policy as Record<string, unknown>).shellIsolationVerified,
    undefined,
    'the renderer must never claim filesystem isolation',
  )
  const policyType = fs.readFileSync(path.join(appRoot, 'src/agent/types.ts'), 'utf8')
  const runPolicy = policyType.slice(policyType.indexOf('export interface RunContextPolicy'))
  assert.doesNotMatch(
    runPolicy.slice(0, runPolicy.indexOf('\n}')),
    /shellIsolationVerified/,
    'the field is gone from the type, so no renderer path can set it',
  )
})

await test('ADR-0047: an unbound view leaves viewRoot absent, so required still denies', () => {
  const policy = withRunShellPolicy(
    buildRunContextPolicy(baseSettings, { temporary: false }),
    { effectiveMode: 'required' },
  )
  assert.equal(policy.viewRoot, undefined)
  const verdict = decideBuiltinShellUnderProtection({
    effectiveMode: policy.outboundShellMode!,
    command: 'ls',
    viewRoot: policy.viewRoot ?? null,
  })
  assert.equal(verdict.allow, false)
})

await test('ADR-0047: every mode survives the IPC crossing into the Host', () => {
  for (const mode of ['required', 'optional', 'demo', 'off'] as const) {
    const policy = withRunShellPolicy(
      buildRunContextPolicy(baseSettings, { temporary: false }),
      { effectiveMode: mode, viewRoot: '/tmp/view' },
    )
    const parsed = parsePiTurnContextPolicy(JSON.parse(JSON.stringify(policy)))
    assert.equal(parsed.outboundShellMode, mode, `${mode} must not be dropped in transit`)
    assert.equal(parsed.viewRoot, '/tmp/view')
  }
})

await test('ADR-0047: taskRunCoordinator pins the posture it admitted the run under', () => {
  const coordinator = fs.readFileSync(
    path.join(appRoot, 'src/agent/taskRunCoordinator.ts'),
    'utf8',
  )
  assert.match(
    coordinator,
    /withRunShellPolicy\(admittedPolicy, \{ effectiveMode: mode \}\)/,
    'the shell posture must be pinned from the same mode the Outbound Data Gate resolved',
  )
  assert.match(
    coordinator,
    /viewRoot: admission\.viewRoot/,
    'a bound Restricted Project View must reach the Host shell gate',
  )
})

await test('ticket22: assertPolicyAdminWriteAllowed standard denies', () => {
  const d = assertPolicyAdminWriteAllowed('standard')
  assert.equal(d.ok, false)
  const ok = assertPolicyAdminWriteAllowed('policy-admin')
  assert.equal(ok.ok, true)
})

await test('ticket23: IPC cannot append outbound-decision', () => {
  assert.equal(allowEvidenceAppendFromIpc('outbound-decision'), false)
  assert.equal(allowEvidenceAppendFromIpc('restricted-view'), false)
  assert.equal(allowEvidenceAppendFromIpc('cli-sandbox-deny'), false)
  assert.equal(allowEvidenceAppendFromIpc('policy-change'), true)
})

await test('ticket23: main appendEvidence IPC sets fromIpc', () => {
  const t = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  assert.match(t, /fromIpc:\s*true/)
  assert.match(t, /cli-sandbox-deny|action: 'cli-sandbox-deny'/)
})

await test('ticket23: prepareRunView appends evidence without fromIpc', () => {
  const t = fs.readFileSync(path.join(appRoot, 'electron/outboundBridge.ts'), 'utf8')
  assert.match(t, /restricted-view/)
  assert.match(t, /appendOutboundEvidence/)
})

console.log(`\n${passed} tests passed`)
