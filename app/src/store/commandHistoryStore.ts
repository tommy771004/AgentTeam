import { create } from 'zustand'

const KEY = 'subagents.cmd.history.v1'
const MAX = 100

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as string[]
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function persist(items: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)))
  } catch {
    /* ignore */
  }
}

interface CommandHistoryStore {
  items: string[]
  /** Push a submitted line (dedupe consecutive duplicates) */
  push: (line: string) => void
  clear: () => void
}

export const useCommandHistoryStore = create<CommandHistoryStore>((set, get) => ({
  items: load(),
  push: (line) => {
    const t = line.trim()
    if (!t) return
    const prev = get().items
    if (prev[0] === t) return
    const next = [t, ...prev].slice(0, MAX)
    persist(next)
    set({ items: next })
  },
  clear: () => {
    persist([])
    set({ items: [] })
  },
}))

/** Session transcript for Codex-style home (not full agent logs) */
export type SessionBubble = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  at: string
}

const SESSION_KEY = 'subagents.session.bubbles.v1'
const MAX_BUBBLES = 80

function loadBubbles(): SessionBubble[] {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as SessionBubble[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

interface SessionStore {
  bubbles: SessionBubble[]
  push: (role: SessionBubble['role'], content: string) => void
  clear: () => void
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  bubbles: loadBubbles(),
  push: (role, content) => {
    const c = content.trim()
    if (!c) return
    const bubble: SessionBubble = {
      id: `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      role,
      content: c.slice(0, 8000),
      at: new Date().toISOString(),
    }
    const next = [...get().bubbles, bubble].slice(-MAX_BUBBLES)
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
    set({ bubbles: next })
  },
  clear: () => {
    try {
      localStorage.removeItem(SESSION_KEY)
    } catch {
      /* ignore */
    }
    set({ bubbles: [] })
  },
}))

/** Custom event: focus any CommandComposer with id "primary" or all */
export const FOCUS_COMPOSER_EVENT = 'subagents:focus-composer'

export function requestFocusComposer(opts?: { openSlash?: boolean }) {
  window.dispatchEvent(
    new CustomEvent(FOCUS_COMPOSER_EVENT, {
      detail: { openSlash: opts?.openSlash !== false },
    }),
  )
}
