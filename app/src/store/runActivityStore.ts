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
  /** Run identity used to keep concurrent streams isolated. */
  runId?: string
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

export type RunTaskStatus = 'pending' | 'active' | 'done' | 'failed'

/** 分析出的須執行任務項（TodoWrite / update_plan / checkbox 解析）→ 右側面板即時同步 */
export type RunTaskItem = {
  id: string
  text: string
  status: RunTaskStatus
  at: number
}

/** IPC payload from main → renderer during CLI stream */
export type CliStreamPayload = {
  runId?: string
  kind: RunActivityKind | 'chunk' | 'plan'
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
  /** kind=plan：完整任務清單快照 */
  todos?: Array<{ text: string; status?: string }>
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
  /** 分析出的須執行任務項 — 右側面板即時同步 */
  tasks: RunTaskItem[]

  begin: (runId?: string) => void
  end: (runId?: string) => void
  clear: () => void
  push: (ev: Omit<RunActivityEvent, 'id' | 'at'> & { id?: string }) => void
  appendThought: (delta: string) => void
  appendText: (delta: string) => void
  setStatus: (line: string, runId?: string) => void
  recordFileChange: (f: Omit<FileChangeRecord, 'at'> & { at?: number }) => void
  /** 以完整快照取代任務清單（結構化 plan 事件） */
  setTasks: (todos: Array<{ text: string; status?: string }>, runId?: string) => void
  /** 文字流 checkbox 解析 → 新增或更新單項 */
  upsertTask: (text: string, status: RunTaskStatus) => void
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
const MAX_TASKS = 40

function basen(p: string) {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || p
}

function normalizeTaskStatus(raw?: string): RunTaskStatus {
  const s = (raw || '').toLowerCase()
  if (s.includes('done') || s.includes('complete')) return 'done'
  if (s.includes('progress') || s.includes('active')) return 'active'
  if (s.includes('fail') || s.includes('error')) return 'failed'
  return 'pending'
}

function taskKey(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** 逐行掃描文字流的 markdown checkbox（- [ ] / - [x]）*/
const taskLineBuf: Record<'thought' | 'text', string> = { thought: '', text: '' }

function resetTaskLineBuf() {
  taskLineBuf.thought = ''
  taskLineBuf.text = ''
}

function scanTaskLines(
  channel: 'thought' | 'text',
  delta: string,
  upsert: (text: string, status: RunTaskStatus) => void,
) {
  taskLineBuf[channel] = (taskLineBuf[channel] + delta).slice(-4000)
  const parts = taskLineBuf[channel].split('\n')
  taskLineBuf[channel] = parts.pop() || ''
  for (const raw of parts) {
    const m = raw.trim().match(/^[-*]\s*\[([ xX])\]\s+(.+)$/)
    if (m?.[2]?.trim()) {
      upsert(m[2].trim().slice(0, 200), m[1] === ' ' ? 'pending' : 'done')
    }
  }
}

export const useRunActivityStore = create<RunActivityStore>((set, get) => ({
  runId: null,
  active: false,
  events: [],
  thought: '',
  draftText: '',
  statusLine: '',
  fileChanges: [],
  tasks: [],

  begin: (runId) => {
    resetTaskLineBuf()
    set({
      runId: runId || nid('run'),
      active: true,
      events: [],
      thought: '',
      draftText: '',
      statusLine: '啟動中…',
      fileChanges: [],
      tasks: [],
    })
  },

  end: (runId) => {
    const current = get()
    if (runId && current.runId && current.runId !== runId) return
    set({ active: false, statusLine: current.statusLine || '完成' })
  },

  clear: () => {
    resetTaskLineBuf()
    set({
      runId: null,
      active: false,
      events: [],
      thought: '',
      draftText: '',
      statusLine: '',
      fileChanges: [],
      tasks: [],
    })
  },

  push: (ev) => {
    const current = get()
    if (ev.runId && current.runId && ev.runId !== current.runId) return
    const item: RunActivityEvent = {
      id: ev.id || nid(),
      at: Date.now(),
      runId: ev.runId || current.runId || undefined,
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

  setStatus: (line, runId) => {
    const current = get()
    if (runId && current.runId && current.runId !== runId) return
    set({ statusLine: line.slice(0, 200) })
  },

  setTasks: (todos, runId) => {
    const current = get()
    if (runId && current.runId && current.runId !== runId) return
    const now = Date.now()
    const seen = new Set<string>()
    const tasks: RunTaskItem[] = []
    for (const t of todos.slice(0, MAX_TASKS)) {
      const text = (t.text || '').trim()
      if (!text) continue
      const key = taskKey(text)
      if (seen.has(key)) continue
      seen.add(key)
      const prev = get().tasks.find((x) => taskKey(x.text) === key)
      tasks.push({
        id: prev?.id || nid('task'),
        text: text.slice(0, 200),
        status: normalizeTaskStatus(t.status),
        at: prev?.at || now,
      })
    }
    if (tasks.length) {
      set({ tasks })
      // Persist the latest snapshot on the run's thread. The explicit runId
      // prevents a late concurrent stream from writing into another thread.
      void import('./threadStore').then(({ useThreadStore }) => {
        const threadState = useThreadStore.getState()
        const threadId = runId
          ? threadState.threads.find((thread) => threadState.runningRunIds[thread.id] === runId)?.id
          : threadState.runningThreadId
        if (threadId) useThreadStore.getState().setRunPlan(threadId, tasks)
      })
    }
  },

  upsertTask: (text, status) => {
    const clean = text.trim()
    if (!clean) return
    const key = taskKey(clean)
    set((s) => {
      const idx = s.tasks.findIndex((x) => taskKey(x.text) === key)
      if (idx >= 0) {
        if (s.tasks[idx].status === status) return s
        const tasks = [...s.tasks]
        tasks[idx] = { ...tasks[idx], status }
        return { tasks }
      }
      if (s.tasks.length >= MAX_TASKS) return s
      return {
        tasks: [...s.tasks, { id: nid('task'), text: clean.slice(0, 200), status, at: Date.now() }],
      }
    })
  },

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
    // Streams are tagged at the Electron boundary. A late event from another
    // concurrent run must never mutate the currently visible feed.
    if (s.runId && payload.runId && payload.runId !== s.runId) return
    if (s.active && s.runId && !payload.runId) return
    const streamRunId = payload.runId || s.runId || undefined

    // 結構化任務清單（TodoWrite / update_plan / todo_list）→ 完整快照取代
    if (payload.kind === 'plan') {
      if (payload.todos?.length) {
        get().setTasks(payload.todos, streamRunId)
        get().push({
          kind: 'status',
          runId: streamRunId,
          title: payload.title || '任務清單更新',
          detail: `${payload.todos.length} 項`,
        })
      }
      return
    }

    if (payload.channel === 'thought' || payload.kind === 'thought') {
      const delta = payload.delta || payload.detail || ''
      if (delta) {
        if (!s.thought) {
          get().push({ kind: 'status', title: '開始思考' })
          get().setStatus('思考中…', streamRunId)
        }
        get().appendThought(delta)
        scanTaskLines('thought', delta, get().upsertTask)
      }
      return
    }
    if (payload.channel === 'text' || payload.kind === 'text') {
      const delta = payload.delta || payload.detail || ''
      if (delta) {
        if (!s.draftText) {
          get().push({ kind: 'status', title: '產生回答' })
          get().setStatus('產生回答…', streamRunId)
        }
        get().appendText(delta)
        scanTaskLines('text', delta, get().upsertTask)
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
        runId: streamRunId,
        title: payload.title || 'CLI 完成',
        detail: payload.detail,
        ok: payload.ok !== false,
      })
      set({ active: false })
      return
    }

    // Multi-path file events (Codex batch)
    const paths = [...new Set([
      ...(payload.path ? [payload.path] : []),
      ...(payload.paths || []),
    ]
      .map((p) => String(p).trim())
      .filter(Boolean))]

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
        runId: streamRunId,
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
          runId: streamRunId,
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
          runId: streamRunId,
          title: `已編輯 ${basen(m[1])}`,
          path: m[1],
          detail: m[1],
          ok: true,
        })
      }
      return
    }

    get().push({
      runId: streamRunId,
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
