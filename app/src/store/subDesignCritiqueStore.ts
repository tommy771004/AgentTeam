import { create } from 'zustand'
import { normalizeSubDesignCritique } from '../agent/subdesign/critique.ts'
import { persistSubDesignMetadata } from '../agent/subdesign/metadata.ts'
import type { SubDesignCritique } from '../agent/subdesign/types.ts'

const STORAGE_KEY = 'subagents.subdesign.critiques.v1'

function loadCritiques(): SubDesignCritique[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        const result = normalizeSubDesignCritique(item)
        return result.ok ? result.critique : null
      })
      .filter((item): item is SubDesignCritique => Boolean(item))
      .slice(0, 120)
  } catch {
    return []
  }
}

function persist(critiques: SubDesignCritique[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(critiques.slice(0, 120)))
  } catch {
    /* localStorage is optional in browser preview. */
  }
}

interface SubDesignCritiqueStore {
  critiques: SubDesignCritique[]
  projectRoot: string
  setProjectRoot: (root: string) => void
  hydrateCanonical: (items: unknown[]) => void
  record: (input: unknown, defaults?: { briefId?: string }, projectRoot?: string) =>
    | { ok: true; critique: SubDesignCritique }
    | { ok: false; errors: string[] }
  findByArtifactId: (artifactId: string) => SubDesignCritique[]
  latestForArtifact: (artifactId: string, revision?: number) => SubDesignCritique | null
}

export const useSubDesignCritiqueStore = create<SubDesignCritiqueStore>((set, get) => ({
  critiques: loadCritiques(),
  projectRoot: '',

  setProjectRoot: (root) => set({ projectRoot: root }),

  hydrateCanonical: (items) => {
    const critiques = items
      .map((item) => {
        const result = normalizeSubDesignCritique(item)
        return result.ok ? result.critique : null
      })
      .filter((item): item is SubDesignCritique => Boolean(item))
      .slice(0, 120)
    set({ critiques })
    persist(critiques)
  },

  record: (input, defaults, projectRoot) => {
    const result = normalizeSubDesignCritique(input, defaults)
    if (!result.ok) return result
    const history = get().critiques.filter((item) => item.artifactId === result.critique.artifactId)
    const critique = {
      ...result.critique,
      revision: Math.max((history[0]?.revision || 0) + 1, result.critique.revision || 1),
    }
    const critiques = [critique, ...get().critiques].slice(0, 120)
    set({ critiques })
    persist(critiques)
    persistSubDesignMetadata('critique', critique, projectRoot || get().projectRoot)
    return { ok: true, critique }
  },

  findByArtifactId: (artifactId) => get().critiques.filter((item) => item.artifactId === artifactId),

  latestForArtifact: (artifactId, revision) => get().critiques.find((item) => item.artifactId === artifactId && (revision == null || item.revision === revision)) || null,
}))
