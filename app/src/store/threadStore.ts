import { create } from 'zustand'
import type { SpeedMode, ThinkingDepth } from '../agent/thinking'
import type { AgentMode, ExecutionStatus, ExternalRunRef, LoopType } from '../agent/types'
import type { ChatAttachment } from '../agent/types'
import { sanitizeAttachmentsForStorage } from '../lib/chatAttachments'
import type { ContinueGoalSnapshot } from '../agent/continueGoal'

const KEY = 'subagents.threads.v5'

/** builtin = 內建 engine；其餘 = 本機 CLI 訂閱 */
export type ThreadRunner = 'builtin' | 'codex' | 'claude' | 'grok' | 'opencode' | 'gemini' | 'cursor'
const MAX_THREADS = 40
const MAX_BUBBLES = 100
const MAX_BUBBLE_CONTENT_CHARS = 32_000

export type ThreadBubble = {
  id: string
  role: 'user' | 'assistant' | 'system' | 'run'
  content: string
  at: string
  /** Optional user message attachments (images / files) */
  attachments?: ChatAttachment[]
  /** Persisted compact process record shown before its final assistant answer. */
  runSummary?: ThreadRunSummary
}

export type ThreadPlanStatus = 'pending' | 'active' | 'done' | 'failed'

export type ThreadPlanItem = {
  id: string
  text: string
  status: ThreadPlanStatus
  at: string
}

export type ThreadAgentSummary = {
  id: string
  name: string
  role: string
  status: 'idle' | 'active' | 'done' | 'error'
  lastMessage?: string
  model?: string
}

export type ThreadRunSummary = {
  durationMs?: number
  subDesign?: {
    briefId: string
    stage: string
    selectedDirectionId?: string
    designSystemId?: string
    artifactId?: string
    artifactRevision?: number
    critique?: {
      revision: number
      verdict: 'pass' | 'needs-revision'
      blockerCount: number
      scores: {
        briefCoverage: number
        brandConformance: number
        accessibility: number
        implementationReadiness: number
      }
    }
    exports?: Array<{
      format: 'html' | 'zip' | 'pdf' | 'pptx' | 'mp4'
      revision: number
      path: string
      sha256: string
    }>
  }
  /** Current Git working-tree diff for files touched by the run. */
  diff?: string
  /** Plan snapshot captured with this execution, for deterministic replay. */
  plan?: ThreadPlanItem[]
  /** Sub-agent roster captured at the end of the run for replay/audit. */
  agents?: ThreadAgentSummary[]
  operations: Array<{
    id: string
    kind: string
    title: string
    detail?: string
    path?: string
    ok?: boolean
  }>
  files: Array<{
    path: string
    action: string
    added?: number
    removed?: number
  }>
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
  /** Latest structured plan snapshot from update_plan / CLI plan events. */
  runPlan?: ThreadPlanItem[]
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
  /** Structured SubDesign session linked to this thread. */
  subDesignBriefId?: string
  /**
   * P3: last unfinished Goal (DoD / missing) — resume without re-parse.
   * Cleared on Goal success.
   */
  continueGoal?: ContinueGoalSnapshot | null
  /** Last external OpenCode session attached to this thread. */
  externalRun?: ExternalRunRef
  /**
   * Last run ended with loopConfig.nextState='Await User Input' (the result
   * itself poses a follow-up question). Drives the composer placeholder hint;
   * cleared on the next dispatch for this thread. See engine.ts resultAwaitsReply.
   */
  awaitingReply?: boolean
  /**
   * Phase 3 item 7: background worker threads stay out of the sidebar.
   * Parent conversation sees completion via injectBackgroundResult only.
   */
  hidden?: boolean
}

interface ThreadStore {
  threads: Thread[]
  activeId: string | null
  showRunPanel: boolean
  showThreadList: boolean
  runningThreadId: string | null
  /** All threads with an active/reserved run. The scalar is retained for legacy UI consumers. */
  runningThreadIds: string[]
  /** Ephemeral thread → run identity map used by concurrent activity updates. */
  runningRunIds: Record<string, string>

