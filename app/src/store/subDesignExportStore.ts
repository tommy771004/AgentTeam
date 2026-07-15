import { create } from 'zustand'
import type { SubDesignExportRecord } from '../agent/subdesign/types'

const STORAGE_KEY = 'subagents.subdesign.exports.v1'

function loadRecords(): SubDesignExportRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is SubDesignExportRecord => {
      return Boolean(item && typeof item === 'object' && item.artifactId && item.format && item.path)
    }).slice(0, 120)
  } catch {
    return []
  }
}

function persist(records: SubDesignExportRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 120)))
  } catch {
    /* localStorage is optional in browser preview. */
  }
}

interface SubDesignExportStore {
  records: SubDesignExportRecord[]
  projectRoot: string
  setProjectRoot: (root: string) => void
  hydrateCanonical: (items: unknown[]) => void
  record: (input: Omit<SubDesignExportRecord, 'id' | 'createdAt'> & { projectRoot?: string }) => SubDesignExportRecord
  findByArtifactId: (artifactId: string) => SubDesignExportRecord[]
}

export const useSubDesignExportStore = create<SubDesignExportStore>((set, get) => ({
  records: loadRecords(),
  projectRoot: '',

  setProjectRoot: (root) => set({ projectRoot: root }),

  hydrateCanonical: (items) => {
    const records = items.filter((item): item is SubDesignExportRecord => Boolean(item && typeof item === 'object' && (item as SubDesignExportRecord).artifactId && (item as SubDesignExportRecord).format && (item as SubDesignExportRecord).path)).slice(0, 120)
    set({ records })
    persist(records)
  },

  record: (input) => {
    const { projectRoot: _projectRoot, ...recordInput } = input
    const record: SubDesignExportRecord = {
      ...recordInput,
      id: `export_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    }
    const records = [record, ...get().records].slice(0, 120)
    set({ records })
    persist(records)
    return record
  },

  findByArtifactId: (artifactId) => get().records.filter((record) => record.artifactId === artifactId),
}))
