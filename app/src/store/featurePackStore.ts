import { create } from 'zustand'
import {
  installFeaturePack,
  disableFeaturePack,
  enableFeaturePack,
  uninstallFeaturePack,
  rollbackFeaturePack,
  featurePackAuditEvent,
  type FeaturePackRecord,
  type FeaturePackAuditEvent,
} from '../agent/featurePacks.ts'
import { validateFeaturePackManifest, type FeaturePackManifest } from '../agent/featurePackContracts.ts'
import type { EntitlementSnapshot } from '../agent/entitlement.ts'
import { readJson, writeJson } from './persist.ts'

const PACKS_KEY = 'feature-packs.v1'
const AUDIT_KEY = 'feature-packs.audit.v1'

/** Injected verifier keeps this store decoupled from Electron's node:crypto specifics. */
export type FeaturePackVerifier = (manifest: FeaturePackManifest, bytes: Uint8Array) => Promise<boolean>

interface FeaturePackStore {
  packs: FeaturePackRecord[]
  audit: FeaturePackAuditEvent[]
  busyId: string | null
  error: string | null
  install: (
    rawManifest: unknown,
    bytes: Uint8Array,
    appVersion: string,
    entitlement: EntitlementSnapshot,
    verify: FeaturePackVerifier,
  ) => Promise<FeaturePackRecord | null>
  disable: (id: string) => void
  enable: (id: string, appVersion: string, entitlement: EntitlementSnapshot) => void
  uninstall: (id: string) => void
  rollback: (id: string, appVersion: string, entitlement: EntitlementSnapshot) => boolean
}

function addAudit(set: (partial: Partial<FeaturePackStore>) => void, get: () => FeaturePackStore, event: FeaturePackAuditEvent) {
  const audit = [...get().audit, event].slice(-300)
  writeJson(AUDIT_KEY, audit)
  set({ audit })
}

export const useFeaturePackStore = create<FeaturePackStore>((set, get) => ({
  packs: readJson<FeaturePackRecord[]>(PACKS_KEY, { fallback: [] }),
  audit: readJson<FeaturePackAuditEvent[]>(AUDIT_KEY, { fallback: [] }),
  busyId: null,
  error: null,

  install: async (rawManifest, bytes, appVersion, entitlement, verify) => {
    const validation = validateFeaturePackManifest(rawManifest, { installedAppVersion: appVersion })
    if (!validation.ok) {
      set({ error: `功能包 manifest 無效：${validation.errors.join('; ')}` })
      return null
    }
    const manifest = validation.manifest
    set({ busyId: manifest.id, error: null })
    try {
      const verified = await verify(manifest, bytes)
      const existing = get().packs.find((p) => p.id === manifest.id) || null
      const result = installFeaturePack(existing, manifest, verified, entitlement, appVersion)
      if (!result.ok) {
        set({ busyId: null, error: result.error })
        addAudit(set, get, featurePackAuditEvent('reject', manifest, result.error))
        return null
      }
      const packs = [result.record, ...get().packs.filter((p) => p.id !== manifest.id)].slice(0, 200)
      writeJson(PACKS_KEY, packs)
      set({ packs, busyId: null, error: null })
      addAudit(set, get, featurePackAuditEvent(existing ? 'update' : 'install', manifest))
      return result.record
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ busyId: null, error: message })
      addAudit(set, get, featurePackAuditEvent('reject', manifest, message))
      return null
    }
  },

  disable: (id) => {
    const current = get().packs.find((p) => p.id === id)
    if (!current) return
    const next = disableFeaturePack(current)
    const packs = get().packs.map((p) => (p.id === id ? next : p))
    writeJson(PACKS_KEY, packs)
    set({ packs })
    addAudit(set, get, featurePackAuditEvent('disable', current.manifest))
  },

  enable: (id, appVersion, entitlement) => {
    const current = get().packs.find((p) => p.id === id)
    if (!current) return
    const next = enableFeaturePack(current, entitlement, appVersion)
    const packs = get().packs.map((p) => (p.id === id ? next : p))
    writeJson(PACKS_KEY, packs)
    set({ packs })
    addAudit(set, get, featurePackAuditEvent('enable', current.manifest))
  },

  uninstall: (id) => {
    const current = get().packs.find((p) => p.id === id)
    if (!current) return
    const next = uninstallFeaturePack(current)
    const packs = get().packs.map((p) => (p.id === id ? next : p))
    writeJson(PACKS_KEY, packs)
    set({ packs })
    addAudit(set, get, featurePackAuditEvent('uninstall', current.manifest))
  },

  rollback: (id, appVersion, entitlement) => {
    const current = get().packs.find((p) => p.id === id)
    if (!current) return false
    const result = rollbackFeaturePack(current, entitlement, appVersion)
    if (!result.ok) {
      set({ error: result.error })
      return false
    }
    const packs = get().packs.map((p) => (p.id === id ? result.record : p))
    writeJson(PACKS_KEY, packs)
    set({ packs, error: null })
    addAudit(set, get, featurePackAuditEvent('rollback', result.record.manifest))
    return true
  },
}))