  hydrate: () => void
  createThread: (
    opts?: Partial<
      Pick<
        Thread,
        | 'title'
        | 'model'
        | 'thinkingDepth'
        | 'speed'
        | 'loopType'
        | 'agentMode'
        | 'runner'
        | 'hidden'
      >
    >,
  ) => string
  forkThread: (id: string) => string | null
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
  pushRunSummary: (threadId: string, summary: ThreadRunSummary) => void
  appendSubDesignExport: (threadId: string, item: {
    format: 'html' | 'zip' | 'pdf' | 'pptx' | 'mp4'
    revision: number
    path: string
    sha256: string
  }) => void
  clearBubbles: (threadId: string) => void
  /**
   * G5 rewind:還原 agent 寫入的檔案到該氣泡時點,並截斷之後的對話。
   * 外部改動過的檔案會跳過(conflicts);run 延續狀態一併清除。
   */
  rewindToBubble: (
    threadId: string,
    bubbleId: string,
  ) => Promise<{
    ok: boolean
    restored: string[]
    conflicts: string[]
    errors: string[]
    removedBubbles: number
  }>
  setShowRunPanel: (v: boolean) => void
  setShowThreadList: (v: boolean) => void
  setRunningThreadId: (id: string | null) => void
  setThreadRunning: (id: string, running: boolean, runId?: string) => void
  setThreadStatus: (id: string, status: ExecutionStatus | 'idle') => void
  setRunPlan: (
    id: string,
    items: Array<{ id?: string; text: string; status?: string }>,
  ) => void
  clearRunPlan: (id: string) => void
  /** Persist capability / tool_search state for next run on this thread */
  setLastCapabilities: (
    id: string,
    capabilityIds: string[],
    unlockedTools?: string[],
  ) => void
  setSubDesignBriefId: (id: string, briefId: string | null) => void
  setContinueGoal: (id: string, snap: ContinueGoalSnapshot | null) => void
  setExternalRun: (id: string, externalRun?: ExternalRunRef) => void
  setAwaitingReply: (id: string, value: boolean) => void
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
  const runners: ThreadRunner[] = ['builtin', 'codex', 'claude', 'grok', 'opencode', 'gemini', 'cursor']
  const depthOk = ['fast', 'standard', 'deep', 'max', 'ultra'].includes(depth)
  const rawPlan = Array.isArray(raw.runPlan) ? raw.runPlan : []
  const runPlan = rawPlan
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const value = item as Record<string, unknown>
      const text = String(value.text || '').trim()
      if (!text) return null
      const status = String(value.status || '').toLowerCase()
      return {
        id: String(value.id || `plan_${index + 1}`),
        text: text.slice(0, 200),
        status: status === 'done' || status === 'active' || status === 'failed' ? status : 'pending',
        at: String(value.at || now),
      } as ThreadPlanItem
    })
    .filter((item): item is ThreadPlanItem => Boolean(item))
    .slice(0, 40)
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
    runPlan,
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
    subDesignBriefId:
      typeof raw.subDesignBriefId === 'string' && raw.subDesignBriefId.trim()
        ? raw.subDesignBriefId.trim().slice(0, 120)
        : undefined,
    continueGoal:
      raw.continueGoal && typeof raw.continueGoal === 'object'
        ? (raw.continueGoal as ContinueGoalSnapshot)
        : undefined,
    externalRun:
      raw.externalRun && typeof raw.externalRun === 'object'
        ? (raw.externalRun as ExternalRunRef)
        : undefined,
    hidden: raw.hidden === true ? true : undefined,
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
    runPlan: [],
    createdAt: now,
    updatedAt: now,
    lastStatus: 'idle',
    subDesignBriefId: partial?.subDesignBriefId,
    hidden: partial?.hidden === true ? true : undefined,
  }
}

