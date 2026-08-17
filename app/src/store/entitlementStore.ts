import { create } from 'zustand'
import {
  isFeatureEntitled,
  resolveEntitlement,
  type EntitlementSnapshot,
  type FeatureId,
} from '../agent/entitlement.ts'
import { useSubscriptionStore } from './subscriptionStore.ts'
import { readJson } from './persist.ts'

interface EntitlementStore {
  snapshot: EntitlementSnapshot
  isEntitled: (featureId: FeatureId) => boolean
}

function initialSnapshot(): EntitlementSnapshot {
  try {
    if (useSubscriptionStore.getState().state.lastVerifiedAt !== undefined) {
      return useSubscriptionStore.getState().entitlement
    }
    // Legacy migration from old key
    const legacy = readJson('entitlement', {
      fallback: undefined,
      migrateFrom: 'subagents:entitlement',
      migrate: (raw) => raw,
    })
    if (legacy !== undefined) {
      return resolveEntitlement(legacy)
    }
    return resolveEntitlement(undefined)
  } catch {
    return resolveEntitlement(undefined)
  }
}

export const useEntitlementStore = create<EntitlementStore>(() => ({
  snapshot: initialSnapshot(),
  isEntitled: (featureId) => {
    const snap = useSubscriptionStore.getState().entitlement
    return isFeatureEntitled(snap, featureId)
  },
}))

useSubscriptionStore.subscribe((next, prev) => {
  if (next.entitlement !== prev.entitlement) {
    useEntitlementStore.setState({ snapshot: next.entitlement })
  }
})
