import { create } from 'zustand'
import type { SpeedMode, ThinkingDepth } from '../agent/thinking'
import type { AgentMode, ExecutionStatus, LoopType } from '../agent/types'
import type { ChatAttachment } from '../agent/types'
import { sanitizeAttachmentsForStorage } from '../lib/chatAttachments'

const KEY = 'subagents.threads.v5'

/** builtin = 內建 engine；其餘 = 本機 CLI 訂閱 */
export type ThreadRunner = 'builtin' | 'codex' | 'claude' | 'grok' | 'opencode' | 'cursor'
const MAX_THREADS = 40
const MAX_BUBBLES = 100

export type ThreadBubble = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  at: string
  /** Optional user message attachments (images / files) */
  attachments?: ChatAttachment[]
}

export type Thread = {
  id: string
  title: string
  /** Per-conversation model (empty = use global settings.model) */
  model: string
  /** Thinking depth for this thread */
  thinkingDepth: ThinkingDepth
  /** 速度偏好（附圖「速度」） */
  speed: SpeedMode
  /** OpenCode primary agent: build | plan */
  agentMode: AgentMode
  /** 執行引擎：內建 or 本機 CLI */
  runner: ThreadRunner
  loopType: LoopType | null
  bubbles: ThreadBubble[]
  createdAt: string
  updatedAt: string
  lastStatus?: ExecutionStatus | 'idle'
  pinned?: boolean
  /** legacy field ignored if present in old storage */
  provider?: string
  /**
   * Capability ids loaded in the last successful/finished run on this thread.
   * Restored as preload on the next run (cross-run progressive disclosure).
   */
  lastCapabilityIds?: string[]
  /** tool_search unlock set from last run */
  lastUnlockedTools?: string[]
}

interface ThreadStore {
  threads: Thread[]
  activeId: string | null
  showRunPanel: boolean
  showThreadList: boolean
  runningThreadId: string | null

  hydrate: () => void
  createThread: (
    opts?: Partial<
      Pick<
        Thread,
        'title' | 'model' | 'thinkingDepth' | 'speed' | 'loopType' | 'agentMode' | 'runner'
      >
    >,
  ) => string
  selectThread: (id: string) => void
  deleteThread: (id: string) => void
  renameThread: (id: string, title: string) => void
  setModel: (id: string, model: string) => void
  setThinkingDepth: (id: string, depth: ThinkingDepth) => void
  setSpeed: (id: string, speed: SpeedMode) => void
  setAgentMode: (id: string, mode: AgentMode) => void
  setRunner: (id: string, runner: ThreadRunner) => void
  setLoopType: (id: string, loop: LoopType | null) => void
  pushBubble: (
    threadId: string,
    role: ThreadBubble['role'],
    content: string,
    attachments?: ChatAttachment[],
  ) => void
  clearBubbles: (threadId: string) => void
  setShowRunPanel: (v: boolean) => void
  setShowThreadList: (v: boolean) => void
  setRunningThreadId: (id: string | null) => void
  setThreadStatus: (id: string, status: ExecutionStatus | 'idle') => void
  /** Persist capability / tool_search state for next run on this thread */
  setLastCapabilities: (
    id: string,
    capabilityIds: string[],
    unlockedTools?: string[],
  ) => void
  activeThread: () => Thread | null
}

