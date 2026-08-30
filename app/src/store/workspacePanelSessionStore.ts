import { create } from 'zustand'
import type { ReviewTarget } from '../agent/reviewContract.ts'

export type WorkspacePanelTarget =
  | { kind: 'summary'; runId: string; threadId: string }
  | { kind: 'review'; target: ReviewTarget }
  | { kind: 'verification'; runId: string; snapshotId: string; revision?: string }
  | { kind: 'terminal'; sessionId?: string }

export type WorkspacePanelTab = {
  id: string
  title: string
  target: WorkspacePanelTarget
  selectedPath?: string
}

export type WorkspacePanelDock = 'right' | 'bottom'

type PersistedWorkspacePanelSession = {
  version: 1
  tabs: WorkspacePanelTab[]
  activeTabId?: string
  dock: WorkspacePanelDock
  reviewWidth: number
  maximized: boolean
}

type WorkspacePanelSessionStore = PersistedWorkspacePanelSession & {
  openTab: (target: WorkspacePanelTarget, title?: string) => string
  focusTab: (id: string) => void
  closeTab: (id: string) => void
  selectPath: (id: string, path?: string) => void
  setDock: (dock: WorkspacePanelDock) => void
  setReviewWidth: (width: number) => void
  setMaximized: (maximized: boolean) => void
  restore: () => void
  resetPresentation: () => void
}

const STORAGE_KEY = 'agentstudio.workspace-panel-session.v1'
const DEFAULT_STATE: PersistedWorkspacePanelSession = { version: 1, tabs: [], dock: 'right', reviewWidth: 640, maximized: false }

function stable(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return JSON.stringify(value)
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`
}

export function workspacePanelTabId(target: WorkspacePanelTarget): string {
  if (target.kind === 'summary') return `summary:${target.runId}`
  if (target.kind === 'review') return `review:${stable(target.target)}`
  if (target.kind === 'verification') return `verification:${target.runId}:${target.revision || 'latest'}`
  return `terminal:${target.sessionId || 'main'}`
}

function defaultTitle(target: WorkspacePanelTarget): string {
  if (target.kind === 'summary') return '執行摘要'
  if (target.kind === 'review') return '審查'
  if (target.kind === 'verification') return '驗證'
  return '終端機'
}

function safePersist(state: PersistedWorkspacePanelSession): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* unavailable/blocked storage */ }
}

function safeRestore(): PersistedWorkspacePanelSession {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<PersistedWorkspacePanelSession> | null
    if (!value || value.version !== 1 || !Array.isArray(value.tabs)) return DEFAULT_STATE
    const tabs = value.tabs.filter((tab): tab is WorkspacePanelTab => Boolean(tab && typeof tab.id === 'string' && typeof tab.title === 'string' && tab.target && typeof tab.target.kind === 'string'))
    const activeTabId = tabs.some((tab) => tab.id === value.activeTabId) ? value.activeTabId : tabs[0]?.id
    return { version: 1, tabs, activeTabId, dock: value.dock === 'bottom' ? 'bottom' : 'right', reviewWidth: Math.min(960, Math.max(420, Number(value.reviewWidth) || 640)), maximized: value.maximized === true }
  } catch { return DEFAULT_STATE }
}

function persisted(state: WorkspacePanelSessionStore): PersistedWorkspacePanelSession {
  return { version: 1, tabs: state.tabs, activeTabId: state.activeTabId, dock: state.dock, reviewWidth: state.reviewWidth, maximized: state.maximized }
}

export const useWorkspacePanelSessionStore = create<WorkspacePanelSessionStore>((set, get) => ({
  ...DEFAULT_STATE,
  openTab: (target, title) => {
    const id = workspacePanelTabId(target)
    const current = get()
    if (current.tabs.some((tab) => tab.id === id)) {
      set({ activeTabId: id })
    } else {
      set({ tabs: [...current.tabs, { id, title: title || defaultTitle(target), target }], activeTabId: id })
    }
    safePersist(persisted(get()))
    return id
  },
  focusTab: (id) => {
    if (!get().tabs.some((tab) => tab.id === id)) return
    set({ activeTabId: id })
    safePersist(persisted(get()))
  },
  closeTab: (id) => {
    const current = get()
    const index = current.tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const tabs = current.tabs.filter((tab) => tab.id !== id)
    const activeTabId = current.activeTabId === id ? tabs[Math.min(index, tabs.length - 1)]?.id : current.activeTabId
    set({ tabs, activeTabId })
    safePersist(persisted(get()))
  },
  selectPath: (id, path) => {
    set({ tabs: get().tabs.map((tab) => tab.id === id ? { ...tab, selectedPath: path } : tab) })
    safePersist(persisted(get()))
  },
  setDock: (dock) => { set({ dock }); safePersist(persisted(get())) },
  setReviewWidth: (width) => { set({ reviewWidth: Math.min(960, Math.max(420, width)) }); safePersist(persisted(get())) },
  setMaximized: (maximized) => { set({ maximized }); safePersist(persisted(get())) },
  restore: () => set(safeRestore()),
  resetPresentation: () => { set(DEFAULT_STATE); safePersist(DEFAULT_STATE) },
}))
