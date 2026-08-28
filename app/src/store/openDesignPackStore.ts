import { create } from 'zustand'
import { pluginRegistry } from '../agent/hermes/plugins.ts'
import {
  normalizeOpenDesignContentPack,
  openDesignPackId,
  openDesignSkillPlugin,
  packMayEnable,
  type OpenDesignContentPackManifest,
  type OpenDesignPackAuditEvent,
} from '../agent/openDesign/packs.ts'
import { readOpenDesignText, type OpenDesignCatalogRecord } from '../agent/openDesign/catalog.ts'
import { persistSubDesignMetadata } from '../agent/subdesign/metadata.ts'
import { applyOpenDesignPack } from '../agent/openDesign/packApplication.ts'

const PACKS_KEY = 'subagents.open-design.packs.v1'
const AUDIT_KEY = 'subagents.open-design.audit.v1'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* Browser preview may disable localStorage. */
  }
}

function skillPath(record: OpenDesignCatalogRecord): string | null {
  return record.assetPaths.find((item) => /(^|\/)SKILL\.md$/i.test(item)) || record.entryPaths.find((item) => /SKILL\.md$/i.test(item)) || null
}

type OpenDesignPackStore = {
  packs: OpenDesignContentPackManifest[]
  audit: OpenDesignPackAuditEvent[]
  busyId: string | null
  error: string | null
  projectRoot: string
  setProjectRoot: (root: string) => void
  hydrateCanonical: (items: unknown[]) => void
  install: (record: OpenDesignCatalogRecord, projectRoot?: string) => Promise<OpenDesignContentPackManifest | null>
  setEnabled: (record: OpenDesignCatalogRecord, enabled: boolean) => Promise<boolean>
  uninstall: (id: string) => Promise<boolean>
  reindex: (records: OpenDesignCatalogRecord[]) => void
  rehydrateEnabled: (records: OpenDesignCatalogRecord[]) => Promise<void>
  installed: (record: OpenDesignCatalogRecord) => OpenDesignContentPackManifest | null
}

function addAudit(set: (value: Partial<OpenDesignPackStore>) => void, event: OpenDesignPackAuditEvent) {
  const audit = [...readJson<OpenDesignPackAuditEvent[]>(AUDIT_KEY, []), event].slice(-300)
  persist(AUDIT_KEY, audit)
  set({ audit })
}