function uid() {
  return `th_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function persist(threads: Thread[], activeId: string | null) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ threads, activeId }))
  } catch {
    /* ignore */
  }
}

function migrateThread(raw: Record<string, unknown>): Thread {
  const now = new Date().toISOString()
  const depth = (raw.thinkingDepth as ThinkingDepth) || 'deep'
  const speed = (raw.speed as SpeedMode) || 'standard'
  const agentMode = (raw.agentMode as AgentMode) || 'build'
  const runnerRaw = String(raw.runner || 'builtin') as ThreadRunner
  const runners: ThreadRunner[] = ['builtin', 'codex', 'claude', 'grok', 'opencode', 'cursor']
  const depthOk = ['fast', 'standard', 'deep', 'max', 'ultra'].includes(depth)
  return {
    id: String(raw.id || uid()),
    title: String(raw.title || '新對話'),
    model: typeof raw.model === 'string' ? raw.model : '',
    thinkingDepth: depthOk ? depth : 'deep',
    speed: ['fast', 'standard', 'careful'].includes(speed) ? speed : 'standard',
    agentMode: agentMode === 'plan' ? 'plan' : 'build',
    runner: runners.includes(runnerRaw) ? runnerRaw : 'builtin',
    loopType: (raw.loopType as LoopType) || null,
    bubbles: Array.isArray(raw.bubbles) ? (raw.bubbles as Thread['bubbles']) : [],
    createdAt: String(raw.createdAt || now),
    updatedAt: String(raw.updatedAt || now),
    lastStatus: (raw.lastStatus as Thread['lastStatus']) || 'idle',
    pinned: Boolean(raw.pinned),
    lastCapabilityIds: Array.isArray(raw.lastCapabilityIds)
      ? (raw.lastCapabilityIds as string[]).filter((x) => typeof x === 'string')
      : undefined,
    lastUnlockedTools: Array.isArray(raw.lastUnlockedTools)
      ? (raw.lastUnlockedTools as string[]).filter((x) => typeof x === 'string')
      : undefined,
  }
}

function load(): { threads: Thread[]; activeId: string | null } {
  try {
    for (const k of [KEY, 'subagents.threads.v3', 'subagents.threads.v2']) {
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const data = JSON.parse(raw) as { threads?: unknown[]; activeId?: string | null }
      if (!Array.isArray(data.threads)) continue
      const threads = data.threads.map((t) => migrateThread(t as Record<string, unknown>))
      return {
        threads,
        activeId: data.activeId ?? null,
      }
    }
    return { threads: [], activeId: null }
  } catch {
    return { threads: [], activeId: null }
  }
}

function titleFromText(text: string) {
  const t = text.replace(/^\/\S+\s*/, '').trim()
  return (t || '新對話').slice(0, 42)
}

function emptyThread(partial?: Partial<Thread>): Thread {
  const now = new Date().toISOString()
  return {
    id: uid(),
    title: partial?.title || '新對話',
    model: partial?.model || '',
    thinkingDepth: partial?.thinkingDepth || 'deep',
    speed: partial?.speed || 'standard',
    agentMode: partial?.agentMode || 'build',
    runner: partial?.runner || 'builtin',
    loopType: partial?.loopType ?? null,
    bubbles: [],
    createdAt: now,
    updatedAt: now,
    lastStatus: 'idle',
  }
}

export const useThreadStore = create<ThreadStore>((set, get) => ({
  threads: [],
  activeId: null,
  showRunPanel: false,
  showThreadList: true,
  runningThreadId: null,

  hydrate: () => {
    const { threads, activeId } = load()
    if (threads.length === 0) {
      const t = emptyThread()
      set({ threads: [t], activeId: t.id })
      persist([t], t.id)
      return
    }
    set({
      threads,
      activeId: activeId && threads.some((t) => t.id === activeId) ? activeId : threads[0].id,
    })
    persist(
      threads,
      activeId && threads.some((t) => t.id === activeId) ? activeId : threads[0].id,
    )
  },

  createThread: (opts) => {
    const t = emptyThread(opts)
    const threads = [t, ...get().threads].slice(0, MAX_THREADS)
    set({ threads, activeId: t.id, showRunPanel: false })
    persist(threads, t.id)
    return t.id
  },

  selectThread: (id) => {
    if (!get().threads.some((t) => t.id === id)) return
    set({ activeId: id })
    persist(get().threads, id)
  },

  deleteThread: (id) => {
    let threads = get().threads.filter((t) => t.id !== id)
    let activeId = get().activeId
    if (threads.length === 0) {
      const t = emptyThread()
      threads = [t]
      activeId = t.id
    } else if (activeId === id) {
      activeId = threads[0].id
    }
    set({ threads, activeId })
    persist(threads, activeId)
  },

  renameThread: (id, title) => {
    const threads = get().threads.map((t) =>
      t.id === id ? { ...t, title: title.slice(0, 60), updatedAt: new Date().toISOString() } : t,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  setModel: (id, model) => {
    const threads = get().threads.map((t) =>
      t.id === id ? { ...t, model, updatedAt: new Date().toISOString() } : t,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  setThinkingDepth: (id, depth) => {
    const threads = get().threads.map((t) =>
      t.id === id ? { ...t, thinkingDepth: depth, updatedAt: new Date().toISOString() } : t,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  setSpeed: (id, speed) => {
    const threads = get().threads.map((t) =>
      t.id === id ? { ...t, speed, updatedAt: new Date().toISOString() } : t,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  setAgentMode: (id, mode) => {
    const threads = get().threads.map((t) =>
      t.id === id ? { ...t, agentMode: mode, updatedAt: new Date().toISOString() } : t,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  setRunner: (id, runner) => {
    const threads = get().threads.map((t) =>
      t.id === id ? { ...t, runner, updatedAt: new Date().toISOString() } : t,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  setLoopType: (id, loop) => {
    const threads = get().threads.map((t) =>
      t.id === id ? { ...t, loopType: loop, updatedAt: new Date().toISOString() } : t,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  pushBubble: (threadId, role, content, attachments) => {
    const c = content.trim()
    const atts = attachments?.length ? attachments : undefined
    if (!c && !atts?.length) return
    const bubble: ThreadBubble = {
      id: `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      role,
      content: (c || (atts?.length ? `（${atts.length} 個附件）` : '')).slice(0, 8000),
      at: new Date().toISOString(),
      attachments: sanitizeAttachmentsForStorage(atts),
    }
    const threads = get().threads.map((t) => {
      if (t.id !== threadId) return t
      const title =
        t.title === '新對話' && role === 'user'
          ? titleFromText(c || atts?.[0]?.name || '附件')
          : t.title
      return {
        ...t,
        title,
        bubbles: [...t.bubbles, bubble].slice(-MAX_BUBBLES),
        updatedAt: new Date().toISOString(),
      }
    })
    set({ threads })
    persist(threads, get().activeId)
  },

  clearBubbles: (threadId) => {
    const threads = get().threads.map((t) =>
      t.id === threadId
        ? { ...t, bubbles: [], title: '新對話', updatedAt: new Date().toISOString() }
        : t,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  setShowRunPanel: (v) => set({ showRunPanel: v }),
  setShowThreadList: (v) => set({ showThreadList: v }),
  setRunningThreadId: (id) => set({ runningThreadId: id }),
  setThreadStatus: (id, status) => {
    const threads = get().threads.map((t) =>
      t.id === id ? { ...t, lastStatus: status, updatedAt: new Date().toISOString() } : t,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  setLastCapabilities: (id, capabilityIds, unlockedTools) => {
    const caps = [...new Set(capabilityIds.filter(Boolean))].sort()
    const unlocks = unlockedTools
      ? [...new Set(unlockedTools.filter(Boolean))].sort()
      : undefined
    const threads = get().threads.map((t) =>
      t.id === id
        ? {
            ...t,
            lastCapabilityIds: caps.length ? caps : t.lastCapabilityIds,
            lastUnlockedTools: unlocks?.length ? unlocks : t.lastUnlockedTools,
            updatedAt: new Date().toISOString(),
          }
        : t,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  activeThread: () => {
    const { threads, activeId } = get()
    return threads.find((t) => t.id === activeId) || null
  },
}))