export const useThreadStore = create<ThreadStore>((set, get) => ({
  threads: [],
  activeId: null,
  showRunPanel: false,
  showThreadList: true,
  runningThreadId: null,
  runningThreadIds: [],
  runningRunIds: {},

  hydrate: () => {
    const { threads, activeId } = load()
    if (threads.length === 0) {
      const t = emptyThread()
      set({ threads: [t], activeId: t.id })
      persist([t], t.id)
      return
    }
    const visible = threads.filter((t) => !t.hidden)
    const fallbackId = (visible[0] || threads[0]).id
    const nextActive =
      activeId && threads.some((t) => t.id === activeId && !t.hidden) ? activeId : fallbackId
    set({
      threads,
      activeId: nextActive,
    })
    persist(threads, nextActive)
  },

  createThread: (opts) => {
    const t = emptyThread(opts)
    const threads = [t, ...get().threads].slice(0, MAX_THREADS)
    // Hidden worker threads (background delegate) must not steal UI focus.
    if (t.hidden) {
      set({ threads })
      persist(threads, get().activeId)
    } else {
      set({ threads, activeId: t.id, showRunPanel: false })
      persist(threads, t.id)
    }
    return t.id
  },

  forkThread: (id) => {
    const source = get().threads.find((thread) => thread.id === id)
    if (!source) return null
    const now = new Date().toISOString()
    const forked: Thread = {
      ...source,
      id: uid(),
      title: `分支 · ${source.title}`.slice(0, 42),
      bubbles: source.bubbles.slice(-MAX_BUBBLES).map((bubble) => ({
        ...bubble,
        id: `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      })),
      runPlan: source.runPlan?.map((item) => ({ ...item })),
      // A fork must never silently keep pointing at the source session. The
      // sidebar completes this pending lineage through OpenCode's fork API.
      externalRun: source.externalRun
        ? {
            ...source.externalRun,
            sessionId: undefined,
            parentSessionId: source.externalRun.sessionId,
            childSessionIds: undefined,
            status: 'starting',
            completionReason: 'fork-pending',
            finishedAt: undefined,
          }
        : undefined,
      createdAt: now,
      updatedAt: now,
      lastStatus: 'idle',
    }
    const threads = [forked, ...get().threads].slice(0, MAX_THREADS)
    set({ threads, activeId: forked.id, showRunPanel: false })
    persist(threads, forked.id)
    return forked.id
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
      // CLI answers can be much longer than ordinary chat. Keep enough output
      // for the collapsible conversation renderer without unbounded storage.
      content: (c || (atts?.length ? `（${atts.length} 個附件）` : '')).slice(
        0,
        MAX_BUBBLE_CONTENT_CHARS,
      ),
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

  pushRunSummary: (threadId, summary) => {
    const bubble: ThreadBubble = {
      id: `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'run',
      content: '執行過程',
      at: new Date().toISOString(),
      runSummary: {
        durationMs: summary.durationMs,
        subDesign: summary.subDesign
          ? {
              briefId: summary.subDesign.briefId.slice(0, 120),
              stage: summary.subDesign.stage.slice(0, 40),
              selectedDirectionId: summary.subDesign.selectedDirectionId?.slice(0, 80),
              designSystemId: summary.subDesign.designSystemId?.slice(0, 120),
              artifactId: summary.subDesign.artifactId?.slice(0, 120),
              artifactRevision: summary.subDesign.artifactRevision,
              critique: summary.subDesign.critique
                ? {
                    revision: summary.subDesign.critique.revision,
                    verdict: summary.subDesign.critique.verdict,
                    blockerCount: summary.subDesign.critique.blockerCount,
                    scores: summary.subDesign.critique.scores,
                  }
                : undefined,
              exports: summary.subDesign.exports?.slice(0, 12).map((item) => ({
                format: item.format,
                revision: item.revision,
                path: item.path.slice(0, 600),
                sha256: item.sha256.slice(0, 128),
              })),
            }
          : undefined,
        diff: summary.diff?.slice(0, 200_000),
        plan: (summary.plan || []).slice(0, 40).map((item) => ({
          id: item.id,
          text: item.text.slice(0, 200),
          status: item.status,
          at: item.at,
        })),
        agents: (summary.agents || []).slice(0, 16).map((agent) => ({
          id: agent.id.slice(0, 120),
          name: agent.name.slice(0, 120),
          role: agent.role.slice(0, 80),
          status: agent.status,
          lastMessage: agent.lastMessage?.slice(0, 400),
          model: agent.model?.slice(0, 160),
        })),
        operations: (summary.operations || []).slice(-40).map((operation, index) => ({
          id: operation.id || `operation_${index}`,
          kind: operation.kind || 'tool',
          title: operation.title.slice(0, 240),
          detail: operation.detail?.slice(0, 1200),
          path: operation.path?.slice(0, 600),
          ok: operation.ok,
        })),
        files: (summary.files || []).slice(-80).map((file) => ({
          path: file.path.slice(0, 600),
          action: file.action.slice(0, 40),
          added: file.added,
          removed: file.removed,
        })),
      },
    }
    const threads = get().threads.map((thread) =>
      thread.id === threadId
        ? {
            ...thread,
            bubbles: [...thread.bubbles, bubble].slice(-MAX_BUBBLES),
            updatedAt: new Date().toISOString(),
          }
        : thread,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  appendSubDesignExport: (threadId, item) => {
    const threads = get().threads.map((thread) => {
      if (thread.id !== threadId) return thread
      const bubbles = [...thread.bubbles]
      let index = -1
      for (let cursor = bubbles.length - 1; cursor >= 0; cursor -= 1) {
        if (bubbles[cursor].role === 'run' && Boolean(bubbles[cursor].runSummary?.subDesign)) {
          index = cursor
          break
        }
      }
      if (index < 0) return thread
      const current = bubbles[index].runSummary
      if (!current?.subDesign) return thread
      const exports = [
        item,
        ...(current.subDesign.exports || []).filter((entry) => !(entry.format === item.format && entry.revision === item.revision && entry.path === item.path)),
      ].slice(0, 12)
      bubbles[index] = {
        ...bubbles[index],
        runSummary: {
          ...current,
          subDesign: { ...current.subDesign, exports },
        },
      }
      return { ...thread, bubbles, updatedAt: new Date().toISOString() }
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

  rewindToBubble: async (threadId, bubbleId) => {
    const fail = (msg: string) => ({
      ok: false,
      restored: [] as string[],
      conflicts: [] as string[],
      errors: [msg],
      removedBubbles: 0,
    })
    const thread = get().threads.find((t) => t.id === threadId)
    if (!thread) return fail('thread not found')
    const idx = thread.bubbles.findIndex((b) => b.id === bubbleId)
    if (idx < 0) return fail('bubble not found')
    if (get().runningThreadId === threadId) return fail('run 進行中,請先停止再回捲')

    const cutoffAt = thread.bubbles[idx].at
    let restored: string[] = []
    let conflicts: string[] = []
    const errors: string[] = []
    const rewind = window.subagents?.rewind
    if (rewind?.list) {
      try {
        const entries = await rewind.list(threadId)
        // 該氣泡之後的第一筆快照 = 還原到氣泡當下狀態的起點
        const target = entries.find((e) => e.at >= cutoffAt)
        if (target) {
          let projectRoot: string | undefined
          try {
            const { useProjectStore } = await import('./projectStore')
            projectRoot = useProjectStore.getState().root || undefined
          } catch {
            /* browser fallback */
          }
          const report = await rewind.restore(threadId, target.id, projectRoot)
          restored = report.restored
          conflicts = report.conflicts
          errors.push(...report.errors)
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e))
      }
    }

    const removedBubbles = thread.bubbles.length - (idx + 1)
    const note = [
      `已回捲到此訊息（截斷 ${removedBubbles} 則之後的對話）。`,
      restored.length ? `還原檔案 ${restored.length} 個：${restored.slice(0, 8).join('、')}` : '無檔案需要還原。',
      conflicts.length ? `外部改動已跳過 ${conflicts.length} 個：${conflicts.slice(0, 5).join('、')}` : '',
      errors.length ? `錯誤：${errors.slice(0, 3).join('、')}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    const at = new Date().toISOString()
    const threads = get().threads.map((t) =>
      t.id === threadId
        ? {
            ...t,
            bubbles: [
              ...t.bubbles.slice(0, idx + 1),
              {
                id: crypto.randomUUID(),
                role: 'system' as const,
                content: note,
                at,
              },
            ],
            // run 延續狀態跟著時點作廢
            lastCapabilityIds: undefined,
            lastUnlockedTools: undefined,
            continueGoal: null,
            updatedAt: at,
          }
        : t,
    )
    set({ threads })
    persist(threads, get().activeId)
    return { ok: errors.length === 0, restored, conflicts, errors, removedBubbles }
  },

  setShowRunPanel: (v) => set({ showRunPanel: v }),
  setShowThreadList: (v) => set({ showThreadList: v }),
  setRunningThreadId: (id) => {
    // Compatibility shim for older callers; new run lifecycle code uses the
    // additive setThreadRunning API so one run cannot clear another run.
    set({
      runningThreadId: id,
      runningThreadIds: id ? [id] : [],
      runningRunIds: id ? { [id]: '' } : {},
    })
  },
  setThreadRunning: (id, running, runId) => {
    const current = get()
    const runningRunIds = { ...current.runningRunIds }
    if (running) {
      runningRunIds[id] = runId || runningRunIds[id] || ''
    } else if (!runId || runningRunIds[id] === runId) {
      delete runningRunIds[id]
    }
    const ids = Object.keys(runningRunIds)
    const scalar = running
      ? id
      : current.runningThreadId && ids.includes(current.runningThreadId)
        ? current.runningThreadId
        : ids.at(-1) || null
    set({ runningThreadIds: ids, runningThreadId: scalar, runningRunIds })
  },
  setThreadStatus: (id, status) => {
    const threads = get().threads.map((t) =>
      t.id === id ? { ...t, lastStatus: status, updatedAt: new Date().toISOString() } : t,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  setRunPlan: (id, items) => {
    const now = new Date().toISOString()
    const previous = get().threads.find((thread) => thread.id === id)?.runPlan || []
    const statusOf = (raw?: string): ThreadPlanStatus => {
      const value = (raw || '').toLowerCase()
      if (value.includes('fail') || value.includes('error')) return 'failed'
      if (value.includes('done') || value.includes('complete')) return 'done'
      if (value.includes('active') || value.includes('progress')) return 'active'
      return 'pending'
    }
    const next = items
      .map((item, index) => {
        const text = item.text.trim().slice(0, 200)
        if (!text) return null
        const old = previous.find((entry) => entry.id === item.id || entry.text === text)
        return {
          id: item.id?.trim() || old?.id || `plan_${index + 1}`,
          text,
          status: statusOf(item.status),
          at: old?.at || now,
        }
      })
      .filter((item): item is ThreadPlanItem => Boolean(item))
      .slice(0, 40)
    const threads = get().threads.map((thread) =>
      thread.id === id ? { ...thread, runPlan: next, updatedAt: now } : thread,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  clearRunPlan: (id) => {
    const threads = get().threads.map((thread) =>
      thread.id === id ? { ...thread, runPlan: [], updatedAt: new Date().toISOString() } : thread,
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

  setAwaitingReply: (id, value) => {
    const threads = get().threads.map((t) =>
      t.id === id ? { ...t, awaitingReply: value || undefined } : t,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  setSubDesignBriefId: (id, briefId) => {
    const threads = get().threads.map((thread) =>
      thread.id === id
        ? {
            ...thread,
            subDesignBriefId: briefId?.trim() || undefined,
            updatedAt: new Date().toISOString(),
          }
        : thread,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  setContinueGoal: (id, snap) => {
    const threads = get().threads.map((t) =>
      t.id === id
        ? {
            ...t,
            continueGoal: snap || undefined,
            updatedAt: new Date().toISOString(),
          }
        : t,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  setExternalRun: (id, externalRun) => {
    const threads = get().threads.map((thread) =>
      thread.id === id
        ? { ...thread, externalRun, updatedAt: new Date().toISOString() }
        : thread,
    )
    set({ threads })
    persist(threads, get().activeId)
  },

  activeThread: () => {
    const { threads, activeId } = get()
    return threads.find((t) => t.id === activeId) || null
  },
}))
