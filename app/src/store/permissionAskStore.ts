import { create } from 'zustand'

export type PermissionAskRequest = {
  id: string
  threadId?: string
  runId?: string
  tool: string
  /** Complete serialized invocation input shown on the approval surface. */
  argsJson: string
  reason: string
  /** HITL asks (ask_user) always pop — the sessionAllow shortcut skips only effect approvals. */
  hitl?: boolean
  /** Structured-question fields lifted from args for ask_user-shaped asks. */
  question?: string
  options?: string[]
  multiSelect?: boolean
  allowFreeform?: boolean
  createdAt: string
  /** Optional fail-closed budget. Interactive asks omit it and wait for a decision. */
  timeoutMs?: number
  expiresAt?: number
  /** Host call identity used to reconcile cancellation and renderer reattachment. */
  callId?: string
}

export type PermissionAskStats = {
  allowed: number
  denied: number
  timedOut: number
  /** Last N tool names that timed out (audit) */
  recentTimeouts: Array<{ tool: string; at: string }>
}

export type PermissionAskOutcome = { decision: 'allow' | 'deny'; answer?: string }

type Resolver = (outcome: PermissionAskOutcome) => void

interface PermissionAskStore {
  /** Oldest pending ask across all conversations. */
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
  /** Promise that resolves when the user decides, the run ends, or an explicit timeout fires. */
  requestAsk: (input: {
    threadId?: string
    runId?: string
    tool: string
    args: Record<string, unknown>
    reason?: string
    timeoutMs?: number
    hitl?: boolean
    callId?: string
  }) => Promise<PermissionAskOutcome>
  /** The ask_user answer rides back inside the resolution as the tool result. */
  resolve: (requestId: string, decision: 'allow' | 'deny', answer?: string) => void
  resolveHostRequest: (runId: string, callId: string, decision: 'allow' | 'deny' | 'timeout' | 'cancel') => void
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
export const MAX_RUN_HITL_AUDITS = 100

type PermissionAskCollection = Pick<PermissionAskStore, 'current' | 'queue'>

export function permissionAsksForThread(
  state: PermissionAskCollection,
  threadId: string,
): PermissionAskRequest[] {
  return [state.current, ...state.queue].filter(
    (request): request is PermissionAskRequest => Boolean(request && request.threadId === threadId),
  )
}

export function unscopedPermissionAsks(state: PermissionAskCollection): PermissionAskRequest[] {
  return [state.current, ...state.queue].filter(
    (request): request is PermissionAskRequest => Boolean(request && !request.threadId),
  )
}

function trimRecord<T>(record: Record<string, T>, max: number): Record<string, T> {
  const keys = Object.keys(record)
  if (keys.length <= max) return record
  return Object.fromEntries(keys.slice(-max).map((key) => [key, record[key]]))
}

function updateRunStats(
  current: PermissionAskStore,
  request: Pick<PermissionAskRequest, 'runId'> | undefined,
  update: (stats: PermissionAskStats) => PermissionAskStats,
): Pick<PermissionAskStore, 'runStats' | 'runStatsByRun'> {
  const runStatsByRun = { ...current.runStatsByRun }
  const runId = request?.runId?.trim()
  if (runId) runStatsByRun[runId] = update(runStatsByRun[runId] || emptyStats())
  const boundedRunStatsByRun = trimRecord(runStatsByRun, MAX_RUN_HITL_AUDITS)
  return {
    runStats: runId
      ? boundedRunStatsByRun[runId] || emptyStats()
      : update(current.runStats),
    runStatsByRun: boundedRunStatsByRun,
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
      sessionAllowByThread: trimRecord(
        { ...get().sessionAllowByThread, [key]: v },
        MAX_RUN_HITL_AUDITS,
      ),
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
      ? trimRecord({ ...get().runStatsByRun, [runId.trim()]: emptyStats() }, MAX_RUN_HITL_AUDITS)
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

  requestAsk: ({ threadId, runId, tool, args, reason, timeoutMs, hitl, callId }) => {
    // ask_user is human-in-the-loop by definition: it always pops, even when
    // the session is set to auto-approve. Deriving the flag from the tool name
    // keeps external callers honest without trusting a caller-passed flag.
    const isHitl = hitl === true || tool === 'ask_user'
    if (!isHitl && get().getSessionAllow(threadId)) {
      bumpAllow(get, set, { runId })
      return Promise.resolve({ decision: 'allow' })
    }

    // Structured question (Aligned with the seam ask_user normalization:
    // string options only, trimmed, deduped, capped at 12).
    const question = isHitl ? String(args.question ?? '').trim() : ''
    const options = isHitl && Array.isArray(args.options)
      ? [...new Set(args.options.map((option) => String(option ?? '').trim()).filter(Boolean))].slice(0, 12)
      : []

    const id = `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const ms = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.max(5_000, timeoutMs)
      : undefined
    const req: PermissionAskRequest = {
      id,
      threadId: threadId?.trim() || undefined,
      runId: runId?.trim() || undefined,
      callId: callId?.trim() || undefined,
      tool,
      argsJson: JSON.stringify(args, null, 2),
      reason: reason || `工具「${tool}」需要核准後才能執行`,
      ...(isHitl ? {
        hitl: true,
        ...(question ? { question } : {}),
        ...(options.length ? { options } : {}),
        multiSelect: args.multiSelect === true,
        allowFreeform: args.allowFreeform !== false,
      } : {}),
      createdAt: new Date().toISOString(),
      ...(ms ? { timeoutMs: ms, expiresAt: Date.now() + ms } : {}),
    }

    return new Promise<PermissionAskOutcome>((resolve) => {
      resolvers.set(id, resolve)
      if (ms) {
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
            r({ decision: 'deny' })
          }, ms),
        )
      }

      const state = get()
      if (!state.current) {
        set({ current: req })
      } else {
        set({ queue: [...state.queue, req] })
      }
    })
  },

  resolve: (requestId, decision, answer) => {
    const state = get()
    const cur = state.current?.id === requestId
      ? state.current
      : state.queue.find((request) => request.id === requestId)
    if (!cur) return
    const r = resolvers.get(requestId)
    resolvers.delete(requestId)
    clearTimer(requestId)
    if (state.current?.id === requestId) {
      set({ current: null })
      promote(get, set)
    } else {
      set({ queue: state.queue.filter((request) => request.id !== requestId) })
    }
    if (decision === 'allow') bumpAllow(get, set, cur)
    else bumpDeny(get, set, cur)
    const text = answer?.trim()
    r?.({ decision, ...(decision === 'allow' && text ? { answer: text } : {}) })
  },

  resolveHostRequest: (runId, callId, decision) => {
    const request = [get().current, ...get().queue].find(
      (item) => item?.runId === runId && item.callId === callId,
    )
    if (!request) return
    get().resolve(request.id, decision === 'allow' ? 'allow' : 'deny')
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
      resolver?.({ decision: 'deny' })
      bumpDeny(get, set, item)
    }
    set({
      current: current?.runId === runId ? null : current,
      queue: get().queue.filter((item) => item.runId !== runId),
    })
    promote(get, set)
  },
}))
