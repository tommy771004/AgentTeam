/**
 * Live run activity for Codex-style center feed (thought / tools / draft text / files).
 * Ephemeral — not persisted in thread bubbles.
 */

import { create } from 'zustand'

export type RunActivityKind =
  | 'status'
  | 'thought'
  | 'text'
  | 'tool'
  | 'file'
  | 'log'
  | 'error'
  | 'done'

export type RunActivityEvent = {
  id: string
  at: number
  kind: RunActivityKind
  title?: string
  detail?: string
  tool?: string
  ok?: boolean
  /** File path when kind=file */
  path?: string
  added?: number
  removed?: number
}

export type FileChangeRecord = {
  path: string
  action: 'edit' | 'create' | 'delete' | 'write' | 'read'
  added?: number
  removed?: number
  at: number
}

/** IPC payload from main → renderer during CLI stream */
export type CliStreamPayload = {
  runId?: string
  kind: RunActivityKind | 'chunk'
  title?: string
  detail?: string
  tool?: string
  ok?: boolean
  delta?: string
  channel?: 'thought' | 'text' | 'stdout' | 'stderr'
  path?: string
  paths?: string[]
  added?: number
  removed?: number
  action?: FileChangeRecord['action']
}

interface RunActivityStore {
  runId: string | null
  active: boolean
  events: RunActivityEvent[]
  thought: string
  draftText: string
  statusLine: string
  /** Unique file edits for final Codex-style summary card */
  fileChanges: FileChangeRecord[]

  begin: (runId?: string) => void
  end: () => void
  clear: () => void
  push: (ev: Omit<RunActivityEvent, 'id' | 'at'> & { id?: string }) => void
  appendThought: (delta: string) => void
  appendText: (delta: string) => void
  setStatus: (line: string) => void
  recordFileChange: (f: Omit<FileChangeRecord, 'at'> & { at?: number }) => void
  handleCliStream: (payload: CliStreamPayload) => void
}

