/**
 * Smoke: First contract-driven pipeline Task run (03)
 * Validates fake provider contract: availability, timeout, cancel, evidence guard,
 * DoD separation, and targeted cancel semantics.
 *
 * Run: node --experimental-strip-types scripts/smoke-open-design-pipeline.mts
 */
import assert from 'node:assert/strict'
import { createFakePipelineProvider } from '../src/agent/openDesign/fakePipelineProvider.ts'
import { rejectModelAttestedEvidence, checkOutputBudget } from '../src/agent/openDesign/providerContract.ts'
import { isProviderSuccessNotDodMet } from '../src/agent/openDesign/pipelineStageState.ts'

let passed = 0, total = 0
async function test(name: string, fn: () => Promise<void> | void) {
  total++
  try { await fn(); passed++; console.log(`  ✓ ${name}`) } catch (e) { console.error(`  ✗ ${name}`); console.error(e); process.exitCode = 1 }
}
console.log('smoke-open-design-pipeline')

await test('coordinator admission: Pi Core ownership — renderer never starts provider directly', async () => {
  // Static drift guard: provider modules must not import runTask dispatch bypass
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const providerSrc = fs.readFileSync(path.join(root, 'src/agent/openDesign/fakePipelineProvider.ts'), 'utf8')
  assert.doesNotMatch(providerSrc, /dispatchThreadTask|startExecution/)
  const contractSrc = fs.readFileSync(path.join(root, 'src/agent/openDesign/providerContract.ts'), 'utf8')
  assert.match(contractSrc, /ProviderHandle|ProviderEvidence/)
})

await test('fake provider availability returns true', async () => {
  const p = createFakePipelineProvider()
  const av = await p.checkAvailability()
  assert.equal(av.available, true)
})

await test('success path produces project-relative evidence & artifact locators', async () => {
  const p = createFakePipelineProvider()
  const ctrl = new AbortController()
  const sess = p.execute({ stageId: 'compose' }, { runId: 'run_001', stageId: 'compose', timeoutMs: 2000, outputBudgetBytes: 1024*10, signal: ctrl.signal })
  const receipt = await sess.promise
  assert.equal(receipt.kind, 'success')
  assert.ok(receipt.evidenceLocator?.startsWith('evidence/run_001'))
  assert.ok(receipt.artifactLocator?.startsWith('artifacts/run_001'))
  assert.equal(sess.evidence.length, 1)
  assert.equal(sess.evidence[0].adapterIssued, true)
})

await test('provider success != DoD met', () => {
  assert.equal(isProviderSuccessNotDodMet('success', false), true)
  assert.equal(isProviderSuccessNotDodMet('success', undefined), true)
  assert.equal(isProviderSuccessNotDodMet('success', true), false)
})

await test('model text cannot create accepted evidence', () => {
  const fake = { evidenceId: 'x', runId: 'r', stageId: 's', providerId: 'fake-pipeline', summary: 'model claimed', adapterIssued: false }
  const r = rejectModelAttestedEvidence(fake)
  assert.equal(r.accepted, false)
  const good = { evidenceId: 'y', runId: 'r', stageId: 's', providerId: 'fake-pipeline', summary: 'ok', kind: 'execution', capturedAt: new Date().toISOString(), adapterIssued: true as const }
  const r2 = rejectModelAttestedEvidence(good)
  assert.equal(r2.accepted, true)
})

await test('provider timeout produces blocked', async () => {
  const p = createFakePipelineProvider()
  const ctrl = new AbortController()
  const sess = p.execute({ stageId: 'compose' }, { runId: 'run_t', stageId: 'compose', timeoutMs: 1, outputBudgetBytes: 1024*10, signal: ctrl.signal })
  const receipt = await sess.promise
  assert.equal(receipt.kind, 'blocked')
})

await test('targeted cancel by run identity stops provider and late event stays cancelled', async () => {
  const p = createFakePipelineProvider()
  const ctrl = new AbortController()
  const sess = p.execute({ stageId: 'compose' }, { runId: 'run_cancel', stageId: 'compose', timeoutMs: 5000, outputBudgetBytes: 1024*10, signal: ctrl.signal })
  // Cancel via handle
  const c = await sess.handle.cancel()
  assert.equal(c.cancelled, true)
  const receipt = await sess.promise
  assert.equal(receipt.kind, 'cancelled')
  // Late cancel of same run should not resurrect
  const late = await p.cancel('run_cancel')
  assert.equal(late.cancelled, false) // already gone
})

await test('output budget truncation', () => {
  const big = 'x'.repeat(1000)
  const r = checkOutputBudget(big, 100)
  assert.equal(r.ok, false)
  assert.ok(r.truncated!.includes('truncated'))
})

await test('failure / blocked have distinct receipts', async () => {
  const p = createFakePipelineProvider()
  const ctrl = new AbortController()
  const fail = await p.execute({ stageId: 'fail' }, { runId: 'r1', stageId: 'fail', timeoutMs: 2000, outputBudgetBytes: 10000, signal: ctrl.signal }).promise
  assert.equal(fail.kind, 'failure')
  const blocked = await p.execute({ stageId: 'blocked' }, { runId: 'r2', stageId: 'blocked', timeoutMs: 2000, outputBudgetBytes: 10000, signal: ctrl.signal }).promise
  assert.equal(blocked.kind, 'blocked')
})

console.log(`\n${passed}/${total} tests passed`)
if (process.exitCode) console.error('Smoke failed'); else console.log('OK')
