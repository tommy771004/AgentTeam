/**
 * Required CLI filesystem sandbox — ticket 06.
 * Seam: evaluateCliSandboxGate / rewriteCliPromptForView / localCliRun wiring.
 * Run: node --experimental-strip-types scripts/smoke-cli-sandbox.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  evaluateCliSandboxGate,
  rewriteCliPromptForView,
  type FilesystemIsolationStatus,
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

console.log('smoke-cli-sandbox')

await test('required mode denies CLI when sandbox unavailable', () => {
  const r = evaluateCliSandboxGate({
    effectiveMode: 'required',
    isolationStatus: 'unavailable',
  })
  assert.equal(r.allow, false)
  assert.match(r.reason || '', /sandbox|filesystem|不可用|unavailable/i)
  assert.doesNotMatch(r.reason || '', /\/Users\/|secret|password/i)
})

await test('required mode allows only verified isolation', () => {
  assert.equal(
    evaluateCliSandboxGate({ effectiveMode: 'required', isolationStatus: 'verified' }).allow,
    true,
  )
  assert.equal(
    evaluateCliSandboxGate({ effectiveMode: 'required', isolationStatus: 'unverified' }).allow,
    false,
  )
})

await test('optional/demo allow unverified with visible status', () => {
  for (const mode of ['optional', 'demo'] as const) {
    const r = evaluateCliSandboxGate({
      effectiveMode: mode,
      isolationStatus: 'unverified',
    })
    assert.equal(r.allow, true, mode)
    assert.equal(r.isolationStatus, 'unverified')
    assert.equal(r.isolationVerified, false)
  }
})

await test('off bypasses sandbox requirement', () => {
  const r = evaluateCliSandboxGate({
    effectiveMode: 'off',
    isolationStatus: 'unavailable',
  })
  assert.equal(r.allow, true)
  assert.equal(r.isolationStatus, 'unavailable')
})

await test('rewriteCliPromptForView strips original absolute paths', () => {
  const original = '/Users/corp/secret-project'
  const view = '/tmp/view-abc'
  const prompt = `Please edit ${original}/src/app.ts and also ${original}`
  const out = rewriteCliPromptForView(prompt, { originalRoot: original, viewRoot: view })
  assert.doesNotMatch(out, /\/Users\/corp\/secret-project/)
  assert.match(out, /\/tmp\/view-abc/)
  assert.match(out, /src\/app\.ts/)
})

await test('localCliRun wires evaluateCliSandboxGate before process', () => {
  const cli = fs.readFileSync(path.join(appRoot, 'src/agent/localCliRun.ts'), 'utf8')
  assert.match(cli, /evaluateCliSandboxGate/)
  assert.match(cli, /isolationStatus/)
})

console.log(`\n${passed} tests passed`)
