import { create } from 'zustand'

export type PermissionAskRequest = {
  id: string
  tool: string
  argsPreview: string
  reason: string
  createdAt: string
  /** Auto-deny after this many ms (interactive default 90s; unattended shorter) */
  timeoutMs: number
  expiresAt: number
}

export type PermissionAskStats = {
  allowed: number
  denied: number
  timedOut: number
  /** Last N tool names that timed out (audit) */
  recentTimeouts: Array<{ tool: string; at: string }>
}

type Resolver = (decision: 'allow' | 'deny') => void

interface PermissionAskStore {
  /** Head of FIFO queue (shown in modal) */
  current: PermissionAskRequest | null
  /** Pending asks behind current */
  queue: PermissionAskRequest[]
  /** session auto-approve until end of run */
  sessionAllow: boolean
  /** Session counters (app lifetime until reset) */
  stats: PermissionAskStats
  /** Per-run counters — reset via beginRunAudit() */
  runStats: PermissionAskStats
  setSessionAllow: (v: boolean) => void
  resetStats: () => void
  /** Call at start of each agent run for archive snapshot */
  beginRunAudit: () => void
  /** Snapshot for ArchiveRecord.hitl */
  getRunHitlSnapshot: () => {
    allowed: number
    denied: number
    timedOut: number
    toolsTimedOut?: string[]
  }
  /** Promise that resolves when user decides or timeout */
  requestAsk: (input: {
    tool: string
    args: Record<string, unknown>
    reason?: string
    timeoutMs?: number
  }) => Promise<'allow' | 'deny'>
  resolve: (decision: 'allow' | 'deny') => void
}

const resolvers = new Map<string, Resolver>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

const emptyStats = (): PermissionAskStats => ({
  allowed: 0,
  denied: 0,
  timedOut: 0,
  recentTimeouts: [],
})

function clearTimer(id: string) {
  const t = timers.get(id)
  if (t) clearTimeout(t)
  timers.delete(id)
}

function promote(get: () => PermissionAskStore, set: (p: Partial<PermissionAskStore>) => void) {
  const { current, queue } = get()
  if (current) return
  if (!queue.length) {
    set({ current: null, queue: [] })
    return
  }
  const [head, ...rest] = queue
  set({ current: head, queue: rest })
}

function bumpAllow(get: () => PermissionAskStore, set: (p: Partial<PermissionAskStore>) => void) {
  const { stats, runStats } = get()
  set({
    stats: { ...stats, allowed: stats.allowed + 1 },
    runStats: { ...runStats, allowed: runStats.allowed + 1 },
  })
}

function bumpDeny(get: () => PermissionAskStore, set: (p: Partial<PermissionAskStore>) => void) {
  const { stats, runStats } = get()
  set({
    stats: { ...stats, denied: stats.denied + 1 },
    runStats: { ...runStats, denied: runStats.denied + 1 },
  })
}

function bumpTimeout(
  get: () => PermissionAskStore,
  set: (p: Partial<PermissionAskStore>) => void,
  tool: string,
) {
  const { stats, runStats } = get()
  const entry = { tool, at: new Date().toISOString() }
  set({
    stats: {
      ...stats,
      timedOut: stats.timedOut + 1,
      recentTimeouts: [entry, ...stats.recentTimeouts].slice(0, 12),
    },
    runStats: {
      ...runStats,
      timedOut: runStats.timedOut + 1,
      recentTimeouts: [entry, ...runStats.recentTimeouts].slice(0, 12),
    },
  })
}

export const usePermissionAskStore = create<PermissionAskStore>((set, get) => ({
  current: null,
  queue: [],
  sessionAllow: false,
  stats: emptyStats(),
  runStats: emptyStats(),
  setSessionAllow: (v) => set({ sessionAllow: v }),
  resetStats: () => set({ stats: emptyStats(), runStats: emptyStats() }),
  beginRunAudit: () => set({ runStats: emptyStats() }),
  getRunHitlSnapshot: () => {
    const r = get().runStats
    const toolsTimedOut = r.recentTimeouts.map((t) => t.tool)
    return {
      allowed: r.allowed,
      denied: r.denied,
      timedOut: r.timedOut,
      toolsTimedOut: toolsTimedOut.length ? [...new Set(toolsTimedOut)] : undefined,
    }
  },

  requestAsk: ({ tool, args, reason, timeoutMs }) => {
    if (get().sessionAllow) {
      bumpAllow(get, set)
      return Promise.resolve('allow')
    }

    const id = `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const ms = Math.max(5_000, timeoutMs ?? 90_000)
    const req: PermissionAskRequest = {
      id,
      tool,
      argsPreview: JSON.stringify(args, null, 2).slice(0, 1200),
      reason: reason || `工具「${tool}」需要核准後才能執行`,
      createdAt: new Date().toISOString(),
      timeoutMs: ms,
      expiresAt: Date.now() + ms,
    }

    return new Promise<'allow' | 'deny'>((resolve) => {
      resolvers.set(id, resolve)
      timers.set(
        id,
        setTimeout(() => {
          const r = resolvers.get(id)
          if (!r) return
          resolvers.delete(id)
          clearTimer(id)
          const state = get()
          if (state.current?.id === id) {
            set({ current: null })
            promote(get, set)
          } else {
            set({ queue: state.queue.filter((q) => q.id !== id) })
          }
          bumpTimeout(get, set, tool)
          r('deny')
        }, ms),
      )

      const state = get()
      if (!state.current) {
        set({ current: req })
      } else {
        set({ queue: [...state.queue, req] })
      }
    })
  },

  resolve: (decision) => {
    const cur = get().current
    if (!cur) return
    const r = resolvers.get(cur.id)
    resolvers.delete(cur.id)
    clearTimer(cur.id)
    set({ current: null })
    promote(get, set)
    if (decision === 'allow') bumpAllow(get, set)
    else bumpDeny(get, set)
    r?.(decision)
  },
}))
