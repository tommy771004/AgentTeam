import { create } from 'zustand'
type Scope = 'run' | 'conversation' | 'project'
type Draft = { surfaceId: string; scope: Scope; scopeKey: string; values: Record<string, unknown>; updatedAt: string }
type Store = { drafts: Draft[]; saveDraft: (surfaceId: string, scope: Scope, scopeKey: string, values: Record<string, unknown>) => void; loadDraft: (surfaceId: string, scope: Scope, scopeKey: string) => Record<string, unknown> | null; clearDraft: (surfaceId: string, scope: Scope, scopeKey: string) => void }
function keyOf(surfaceId: string, scope: Scope, scopeKey: string) { return `${surfaceId}:${scope}:${scopeKey}` }
const STORAGE_KEY = 'subagents.mcp.surfaceDrafts.v1'
function persist(drafts: Draft[]) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts.slice(0, 100))) } catch {} }
function hydrate(): Draft[] { try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return []; const arr = JSON.parse(raw); return Array.isArray(arr) ? arr.filter(Boolean).slice(0, 100) : [] } catch { return [] } }
export const useSurfaceDraftStore = create<Store>((set, get) => ({
  drafts: typeof window !== 'undefined' ? hydrate() : [],
  saveDraft: (surfaceId, scope, scopeKey, values) => {
    const drafts = [...get().drafts.filter((d) => keyOf(d.surfaceId, d.scope, d.scopeKey) !== keyOf(surfaceId, scope, scopeKey))]
    drafts.unshift({ surfaceId, scope, scopeKey, values, updatedAt: new Date().toISOString() })
    const trimmed = drafts.slice(0, 100); persist(trimmed); set({ drafts: trimmed })
  },
  loadDraft: (surfaceId, scope, scopeKey) => {
    const hit = get().drafts.find((d) => d.surfaceId === surfaceId && d.scope === scope && d.scopeKey === scopeKey); return hit ? hit.values : null
  },
  clearDraft: (surfaceId, scope, scopeKey) => {
    const drafts = get().drafts.filter((d) => keyOf(d.surfaceId, d.scope, d.scopeKey) !== keyOf(surfaceId, scope, scopeKey)); persist(drafts); set({ drafts })
  },
}))
