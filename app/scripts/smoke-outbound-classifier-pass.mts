import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runClassifierPass } from '../src/agent/outbound/classifierPass.ts'

/**
 * Issue 21 — the company classifier reaches the real outbound path.
 *
 * `companyClassifier.ts` shipped with a smoke and a Settings "test connection"
 * button, and nothing else ever called it: configuring an endpoint changed
 * exactly nothing about what left the machine. These assertions are about the
 * pass that fixed that, and above all about its failure posture — a classifier
 * that cannot answer must not be read as "safe to send".
 */

let passed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

console.log('smoke-outbound-classifier-pass')

const okResponse = (exclusions: unknown[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ exclusions }),
  text: async () => JSON.stringify({ exclusions }),
}) as unknown as Response

const files = [{ relPath: 'a.ts', text: 'line1\nline2\nline3\n' }]

await test('no endpoint means the pass does not run at all', async () => {
  const outcome = await runClassifierPass({
    effectiveMode: 'required', connectionId: 'c', files,
    applyExclusions: () => assert.fail('nothing may be excluded when no classifier is configured'),
  })
  assert.deepEqual(outcome, { status: 'not-configured' })
})

await test('guard off means the classifier never runs, even if configured', async () => {
  const outcome = await runClassifierPass({
    endpointUrl: 'https://classify.test/v1', effectiveMode: 'off', connectionId: 'c', files,
    applyExclusions: () => assert.fail('off must not contact the endpoint'),
    fetchImpl: (() => assert.fail('off must not contact the endpoint')) as unknown as typeof fetch,
  })
  assert.equal(outcome.status, 'not-configured')
})

await test('what the classifier returns is excluded from what is sent', async () => {
  const applied: Array<{ relPath: string; ranges: number }> = []
  const outcome = await runClassifierPass({
    endpointUrl: 'https://classify.test/v1', effectiveMode: 'required', connectionId: 'c', files,
    applyExclusions: (relPath, added) => applied.push({ relPath, ranges: added.length }),
    fetchImpl: (async () => okResponse([{ startLine: 2, endLine: 2, label: 'secret' }])) as unknown as typeof fetch,
  })
  assert.equal(outcome.status, 'applied')
  assert.deepEqual(applied, [{ relPath: 'a.ts', ranges: 1 }])
})

await test('under `required`, a classifier that cannot answer BLOCKS', async () => {
  // The point of the whole feature: "we could not check" is not evidence that
  // the content is safe to send. A partial classification would let exactly
  // the unchecked file through, which is why one failure stops the run.
  const outcome = await runClassifierPass({
    endpointUrl: 'https://classify.test/v1', effectiveMode: 'required', connectionId: 'c', files,
    applyExclusions: () => assert.fail('a blocked pass excludes nothing because nothing is sent'),
    fetchImpl: (async () => { throw new Error('connection refused') }) as unknown as typeof fetch,
  })
  assert.equal(outcome.status, 'blocked')
  assert.match((outcome as { reason: string }).reason, /a\.ts/, 'the refusal names the file it could not classify')
})

await test('under `optional` the same failure degrades, and says so', async () => {
  const outcome = await runClassifierPass({
    endpointUrl: 'https://classify.test/v1', effectiveMode: 'optional', connectionId: 'c', files,
    applyExclusions: () => undefined,
    fetchImpl: (async () => { throw new Error('connection refused') }) as unknown as typeof fetch,
  })
  assert.equal(outcome.status, 'degraded', 'optional keeps the ADR-0047 degrade-with-a-mark posture')
  assert.match((outcome as { reason: string }).reason, /connection refused/)
})

await test('plaintext HTTP is refused unless explicitly approved', async () => {
  const denied = await runClassifierPass({
    endpointUrl: 'http://classify.test/v1', effectiveMode: 'required', connectionId: 'c', files,
    applyExclusions: () => assert.fail('an unapproved plaintext endpoint is never contacted'),
  })
  assert.equal(denied.status, 'blocked', 'plaintext without approval fails closed under required')

  const approved = await runClassifierPass({
    endpointUrl: 'http://classify.test/v1', allowPlaintextHttp: true,
    effectiveMode: 'required', connectionId: 'c', files,
    applyExclusions: () => undefined,
    fetchImpl: (async () => okResponse([])) as unknown as typeof fetch,
  })
  assert.equal(approved.status, 'applied', 'company-approved plaintext is allowed, and recorded as http')
  assert.equal((approved as { transport: string }).transport, 'http')
})

await test('the classifier sees sanitized text, never the original', () => {
  // Structural: the pass takes `files` already carrying sanitized text and has
  // no access to the originals, so raw content cannot be sent to a third party
  // to ask whether it is safe to send.
  const source = readFileSync(new URL('../src/agent/outbound/sanitizedWorkspace.ts', import.meta.url), 'utf8')
  assert.match(source, /initialSanitizedText/, 'the pass is fed the sanitized text')
  const passAt = source.indexOf('runClassifierPass(')
  const writeAt = source.indexOf('fs.writeFileSync(dest, sanitized.text')
  assert.ok(writeAt !== -1 && passAt > writeAt, 'local sanitization happens before the classifier is consulted')
})

console.log(`\n${passed} tests passed`)
