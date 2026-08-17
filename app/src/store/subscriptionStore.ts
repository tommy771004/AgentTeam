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
} from '../agent/subscription.ts'
import type { EntitlementSnapshot } from '../agent/entitlement.ts'
import { readJson, writeJson } from './persist.ts'

const STORAGE_KEY = 'subscription'
const RAW_ENTITLEMENT_KEY = 'entitlement'

function readSubscriptionState(): SubscriptionState {
  return readJson<SubscriptionState>(STORAGE_KEY, {
    fallback: DEFAULT_SUBSCRIPTION_STATE,
  })
}

function writeSubscriptionState(state: SubscriptionState) {
  writeJson(STORAGE_KEY, state)
}

function readRawEntitlement(): unknown {
  return readJson(RAW_ENTITLEMENT_KEY, {
    fallback: undefined,
    migrateFrom: 'subagents:entitlement',
    migrate: (raw) => raw,
  })
}

/** Generate a simple device signature from deviceId + timestamp. */
function generateDeviceSignature(deviceId: string): string {
  const input = `${deviceId}:${Date.now()}`
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

/** Get app version from environment or fallback. */
function getAppVersion(): string {
  if (typeof process !== 'undefined' && process.env?.APP_VERSION) return process.env.APP_VERSION
  return 'unknown'
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
      const enriched: DeviceActivation = {
        ...device,
        deviceSignature: generateDeviceSignature(device.deviceId),
        appVersion: getAppVersion(),
      }
      const result = activateDevice(get().state, enriched)
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
      const primaryDevice = current.devices[0]
      try {
        const req = buildEntitlementRefreshRequest({
          licenseId: current.plan || '',
          deviceId: primaryDevice?.deviceId || '',
          deviceSignature: primaryDevice?.deviceSignature || '',
          appVersion: primaryDevice?.appVersion || getAppVersion(),
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