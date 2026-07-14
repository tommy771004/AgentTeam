import { create } from 'zustand'
import type {
  AgentState,
  ApprovalMode,
  ArchiveRecord,
  CliConfigSnapshot,
  LoopType,
  RuntimeOverrides,
} from '../agent/types'
import { agentEngine } from '../agent/engine'
import { runCapacity } from '../agent/runConcurrency'
import { emptyKnowledge, extractKnowledge } from '../agent/knowledge'
import { learningLoop } from '../agent/hermes/learning'
import { useSettingsStore } from './settingsStore'
import { useLearningStore } from './learningStore'
import {
  emptyAgentLike,
  runPromptViaLocalCli,
  type LocalRunnerKind,
} from '../agent/localCliRun'

/** Drain unified run queue after any path frees a run-capacity slot. */
function drainQueueAfterRun() {
  void (async () => {
    try {
      const { drainExternalRunQueue } = await import('../agent/runQueue')
      const { runExternalObjective } = await import('../agent/runExternal')
      await drainExternalRunQueue((o) =>
        runExternalObjective({ ...o, _fromQueue: true }),
      )
    } catch {
      /* non-fatal */
    }
  })()
}

interface AgentStore {
  agent: AgentState
  selectedLoopType: LoopType | null
  isRunning: boolean
  /** Concurrent run registry exposed to UI / lifecycle controllers. */
  activeRunIds: string[]
  runStates: Record<string, AgentState>
  selectedRunId: string | null
  archive: ArchiveRecord[]
  draftInput: string
  showReport: boolean

  setDraftInput: (v: string) => void
  setSelectedLoopType: (t: LoopType | null) => void
  setShowReport: (v: boolean) => void
  canStartRun: (runId?: string, threadId?: string) => { allowed: boolean; active: number; limit: number; reason?: string }
  reserveRun: (runId: string, threadId?: string, kind?: 'builtin' | 'cli') => boolean
  bindRun: (runId: string, threadId: string) => void
  releaseRun: (runId: string) => void
  getRunState: (runId?: string) => AgentState | null
  getRunIdForThread: (threadId: string) => string | null
  selectRun: (runId: string | null) => void
  startExecution: (input?: string, overrides?: RuntimeOverrides) => Promise<void>
  /** 透過本機 CLI（Codex/Claude/Grok…）執行，使用其既有登入 */
  startLocalCliExecution: (opts: {
    kind: LocalRunnerKind
    prompt: string
    binary?: string
    cwd?: string
    model?: string
    depth?: string
    agentMode?: string
    approvalMode?: ApprovalMode
    unattended?: boolean
    /** Correlate with runTask trace */
    runId?: string
    threadId?: string
    /** Safe OpenCode config lineage captured before dispatch */
    configSnapshot?: CliConfigSnapshot
    /** Preserve loop type in agent state (not always Goal-based) */
    loopType?: LoopType
    /** Chat attachments for CLI (written to disk in Electron) */
    attachments?: Array<{
      name: string
      mimeType?: string
      kind?: 'image' | 'text' | 'binary'
      dataUrl?: string
      textContent?: string
      filePath?: string
    }>
  }) => Promise<void>
  stopExecution: (runId?: string) => void
  continueTurn: (runId?: string) => void
  resolveIntervention: (decision: {
    action: 'approve' | 'reject' | 'abort'
    payloadJson?: string
  }) => void
  reset: () => void
  loadArchive: () => Promise<void>
  saveToArchive: (agentOverride?: AgentState, runId?: string) => Promise<void>
}

function emptyAgent(): AgentState {
  return {
    id: '',
    objective: '',
    loopConfig: {
      loopType: 'Goal-based',
      trigger: '',
      executionSequence: [],
      definitionOfDone: '',
      maxIterations: 5,
      fallbackProtocol: '',
      nextState: 'Halt',
    },
    status: 'idle',
    currentIteration: 0,
    steps: [],
    logs: [],
    confidence: 0,
    progress: 0,
    startedAt: null,
    finishedAt: null,
    subAgents: [],
    knowledge: emptyKnowledge(),
    intervention: {
      active: false,
      reason: '',
      payloadJson: '',
      safety: null,
      timeoutSec: 900,
    },
    tokensUsed: 0,
    minConfidence: 0.8,
    toolCalls: [],
    loadedCapabilityIds: [],
    unlockedToolNames: [],
    violation: null,
    metrics: { vramLabel: '—', apiCredits: 0, executionMs: 0 },
  }
}

