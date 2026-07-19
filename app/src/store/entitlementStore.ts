import { create } from 'zustand'
import {
  resolveEntitlement,
  isFeatureEntitled,
  type EntitlementSnapshot,
} from '../agent/entitlement'

const STORAGE_KEY = 'subagents:entitlement'

/** Read the raw local entitlement blob if present. Never throws. */
function readRawEntitlement(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return undefined
    return JSON.parse(raw)
  } catch {
    // Unavailable localStorage or malformed JSON both fail closed via resolveEntitlement(undefined-ish).
    return undefined
  }
}

interface EntitlementStore {
  snapshot: EntitlementSnapshot
  /** Issue 07 — the single check every paid feature (UI or runtime) must call through. */
  isEntitled: (featureId: string) => boolean
  /** Re-resolve from a fresh raw payload (e.g. after a subscription refresh in a later issue). */
  refresh: (raw: unknown) => void
}

export const useEntitlementStore = create<EntitlementStore>((set, get) => ({
  snapshot: resolveEntitlement(readRawEntitlement()),
  isEntitled: (featureId) => isFeatureEntitled(get().snapshot, featureId),
  refresh: (raw) => set({ snapshot: resolveEntitlement(raw) }),
}))
