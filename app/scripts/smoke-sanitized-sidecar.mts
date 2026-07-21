/**
 * PDF/Office Sanitized Sidecar — ticket 07.
 * Seam: classifyNonTextForAi / buildSanitizedSidecar (never returns original binary).
 * Run: node --experimental-strip-types scripts/smoke-sanitized-sidecar.mts
 */
import assert from 'node:assert/strict'
import {
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy,
} from '../src/agent/outbound/policySchema.ts'
import { compileProviderSecurityProfile } from '../src/agent/outbound/policyMerge.ts'
import {
  buildSanitizedSidecar,
  classifyNonTextForAi,
  isSidecarWritebackAllowed,
} from '../src/agent/outbound/sanitizedSidecar.ts'
import { PROTECTED_EXCLUSION_MARKER } from '../src/agent/outbound/textSanitize.ts'

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

console.log('smoke-sanitized-sidecar')

const profile = compileProviderSecurityProfile(
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy('llm:side'),
)

await test('classify: pdf/office → sidecar; image → deny; zip/sqlite → unavailable', () => {
  assert.equal(classifyNonTextForAi('docs/a.pdf').kind, 'sidecar-candidate')
  assert.equal(classifyNonTextForAi('x.docx').kind, 'sidecar-candidate')
  assert.equal(classifyNonTextForAi('x.xlsx').kind, 'sidecar-candidate')
  assert.equal(classifyNonTextForAi('x.pptx').kind, 'sidecar-candidate')
  assert.equal(classifyNonTextForAi('shot.png').kind, 'image')
  assert.equal(classifyNonTextForAi('db.sqlite').kind, 'unavailable')
  assert.equal(classifyNonTextForAi('pack.zip').kind, 'unavailable')
})

await test('PDF synthetic fixture: secrets redacted; page locators; no binary in result', () => {
  const fixture = [
    '%%PDF-1.4 synthetic',
    '[[page:1]]',
    'Hello world',
    'api_key: sk-PDF-SECRET',
    '[[page:2]]',
    'safe tail',
  ].join('\n')
  const r = buildSanitizedSidecar({
    relPath: 'docs/spec.pdf',
    bytes: Buffer.from(fixture, 'utf8'),
    profile,
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.kind, 'sidecar')
  assert.equal(r.format, 'pdf')
  assert.equal(r.originalImmutable, true)
  assert.doesNotMatch(r.markdown, /sk-PDF-SECRET/)
  assert.match(r.markdown, new RegExp(PROTECTED_EXCLUSION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.ok(r.locators.some((l) => l.page === 1 || l.page === 2))
  assert.ok(!('bytes' in r) && !('binary' in r))
  assert.equal(isSidecarWritebackAllowed(r), false)
})

await test('Office sheet fixture uses sheet/cell locators', () => {
  const fixture = [
    '[[sheet:Budget]]',
    '[[cell:A1]] Total',
    '[[cell:B1]] password=office-secret-99',
  ].join('\n')
  const r = buildSanitizedSidecar({
    relPath: 'fin.xlsx',
    bytes: Buffer.from(fixture, 'utf8'),
    profile,
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.format, 'xlsx')
  assert.doesNotMatch(r.markdown, /office-secret-99/)
  assert.ok(r.locators.some((l) => l.sheet === 'Budget'))
})

await test('image is whole-file exclusion; never decodes', () => {
  const r = buildSanitizedSidecar({
    relPath: 'id.png',
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    profile,
  })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.kind, 'unavailable')
  assert.match(r.reason, /image|vision|deny/i)
})

await test('parser failure does not return original binary', () => {
  const r = buildSanitizedSidecar({
    relPath: 'weird.pdf',
    bytes: Buffer.from([0, 1, 2, 3, 4, 5, 255]),
    profile,
  })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.reason, /unavailable|parse|extract/i)
  assert.ok(!('bytes' in r))
})

await test('evidence metadata has filename + locators only (no extracted secret)', () => {
  const fixture = '[[page:1]]\napi_key: sk-EVID-1\n'
  const r = buildSanitizedSidecar({
    relPath: 'a.pdf',
    bytes: Buffer.from(fixture, 'utf8'),
    profile,
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  const meta = JSON.stringify(r.evidence)
  assert.doesNotMatch(meta, /sk-EVID/)
  assert.match(meta, /a\.pdf/)
})

console.log(`\n${passed} tests passed`)
