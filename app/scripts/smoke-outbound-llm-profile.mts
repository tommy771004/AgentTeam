/**
 * Ticket 19 — LLM egress uses company Provider Security Profile.
 * Seam: resolveLlmEgressProfile + prepareLlmEgressMessages.
 * Run: node --experimental-strip-types scripts/smoke-outbound-llm-profile.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveLlmEgressProfile,
  prepareLlmEgressMessages,
} from '../src/agent/outbound/llmEgress.ts'
import {
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy,
  type CompanyBasePolicy,
} from '../src/agent/outbound/policySchema.ts'
import { compileProviderSecurityProfile } from '../src/agent/outbound/policyMerge.ts'
import { PROTECTED_EXCLUSION_MARKER } from '../src/agent/outbound/textSanitize.ts'

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

console.log('smoke-outbound-llm-profile')

const baseline = compileProviderSecurityProfile(
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy('llm:ticket19'),
)

/** Company base with an extra detector that baseline does not have. */
const companyWithExtra: CompanyBasePolicy = {
  ...BUILTIN_BASELINE_POLICY,
  version: 2,
  changeId: 'company-extra-1',
  detectors: [
    ...BUILTIN_BASELINE_POLICY.detectors,
    {
      id: 'company.project-codename',
      pattern: 'PROJECT_CODENAME_NEVER_LEAVE_\\w+',
      description: 'Company-only secret codename',
    },
  ],
  baselineDetectorIds: [...BUILTIN_BASELINE_POLICY.baselineDetectorIds],
}
const companyProfile = compileProviderSecurityProfile(
  companyWithExtra,
  emptySupplementalPolicy('llm:ticket19'),
)

const SECRET = 'PROJECT_CODENAME_NEVER_LEAVE_ZEUS99'

await test('resolve: company load ok → use company profile', () => {
  const r = resolveLlmEgressProfile({
    effectiveMode: 'required',
    loaded: { ok: true, profile: companyProfile },
    baselineProfile: baseline,
  })
  assert.equal(r.action, 'use')
  if (r.action === 'use') {
    assert.equal(r.source, 'company')
    assert.ok(r.profile.detectors.some((d) => d.id === 'company.project-codename'))
  }
})

await test('resolve: required + load fail → block (no silent baseline)', () => {
  const r = resolveLlmEgressProfile({
    effectiveMode: 'required',
    loaded: { ok: false, reason: 'malformed company-base' },
    baselineProfile: baseline,
  })
  assert.equal(r.action, 'block')
})

await test('resolve: optional + load fail → baseline degraded', () => {
  const r = resolveLlmEgressProfile({
    effectiveMode: 'optional',
    loaded: { ok: false, reason: 'missing' },
    baselineProfile: baseline,
  })
  assert.equal(r.action, 'use')
  if (r.action === 'use') {
    assert.equal(r.source, 'baseline')
    assert.equal(r.degraded, true)
  }
})

await test('resolve: no load attempt → baseline floor (browser / no IPC)', () => {
  const r = resolveLlmEgressProfile({
    effectiveMode: 'required',
    loaded: null,
    baselineProfile: baseline,
  })
  assert.equal(r.action, 'use')
  if (r.action === 'use') assert.equal(r.source, 'baseline')
})

await test('prepare: company profile redacts company-only secret; baseline alone does not', async () => {
  const messages = [{ role: 'user', content: `see ${SECRET} in docs` }]

  const withCompany = await prepareLlmEgressMessages({
    effectiveMode: 'required',
    messages,
    baselineProfile: baseline,
    loadCompanyProfile: async () => ({ ok: true, profile: companyProfile }),
  })
  assert.equal(withCompany.ok, true)
  if (withCompany.ok) {
    assert.equal(withCompany.source, 'company')
    const text = withCompany.messages.map((m) => m.content).join('\n')
    assert.ok(!text.includes(SECRET), 'company profile must redact codename')
    assert.match(text, new RegExp(PROTECTED_EXCLUSION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  const baselineOnly = await prepareLlmEgressMessages({
    effectiveMode: 'required',
    messages,
    baselineProfile: baseline,
    loadCompanyProfile: async () => null, // no IPC → baseline floor
  })
  assert.equal(baselineOnly.ok, true)
  if (baselineOnly.ok) {
    // Documents gap that company load must fill — baseline does not know codename
    const text = baselineOnly.messages.map((m) => m.content).join('\n')
    assert.ok(text.includes(SECRET), 'baseline alone leaves company-only secret (contrast)')
  }
})

await test('prepare: required + load fail blocks egress', async () => {
  const r = await prepareLlmEgressMessages({
    effectiveMode: 'required',
    messages: [{ role: 'user', content: 'hi' }],
    baselineProfile: baseline,
    loadCompanyProfile: async () => ({ ok: false, reason: 'malformed company-base' }),
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.reason, /malformed|company/i)
})

await test('prepare: multi-round uses same loader profile (stable source)', async () => {
  let loads = 0
  const load = async () => {
    loads++
    return { ok: true as const, profile: companyProfile }
  }
  for (let i = 0; i < 2; i++) {
    const r = await prepareLlmEgressMessages({
      effectiveMode: 'optional',
      messages: [{ role: 'user', content: `round ${i} ${SECRET}` }],
      baselineProfile: baseline,
      loadCompanyProfile: load,
      cacheKey: 'run_multi_1:llm:ticket19',
    })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.source, 'company')
      assert.ok(!r.messages.some((m) => m.content.includes(SECRET)))
    }
  }
  // cache should avoid re-load on second round
  assert.equal(loads, 1)
})

await test('wiring: llm.ts uses prepareLlmEgressMessages + company IPC loader', () => {
  const t = fs.readFileSync(path.join(appRoot, 'src/agent/llm.ts'), 'utf8')
  assert.match(t, /prepareLlmEgressMessages/)
  assert.match(t, /loadCompanyProfileViaOutboundIpc/)
  // baseline remains as irreducible floor input only — company load is required path
  assert.match(t, /baselineProfile/)
  assert.match(t, /loadCompanyProfile:/)
})

console.log(`\n${passed} tests passed`)