function toArchiveStatus(s: AgentState['status']): ArchiveRecord['status'] {
  if (s === 'success') return 'success'
  if (s === 'failed') return 'failed'
  if (s === 'halted' || s === 'manual_intervention') return 'halted'
  if (s === 'running' || s === 'awaiting_user') return 'running'
  return 'warning'
}

const liveEngines = new Map<string, ReturnType<typeof agentEngine.create>>()
const runAgentStates = new Map<string, AgentState>()
const reservedRuns = new Map<string, { threadId?: string; kind: 'builtin' | 'cli' }>()

function stateSnapshot(): Record<string, AgentState> {
  return Object.fromEntries([...runAgentStates.entries()].map(([id, state]) => [id, state]))
}

function publishRun(set: (partial: Partial<AgentStore>) => void, get: () => AgentStore, runId: string, state: AgentState) {
  runAgentStates.set(runId, state)
  const activeRunIds = [...reservedRuns.keys()]
  let selectedRunId = get().selectedRunId
  if (!selectedRunId || (!activeRunIds.includes(selectedRunId) && activeRunIds.length)) selectedRunId = activeRunIds.at(-1) || runId
  const visible = (selectedRunId && runAgentStates.get(selectedRunId)) || state
  set({
    agent: visible,
    runStates: stateSnapshot(),
    selectedRunId,
    activeRunIds,
    isRunning: activeRunIds.length > 0,
  })
}

