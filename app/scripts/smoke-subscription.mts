/**
 * Issue 08 — 訂閱、裝置啟用與離線寬限 smoke.
 *
 * Pure-logic contract for pricing, device seat limits, offline grace,
 * explicit lifecycle transitions, content-free refresh requests, and
 * actionable failure messages — layered on top of the issue 07 entitlement
 * boundary (never reimplements it).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveEntitlement, isCapabilityEntitled, isFailClosed } from '../src/agent/entitlement.ts'
import { redactSettingsForExport } from '../src/agent/settingsExport.ts'
import {
  SUBSCRIPTION_PRICING,
  DEFAULT_MAX_DEVICES,
  DEFAULT_OFFLINE_GRACE_MS,
  DEFAULT_CHECK_IN_INTERVAL_MS,
  activateDevice,
  removeDevice,
  applyLifecycleEvent,
  isWithinOfflineGrace,
  resolveEntitlementWithGrace,
  buildEntitlementRefreshRequest,
  describeSubscriptionFailure,
  type SubscriptionState,
} from '../src/agent/subscription.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.join(appRoot, rel), 'utf8')

// ── 1. Pricing options are represented ──
assert.equal(SUBSCRIPTION_PRICING.monthly.usd, 9)
assert.equal(SUBSCRIPTION_PRICING.monthly.interval, 'month')
assert.equal(SUBSCRIPTION_PRICING.annual.usd, 90)
assert.equal(SUBSCRIPTION_PRICING.annual.interval, 'year')

// ── 2. Purchase activates entitlement for a bounded number of devices ──
{
  const base: SubscriptionState = { status: 'active', plan: 'monthly', devices: [], maxDevices: DEFAULT_MAX_DEVICES }
  let state = base
  for (let i = 0; i < DEFAULT_MAX_DEVICES; i += 1) {
    const r = activateDevice(state, { deviceId: `d${i}`, label: `Device ${i}`, activatedAt: new Date().toISOString() })
    assert.equal(r.ok, true, `device ${i} should activate within the seat limit`)
    state = r.ok ? r.state : state
  }
  assert.equal(state.devices.length, DEFAULT_MAX_DEVICES)
  const overLimit = activateDevice(state, { deviceId: 'one-too-many', label: 'x', activatedAt: new Date().toISOString() })
  assert.equal(overLimit.ok, false, 'activating beyond maxDevices must fail')
  assert.match(overLimit.ok ? '' : overLimit.error, /limit|上限/i)
  // Re-activating an already-registered device is idempotent, not a seat consumption.
  const again = activateDevice(state, { deviceId: 'd0', label: 'Device 0', activatedAt: new Date().toISOString() })
  assert.equal(again.ok, true)
  assert.equal(again.ok ? again.state.devices.length : -1, DEFAULT_MAX_DEVICES)

  const afterRemoval = removeDevice(state, 'd0')
  assert.equal(afterRemoval.devices.length, DEFAULT_MAX_DEVICES - 1)
  const reActivate = activateDevice(afterRemoval, { deviceId: 'new-device', label: 'y', activatedAt: new Date().toISOString() })
  assert.equal(reActivate.ok, true, 'freed seat must be usable again')
}

// ── 3. Refresh never uploads source/prompts/transcripts/Handoff content ──
{
  const req = buildEntitlementRefreshRequest({
    licenseId: 'lic_123',
    deviceId: 'dev_456',
    deviceSignature: 'sig_abc',
    appVersion: '1.0.0',
  })
  const keys = Object.keys(req).sort()
  assert.deepEqual(keys, ['appVersion', 'deviceId', 'deviceSignature', 'licenseId'].sort())
  const forbidden = /source|prompt|transcript|handoff|project|file.?content/i
  assert.ok(!forbidden.test(JSON.stringify(req)), 'refresh request must not carry any content field')
}

// ── 4. Offline grace permits local work during temporary network loss ──
{
  const now = Date.parse('2026-07-19T00:00:00.000Z')
  const justVerified = new Date(now - 1000).toISOString()
  assert.equal(isWithinOfflineGrace(justVerified, now, DEFAULT_CHECK_IN_INTERVAL_MS, DEFAULT_OFFLINE_GRACE_MS), true)

  const withinGrace = new Date(now - DEFAULT_CHECK_IN_INTERVAL_MS - DEFAULT_OFFLINE_GRACE_MS / 2).toISOString()
  assert.equal(isWithinOfflineGrace(withinGrace, now, DEFAULT_CHECK_IN_INTERVAL_MS, DEFAULT_OFFLINE_GRACE_MS), true)

  const beyondGrace = new Date(now - DEFAULT_CHECK_IN_INTERVAL_MS - DEFAULT_OFFLINE_GRACE_MS - 1000).toISOString()
  assert.equal(isWithinOfflineGrace(beyondGrace, now, DEFAULT_CHECK_IN_INTERVAL_MS, DEFAULT_OFFLINE_GRACE_MS), false)
  assert.equal(isWithinOfflineGrace(undefined, now, DEFAULT_CHECK_IN_INTERVAL_MS, DEFAULT_OFFLINE_GRACE_MS), false, 'never verified must not get grace')

  // resolveEntitlementWithGrace layers on issue 07's resolveEntitlement without reimplementing it.
  const paidRaw = { tier: 'paid', grantedFeatures: ['pro-x'] }
  const stillGraced = resolveEntitlementWithGrace({ raw: paidRaw, lastVerifiedAt: withinGrace, now })
  assert.equal(stillGraced.tier, 'paid')
  assert.equal(isCapabilityEntitled(stillGraced, 'pro-x'), true)

  const graceExpired = resolveEntitlementWithGrace({ raw: paidRaw, lastVerifiedAt: beyondGrace, now })
  assert.equal(graceExpired.tier, 'free', 'exceeding the offline grace window must fail closed to free')
  assert.equal(isFailClosed(graceExpired), true)

  // Free Core is never affected either way.
  assert.equal(isCapabilityEntitled(stillGraced, undefined), true)
  assert.equal(isCapabilityEntitled(graceExpired, undefined), true)
}

// ── 5. Expiry, cancellation, refund, device removal, reactivation are explicit states ──
{
  const base: SubscriptionState = {
    status: 'active',
    plan: 'monthly',
    devices: [{ deviceId: 'd1', label: 'x', activatedAt: new Date().toISOString() }],
    maxDevices: DEFAULT_MAX_DEVICES,
  }
  const cancelled = applyLifecycleEvent(base, { type: 'cancel' })
  assert.equal(cancelled.ok, true)
  assert.equal(cancelled.ok ? cancelled.state.status : '', 'canceled')

  const expired = applyLifecycleEvent(cancelled.ok ? cancelled.state : base, { type: 'expire' })
  assert.equal(expired.ok, true)
  assert.equal(expired.ok ? expired.state.status : '', 'expired')
  assert.equal(expired.ok ? expired.state.devices.length : -1, 0, 'expiry clears device seats')

  const refunded = applyLifecycleEvent(base, { type: 'refund' })
  assert.equal(refunded.ok, true)
  assert.equal(refunded.ok ? refunded.state.status : '', 'refunded')

  const reactivateFromExpired = applyLifecycleEvent(expired.ok ? expired.state : base, { type: 'reactivate', plan: 'annual' })
  assert.equal(reactivateFromExpired.ok, true)
  assert.equal(reactivateFromExpired.ok ? reactivateFromExpired.state.status : '', 'active')
  assert.equal(reactivateFromExpired.ok ? reactivateFromExpired.state.plan : '', 'annual')

  const reactivateFromRefunded = applyLifecycleEvent(refunded.ok ? refunded.state : base, { type: 'reactivate', plan: 'monthly' })
  assert.equal(reactivateFromRefunded.ok, false, 'refunded subscriptions require a new purchase, not reactivation')

  const doubleCancel = applyLifecycleEvent(cancelled.ok ? cancelled.state : base, { type: 'cancel' })
  assert.equal(doubleCancel.ok, false, 'cannot cancel a subscription that is not active')
}

// ── 6. Expired/cancelled Pro preserves Free Core and existing local data ──
{
  const graceExpired = resolveEntitlementWithGrace({
    raw: { tier: 'paid', grantedFeatures: ['pro-x'] },
    lastVerifiedAt: undefined,
    now: Date.now(),
  })
  assert.equal(graceExpired.tier, 'free')
  assert.equal(isCapabilityEntitled(graceExpired, undefined), true, 'Free Core capabilities stay available')
  const settings = { apiKey: 'sk-untouched', model: 'gpt-4' }
  const exported = redactSettingsForExport(settings)
  assert.ok(exported.redactedFields.includes('apiKey'))
}
assert.ok(!read('src/agent/settingsExport.ts').includes('subscription'), 'export must stay subscription-agnostic')

// ── 7. Account/payment/webhook/entitlement failures produce actionable messages ──
for (const kind of ['account', 'payment', 'webhook', 'entitlement-refresh'] as const) {
  const msg = describeSubscriptionFailure(kind)
  assert.ok(msg.length > 10, `${kind} failure message must be non-trivial`)
  assert.ok(msg.includes('Free Core') || msg.includes('免費'), `${kind} failure message must reassure Free Core keeps working`)
}

// ── 8. UI seam: Settings surfaces pricing + device/lifecycle state ──
const settingsPageSrc = read('src/pages/SettingsPage.tsx')
assert.ok(settingsPageSrc.includes('useSubscriptionStore') || settingsPageSrc.includes('SUBSCRIPTION_PRICING'),
  'SettingsPage must surface subscription pricing/lifecycle state')

// ── 9. Store seam: single place that layers subscription state on the entitlement boundary ──
const storeSrc = read('src/store/subscriptionStore.ts')
assert.ok(storeSrc.includes('resolveEntitlementWithGrace'), 'subscriptionStore must resolve through the grace-aware boundary')

console.log('Subscription lifecycle smoke: 9 groups passed')
