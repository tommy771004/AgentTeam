/**
 * Tickets 21 + 23 — builtin shell under protection + privileged evidence IPC deny.
 * Run: node --experimental-strip-types scripts/smoke-outbound-shell-evidence.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decideBuiltinShellUnderProtection } from '../src/agent/outbound/cliSandbox.ts'
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
    shellIsolationVerified: false,
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

await test('ticket21: bash handler wires decideBuiltinShellUnderProtection', () => {
  const t = fs.readFileSync(
    path.join(appRoot, 'src/agent/tools/registered/bash.ts'),
    'utf8',
  )
  assert.match(t, /decideBuiltinShellUnderProtection/)
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