export const useAgentStore = create<AgentStore>((set, get) => {
  return {
    agent: agentEngine.getState(),
    selectedLoopType: null,
    isRunning: false,
    activeRunIds: [],
    runStates: {},
    selectedRunId: null,
    archive: [],
    draftInput: '',
    showReport: false,

    setDraftInput: (v) => set({ draftInput: v }),
    setSelectedLoopType: (t) => set({ selectedLoopType: t }),
    setShowReport: (v) => set({ showReport: v }),

    canStartRun: (runId, threadId) => {
      if (runId && reservedRuns.has(runId)) return { allowed: true, active: reservedRuns.size, limit: useSettingsStore.getState().settings.maxConcurrentRuns || 1 }
      if (threadId) {
        const sameThread = [...reservedRuns.values()].some((entry) => entry.threadId === threadId)
        if (sameThread) return { allowed: false, active: reservedRuns.size, limit: 1, reason: 'thread-busy' }
      }
      const capacity = runCapacity(useSettingsStore.getState().settings, reservedRuns.size)
      return capacity.allowed
        ? capacity
        : { ...capacity, reason: 'capacity' }
    },

    reserveRun: (runId, threadId, kind = 'builtin') => {
      if (!runId || reservedRuns.has(runId)) return Boolean(runId)
      const check = get().canStartRun(runId, threadId)
      if (!check.allowed) return false
      reservedRuns.set(runId, { threadId, kind })
      runAgentStates.set(runId, emptyAgentLike({ id: runId, objective: '', status: 'idle' }))
      publishRun(set, get, runId, runAgentStates.get(runId)!)
      return true
    },

    bindRun: (runId, threadId) => {
      const entry = reservedRuns.get(runId)
      if (!entry) return
      entry.threadId = threadId
      publishRun(set, get, runId, runAgentStates.get(runId) || emptyAgent())
    },

    releaseRun: (runId) => {
      reservedRuns.delete(runId)
      liveEngines.delete(runId)
      agentEngine.release(runId)
      publishRun(set, get, runId, runAgentStates.get(runId) || emptyAgent())
    },

    getRunState: (runId) => {
      if (runId) return runAgentStates.get(runId) || null
      return get().selectedRunId ? runAgentStates.get(get().selectedRunId!) || get().agent : get().agent
    },

    getRunIdForThread: (threadId) => {
      for (const [runId, entry] of reservedRuns) if (entry.threadId === threadId) return runId
      return null
    },

    selectRun: (runId) => {
      const state = runId ? runAgentStates.get(runId) : undefined
      if (runId && !state) return
      set({ selectedRunId: runId, agent: state || get().agent })
    },

    startExecution: async (input, overrides) => {
      const text = (input ?? get().draftInput).trim()
      if (!text) return
      const runId = overrides?.runId || `run_${Date.now().toString(36)}`
      if (!get().reserveRun(runId, overrides?.threadId, 'builtin')) {
        console.warn('[agentStore] startExecution blocked: concurrent cap reached')
        return
      }
      const settings = useSettingsStore.getState().settings
      agentEngine.configure(settings)
      const engine = agentEngine.create(runId)
      liveEngines.set(runId, engine)
      const unsub = engine.subscribe((state) => publishRun(set, get, runId, state))
      set({ showReport: false })
      try {
        // Center process feed (Codex-style)
        try {
          const { useRunActivityStore } = await import('./runActivityStore')
          useRunActivityStore.getState().begin(runId)
          useRunActivityStore.getState().setStatus('內建引擎執行中…', runId)
        } catch {
          /* ignore */
        }
        // Per-run HITL counters for Archive
        try {
          const { usePermissionAskStore } = await import('./permissionAskStore')
          usePermissionAskStore.getState().beginRunAudit(runId, overrides?.threadId)
        } catch {
          /* ignore */
        }
        // Prefer overrides from runTask/dispatch; selectedLoopType is sticky UI pin only when force.
        const forceFromOverrides =
          overrides?.loopTypeMode === 'force'
            ? overrides.forceLoopType || get().selectedLoopType || undefined
            : overrides?.loopTypeMode === 'auto'
              ? undefined
              : get().selectedLoopType ?? undefined
        const final = await engine.start(text, forceFromOverrides, { ...overrides, runId })
        unsub()
        publishRun(set, get, runId, final)
        try {
          const { useRunActivityStore } = await import('./runActivityStore')
          useRunActivityStore.getState().setStatus(
            final.status === 'success' ? '完成' : final.status,
            runId,
          )
          useRunActivityStore.getState().end(runId)
        } catch {
          /* ignore */
        }
        // End of run: clear sticky "代我核准" unless user wants multi-run (opt-in later)
        try {
          const { usePermissionAskStore } = await import('./permissionAskStore')
          usePermissionAskStore.getState().setSessionAllow(false, overrides?.threadId)
        } catch {
          /* ignore */
        }

        if (['success', 'failed', 'halted'].includes(final.status)) {
          await get().saveToArchive(final, runId)
        }
        get().releaseRun(runId)
        // Unified queue drain (automation + interactive follow-ups)
        void drainQueueAfterRun()
      } catch (e) {
        unsub()
        publishRun(set, get, runId, runAgentStates.get(runId) || emptyAgent())
        try {
          const { useRunActivityStore } = await import('./runActivityStore')
          useRunActivityStore.getState().end(runId)
        } catch {
          /* ignore */
        }
        try {
          const { usePermissionAskStore } = await import('./permissionAskStore')
          usePermissionAskStore.getState().setSessionAllow(false, overrides?.threadId)
        } catch {
          /* ignore */
        }
        get().releaseRun(runId)
        void drainQueueAfterRun()
        throw e
      }
    },

    startLocalCliExecution: async (opts) => {
      const prompt = opts.prompt.trim()
      if (!prompt) return
      const t0 = Date.now()
      const runId = opts.runId || `cli_${Date.now().toString(36)}`
      if (!get().reserveRun(runId, opts.threadId, 'cli')) {
        console.warn('[agentStore] startLocalCliExecution blocked: concurrent cap reached')
        return
      }
      const logs: AgentState['logs'] = []
      let toolCalls: AgentState['toolCalls'] = []
      let draftChars = 0
      let lastUiPush = 0

      const baseLoop = {
        loopType: opts.loopType || ('Goal-based' as const),
        trigger: 'local-cli' as const,
        executionSequence: ['local-cli'],
        definitionOfDone: 'CLI returned',
        maxIterations: 1,
        fallbackProtocol: '',
        nextState: 'Halt' as const,
      }

      const pushLiveAgent = (progress: number, extra?: { result?: string }) => {
        publishRun(set, get, runId, emptyAgentLike({
            id: runId,
            objective: prompt,
            status: 'running',
            progress: Math.min(95, Math.max(5, progress)),
            logs: [...logs],
            toolCalls: [...toolCalls],
            result: extra?.result,
            loopConfig: baseLoop,
            steps: [
              {
                step: 1,
                action: 'local-cli',
                description: `本機 ${opts.kind} CLI`,
                status: 'IN_PROGRESS',
                assignedAgent: opts.kind,
                modelUsed: opts.model?.trim() || opts.kind,
                modelSource: 'cli',
              },
            ],
            subAgents: [
              {
                id: `cli-${opts.kind}`,
                name: opts.kind,
                role: 'executor',
                status: 'active',
                model: opts.model?.trim() || opts.kind,
                modelSource: 'cli',
              },
            ],
            metrics: {
              vramLabel: `cli:${opts.kind}`,
              apiCredits: 0,
              executionMs: Date.now() - t0,
            },
            startedAt: new Date(t0).toISOString(),
            finishedAt: null,
          }))
      }

      const pushLog = (message: string, level: AgentState['logs'][0]['level'] = 'INFO') => {
        logs.push({
          id: `l_${logs.length}`,
          timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
          level,
          message,
        })
        // Mirror logs into center process feed even when CLI stream IPC is missing
        try {
          void import('./runActivityStore').then(({ useRunActivityStore }) => {
            const short = message.slice(0, 200)
            if (!short || short.startsWith('$ ')) return
            useRunActivityStore.getState().push({
              kind: level === 'ERROR' ? 'error' : level === 'SUCCESS' ? 'done' : 'status',
              runId,
              title: short,
              detail: message.slice(0, 500),
              ok: level !== 'ERROR',
            })
            useRunActivityStore.getState().setStatus(short, runId)
          })
        } catch {
          /* ignore */
        }
        // progress: start ~15, climb with logs/draft toward 90
        const p = 15 + Math.min(70, logs.length * 2 + Math.floor(draftChars / 80))
        pushLiveAgent(p)
      }

      // Codex-style center feed
      let unsubStream: (() => void) | undefined
      try {
        const { useRunActivityStore } = await import('./runActivityStore')
        useRunActivityStore.getState().begin(runId)
        useRunActivityStore.getState().setStatus(`本機 ${opts.kind} CLI · 啟動中`, runId)
        unsubStream = window.subagents?.cli?.onStream?.((ev) => {
          useRunActivityStore.getState().handleCliStream({
            ...ev,
            kind: ev.kind as import('./runActivityStore').CliStreamPayload['kind'],
            path: ev.path,
            paths: ev.paths,
            added: ev.added,
            removed: ev.removed,
            action: ev.action,
          })
          if ((ev.kind === 'tool' || ev.kind === 'file') && (ev.tool || ev.path)) {
            toolCalls = [
              ...toolCalls,
              {
                id: `cli_tool_${toolCalls.length}`,
                step: 1,
                tool: ev.tool || (ev.kind === 'file' ? 'file_edit' : 'tool'),
                input: {
                  detail: ev.detail || '',
                  path: ev.path || '',
                },
                output: ev.detail || ev.title || '',
                ok: ev.ok !== false,
                durationMs: 0,
                timestamp: new Date().toISOString(),
              },
            ]
          }
          if (ev.channel === 'text' || ev.kind === 'text') {
            draftChars += (ev.delta || ev.detail || '').length
          }
          // Throttle full agent re-render (~8/s)
          const now = Date.now()
          if (now - lastUiPush > 120) {
            lastUiPush = now
            const act = useRunActivityStore.getState()
            const p = 20 + Math.min(70, Math.floor(draftChars / 40) + act.events.length)
            pushLiveAgent(p, { result: act.draftText || undefined })
            if (ev.title || ev.kind === 'status') {
              pushLog(
                [ev.title, ev.detail].filter(Boolean).join(' · ').slice(0, 240),
                ev.kind === 'error' ? 'ERROR' : 'INFO',
              )
            }
          }
        })
      } catch {
        /* browser / missing API */
      }

      set({ showReport: false })
      const modelLabel = opts.model?.trim() || opts.kind
      pushLog(`Local CLI runner: ${opts.kind}${opts.runId ? ` · runId=${opts.runId}` : ''}`)
      if (opts.loopType) pushLog(`loopType: ${opts.loopType}`)
      if (opts.model) pushLog(`model: ${opts.model}`)
      if (opts.depth) pushLog(`depth: ${opts.depth}`)
      if (opts.approvalMode) pushLog(`approvalMode: ${opts.approvalMode}${opts.unattended ? ' · unattended' : ''}`)

      try {
        try {
          const { usePermissionAskStore } = await import('./permissionAskStore')
          usePermissionAskStore.getState().beginRunAudit(runId, opts.threadId)
        } catch {
          /* ignore */
        }
        const r = await runPromptViaLocalCli({
          ...opts,
          runId,
          onLog: (line) => pushLog(line),
        })
        try {
          unsubStream?.()
        } catch {
          /* ignore */
        }
        try {
          const { useRunActivityStore } = await import('./runActivityStore')
          const act = useRunActivityStore.getState()
          // Keep thought / process events for center timeline; clear draft so
          // final answer is only the markdown assistant bubble (no duplicate).
          if (r.ok) {
            act.push({ kind: 'done', title: 'CLI 完成', ok: true, runId })
            act.setStatus('完成', runId)
          }
          useRunActivityStore.setState({ draftText: '', active: false })
        } catch {
          /* ignore */
        }
        // Knowledge graph from CLI output
        const knowledge = extractKnowledge(
          prompt,
          [r.output || r.error || ''],
          r.ok ? 0.88 : 0.4,
        )
        knowledge.phase = r.ok ? 'CLI Synthesis' : 'CLI Failed'

        // If user hit stop mid-run, still finalize state
        const final = emptyAgentLike({
          id: runId,
          objective: prompt,
          status: r.ok ? 'success' : r.error === '使用者取消' ? 'halted' : 'failed',
          progress: 100,
          result: r.output,
          knowledge,
          confidence: r.ok ? 0.88 : 0.35,
          toolCalls: [...toolCalls],
          loopConfig: {
            loopType: opts.loopType || 'Goal-based',
            trigger: 'local-cli',
            executionSequence: ['local-cli'],
            definitionOfDone: 'CLI returned',
            maxIterations: 1,
            fallbackProtocol: '',
            nextState: 'Halt',
          },
          subAgents: [
            {
              id: `cli-${opts.kind}`,
              name: opts.kind,
              role: 'executor',
              status: r.ok ? 'done' : 'error',
              model: modelLabel,
              modelSource: 'cli',
              lastMessage: (r.output || r.error || '').slice(0, 120),
            },
          ],
          logs: [
            ...logs,
            {
              id: `l_${logs.length}`,
              timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
              level: r.ok ? 'SUCCESS' : 'ERROR',
              message: r.ok ? 'CLI finished' : r.error || 'failed',
            },
          ],
          steps: [
            {
              step: 1,
              action: 'local-cli',
              description: `本機 ${opts.kind} CLI`,
              status: r.ok ? 'COMPLETED' : 'FAILED',
              // 完整輸出放主對話 assistant 泡泡；右側面板只留摘要
              result: r.ok
                ? r.output.trim()
                  ? `輸出 ${r.output.length.toLocaleString()} 字 · 完整內容見主對話`
                  : '完成（無輸出）'
                : (r.error || r.output || 'failed').slice(0, 400),
              durationMs: Date.now() - t0,
              assignedAgent: opts.kind,
              modelUsed: modelLabel,
              modelSource: 'cli',
            },
          ],
          metrics: {
            vramLabel: `cli:${opts.kind}`,
            apiCredits: 0,
            executionMs: Date.now() - t0,
          },
          haltReason: r.ok ? undefined : r.error,
          cliConfigSnapshot: opts.configSnapshot,
          externalRun: r.externalRun,
        })
        final.finishedAt = new Date().toISOString()

        // Learning loop on CLI success (same as builtin finalizeSuccess)
        if (r.ok) {
          try {
            const mem = useSettingsStore.getState().settings
            learningLoop.onGoalSuccess({
              objective: prompt,
              steps: [
                {
                  description: `本機 ${opts.kind} CLI`,
                  result: r.output.slice(0, 500),
                },
              ],
              loopType: `local-cli:${opts.kind}`,
              memoryEnabled: mem.memoryEnabled,
              memoryWriteEnabled: mem.memoryWriteEnabled,
            })
            pushLog('學習迴圈：已寫入技能草稿／記憶摘要（見學習中心）')
            void useLearningStore.getState().refresh()
            void useLearningStore.getState().persist()
          } catch {
            /* non-fatal */
          }
        }

        publishRun(set, get, runId, final)
        try {
          const { usePermissionAskStore } = await import('./permissionAskStore')
          usePermissionAskStore.getState().setSessionAllow(false, opts.threadId)
        } catch {
          /* ignore */
        }
        if (['success', 'failed', 'halted'].includes(final.status)) {
          await get().saveToArchive(final, runId)
        }
        get().releaseRun(runId)
        void drainQueueAfterRun()
      } catch (e) {
        try {
          unsubStream?.()
        } catch {
          /* ignore */
        }
        try {
          const { useRunActivityStore } = await import('./runActivityStore')
          useRunActivityStore.getState().push({
            kind: 'error',
            runId,
            title: 'CLI 例外',
            detail: e instanceof Error ? e.message : String(e),
          })
          useRunActivityStore.getState().end(runId)
        } catch {
          /* ignore */
        }
        const msg = e instanceof Error ? e.message : String(e)
        const final = emptyAgentLike({
          id: runId,
          objective: prompt,
          status: 'failed',
          progress: 100,
          result: msg,
          toolCalls: [...toolCalls],
          logs: [
            ...logs,
            {
              id: `l_err`,
              timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
              level: 'ERROR',
              message: msg,
            },
          ],
          steps: [
            {
              step: 1,
              action: 'local-cli',
              description: `本機 ${opts.kind} CLI`,
              status: 'FAILED',
              result: msg,
            },
          ],
          finishedAt: new Date().toISOString(),
          cliConfigSnapshot: opts.configSnapshot,
        })
        publishRun(set, get, runId, final)
        try {
          const { usePermissionAskStore } = await import('./permissionAskStore')
          usePermissionAskStore.getState().setSessionAllow(false, opts.threadId)
        } catch {
          /* ignore */
        }
        get().releaseRun(runId)
        void drainQueueAfterRun()
      }
    },

    stopExecution: (runId) => {
      const target = runId || get().selectedRunId || undefined
      agentEngine.stop(target)
      // Cancel only the selected run's CLI / bash processes.
      void window.subagents?.cli?.cancel?.(target)
      try {
        void import('./runActivityStore').then(({ useRunActivityStore }) => {
          useRunActivityStore.getState().push({ kind: 'status', title: '使用者停止', runId: target })
          useRunActivityStore.getState().end(target)
        })
      } catch {
        /* ignore */
      }
      // Clear sticky "代我核准" so a stopped run cannot auto-allow the next one
      try {
        void import('./permissionAskStore').then(({ usePermissionAskStore }) => {
          if (target) {
            usePermissionAskStore.getState().cancelRun(target)
            usePermissionAskStore.getState().setSessionAllow(false, reservedRuns.get(target)?.threadId)
          } else {
            usePermissionAskStore.getState().setSessionAllow(false)
          }
        })
      } catch {
        /* ignore */
      }
      void drainQueueAfterRun()
    },

    continueTurn: (runId) => {
      agentEngine.continueTurn(runId || get().selectedRunId || undefined)
    },

    resolveIntervention: (decision) => {
      agentEngine.resolveIntervention(decision, get().selectedRunId || undefined)
    },

    reset: () => {
      agentEngine.stop()
      for (const runId of reservedRuns.keys()) agentEngine.release(runId)
      reservedRuns.clear()
      liveEngines.clear()
      set({
        agent: emptyAgent(),
        isRunning: false,
        activeRunIds: [],
        selectedRunId: null,
        runStates: {},
        draftInput: get().draftInput,
        showReport: false,
      })
      try {
        void import('./permissionAskStore').then(({ usePermissionAskStore }) => {
          usePermissionAskStore.getState().setSessionAllow(false)
        })
      } catch {
        /* ignore */
      }
    },

    loadArchive: async () => {
      if (window.subagents?.archive) {
        const list = (await window.subagents.archive.list()) as ArchiveRecord[]
        set({ archive: list })
      }
      // Data controls: prune on load too
      await pruneArchiveByAge(useSettingsStore.getState().settings.autoArchiveDays || 0)
    },

    saveToArchive: async (agentOverride, runId) => {
      const agent = agentOverride || get().getRunState(runId) || get().agent
      if (!agent.id) return
      let hitl: ArchiveRecord['hitl']
      try {
        const { usePermissionAskStore } = await import('./permissionAskStore')
        const snap = usePermissionAskStore.getState().getRunHitlSnapshot(runId)
        if (snap.allowed || snap.denied || snap.timedOut) {
          hitl = snap
        }
      } catch {
        /* ignore */
      }
      const record: ArchiveRecord = {
        id: agent.id,
        status: toArchiveStatus(agent.status),
        objective: agent.objective,
        loopType: agent.loopConfig.loopType,
        confidence: agent.confidence || null,
        timestamp: agent.finishedAt || agent.startedAt || new Date().toISOString(),
        iterations: agent.currentIteration,
        maxIterations: agent.loopConfig.maxIterations,
        steps: agent.steps,
        logs: agent.logs,
        result: agent.result,
        knowledge: agent.knowledge,
        toolCalls: agent.toolCalls?.length ? agent.toolCalls : undefined,
        loadedCapabilityIds: agent.loadedCapabilityIds?.length
          ? agent.loadedCapabilityIds
          : undefined,
        tokensUsed: agent.tokensUsed || undefined,
        hitl,
        cliConfigSnapshot: agent.cliConfigSnapshot,
        externalRun: agent.externalRun,
      }
      if (window.subagents?.archive) {
        await window.subagents.archive.save(record)
        await get().loadArchive()
      } else {
        const prev = get().archive.filter((a) => a.id !== record.id)
        set({ archive: [record, ...prev] })
      }
      // Usage-based automation suggestions are generated from the same
      // successful archive source; decisions are kept separately by the UI.
      try {
        const { useAutomationSuggestionStore } = await import('./automationSuggestionStore')
        useAutomationSuggestionStore.getState().refreshFromArchive(get().archive)
      } catch {
        /* suggestions are advisory and never change run outcome */
      }
      // ChatGPT-style data control: auto-archive prune by age
      await pruneArchiveByAge(useSettingsStore.getState().settings.autoArchiveDays || 0)
    },
  }
})

/** Delete archive records older than N days (0 = off) */
async function pruneArchiveByAge(days: number) {
  if (!days || days <= 0) return
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  try {
    if (window.subagents?.archive?.list && window.subagents.archive.delete) {
      const list = (await window.subagents.archive.list()) as ArchiveRecord[]
      for (const r of list) {
        const t = Date.parse(r.timestamp || '')
        if (!Number.isNaN(t) && t < cutoff) {
          await window.subagents.archive.delete(r.id)
        }
      }
      const next = (await window.subagents.archive.list()) as ArchiveRecord[]
      useAgentStore.setState({ archive: next })
    } else {
      const keep = useAgentStore
        .getState()
        .archive.filter((r) => {
          const t = Date.parse(r.timestamp || '')
          return Number.isNaN(t) || t >= cutoff
        })
      useAgentStore.setState({ archive: keep })
    }
  } catch {
    /* non-fatal */
  }
}
