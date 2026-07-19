/**
 * Issue 08 — 訂閱、裝置啟用與離線寬限。
 *
 * Layers on top of the issue 07 entitlement boundary (`./entitlement.ts`):
 * pricing, bounded device seats, explicit lifecycle transitions, a
 * content-free refresh request contract, offline grace, and actionable
 * failure copy. Never reimplements `resolveEntitlement` — only wraps it.
 */

import { resolveEntitlement, type EntitlementSnapshot } from './entitlement.ts'

export type SubscriptionPlan = 'monthly' | 'annual'

export const SUBSCRIPTION_PRICING: Record<SubscriptionPlan, { usd: number; interval: 'month' | 'year' }> = {
  monthly: { usd: 9, interval: 'month' },
  annual: { usd: 90, interval: 'year' },
}

export const DEFAULT_MAX_DEVICES = 3
/** Client must successfully check in with the entitlement service at least this often. */
export const DEFAULT_CHECK_IN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
/** Extra buffer after a missed check-in before Pro features fail closed. */
export const DEFAULT_OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000

export interface DeviceActivation {
  deviceId: string
  label: string
  activatedAt: string
}

export type SubscriptionStatus = 'active' | 'canceled' | 'expired' | 'refunded'

export interface SubscriptionState {
  status: SubscriptionStatus
  plan: SubscriptionPlan | null
  devices: DeviceActivation[]
  maxDevices: number
  /** Last time the client successfully refreshed entitlement from the service. */
  lastVerifiedAt?: string
}

export const DEFAULT_SUBSCRIPTION_STATE: SubscriptionState = {
  status: 'expired',
  plan: null,
  devices: [],
  maxDevices: DEFAULT_MAX_DEVICES,
}

export type ActivateDeviceResult =
  | { ok: true; state: SubscriptionState }
  | { ok: false; error: string }

/** Bounded device activation. Re-activating a known device is idempotent, not a new seat. */
export function activateDevice(state: SubscriptionState, device: DeviceActivation): ActivateDeviceResult {
  if (state.status !== 'active') {
    return { ok: false, error: `無法啟用裝置：訂閱狀態為「${state.status}」，需為 active。` }
  }
  if (state.devices.some((d) => d.deviceId === device.deviceId)) {
    return { ok: true, state }
  }
  if (state.devices.length >= state.maxDevices) {
    return { ok: false, error: `裝置數已達上限（${state.maxDevices}）。請先移除其他裝置再啟用新裝置。` }
  }
  return { ok: true, state: { ...state, devices: [...state.devices, device] } }
}

export function removeDevice(state: SubscriptionState, deviceId: string): SubscriptionState {
  return { ...state, devices: state.devices.filter((d) => d.deviceId !== deviceId) }
}

export type SubscriptionLifecycleEvent =
  | { type: 'cancel' }
  | { type: 'expire' }
  | { type: 'refund' }
  | { type: 'reactivate'; plan: SubscriptionPlan }

export type LifecycleResult =
  | { ok: true; state: SubscriptionState }
  | { ok: false; error: string }

/** Explicit, total state machine for every lifecycle transition the issue calls out. */
export function applyLifecycleEvent(state: SubscriptionState, event: SubscriptionLifecycleEvent): LifecycleResult {
  switch (event.type) {
    case 'cancel':
      if (state.status !== 'active') {
        return { ok: false, error: `無法取消：目前狀態為「${state.status}」，需為 active。` }
      }
      // Cancellation keeps devices/entitlement until the paid period genuinely ends (expire).
      return { ok: true, state: { ...state, status: 'canceled' } }
    case 'expire':
      return { ok: true, state: { ...state, status: 'expired', devices: [] } }
    case 'refund':
      return { ok: true, state: { ...state, status: 'refunded', devices: [] } }
    case 'reactivate':
      if (state.status === 'refunded') {
        return { ok: false, error: '已退款的訂閱需重新購買，無法直接重新啟用。' }
      }
      return { ok: true, state: { ...state, status: 'active', plan: event.plan } }
  }
}

/** Whether a device offline since `lastVerifiedAt` is still within the grace window at `now`. */
export function isWithinOfflineGrace(
  lastVerifiedAt: string | undefined,
  now: number,
  checkInIntervalMs: number = DEFAULT_CHECK_IN_INTERVAL_MS,
  graceMs: number = DEFAULT_OFFLINE_GRACE_MS,
): boolean {
  if (!lastVerifiedAt) return false
  const verifiedMs = new Date(lastVerifiedAt).getTime()
  if (Number.isNaN(verifiedMs)) return false
  return now <= verifiedMs + checkInIntervalMs + graceMs
}

/**
 * The one place offline grace combines with issue 07's `resolveEntitlement`.
 * A paid snapshot that hasn't checked in within interval+grace fails closed
 * to free — Free Core is unaffected either way.
 */
export function resolveEntitlementWithGrace(input: {
  raw: unknown
  lastVerifiedAt?: string
  now?: number
  checkInIntervalMs?: number
  graceMs?: number
}): EntitlementSnapshot {
  const now = input.now ?? Date.now()
  const snapshot = resolveEntitlement(input.raw)
  if (snapshot.tier !== 'paid') return snapshot
  if (
    isWithinOfflineGrace(
      input.lastVerifiedAt,
      now,
      input.checkInIntervalMs ?? DEFAULT_CHECK_IN_INTERVAL_MS,
      input.graceMs ?? DEFAULT_OFFLINE_GRACE_MS,
    )
  ) {
    return snapshot
  }
  return {
    tier: 'free',
    grantedFeatures: new Set(),
    source: 'expired',
    failClosed: true,
    reason: '已超過離線寬限期，需重新連線以刷新 Pro 授權。',
  }
}

export interface EntitlementRefreshRequest {
  licenseId: string
  deviceId: string
  deviceSignature: string
  appVersion: string
}

/**
 * Whitelisted refresh payload builder — the only fields ever sent to refresh
 * entitlement. No source code, prompts, transcripts, or Handoff content can
 * be added here without changing this explicit shape.
 */
export function buildEntitlementRefreshRequest(input: {
  licenseId: string
  deviceId: string
  deviceSignature: string
  appVersion: string
}): EntitlementRefreshRequest {
  return {
    licenseId: input.licenseId,
    deviceId: input.deviceId,
    deviceSignature: input.deviceSignature,
    appVersion: input.appVersion,
  }
}

export type SubscriptionFailureKind = 'account' | 'payment' | 'webhook' | 'entitlement-refresh'

/** Actionable, Free-Core-reassuring copy for every failure surface the issue calls out. */
export function describeSubscriptionFailure(kind: SubscriptionFailureKind, detail?: string): string {
  const suffix = detail ? `（${detail}）` : ''
  switch (kind) {
    case 'account':
      return `無法驗證帳號${suffix}，請重新登入或聯絡支援；Free Core 功能不受影響，仍可正常使用。`
    case 'payment':
      return `付款處理失敗${suffix}，請確認付款方式後重試；Free Core 功能不受影響，仍可正常使用。`
    case 'webhook':
      return `訂閱狀態通知遺失${suffix}，我們會在下次連線時自動重新同步；Free Core 功能不受影響。`
    case 'entitlement-refresh':
      return `無法刷新 Pro 授權${suffix}，請檢查網路連線；離線寬限期內可繼續使用，Free Core 完全不受影響。`
  }
}
