import { create } from 'zustand'
import {
  createSubDesignBrief,
  normalizeBrief,
  selectSubDesignDirection,
  transitionSubDesignStage,
  updateSubDesignBrief,
} from '../agent/subdesign/brief.ts'
import { persistSubDesignMetadata } from '../agent/subdesign/metadata.ts'
import type {
  SubDesignBrief,
  SubDesignBriefPatch,
  SubDesignDirection,
  SubDesignStage,
} from '../agent/subdesign/types.ts'

const STORAGE_KEY = 'subagents.subdesign.briefs.v1'

function loadBriefs(): SubDesignBrief[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeBrief).filter((brief): brief is SubDesignBrief => Boolean(brief)).slice(0, 40)
  } catch {
    return []
  }
}

function persistBriefs(briefs: SubDesignBrief[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(briefs.slice(0, 40)))
  } catch {
    /* localStorage is optional in the browser preview. */
  }
}

type StageResult =
  | { ok: true; brief: SubDesignBrief }
  | { ok: false; error: string; brief: SubDesignBrief }

interface SubDesignStore {
  briefs: SubDesignBrief[]
  selectedBriefId: string | null
  projectRoot: string

  hydrate: () => void
  hydrateCanonical: (items: unknown[]) => void
  setProjectRoot: (root: string) => void
  createBrief: (input: Parameters<typeof createSubDesignBrief>[0] & { projectRoot?: string }) => SubDesignBrief
  updateBrief: (id: string, patch: SubDesignBriefPatch, projectRoot?: string) => SubDesignBrief | null
  setStage: (id: string, stage: SubDesignStage, projectRoot?: string) => StageResult
  selectDirection: (
    id: string,
    directionId: string,
    fallback?: Partial<SubDesignDirection>,
    projectRoot?: string,
  ) => StageResult
  selectBrief: (id: string | null) => void
  findByThreadId: (threadId: string) => SubDesignBrief | null
  findById: (id: string) => SubDesignBrief | null
}

function replaceBrief(set: (value: { briefs: SubDesignBrief[] }) => void, briefs: SubDesignBrief[], next: SubDesignBrief) {
  const updated = briefs.map((brief) => (brief.id === next.id ? next : brief))
  set({ briefs: updated })
  persistBriefs(updated)
  return next
}

export const useSubDesignStore = create<SubDesignStore>((set, get) => ({
  briefs: loadBriefs(),
  selectedBriefId: null,
  projectRoot: '',

  hydrate: () => {
    const briefs = loadBriefs()
    set({ briefs, selectedBriefId: briefs[0]?.id || null })
  },

  hydrateCanonical: (items) => {
    const briefs = items.map(normalizeBrief).filter((brief): brief is SubDesignBrief => Boolean(brief)).slice(0, 40)
    set({ briefs, selectedBriefId: briefs[0]?.id || null })
    persistBriefs(briefs)
  },

  setProjectRoot: (root) => set({ projectRoot: root }),

  createBrief: (input) => {
    const { projectRoot, ...briefInput } = input
    const brief = createSubDesignBrief(briefInput)
    const briefs = [brief, ...get().briefs].slice(0, 40)
    set({ briefs, selectedBriefId: brief.id })
    persistBriefs(briefs)
    persistSubDesignMetadata('brief', brief, projectRoot || get().projectRoot)
    return brief
  },

  updateBrief: (id, patch, projectRoot) => {
    const brief = get().briefs.find((item) => item.id === id)
    if (!brief) return null
    const next = updateSubDesignBrief(brief, patch)
    replaceBrief(set, get().briefs, next)
    persistSubDesignMetadata('brief', next, projectRoot || get().projectRoot)
    return next
  },

  setStage: (id, stage, projectRoot) => {
    const brief = get().briefs.find((item) => item.id === id)
    if (!brief) return { ok: false, error: `找不到 brief：${id}`, brief: brief as never }
    const result = transitionSubDesignStage(brief, stage)
    if (!result.ok) return { ok: false, error: result.error, brief }
    replaceBrief(set, get().briefs, result.brief)
    persistSubDesignMetadata('brief', result.brief, projectRoot || get().projectRoot)
    return result
  },

  selectDirection: (id, directionId, fallback, projectRoot) => {
    const brief = get().briefs.find((item) => item.id === id)
    if (!brief) return { ok: false, error: `找不到 brief：${id}`, brief: brief as never }
    const result = selectSubDesignDirection(brief, directionId, fallback)
    if (!result.ok) return { ok: false, error: result.error, brief }
    replaceBrief(set, get().briefs, result.brief)
    persistSubDesignMetadata('brief', result.brief, projectRoot || get().projectRoot)
    return result
  },

  selectBrief: (id) => set({ selectedBriefId: id }),

  findByThreadId: (threadId) => get().briefs.find((brief) => brief.threadId === threadId) || null,

  findById: (id) => get().briefs.find((brief) => brief.id === id) || null,

}))

export function getSubDesignBriefForThread(threadId: string): SubDesignBrief | null {
  return useSubDesignStore.getState().findByThreadId(threadId)
}
