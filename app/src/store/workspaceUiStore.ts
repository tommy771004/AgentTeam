import { create } from 'zustand'

export type WorkspaceLayoutMode = 'full' | 'compact' | 'float'
export type WorkspacePanel = 'files' | 'editor' | 'terminal' | 'tools'

interface WorkspaceUiStore {
  layoutMode: WorkspaceLayoutMode
  panel: WorkspacePanel
  floatOpen: boolean
  floatPos: { x: number; y: number }
  composer: string
  terminalLog: string[]

  setLayoutMode: (m: WorkspaceLayoutMode) => void
  setPanel: (p: WorkspacePanel) => void
  setFloatOpen: (v: boolean) => void
  setFloatPos: (p: { x: number; y: number }) => void
  setComposer: (v: string) => void
  pushLog: (line: string) => void
  clearLog: () => void
  toggleCompact: () => void
}

const MAX_LOG = 200

export const useWorkspaceUiStore = create<WorkspaceUiStore>((set, get) => ({
  layoutMode: 'full',
  panel: 'files',
  floatOpen: false,
  floatPos: { x: 24, y: 80 },
  composer: '',
  terminalLog: ['SubAgents 控制台就緒。輸入 / 查看指令。'],

  setLayoutMode: (m) =>
    set({
      layoutMode: m,
      floatOpen: m === 'float' || m === 'compact',
    }),
  setPanel: (p) => set({ panel: p }),
  setFloatOpen: (v) => set({ floatOpen: v }),
  setFloatPos: (p) => set({ floatPos: p }),
  setComposer: (v) => set({ composer: v }),
  pushLog: (line) =>
    set({
      terminalLog: [...get().terminalLog, line].slice(-MAX_LOG),
    }),
  clearLog: () => set({ terminalLog: [] }),
  toggleCompact: () => {
    const cur = get().layoutMode
    if (cur === 'full') set({ layoutMode: 'float', floatOpen: true })
    else set({ layoutMode: 'full', floatOpen: false })
  },
}))
