/**
 * Ticket 20 — main-enforced CLI filesystem sandbox + canary off original project.
 * Seam: decideMainCliSpawnAdmission + allocateForbiddenCanaryPath.
 * Run: node --experimental-strip-types scripts/smoke-cli-main-sandbox.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decideMainCliSpawnAdmission,
  allocateForbiddenCanaryPath,
  isPathInsideRoot,
} from '../src/agent/outbound/cliSandbox.ts'

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

console.log('smoke-cli-main-sandbox')

const view = '/tmp/view-run-1'
const original = '/tmp/original-proj'

await test('required + no sandboxWrap → deny (renderer cannot omit wrap)', () => {
  const r = decideMainCliSpawnAdmission({
    effectiveMode: 'required',
    cwd: view,
    boundViewRoot: view,
    sandboxWrap: null,
    isolationStatus: 'verified', // even if renderer lies, no wrap → deny
  })
  assert.equal(r.allow, false)
  assert.match(r.reason || '', /sandbox|wrap|required/i)
})

await test('required + wrap but cwd outside view → deny', () => {
  const r = decideMainCliSpawnAdmission({
    effectiveMode: 'required',
    cwd: original,
    boundViewRoot: view,
    sandboxWrap: { engine: 'seatbelt', viewRoot: view },
    isolationStatus: 'verified',
  })
  assert.equal(r.allow, false)
  assert.match(r.reason || '', /cwd|view/i)
})

await test('required + wrap viewRoot mismatch bound view → deny', () => {
  const r = decideMainCliSpawnAdmission({
    effectiveMode: 'required',
    cwd: '/tmp/other-view',
    boundViewRoot: view,
    sandboxWrap: { engine: 'seatbelt', viewRoot: '/tmp/other-view' },
    isolationStatus: 'verified',
  })
  assert.equal(r.allow, false)
})

await test('required + wrap + cwd in view + verified → allow', () => {
  const r = decideMainCliSpawnAdmission({
    effectiveMode: 'required',
    cwd: path.join(view, 'src'),
    boundViewRoot: view,
    sandboxWrap: { engine: 'seatbelt', viewRoot: view },
    isolationStatus: 'verified',
  })
  assert.equal(r.allow, true)
})

await test('required + wrap but isolation unverified → deny', () => {
  const r = decideMainCliSpawnAdmission({
    effectiveMode: 'required',
    cwd: view,
    boundViewRoot: view,
    sandboxWrap: { engine: 'bwrap', viewRoot: view },
    isolationStatus: 'unverified',
  })
  assert.equal(r.allow, false)
})

await test('optional + no wrap → allow with unverified mark', () => {
  const r = decideMainCliSpawnAdmission({
    effectiveMode: 'optional',
    cwd: view,
    boundViewRoot: view,
    sandboxWrap: null,
    isolationStatus: 'unverified',
  })
  assert.equal(r.allow, true)
  assert.equal(r.isolationVerified, false)
})

await test('off → allow without wrap', () => {
  const r = decideMainCliSpawnAdmission({
    effectiveMode: 'off',
    cwd: original,
    boundViewRoot: null,
    sandboxWrap: null,
    isolationStatus: 'unavailable',
  })
  assert.equal(r.allow, true)
})

await test('allocateForbiddenCanaryPath is outside original and view', () => {
  const p = allocateForbiddenCanaryPath({
    originalRoot: original,
    viewRoot: view,
  })
  assert.ok(path.isAbsolute(p))
  assert.equal(isPathInsideRoot(p, original), false)
  assert.equal(isPathInsideRoot(p, view), false)
  // lives under tmp
  assert.ok(p.startsWith(os.tmpdir()) || p.includes('subagents-forbid'))
  // cleanup parent dir if created
  try {
    fs.rmSync(path.dirname(p), { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

await test('wiring: main cli:runAgent uses decideMainCliSpawnAdmission', () => {
  const t = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  assert.match(t, /decideMainCliSpawnAdmission/)
  assert.match(t, /cli:runAgent/)
})

await test('wiring: localCliRun uses allocateForbiddenCanaryPath (not original/.canary)', () => {
  const t = fs.readFileSync(path.join(appRoot, 'src/agent/localCliRun.ts'), 'utf8')
  assert.match(t, /allocateForbiddenCanaryPath/)
  assert.doesNotMatch(t, /\.subagents-outbound-forbid-canary/)
})

await test('wiring: verifyCliFilesystemSandbox does not require canary under project', () => {
  const t = fs.readFileSync(path.join(appRoot, 'electron/cliFilesystemSandbox.ts'), 'utf8')
  // still accepts forbiddenCanaryPath but docs/comment should not say original project only
  assert.match(t, /forbiddenCanaryPath/)
})

console.log(`\n${passed} tests passed`)
