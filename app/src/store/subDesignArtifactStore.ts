import { create } from 'zustand'
import { validateSubDesignArtifactManifest } from '../agent/subdesign/artifactManifest.ts'
import { persistSubDesignMetadata } from '../agent/subdesign/metadata.ts'
import type { SubDesignArtifact } from '../agent/subdesign/types.ts'

const STORAGE_KEY = 'subagents.subdesign.artifacts.v1'

function loadArtifacts(): SubDesignArtifact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        const result = validateSubDesignArtifactManifest(item)
        return result.ok ? result.manifest : null
      })
      .filter((item): item is SubDesignArtifact => Boolean(item))
      .slice(0, 80)
  } catch {
    return []
  }
}

function persist(artifacts: SubDesignArtifact[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(artifacts.slice(0, 80)))
  } catch {
    /* localStorage is optional in browser preview. */
  }
}

interface SubDesignArtifactStore {
  artifacts: SubDesignArtifact[]
  projectRoot: string
  setProjectRoot: (root: string) => void
  hydrateCanonical: (items: unknown[]) => void
  register: (input: unknown, defaults?: { briefId?: string }, projectRoot?: string) =>
    | { ok: true; artifact: SubDesignArtifact }
    | { ok: false; errors: string[] }
  remove: (id: string) => void
  findByBriefId: (briefId: string) => SubDesignArtifact[]
  findById: (id: string) => SubDesignArtifact | null
}

export const useSubDesignArtifactStore = create<SubDesignArtifactStore>((set, get) => ({
  artifacts: loadArtifacts(),
  projectRoot: '',

  setProjectRoot: (root) => set({ projectRoot: root }),

  hydrateCanonical: (items) => {
    const artifacts = items
      .map((item) => {
        const result = validateSubDesignArtifactManifest(item)
        return result.ok ? result.manifest : null
      })
      .filter((item): item is SubDesignArtifact => Boolean(item))
      .slice(0, 80)
    set({ artifacts })
    persist(artifacts)
  },

  register: (input, defaults, projectRoot) => {
    const result = validateSubDesignArtifactManifest(input, defaults)
    if (!result.ok) return result
    const existing = get().artifacts.find((item) => item.id === result.manifest.id)
    const artifact = existing
      ? { ...result.manifest, createdAt: existing.createdAt, revision: Math.max(existing.revision + 1, result.manifest.revision), updatedAt: new Date().toISOString() }
      : result.manifest
    const artifacts = [artifact, ...get().artifacts].slice(0, 80)
    set({ artifacts })
    persist(artifacts)
    persistSubDesignMetadata('artifact', artifact, projectRoot || get().projectRoot)
    return { ok: true, artifact }
  },

  remove: (id) => {
    const artifacts = get().artifacts.filter((item) => item.id !== id)
    set({ artifacts })
    persist(artifacts)
  },

  findByBriefId: (briefId) => get().artifacts.filter((item) => item.briefId === briefId),

  findById: (id) => get().artifacts.find((item) => item.id === id) || null,
}))
