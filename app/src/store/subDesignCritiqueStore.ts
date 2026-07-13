import { create } from 'zustand'
import { normalizeSubDesignCritique } from '../agent/subdesign/critique'
import type { SubDesignCritique } from '../agent/subdesign/types'

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
  record: (input: unknown, defaults?: { briefId?: string }) =>
    | { ok: true; critique: SubDesignCritique }
    | { ok: false; errors: string[] }
  findByArtifactId: (artifactId: string) => SubDesignCritique[]
  latestForArtifact: (artifactId: string) => SubDesignCritique | null
}

export const useSubDesignCritiqueStore = create<SubDesignCritiqueStore>((set, get) => ({
  critiques: loadCritiques(),

  record: (input, defaults) => {
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
    return { ok: true, critique }
  },

  findByArtifactId: (artifactId) => get().critiques.filter((item) => item.artifactId === artifactId),

  latestForArtifact: (artifactId) => get().critiques.find((item) => item.artifactId === artifactId) || null,
}))
