import { create } from 'zustand'
type Scope = 'run' | 'conversation' | 'project'
/** The three fields that identify a draft always travel together. */
export type SurfaceDraftRef = { surfaceId: string; scope: Scope; scopeKey: string }
type Draft = SurfaceDraftRef & { values: Record<string, unknown>; updatedAt: string }
type Store = {
  drafts: Draft[]
  saveDraft: (ref: SurfaceDraftRef, values: Record<string, unknown>) => void
  loadDraft: (ref: SurfaceDraftRef) => Record<string, unknown> | null
  clearDraft: (ref: SurfaceDraftRef) => void
}
/** Draft identity: a surface's draft is scoped, so a reload finds the same one. */
export function surfaceDraftKey({ surfaceId, scope, scopeKey }: SurfaceDraftRef) { return `${surfaceId}:${scope}:${scopeKey}` }
const STORAGE_KEY = 'subagents.mcp.surfaceDrafts.v1'
function persist(drafts: Draft[]) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts.slice(0, 100))) } catch {} }
function hydrate(): Draft[] { try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return []; const arr = JSON.parse(raw); return Array.isArray(arr) ? arr.filter(Boolean).slice(0, 100) : [] } catch { return [] } }
export const useSurfaceDraftStore = create<Store>((set, get) => ({
  drafts: typeof window !== 'undefined' ? hydrate() : [],
  saveDraft: (ref, values) => {
    const key = surfaceDraftKey(ref)
    const drafts = get().drafts.filter((d) => surfaceDraftKey(d) !== key)
    drafts.unshift({ ...ref, values, updatedAt: new Date().toISOString() })
    const trimmed = drafts.slice(0, 100); persist(trimmed); set({ drafts: trimmed })
  },
  loadDraft: (ref) => {
    const key = surfaceDraftKey(ref)
    return get().drafts.find((d) => surfaceDraftKey(d) === key)?.values ?? null
  },
  clearDraft: (ref) => {
    const key = surfaceDraftKey(ref)
    const drafts = get().drafts.filter((d) => surfaceDraftKey(d) !== key); persist(drafts); set({ drafts })
  },
}))
