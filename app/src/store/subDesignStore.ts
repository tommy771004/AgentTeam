import { create } from 'zustand'
import {
  createSubDesignBrief,
  normalizeBrief,
  selectSubDesignDirection,
  transitionSubDesignStage,
  updateSubDesignBrief,
} from '../agent/subdesign/brief'
import { scanDesignSystems } from '../agent/subdesign/designSystem'
import type {
  DesignSystemSummary,
  SubDesignBrief,
  SubDesignBriefPatch,
  SubDesignDirection,
  SubDesignStage,
} from '../agent/subdesign/types'

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
  systems: DesignSystemSummary[]
  systemsLoading: boolean
  systemsError: string | null

  hydrate: () => void
  createBrief: (input: Parameters<typeof createSubDesignBrief>[0]) => SubDesignBrief
  updateBrief: (id: string, patch: SubDesignBriefPatch) => SubDesignBrief | null
  setStage: (id: string, stage: SubDesignStage) => StageResult
  selectDirection: (
    id: string,
    directionId: string,
    fallback?: Partial<SubDesignDirection>,
  ) => StageResult
  selectBrief: (id: string | null) => void
  findByThreadId: (threadId: string) => SubDesignBrief | null
  findById: (id: string) => SubDesignBrief | null
  refreshSystems: (projectRoot?: string) => Promise<DesignSystemSummary[]>
  setSystems: (systems: DesignSystemSummary[]) => void
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
  systems: [],
  systemsLoading: false,
  systemsError: null,

  hydrate: () => {
    const briefs = loadBriefs()
    set({ briefs, selectedBriefId: briefs[0]?.id || null })
  },

  createBrief: (input) => {
    const brief = createSubDesignBrief(input)
    const briefs = [brief, ...get().briefs].slice(0, 40)
    set({ briefs, selectedBriefId: brief.id })
    persistBriefs(briefs)
    return brief
  },

  updateBrief: (id, patch) => {
    const brief = get().briefs.find((item) => item.id === id)
    if (!brief) return null
    const next = updateSubDesignBrief(brief, patch)
    replaceBrief(set, get().briefs, next)
    return next
  },

  setStage: (id, stage) => {
    const brief = get().briefs.find((item) => item.id === id)
    if (!brief) return { ok: false, error: `找不到 brief：${id}`, brief: brief as never }
    const result = transitionSubDesignStage(brief, stage)
    if (!result.ok) return { ok: false, error: result.error, brief }
    replaceBrief(set, get().briefs, result.brief)
    return result
  },

  selectDirection: (id, directionId, fallback) => {
    const brief = get().briefs.find((item) => item.id === id)
    if (!brief) return { ok: false, error: `找不到 brief：${id}`, brief: brief as never }
    const result = selectSubDesignDirection(brief, directionId, fallback)
    if (!result.ok) return { ok: false, error: result.error, brief }
    replaceBrief(set, get().briefs, result.brief)
    return result
  },

  selectBrief: (id) => set({ selectedBriefId: id }),

  findByThreadId: (threadId) => get().briefs.find((brief) => brief.threadId === threadId) || null,

  findById: (id) => get().briefs.find((brief) => brief.id === id) || null,

  refreshSystems: async (projectRoot) => {
    set({ systemsLoading: true, systemsError: null })
    try {
      const systems = await scanDesignSystems(projectRoot)
      set({ systems, systemsLoading: false })
      return systems
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ systemsLoading: false, systemsError: message })
      return []
    }
  },

  setSystems: (systems) => set({ systems, systemsError: null }),
}))

export function getSubDesignBriefForThread(threadId: string): SubDesignBrief | null {
  return useSubDesignStore.getState().findByThreadId(threadId)
}