export const useOpenDesignPackStore = create<OpenDesignPackStore>((set, get) => ({
  packs: readJson<unknown[]>(PACKS_KEY, []).map(normalizeOpenDesignContentPack).filter((item): item is OpenDesignContentPackManifest => Boolean(item)),
  audit: readJson<OpenDesignPackAuditEvent[]>(AUDIT_KEY, []),
  busyId: null,
  error: null,
  projectRoot: '',

  setProjectRoot: (root) => set({ projectRoot: root }),

  hydrateCanonical: (items) => {
    const canonical = items
      .map(normalizeOpenDesignContentPack)
      .filter((item): item is OpenDesignContentPackManifest => Boolean(item))
    if (!canonical.length) return
    // Canonical (project-file) packs are authoritative for portability; keep any
    // pack this project's files don't know about yet (e.g. install in flight).
    const byId = new Map(canonical.map((pack) => [pack.id, pack]))
    const packs = [...canonical, ...get().packs.filter((pack) => !byId.has(pack.id))].slice(0, 500)
    persist(PACKS_KEY, packs)
    set({ packs })
  },

  install: async (record, projectRoot) => {
    const id = openDesignPackId(record)
    set({ busyId: id, error: null })
    const root = projectRoot || get().projectRoot
    const result = await applyOpenDesignPack({
      record,
      projectRoot: root,
      existing: get().packs.find((item) => item.id === id),
      dependencies: {
        copyToProject: async (copyInput) => {
          const copy = window.subagents?.subdesign?.copyVendorPack
          if (!copy) return { ok: false, error: '目前的 Electron Host 不支援 Open Design pack copy。' }
          const copied = await copy(copyInput)
          return copied.ok && copied.path
            ? { ok: true, path: copied.path }
            : { ok: false, error: copied.error || 'Open Design pack copy 失敗。' }
        },
        persistCanonical: (pack, canonicalRoot) => persistSubDesignMetadata('open-design-pack', pack, canonicalRoot),
        commitProjection: (pack) => {
          const packs = [pack, ...get().packs.filter((item) => item.id !== id)].slice(0, 500)
          persist(PACKS_KEY, packs)
          set({ packs, busyId: null, error: null })
        },
        appendAudit: (event) => addAudit(set, event),
      },
    })
    if (result.ok) return result.pack
    set({ busyId: null, error: result.reason })
    return null
  },

  setEnabled: async (record, enabled) => {
    const id = openDesignPackId(record)
    const current = get().packs.find((item) => item.id === id)
    if (!current) return false
    if (enabled) {
      const gate = packMayEnable(current)
      if (!gate.ok) {
        set({ error: gate.reason })
        addAudit(set, { at: new Date().toISOString(), action: 'reject', packId: id, digest: current.digest, reason: gate.reason })
        return false
      }
    }
    let skillRaw: string | null = null
    let selectedSkillPath: string | null = null
    if (enabled && current.kind === 'skill') {
      selectedSkillPath = skillPath(record)
      if (!selectedSkillPath) {
        set({ error: 'skill pack 缺少 SKILL.md，不能注入 capability。' })
        return false
      }
      skillRaw = await readOpenDesignText(selectedSkillPath)
      if (!skillRaw) {
        set({ error: '無法讀取本機 SKILL.md，未啟用 capability。' })
        return false
      }
    }
    const next = { ...current, enabled }
    const packs = get().packs.map((item) => item.id === id ? next : item)
    persist(PACKS_KEY, packs)
    set({ packs, error: null })
    persistSubDesignMetadata('open-design-pack', next, get().projectRoot)
    if (current.kind === 'skill') {
      if (enabled) {
        pluginRegistry.add(openDesignSkillPlugin(next, selectedSkillPath!, skillRaw!))
      } else {
        pluginRegistry.remove(id)
      }
      pluginRegistry.apply()
    }
    addAudit(set, { at: new Date().toISOString(), action: enabled ? 'enable' : 'disable', packId: id, digest: current.digest })
    return true
  },

  uninstall: async (id) => {
    const current = get().packs.find((item) => item.id === id)
    if (!current) return false
    const packs = get().packs.filter((item) => item.id !== id)
    persist(PACKS_KEY, packs)
    pluginRegistry.remove(id)
    pluginRegistry.apply()
    set({ packs, error: null })
    addAudit(set, { at: new Date().toISOString(), action: 'uninstall', packId: id, digest: current.digest })
    return true
  },

  reindex: (records) => {
    const byId = new Map(records.map((record) => [openDesignPackId(record), record]))
    const changed: OpenDesignContentPackManifest[] = []
    const packs = get().packs.map((pack) => {
      const record = byId.get(pack.id)
      if (!record || record.digest === pack.digest) return pack
      const next = { ...pack, enabled: false, digest: record.digest, sourcePath: record.sourcePath, assetPaths: record.assetPaths, licensePaths: record.licensePaths }
      changed.push(next)
      return next
    })
    persist(PACKS_KEY, packs)
    set({ packs })
    for (const pack of changed) persistSubDesignMetadata('open-design-pack', pack, get().projectRoot)
    addAudit(set, { at: new Date().toISOString(), action: 'reindex', packId: 'open-design:index' })
  },

  rehydrateEnabled: async (records) => {
    for (const pack of get().packs.filter((item) => item.enabled && item.kind === 'skill')) {
      const record = records.find((item) => openDesignPackId(item) === pack.id)
      const path = record && skillPath(record)
      if (!path) continue
      const raw = await readOpenDesignText(path)
      if (raw) pluginRegistry.add(openDesignSkillPlugin(pack, path, raw))
    }
    pluginRegistry.apply()
  },

  installed: (record) => get().packs.find((item) => item.id === openDesignPackId(record)) || null,
}))
