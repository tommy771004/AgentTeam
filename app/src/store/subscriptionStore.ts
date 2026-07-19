import { create } from 'zustand'
import {
  DEFAULT_SUBSCRIPTION_STATE,
  activateDevice,
  removeDevice,
  applyLifecycleEvent,
  resolveEntitlementWithGrace,
  buildEntitlementRefreshRequest,
  describeSubscriptionFailure,
  type SubscriptionState,
  type DeviceActivation,
  type SubscriptionLifecycleEvent,
  type SubscriptionFailureKind,
} from '../agent/subscription'
import type { EntitlementSnapshot } from '../agent/entitlement'

const STORAGE_KEY = 'subagents:subscription'
const RAW_ENTITLEMENT_KEY = 'subagents:entitlement'

function readSubscriptionState(): SubscriptionState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SUBSCRIPTION_STATE
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return DEFAULT_SUBSCRIPTION_STATE
    return { ...DEFAULT_SUBSCRIPTION_STATE, ...parsed }
  } catch {
    return DEFAULT_SUBSCRIPTION_STATE
  }
}

function writeSubscriptionState(state: SubscriptionState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* unavailable localStorage: state stays in-memory only, entitlement still fails closed */
  }
}

function readRawEntitlement(): unknown {
  try {
    const raw = localStorage.getItem(RAW_ENTITLEMENT_KEY)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

interface SubscriptionStore {
  state: SubscriptionState
  /** Issue 07+08 combined boundary: entitlement resolved with offline grace. */
  entitlement: EntitlementSnapshot
  lastError: string | null
  activate: (device: DeviceActivation) => { ok: boolean; error?: string }
  removeDevice: (deviceId: string) => void
  applyLifecycle: (event: SubscriptionLifecycleEvent) => { ok: boolean; error?: string }
  /** Refresh entitlement using an injected transport — the store never assumes a specific backend. */
  refresh: (fetcher: (req: ReturnType<typeof buildEntitlementRefreshRequest>) => Promise<unknown>) => Promise<void>
  describeFailure: (kind: SubscriptionFailureKind, detail?: string) => string
}

function recomputeEntitlement(state: SubscriptionState): EntitlementSnapshot {
  return resolveEntitlementWithGrace({
    raw: readRawEntitlement(),
    lastVerifiedAt: state.lastVerifiedAt,
  })
}

export const useSubscriptionStore = create<SubscriptionStore>((set, get) => {
  const initial = readSubscriptionState()
  return {
    state: initial,
    entitlement: recomputeEntitlement(initial),
    lastError: null,

    activate: (device) => {
      const result = activateDevice(get().state, device)
      if (!result.ok) {
        set({ lastError: result.error })
        return { ok: false, error: result.error }
      }
      writeSubscriptionState(result.state)
      set({ state: result.state, entitlement: recomputeEntitlement(result.state), lastError: null })
      return { ok: true }
    },

    removeDevice: (deviceId) => {
      const next = removeDevice(get().state, deviceId)
      writeSubscriptionState(next)
      set({ state: next, entitlement: recomputeEntitlement(next) })
    },

    applyLifecycle: (event) => {
      const result = applyLifecycleEvent(get().state, event)
      if (!result.ok) {
        set({ lastError: result.error })
        return { ok: false, error: result.error }
      }
      writeSubscriptionState(result.state)
      set({ state: result.state, entitlement: recomputeEntitlement(result.state), lastError: null })
      return { ok: true }
    },

    refresh: async (fetcher) => {
      const current = get().state
      try {
        const req = buildEntitlementRefreshRequest({
          licenseId: current.plan || '',
          deviceId: current.devices[0]?.deviceId || '',
          deviceSignature: '',
          appVersion: '',
        })
        await fetcher(req)
        const verifiedState = { ...current, lastVerifiedAt: new Date().toISOString() }
        writeSubscriptionState(verifiedState)
        set({ state: verifiedState, entitlement: recomputeEntitlement(verifiedState), lastError: null })
      } catch (error) {
        set({ lastError: describeSubscriptionFailure('entitlement-refresh', error instanceof Error ? error.message : String(error)) })
      }
    },

    describeFailure: (kind, detail) => describeSubscriptionFailure(kind, detail),
  }
})
