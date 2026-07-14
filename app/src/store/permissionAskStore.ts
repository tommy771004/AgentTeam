import { create } from 'zustand'

export type PermissionAskRequest = {
  id: string
  threadId?: string
  runId?: string
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
  /** Session approval is isolated by thread; sessionAllow remains for legacy UI. */
  sessionAllowByThread: Record<string, boolean>
  /** Session counters (app lifetime until reset) */
  stats: PermissionAskStats
  /** Per-run counters — reset via beginRunAudit() */
  runStats: PermissionAskStats
  runStatsByRun: Record<string, PermissionAskStats>
  setSessionAllow: (v: boolean, threadId?: string) => void
  getSessionAllow: (threadId?: string) => boolean
  resetStats: () => void
  /** Call at start of each agent run for archive snapshot */
  beginRunAudit: (runId?: string, threadId?: string) => void
  /** Snapshot for ArchiveRecord.hitl */
  getRunHitlSnapshot: (runId?: string) => {
    allowed: number
    denied: number
    timedOut: number
    toolsTimedOut?: string[]
  }
  /** Promise that resolves when user decides or timeout */
  requestAsk: (input: {
    threadId?: string
    runId?: string
    tool: string
    args: Record<string, unknown>
    reason?: string
    timeoutMs?: number
  }) => Promise<'allow' | 'deny'>
  resolve: (decision: 'allow' | 'deny') => void
  cancelRun: (runId: string) => void
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

const GLOBAL_SCOPE = '__global__'

function updateRunStats(
  current: PermissionAskStore,
  request: Pick<PermissionAskRequest, 'runId'> | undefined,
  update: (stats: PermissionAskStats) => PermissionAskStats,
): Pick<PermissionAskStore, 'runStats' | 'runStatsByRun'> {
  const runStatsByRun = { ...current.runStatsByRun }
  const runId = request?.runId?.trim()
  if (runId) runStatsByRun[runId] = update(runStatsByRun[runId] || emptyStats())
  return {
    runStats: runId ? runStatsByRun[runId] : update(current.runStats),
    runStatsByRun,
  }
}

function bumpAllow(get: () => PermissionAskStore, set: (p: Partial<PermissionAskStore>) => void, request?: Pick<PermissionAskRequest, 'runId'>) {
  const { stats } = get()
  set({
    stats: { ...stats, allowed: stats.allowed + 1 },
    ...updateRunStats(get(), request, (value) => ({ ...value, allowed: value.allowed + 1 })),
  })
}

function bumpDeny(get: () => PermissionAskStore, set: (p: Partial<PermissionAskStore>) => void, request?: Pick<PermissionAskRequest, 'runId'>) {
  const { stats } = get()
  set({
    stats: { ...stats, denied: stats.denied + 1 },
    ...updateRunStats(get(), request, (value) => ({ ...value, denied: value.denied + 1 })),
  })
}

function bumpTimeout(
  get: () => PermissionAskStore,
  set: (p: Partial<PermissionAskStore>) => void,
  tool: string,
  request?: Pick<PermissionAskRequest, 'runId'>,
) {
  const { stats } = get()
  const entry = { tool, at: new Date().toISOString() }
  set({
    stats: {
      ...stats,
      timedOut: stats.timedOut + 1,
      recentTimeouts: [entry, ...stats.recentTimeouts].slice(0, 12),
    },
    ...updateRunStats(get(), request, (value) => ({
      ...value,
      timedOut: value.timedOut + 1,
      recentTimeouts: [entry, ...value.recentTimeouts].slice(0, 12),
    })),
  })
}

export const usePermissionAskStore = create<PermissionAskStore>((set, get) => ({
  current: null,
  queue: [],
  sessionAllow: false,
  sessionAllowByThread: {},
  stats: emptyStats(),
  runStats: emptyStats(),
  runStatsByRun: {},
  setSessionAllow: (v, threadId) => {
    const key = threadId?.trim() || GLOBAL_SCOPE
    set({
      sessionAllow: threadId ? get().sessionAllow : v,
      sessionAllowByThread: { ...get().sessionAllowByThread, [key]: v },
    })
  },
  getSessionAllow: (threadId) => {
    if (!threadId?.trim()) return get().sessionAllowByThread[GLOBAL_SCOPE] === true || get().sessionAllow
    return get().sessionAllowByThread[threadId.trim()] === true
  },
  resetStats: () => set({ stats: emptyStats(), runStats: emptyStats(), runStatsByRun: {} }),
  beginRunAudit: (runId) => set({
    runStats: emptyStats(),
    runStatsByRun: runId?.trim()
      ? { ...get().runStatsByRun, [runId.trim()]: emptyStats() }
      : get().runStatsByRun,
  }),
  getRunHitlSnapshot: (runId) => {
    const r = runId?.trim()
      ? (get().runStatsByRun[runId.trim()] || emptyStats())
      : get().runStats
    const toolsTimedOut = r.recentTimeouts.map((t) => t.tool)
    return {
      allowed: r.allowed,
      denied: r.denied,
      timedOut: r.timedOut,
      toolsTimedOut: toolsTimedOut.length ? [...new Set(toolsTimedOut)] : undefined,
    }
  },

  requestAsk: ({ threadId, runId, tool, args, reason, timeoutMs }) => {
    if (get().getSessionAllow(threadId)) {
      bumpAllow(get, set, { runId })
      return Promise.resolve('allow')
    }

    const id = `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const ms = Math.max(5_000, timeoutMs ?? 90_000)
    const req: PermissionAskRequest = {
      id,
      threadId: threadId?.trim() || undefined,
      runId: runId?.trim() || undefined,
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
          bumpTimeout(get, set, tool, req)
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
    if (decision === 'allow') bumpAllow(get, set, cur)
    else bumpDeny(get, set, cur)
    r?.(decision)
  },

  cancelRun: (runId) => {
    const current = get().current
    const matching = [current, ...get().queue].filter(
      (item): item is PermissionAskRequest => Boolean(item && item.runId === runId),
    )
    if (!matching.length) return
    for (const item of matching) {
      const resolver = resolvers.get(item.id)
      resolvers.delete(item.id)
      clearTimer(item.id)
      resolver?.('deny')
      bumpDeny(get, set, item)
    }
    set({
      current: current?.runId === runId ? null : current,
      queue: get().queue.filter((item) => item.runId !== runId),
    })
    promote(get, set)
  },
}))
