import { create } from 'zustand'

export type ProjectSource = 'local' | 'github'

export type GitWorktreeInfo = {
  path: string
  branch: string
  bare: boolean
  detached: boolean
}

interface ProjectStore {
  root: string
  name: string
  source: ProjectSource
  branch: string | null
  remote: string | null
  worktrees: GitWorktreeInfo[]
  dirty: boolean
  branches: string[]
  loaded: boolean
  error: string | null
  picking: boolean
  /** 手輸路徑 UI（Electron 無 window.prompt；僅作 fallback） */
  manualPathOpen: boolean

  refresh: () => Promise<void>
  /** 系統資料夾選單（Finder / Explorer）— 主路徑 */
  pickFolder: () => Promise<boolean>
  setRoot: (root: string) => Promise<void>
  selectWorktree: (path: string) => Promise<void>
  clearError: () => void
  openManualPath: () => void
  closeManualPath: () => void
  submitManualPath: (path: string) => Promise<boolean>
  /** 訂閱主進程選單 / 系統匣推送的路徑 */
  bindMenuPick: () => () => void
}

const KEY = 'subagents.project.root.v1'

function loadRoot(): string {
  try {
    return localStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}

function saveRoot(root: string) {
  try {
    if (root) localStorage.setItem(KEY, root)
    else localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

function nameFromPath(p: string) {
  const parts = p.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] || p || '—'
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  root: loadRoot(),
  name: '—',
  source: 'local',
  branch: null,
  remote: null,
  worktrees: [],
  dirty: false,
  branches: [],
  loaded: false,
  error: null,
  picking: false,
  manualPathOpen: false,

  clearError: () => set({ error: null }),
  openManualPath: () => set({ manualPathOpen: true, error: null }),
  closeManualPath: () => set({ manualPathOpen: false }),

  submitManualPath: async (path: string) => {
    const trimmed = path.trim()
    if (!trimmed) {
      set({ error: '請輸入專案資料夾絕對路徑' })
      return false
    }
    set({ picking: true, error: null })
    try {
      await get().setRoot(trimmed)
      set({ picking: false, manualPathOpen: false })
      return true
    } catch (e) {
      set({
        picking: false,
        error: e instanceof Error ? e.message : String(e),
      })
      return false
    }
  },

  bindMenuPick: () => {
    const api = window.subagents?.project?.onSelected
    if (!api) return () => {}
    return api((p) => {
      void get().setRoot(p)
      set({ manualPathOpen: false, error: null, picking: false })
    })
  },

  refresh: async () => {
    const root = get().root
    if (!root) {
      try {
        await window.subagents?.project?.setActiveRoot?.(null)
      } catch {
        /* ignore */
      }
      set({
        loaded: true,
        name: '選擇專案',
        branch: null,
        remote: null,
        worktrees: [],
        dirty: false,
        source: 'local',
        error: null,
      })
      return
    }

    // Re-sync active root (e.g. after app reload)
    try {
      await window.subagents?.project?.setActiveRoot?.(root)
    } catch {
      /* ignore */
    }

    // Electron path
    if (window.subagents?.project?.inspect) {
      try {
        const info = await window.subagents.project.inspect(root)
        const source: ProjectSource =
          info.remote && /github\.com/i.test(info.remote) ? 'github' : 'local'
        let branches: string[] = []
        try {
          branches = await window.subagents.project.branches(root)
        } catch {
          branches = []
        }
        set({
          root: info.root || root,
          name: info.name || nameFromPath(root),
          source,
          branch: info.branch,
          remote: info.remote,
          worktrees: info.worktrees || [],
          dirty: info.dirty,
          branches,
          loaded: true,
          error: null,
        })
        saveRoot(info.root || root)
        return
      } catch (e) {
        set({
          loaded: true,
          name: nameFromPath(root),
          error: e instanceof Error ? e.message : String(e),
        })
        return
      }
    }

    // Browser / no IPC: still show path name
    set({
      loaded: true,
      name: nameFromPath(root),
      source: 'local',
      branch: null,
      worktrees: [],
      error: null,
    })
  },

  pickFolder: async () => {
    set({ picking: true, error: null })
    try {
      // Electron native Finder / Explorer dialog — primary path
      if (window.subagents?.project?.pick) {
        const r = await window.subagents.project.pick({
          defaultPath: get().root || undefined,
        })
        if (r.error) {
          set({
            error: `系統選檔失敗：${r.error}`,
            picking: false,
            // keep manual open only if already open; otherwise still offer it
            manualPathOpen: true,
          })
          return false
        }
        if (r.canceled || !r.path) {
          set({ picking: false })
          return false
        }
        await get().setRoot(r.path)
        set({ picking: false, manualPathOpen: false, error: null })
        return true
      }

      // 無 IPC / preload 失敗：只能手輸
      const inElectronShell =
        typeof navigator !== 'undefined' &&
        /Electron/i.test(navigator.userAgent)
      set({
        picking: false,
        manualPathOpen: true,
        error: window.subagents
          ? '未取得 project.pick API，請完全重啟應用（⌘Q 後再 npm run dev），或手動貼上絕對路徑'
          : inElectronShell
            ? 'Electron preload 未載入（window.subagents 缺失）。請重啟 npm run dev；若仍失敗請看主進程 preload-error 日誌'
            : '目前是瀏覽器分頁（無系統選檔）。請改用 Electron 視窗（npm run dev 啟動的桌面 App），或手動輸入絕對路徑',
      })
      return false
    } catch (e) {
      set({
        picking: false,
        manualPathOpen: true,
        error: e instanceof Error ? e.message : String(e),
      })
      return false
    }
  },

  setRoot: async (root: string) => {
    const r = root.trim()
    set({ root: r, name: nameFromPath(r) || '—' })
    saveRoot(r)
    // Keep electron workspace_* tools & default cwd in sync with ProjectContextBar
    try {
      await window.subagents?.project?.setActiveRoot?.(r || null)
    } catch {
      /* optional API */
    }
    await get().refresh()
  },

  selectWorktree: async (path: string) => {
    await get().setRoot(path)
  },
}))