let seq = 0
function nid(prefix = 'ra') {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq}`
}

const MAX_EVENTS = 120
const MAX_THOUGHT = 12_000
const MAX_DRAFT = 40_000
const MAX_FILES = 80

function basen(p: string) {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || p
}

export const useRunActivityStore = create<RunActivityStore>((set, get) => ({
  runId: null,
  active: false,
  events: [],
  thought: '',
  draftText: '',
  statusLine: '',
  fileChanges: [],

  begin: (runId) =>
    set({
      runId: runId || nid('run'),
      active: true,
      events: [],
      thought: '',
      draftText: '',
      statusLine: '啟動中…',
      fileChanges: [],
    }),

  end: () => set({ active: false, statusLine: get().statusLine || '完成' }),

  clear: () =>
    set({
      runId: null,
      active: false,
      events: [],
      thought: '',
      draftText: '',
      statusLine: '',
      fileChanges: [],
    }),

  push: (ev) => {
    const item: RunActivityEvent = {
      id: ev.id || nid(),
      at: Date.now(),
      kind: ev.kind,
      title: ev.title,
      detail: ev.detail?.slice(0, 2000),
      tool: ev.tool,
      ok: ev.ok,
      path: ev.path,
      added: ev.added,
      removed: ev.removed,
    }
    set((s) => ({
      events: [...s.events, item].slice(-MAX_EVENTS),
      statusLine:
        ev.kind === 'status' || ev.kind === 'tool' || ev.kind === 'file' || ev.kind === 'error'
          ? (ev.title || ev.detail || s.statusLine).slice(0, 200)
          : s.statusLine,
    }))
  },

  appendThought: (delta) => {
    if (!delta) return
    set((s) => ({
      thought: (s.thought + delta).slice(-MAX_THOUGHT),
      active: true,
    }))
  },

  appendText: (delta) => {
    if (!delta) return
    set((s) => ({
      draftText: (s.draftText + delta).slice(-MAX_DRAFT),
      active: true,
    }))
  },

  setStatus: (line) => set({ statusLine: line.slice(0, 200) }),

  recordFileChange: (f) => {
    const path = (f.path || '').trim()
    if (!path) return
    set((s) => {
      const prev = s.fileChanges.findIndex((x) => x.path === path)
      const next: FileChangeRecord = {
        path,
        action: f.action || 'edit',
        added: f.added,
        removed: f.removed,
        at: f.at || Date.now(),
      }
      let list: FileChangeRecord[]
      if (prev >= 0) {
        list = [...s.fileChanges]
        const old = list[prev]
        list[prev] = {
          ...old,
          ...next,
          added: f.added ?? old.added,
          removed: f.removed ?? old.removed,
          action: f.action || old.action,
        }
      } else {
        list = [...s.fileChanges, next].slice(-MAX_FILES)
      }
      return { fileChanges: list }
    })
  },

  handleCliStream: (payload) => {
    const s = get()
    if (payload.runId && s.runId && payload.runId !== s.runId) return

    if (payload.channel === 'thought' || payload.kind === 'thought') {
      const delta = payload.delta || payload.detail || ''
      if (delta) {
        if (!s.thought) {
          get().push({ kind: 'status', title: '開始思考' })
          get().setStatus('思考中…')
        }
        get().appendThought(delta)
      }
      return
    }
    if (payload.channel === 'text' || payload.kind === 'text') {
      const delta = payload.delta || payload.detail || ''
      if (delta) {
        if (!s.draftText) {
          get().push({ kind: 'status', title: '產生回答' })
          get().setStatus('產生回答…')
        }
        get().appendText(delta)
      }
      return
    }
    if (payload.kind === 'chunk') {
      if (payload.detail?.trim()) {
        get().push({
          kind: 'log',
          title: payload.channel === 'stderr' ? 'stderr' : 'stdout',
          detail: payload.detail.slice(0, 400),
        })
      }
      return
    }
    if (payload.kind === 'done') {
      get().push({
        kind: 'done',
        title: payload.title || 'CLI 完成',
        detail: payload.detail,
        ok: payload.ok !== false,
      })
      set({ active: false })
      return
    }

    // Multi-path file events (Codex batch)
    const paths = [
      ...(payload.path ? [payload.path] : []),
      ...(payload.paths || []),
    ]
      .map((p) => String(p).trim())
      .filter(Boolean)

    if (payload.kind === 'file' || paths.length > 0) {
      for (const p of paths.length ? paths : [payload.detail || '']) {
        const path = p.trim()
        if (!path || path.length > 500) continue
        const action = payload.action || 'edit'
        const label =
          action === 'create'
            ? `已建立 ${basen(path)}`
            : action === 'delete'
              ? `已刪除 ${basen(path)}`
              : `已編輯 ${basen(path)}`
        get().recordFileChange({
          path,
          action,
          added: payload.added,
          removed: payload.removed,
        })
        get().push({
          kind: 'file',
          title: payload.title || label,
          detail: path,
          path,
          tool: payload.tool,
          ok: payload.ok !== false,
          added: payload.added,
          removed: payload.removed,
        })
      }
      if (paths.length) return
    }

    if (payload.kind === 'tool') {
      get().push({
        kind: 'tool',
        title: payload.title || (payload.tool ? `已執行 ${payload.tool}` : '已執行指令'),
        detail: payload.detail || payload.delta,
        tool: payload.tool,
        ok: payload.ok,
      })
      // Infer file path from tool detail when CLIs don't emit structured file events
      const detail = payload.detail || ''
      const m =
        detail.match(/(?:path|file|filename)["']?\s*[:=]\s*["']([^"']+)["']/i) ||
        detail.match(/((?:[A-Za-z]:)?(?:[\\/][\w.\-@]+)+\.\w{1,12})/)
      if (m?.[1] && /write|edit|create|patch|apply/i.test(payload.tool || payload.title || '')) {
        get().recordFileChange({ path: m[1], action: 'edit' })
        get().push({
          kind: 'file',
          title: `已編輯 ${basen(m[1])}`,
          path: m[1],
          detail: m[1],
          ok: true,
        })
      }
      return
    }

    get().push({
      kind:
        payload.kind === 'error'
          ? 'error'
          : payload.kind === 'log'
            ? 'log'
            : 'status',
      title: payload.title,
      detail: payload.detail || payload.delta,
      tool: payload.tool,
      ok: payload.ok,
    })
  },
}))
