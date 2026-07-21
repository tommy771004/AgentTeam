/**
 * Issue 07 — Free Core entitlement boundary smoke.
 *
 * Pure-logic contract for the single entitlement decision point, plus
 * source drift guards proving the runtime (capabilities) and UI (Settings)
 * seams route through it instead of scattered feature flags.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveEntitlement, isFeatureEntitled, isCapabilityEntitled, isFailClosed } from '../src/agent/entitlement.ts'
import { redactSettingsForExport } from '../src/agent/settingsExport.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.join(appRoot, rel), 'utf8')

// ── 1. App works fully with no entitlement data at all (Free Core) ──
{
  const snap = resolveEntitlement(undefined)
  assert.equal(snap.tier, 'free')
  assert.equal(snap.grantedFeatures.size, 0)
  assert.equal(snap.source, 'none')
  // Free Core never calls isFeatureEntitled, but if something did, it must be false, not throw.
  assert.equal(isFeatureEntitled(snap, 'anything'), false)
}
{
  const snap = resolveEntitlement(null)
  assert.equal(snap.tier, 'free')
  assert.equal(snap.source, 'none')
}

// ── 2. Single entitlement boundary: valid payload resolves paid + granted features ──
{
  const snap = resolveEntitlement({ tier: 'paid', grantedFeatures: ['pro-x'] })
  assert.equal(snap.tier, 'paid')
  assert.equal(snap.source, 'valid')
  assert.equal(isFailClosed(snap), false)
  assert.equal(isFeatureEntitled(snap, 'pro-x'), true)
  assert.equal(isFeatureEntitled(snap, 'pro-y'), false)
}

// ── 3. Malformed / unavailable entitlement fails closed for paid features only ──
for (const malformed of ['not-an-object', 42, { tier: 'paid' }, { tier: 'paid', grantedFeatures: 'nope' }, { tier: 'paid', grantedFeatures: [1, 2] }]) {
  const snap = resolveEntitlement(malformed)
  assert.equal(snap.tier, 'free', `malformed payload must fail closed to free: ${JSON.stringify(malformed)}`)
  assert.equal(isFailClosed(snap), true)
  assert.ok(snap.reason && snap.reason.length > 0, 'fail-closed snapshot should explain why')
  assert.equal(isFeatureEntitled(snap, 'pro-x'), false)
}
{
  // Expired grant fails closed too.
  const snap = resolveEntitlement({ tier: 'paid', grantedFeatures: ['pro-x'], expiresAt: '2000-01-01T00:00:00.000Z' })
  assert.equal(snap.tier, 'free')
  assert.equal(snap.source, 'expired')
  assert.equal(isFeatureEntitled(snap, 'pro-x'), false)
}
{
  // Unresolvable expiresAt is malformed, not silently ignored.
  const snap = resolveEntitlement({ tier: 'paid', grantedFeatures: ['pro-x'], expiresAt: 'not-a-date' })
  assert.equal(snap.tier, 'free')
  assert.equal(snap.source, 'malformed')
}
{
  // Not-yet-expired grant stays paid.
  const future = new Date(Date.now() + 86_400_000).toISOString()
  const snap = resolveEntitlement({ tier: 'paid', grantedFeatures: ['pro-x'], expiresAt: future })
  assert.equal(snap.tier, 'paid')
  assert.equal(isFeatureEntitled(snap, 'pro-x'), true)
}

// ── 4. Runtime seam: the gating predicate capabilities/runtime.ts uses ──
{
  // Free Core capabilities (no requiresEntitlement) are unaffected by any entitlement state.
  assert.equal(isCapabilityEntitled(resolveEntitlement(undefined), undefined), true)
  assert.equal(isCapabilityEntitled(resolveEntitlement('garbage'), undefined), true)

  const free = resolveEntitlement(undefined)
  const paid = resolveEntitlement({ tier: 'paid', grantedFeatures: ['pro-x'] })
  assert.equal(isCapabilityEntitled(free, 'pro-x'), false, 'free snapshot must not entitle a paid-only capability')
  assert.equal(isCapabilityEntitled(paid, 'pro-x'), true, 'paid snapshot with matching grant must entitle the capability')
  assert.equal(isCapabilityEntitled(paid, 'pro-y'), false, 'paid snapshot without the specific grant must not entitle it')
}

// ── 5. Existing local data remains readable/exportable regardless of entitlement state ──
{
  const settings = { apiKey: 'sk-should-be-redacted', model: 'gpt-4', enabled: true }
  // redaction must not consult entitlement at all — same shape whether free, paid, or malformed.
  const a = redactSettingsForExport(settings)
  const b = redactSettingsForExport(settings)
  assert.deepEqual(a.settings, b.settings)
  assert.ok(a.redactedFields.includes('apiKey'))
  assert.ok(!JSON.stringify(a.settings).includes('sk-should-be-redacted'))
}
assert.ok(!read('src/agent/settingsExport.ts').includes('entitlement'), 'export/redaction must stay entitlement-agnostic (fails open for data, never gated)')

// ── 6. Source drift guards: runtime + UI seams actually wire through entitlement.ts ──
const runtimeSrc = read('src/agent/capabilities/runtime.ts')
assert.ok(
  runtimeSrc.includes("from '../entitlement'") || runtimeSrc.includes("from '../entitlement.ts'"),
  'capabilities/runtime.ts must import the single entitlement boundary',
)
assert.ok(runtimeSrc.includes('isCapabilityEntitled'), 'assembleCapabilities must gate through isCapabilityEntitled, not a reimplemented check')
assert.ok(runtimeSrc.includes('requiresEntitlement'), 'assembleCapabilities must gate on AgentCapability.requiresEntitlement')

const typesSrc = read('src/agent/capabilities/types.ts')
assert.ok(typesSrc.includes('requiresEntitlement'), 'AgentCapability must declare requiresEntitlement seam for future paid capabilities')

const settingsPageSrc = read('src/pages/SettingsPage.tsx')
assert.ok(settingsPageSrc.includes('useEntitlementStore'), 'SettingsPage must surface plan/tier via the entitlement store (UI seam)')
assert.ok(settingsPageSrc.includes('Free Core') || settingsPageSrc.includes('免費核心'), 'SettingsPage must label the free tier for users')

// ── 7. Store: one runtime decision point consumable by UI/engine, unaffected by missing data ──
const storeSrc = read('src/store/entitlementStore.ts')
assert.ok(storeSrc.includes('resolveEntitlement'), 'entitlementStore must resolve through the shared boundary, not reimplement logic')
assert.ok(storeSrc.includes('isEntitled'), 'entitlementStore must expose a single isEntitled(featureId) check')

// ── 8. Issue 11 — subscription store is the only entitlement writer; entitlement store is derived ──
const subscriptionStoreSrc = read('src/store/subscriptionStore.ts')
assert.ok(
  subscriptionStoreSrc.includes('recomputeEntitlement'),
  'subscriptionStore must own entitlement projection (recomputeEntitlement)',
)
assert.ok(
  !/localStorage\.(setItem|getItem)\(['"]subagents:entitlement['"]\)/.test(storeSrc)
    || /legacyMigrated|legacy|readLegacyRawEntitlement/.test(storeSrc),
  'entitlementStore must not write to subagents:entitlement; only legacy migration read is allowed',
)
assert.ok(
  !/\brefresh:\s*\(raw\)/.test(storeSrc),
  'entitlementStore must not own a refresh(raw) writer — subscriptionStore owns lifecycle',
)
assert.ok(
  /useSubscriptionStore\.subscribe|useSubscriptionStore\.getState/.test(storeSrc),
  'entitlementStore must derive from subscriptionStore (subscribe or getState), not maintain its own snapshot',
)

console.log('Entitlement boundary smoke: 8 groups passed')
