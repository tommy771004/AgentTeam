/**
 * Text sanitization at LLM egress — ticket 03.
 * Seam: sanitizeTextWithProfile / sanitizeChatMessages; negative scan of payload.
 * Run: node --experimental-strip-types scripts/smoke-text-sanitize.mts
 */
import assert from 'node:assert/strict'
import {
  PROTECTED_EXCLUSION_MARKER,
  sanitizeChatMessages,
  sanitizeTextWithProfile,
} from '../src/agent/outbound/textSanitize.ts'
import {
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy,
} from '../src/agent/outbound/policySchema.ts'
import { compileProviderSecurityProfile } from '../src/agent/outbound/policyMerge.ts'
import { inspectOutbound } from '../src/agent/outbound/outboundGate.ts'

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

console.log('smoke-text-sanitize')

const profile = compileProviderSecurityProfile(
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy('llm:test'),
)

await test('baseline redacts API key / password / private key material', () => {
  const raw = [
    'hello',
    'api_key: sk-live-ABCDEFG1234567890',
    'password = hunter2secret',
    '-----BEGIN PRIVATE KEY-----',
    'MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC',
    '-----END PRIVATE KEY-----',
    'safe trailing',
  ].join('\n')
  const r = sanitizeTextWithProfile(raw, profile, { source: 'prompt' })
  assert.ok(r.text.includes(PROTECTED_EXCLUSION_MARKER))
  assert.doesNotMatch(r.text, /sk-live-ABCDEFG/)
  assert.doesNotMatch(r.text, /hunter2secret/)
  assert.doesNotMatch(r.text, /BEGIN PRIVATE KEY/)
  assert.match(r.text, /hello/)
  assert.match(r.text, /safe trailing/)
  assert.ok(r.exclusions.length >= 1)
  assert.ok(r.exclusions.every((e) => e.source === 'prompt' && e.startLine >= 1))
})

await test('baseline redacts email and TW phone patterns', () => {
  const raw = 'contact me@corp.example.com or +886-912-345-678 please'
  const r = sanitizeTextWithProfile(raw, profile, { source: 'history' })
  assert.doesNotMatch(r.text, /me@corp\.example\.com/)
  assert.doesNotMatch(r.text, /912-345-678/)
  assert.match(r.text, /contact/)
  assert.match(r.text, /please/)
})

await test('safe text is unchanged when no match', () => {
  const raw = 'Refactor the scheduler queue to use FIFO ordering.'
  const r = sanitizeTextWithProfile(raw, profile, { source: 'tool_result' })
  assert.equal(r.text, raw)
  assert.equal(r.exclusions.length, 0)
})

await test('sanitizeChatMessages covers system/user/assistant/tool roles', () => {
  const messages = [
    { role: 'system', content: 'You are helpful. api_key=sk-SYS-111' },
    { role: 'user', content: 'password: s3cret-user' },
    { role: 'assistant', content: 'ok' },
    { role: 'tool', content: 'AKIAIOSFODNN7EXAMPLE output' },
  ]
  const out = sanitizeChatMessages(messages, profile)
  const joined = out.messages.map((m) => m.content).join('\n')
  assert.doesNotMatch(joined, /sk-SYS-111/)
  assert.doesNotMatch(joined, /s3cret-user/)
  assert.doesNotMatch(joined, /AKIAIOSFODNN7EXAMPLE/)
  assert.ok(out.exclusions.length >= 2)
})

await test('company extra detector from profile is applied', () => {
  const company = compileProviderSecurityProfile(BUILTIN_BASELINE_POLICY, {
    ...emptySupplementalPolicy('llm:test'),
    extraDetectors: [{ id: 'company.codename', pattern: 'PROJECT-XRAY', flags: 'i' }],
  })
  const r = sanitizeTextWithProfile('Discuss PROJECT-XRAY status', company, {
    source: 'prompt',
  })
  assert.doesNotMatch(r.text, /PROJECT-XRAY/i)
  assert.match(r.text, new RegExp(PROTECTED_EXCLUSION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

await test('inspectOutbound active mode can attach sanitized message payload', () => {
  // Contract for later wire: gate result keeps structure, no secret in payload after sanitize helper
  const body = {
    model: 'm',
    messages: [{ role: 'user', content: 'api_key: sk-OUT-999' }],
  }
  const sanitized = sanitizeChatMessages(body.messages, profile)
  const gate = inspectOutbound({
    channel: 'llm',
    payload: { ...body, messages: sanitized.messages },
    effectiveMode: 'required',
    buildFlavor: 'standard',
  })
  assert.equal(gate.action, 'allow')
  if (gate.action === 'allow') {
    const payload = JSON.stringify(gate.payload)
    assert.doesNotMatch(payload, /sk-OUT-999/)
  }
})

console.log(`\n${passed} tests passed`)
