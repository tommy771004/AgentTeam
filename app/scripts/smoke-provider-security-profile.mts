/**
 * Provider Security Profile — ticket 02 pure-module smoke.
 * Seams: connection identity, monotonic merge, bootstrap, malformed isolation.
 * Run: node --experimental-strip-types scripts/smoke-provider-security-profile.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  connectionIdForBuiltinLlm,
  connectionIdForCliProvider,
} from '../src/agent/outbound/providerConnectionId.ts'
import {
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy,
  validateCompanyBasePolicy,
  validateProviderSupplementalPolicy,
  type CompanyBasePolicy,
  type ProviderSupplementalPolicy,
} from '../src/agent/outbound/policySchema.ts'
import { compileProviderSecurityProfile, mergePolicyMonotonic } from '../src/agent/outbound/policyMerge.ts'
import {
  ensureLocalPolicyTree,
  loadProviderSecurityProfile,
  resolvePolicyDir,
} from '../src/agent/outbound/policyStore.ts'
import { parsePolicySourceMode } from '../src/agent/outbound/policySourceMode.ts'

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

console.log('smoke-provider-security-profile')

await test('connection IDs: same brand different endpoints stay distinct; stable for same input', () => {
  const a = connectionIdForBuiltinLlm({
    apiProvider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
  })
  const b = connectionIdForBuiltinLlm({
    apiProvider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
  })
  const c = connectionIdForBuiltinLlm({
    apiProvider: 'openai',
    baseUrl: 'https://gateway.example.com/v1',
  })
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.match(a, /^llm:/)
  const cliA = connectionIdForCliProvider({ id: 'codex' })
  const cliB = connectionIdForCliProvider({ id: 'claude' })
  assert.notEqual(cliA, cliB)
  assert.match(cliA, /^cli:/)
})

await test('policy source mode: local|workspace only; no implicit auto', () => {
  assert.equal(parsePolicySourceMode(undefined), 'local')
  assert.equal(parsePolicySourceMode('local'), 'local')
  assert.equal(parsePolicySourceMode('workspace'), 'workspace')
  assert.throws(() => parsePolicySourceMode('auto'), /SUBAGENTS_POLICY_SOURCE/)
  assert.throws(() => parsePolicySourceMode('remote'), /SUBAGENTS_POLICY_SOURCE/)
})

await test('monotonic merge: supplement can only add/tighten; relax fails', () => {
  const base = structuredClone(BUILTIN_BASELINE_POLICY) as CompanyBasePolicy
  const okSupp: ProviderSupplementalPolicy = {
    ...emptySupplementalPolicy('llm:test'),
    version: 1,
    extraDetectors: [{ id: 'company.project-codename', pattern: 'PROJECT-X' }],
    denyImageVision: true,
  }
  const merged = mergePolicyMonotonic(base, okSupp)
  assert.ok(merged.detectors.some((d) => d.id === 'company.project-codename'))
  assert.equal(merged.denyImageVision, true)

  const relax: ProviderSupplementalPolicy = {
    ...emptySupplementalPolicy('llm:test'),
    version: 1,
    // attempt to disable baseline detectors — must fail validation/merge
    disabledBaselineDetectorIds: ['baseline.api-key'],
  }
  assert.throws(() => mergePolicyMonotonic(base, relax), /tighten|weaken|relax|baseline/i)
})

await test('bootstrap: missing base + supplement created atomically under policy dir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odg-policy-'))
  try {
    const conn = connectionIdForBuiltinLlm({
      apiProvider: 'custom',
      baseUrl: 'https://example.test/v1',
    })
    const profile = await ensureLocalPolicyTree(dir, conn)
    assert.equal(profile.ok, true)
    if (!profile.ok) return
    assert.ok(fs.existsSync(path.join(dir, 'company-base.json')))
    assert.ok(fs.existsSync(path.join(dir, 'providers', `${conn.replace(/[/:]/g, '_')}.json`)))
    assert.equal(profile.profile.connectionId, conn)
    assert.ok(profile.profile.baseVersion >= 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await test('malformed base: preserved on disk; only that connection blocked', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odg-policy-bad-'))
  try {
    fs.writeFileSync(path.join(dir, 'company-base.json'), '{not-json', 'utf8')
    const conn = 'llm:bad-base'
    const r = await loadProviderSecurityProfile({
      policyDir: dir,
      connectionId: conn,
      policySource: 'local',
    })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.reason, /malformed|invalid|parse/i)
    // file preserved
    assert.equal(fs.readFileSync(path.join(dir, 'company-base.json'), 'utf8'), '{not-json')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await test('two connections: separate profiles and supplemental files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odg-policy-iso-'))
  try {
    const a = connectionIdForBuiltinLlm({ apiProvider: 'openai', baseUrl: 'https://a.example/v1' })
    const b = connectionIdForBuiltinLlm({ apiProvider: 'openai', baseUrl: 'https://b.example/v1' })
    const pa = await ensureLocalPolicyTree(dir, a)
    const pb = await ensureLocalPolicyTree(dir, b)
    assert.equal(pa.ok && pb.ok, true)
    if (!pa.ok || !pb.ok) return
    assert.notEqual(pa.profile.connectionId, pb.profile.connectionId)
    const files = fs.readdirSync(path.join(dir, 'providers'))
    assert.ok(files.length >= 2)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await test('resolvePolicyDir honors SUBAGENTS_OUTBOUND_POLICY_DIR', () => {
  const custom = path.join(os.tmpdir(), 'company-odg-policy')
  const resolved = resolvePolicyDir({ SUBAGENTS_OUTBOUND_POLICY_DIR: custom }, '/default/userData')
  assert.equal(resolved, custom)
  const fallback = resolvePolicyDir({}, '/default/userData')
  assert.equal(fallback, path.join('/default/userData', 'outbound-policy'))
})

await test('compileProviderSecurityProfile is pure + schema-validated', () => {
  const base = validateCompanyBasePolicy(BUILTIN_BASELINE_POLICY)
  const supp = validateProviderSupplementalPolicy(emptySupplementalPolicy('llm:x'))
  const profile = compileProviderSecurityProfile(base, supp)
  assert.equal(profile.connectionId, 'llm:x')
  assert.ok(profile.detectors.length >= 1)
})

console.log(`\n${passed} tests passed`)
