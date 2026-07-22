import { create } from 'zustand'
import type {
  AgentState,
  ApprovalMode,
  ArchiveRecord,
  CliConfigSnapshot,
  LoopType,
  PostStateOutcome,
  RuntimeOverrides,
} from '../agent/types'
import { agentEngine } from '../agent/engine'
import { runCapacity } from '../agent/runConcurrency'
import { emptyKnowledge, extractKnowledge } from '../agent/knowledge'
import { learningLoop } from '../agent/hermes/learning'
import { useSettingsStore } from './settingsStore'
import { useLearningStore } from './learningStore'
import { consumeNextState } from '../agent/outcomeDispatcher'
import { submitPiHostRun } from '../agent/piHostRun'
import {
  emptyAgentLike,
  runPromptViaLocalCli,
  type LocalRunnerKind,
} from '../agent/localCliRun'
import {
  EXTERNAL_CLI_DOD_LABEL,
  EXTERNAL_CLI_RUNNER_CAPABILITIES,
} from '../agent/runners'

const runPiOrchestration = async (...args: Parameters<typeof import('../../electron/piOrchestrationExtension').runPiOrchestration>) => {
  const { runPiOrchestration: run } = await import('../../electron/piOrchestrationExtension')
  return run(...args)
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
  /** Attach the single post-state outcome before finalization/archive. */
  applyPostState: (runId: string, outcome: PostStateOutcome) => void
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
    /** Preserve schedule trigger lineage for scheduled CLI runs. */
    scheduleTrigger?: RuntimeOverrides['scheduleTrigger']
    /** Preserve Proactive matcher lineage for scheduled CLI runs. */
    eventTrigger?: RuntimeOverrides['eventTrigger']
    /** Preserve the requested post-execution state for CLI finalization. */
    nextState?: RuntimeOverrides['nextState']
    /** Per-run outbound target; falls back to settings.webhookTarget. */
    webhookTarget?: RuntimeOverrides['webhookTarget']
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
  }, runId?: string) => void
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
const lastRunIdByThread = new Map<string, string>()
const MAX_RUN_AGENT_STATES = 100

function pruneRunAgentStates(selectedRunId: string | null) {
  if (runAgentStates.size <= MAX_RUN_AGENT_STATES) return
  const activeRunIds = new Set(reservedRuns.keys())
  const evictable = [...runAgentStates.keys()]
    .filter((runId) => runId !== selectedRunId && !activeRunIds.has(runId))
    .sort((left, right) => {
      const a = runAgentStates.get(left)
      const b = runAgentStates.get(right)
      const aAt = Date.parse(a?.finishedAt || a?.startedAt || '') || 0
      const bAt = Date.parse(b?.finishedAt || b?.startedAt || '') || 0
      return aAt - bAt
    })
  for (const runId of evictable) {
    if (runAgentStates.size <= MAX_RUN_AGENT_STATES) break
    runAgentStates.delete(runId)
  }
}

function rememberRunThread(threadId: string | undefined, runId: string) {
  if (!threadId) return
  lastRunIdByThread.set(threadId, runId)
  if (lastRunIdByThread.size <= MAX_RUN_AGENT_STATES) return
  const activeThreadIds = new Set(
    [...reservedRuns.values()].map((entry) => entry.threadId).filter(Boolean) as string[],
  )
  for (const [id] of lastRunIdByThread) {
    if (lastRunIdByThread.size <= MAX_RUN_AGENT_STATES) break
    if (!activeThreadIds.has(id)) lastRunIdByThread.delete(id)
  }
}

function stateSnapshot(): Record<string, AgentState> {
  return Object.fromEntries([...runAgentStates.entries()].map(([id, state]) => [id, state]))
}

function publishRun(set: (partial: Partial<AgentStore>) => void, get: () => AgentStore, runId: string, state: AgentState) {
  runAgentStates.set(runId, state)
  const activeRunIds = [...reservedRuns.keys()]
  let selectedRunId = get().selectedRunId
  if (!selectedRunId || (!activeRunIds.includes(selectedRunId) && activeRunIds.length)) selectedRunId = activeRunIds.at(-1) || runId
  pruneRunAgentStates(selectedRunId)
  const visible = (selectedRunId && runAgentStates.get(selectedRunId)) || state
  set({
    agent: visible,
    runStates: stateSnapshot(),
    selectedRunId,
    activeRunIds,
    isRunning: activeRunIds.length > 0,
  })
}

async function executePiHostTurn(
  set: (partial: Partial<AgentStore>) => void,
  get: () => AgentStore,
  text: string,
  runId: string,
  overrides: RuntimeOverrides,
  settings: ReturnType<typeof useSettingsStore.getState>['settings'],
): Promise<void> {
  const startedAt = new Date().toISOString()
  const loopType = overrides.forceLoopType || 'Goal-based'
  const loopConfig = {
    loopType,
    trigger: 'pi-host',
    executionSequence: ['pi-host-turn'],
    definitionOfDone: 'Pi Core settlement returned',
    maxIterations: 1,
    fallbackProtocol: '',
    nextState: overrides.nextState || 'Halt',
  } as const
  const t0 = Date.now()
  const piHost = window.subagents?.piHost
  if (!piHost?.sessions?.list || !piHost.sessions.create || !piHost.turn?.submit || !overrides.threadId) {
    throw new Error('Pi Core Host bridge is unavailable for an Electron run')
  }
  publishRun(set, get, runId, emptyAgentLike({
    id: runId,
    objective: text,
    status: 'running',
    progress: 15,
    loopConfig,
    executionKind: 'loop',
    startedAt,
    steps: [{ step: 1, action: 'pi-host-turn', description: 'Pi Core Host turn', status: 'IN_PROGRESS', modelSource: 'primary' }],
    logs: [{ id: 'pi-host-start', timestamp: startedAt, level: 'PROCESS', message: `Pi Core Host · runId=${runId}` }],
  }))
  const profile = Object.fromEntries(
    Object.entries({
      model: overrides.model,
      approvalMode: overrides.approvalMode,
      unattended: overrides.unattended,
    }).filter(([, value]) => value !== undefined),
  )
  try {
    const result = await runPiOrchestration({
      pattern: loopType,
      prompt: text,
      maxIterations: 1,
      turn: async (prompt) => {
        const turn = await submitPiHostRun(piHost, {
          threadId: overrides.threadId!,
          title: text.slice(0, 48),
          prompt,
          runId,
          cwd: overrides.projectRoot,
          profile,
        })
        return { settlement: turn.settlement, result: turn.result }
      },
    })
    const success = result.settlement === 'success'
    const halted = result.settlement === 'cancelled' || result.settlement === 'interrupted'
    const final = emptyAgentLike({
      id: runId,
      objective: text,
      status: success ? 'success' : halted ? 'halted' : 'failed',
      progress: 100,
      result: result.result || (success ? 'Pi Core 完成（無文字輸出）' : `Pi Core ${result.settlement}`),
      confidence: success ? 0.9 : 0.3,
      loopConfig,
      executionKind: 'loop',
      startedAt,
      finishedAt: new Date().toISOString(),
      logs: [{ id: 'pi-host-end', timestamp: new Date().toISOString(), level: success ? 'SUCCESS' : halted ? 'HALT' : 'ERROR', message: `Pi Core Host settlement=${result.settlement}` }],
      steps: [{ step: 1, action: 'pi-host-turn', description: 'Pi Core Host turn', status: success ? 'COMPLETED' : halted ? 'SKIPPED' : 'FAILED', result: result.result || result.settlement, durationMs: Date.now() - t0, modelSource: 'primary' }],
    })
    publishRun(set, get, runId, final)
    const postState = await consumeNextState(loopConfig.nextState, {
      runId,
      objective: text,
      status: final.status,
      loopType,
      result: final.result,
      finishedAt: final.finishedAt,
      webhookTarget: overrides.webhookTarget || settings.webhookTarget,
    })
    get().applyPostState(runId, postState)
    try {
      const { useRunActivityStore } = await import('./runActivityStore')
      useRunActivityStore.getState().end(runId, success ? '完成' : halted ? '已停止' : '失敗')
    } catch {
      /* optional renderer activity */
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    publishRun(set, get, runId, emptyAgentLike({
      id: runId,
      objective: text,
      status: 'failed',
      progress: 100,
      result: message,
      haltReason: message,
      loopConfig,
      executionKind: 'loop',
      startedAt,
      finishedAt: new Date().toISOString(),
      logs: [{ id: 'pi-host-error', timestamp: new Date().toISOString(), level: 'ERROR', message }],
      steps: [{ step: 1, action: 'pi-host-turn', description: 'Pi Core Host turn', status: 'FAILED', result: message, durationMs: Date.now() - t0, modelSource: 'primary' }],
    }))
    throw error
  }
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
      rememberRunThread(threadId, runId)
      runAgentStates.set(runId, emptyAgentLike({ id: runId, objective: '', status: 'idle' }))
      publishRun(set, get, runId, runAgentStates.get(runId)!)
      return true
    },

    bindRun: (runId, threadId) => {
      const entry = reservedRuns.get(runId)
      if (!entry) return
      entry.threadId = threadId
      rememberRunThread(threadId, runId)
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
      return lastRunIdByThread.get(threadId) || null
    },

    selectRun: (runId) => {
      const state = runId ? runAgentStates.get(runId) : undefined
      // Clearing the selection must not leave the previous thread's live
      // state visible. The thread bubble / terminal digest is the fallback
      // until a run-scoped presentation is selected again.
      set({ selectedRunId: state ? runId || null : null, agent: state || emptyAgent() })
    },

    applyPostState: (runId, outcome) => {
      const current = runAgentStates.get(runId)
      if (!current) return
      const next = { ...current, postState: outcome }
      if (outcome.status === 'failed' && current.status === 'success') {
        next.status = 'failed'
        next.haltReason = outcome.error || 'Post-state dispatch failed'
        next.logs = [
          ...current.logs,
          {
            id: `post_state_${runId}`,
            timestamp: new Date().toISOString(),
            level: 'ERROR' as const,
            message: next.haltReason,
          },
        ]
      }
      runAgentStates.set(runId, next)
      publishRun(set, get, runId, next)
    },

    startExecution: async (input, overrides) => {
      const text = (input ?? get().draftInput).trim()
      if (!text) return
      const runId = overrides?.runId || `run_${Date.now().toString(36)}`
      const settings = useSettingsStore.getState().settings
      if (window.subagents?.piHost?.sessions?.list && overrides?.threadId) {
        try {
          const { useRunActivityStore } = await import('./runActivityStore')
          useRunActivityStore.getState().begin(runId)
          useRunActivityStore.getState().setStatus('Pi Core Host 執行中…', runId)
        } catch {
          /* optional renderer activity */
        }
        await executePiHostTurn(set, get, text, runId, overrides, settings)
        return
      }
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
        const postState = await consumeNextState(
          final.loopConfig.nextState,
          {
            runId,
            objective: final.objective || text,
            status: final.status,
            loopType: final.loopConfig.loopType,
            result: final.result,
            finishedAt: final.finishedAt,
            webhookTarget: overrides?.webhookTarget || settings.webhookTarget,
            scheduleTrigger: final.scheduleTrigger,
            eventTrigger: final.eventTrigger,
          },
        )
        get().applyPostState(runId, postState)
        const settled = get().getRunState(runId) || { ...final, postState }
        try {
          const { useRunActivityStore } = await import('./runActivityStore')
          useRunActivityStore.getState().setStatus(
            settled.status === 'success' ? '完成' : settled.status,
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
        throw e
      }
    },

    startLocalCliExecution: async (opts) => {
      const prompt = opts.prompt.trim()
      if (!prompt) return
      const t0 = Date.now()
      const runId = opts.runId || `cli_${Date.now().toString(36)}`
      const logs: AgentState['logs'] = []
      let toolCalls: AgentState['toolCalls'] = []
      let draftChars = 0
      let lastUiPush = 0

      const baseLoop = {
        loopType: opts.loopType || ('Goal-based' as const),
        trigger: 'local-cli' as const,
        executionSequence: ['local-cli'],
        // Phase 5: never claim "CLI returned" as DoD met
        definitionOfDone: EXTERNAL_CLI_DOD_LABEL,
        maxIterations: 1,
        fallbackProtocol: '',
        nextState: opts.nextState || ('Halt' as const),
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
            executionKind: 'external',
            runnerCapabilities: { ...EXTERNAL_CLI_RUNNER_CAPABILITIES },
            externalRunnerKind: opts.kind,
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
            scheduleTrigger: opts.scheduleTrigger,
            eventTrigger: opts.eventTrigger,
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
            const activity = useRunActivityStore.getState().getPresentation(runId)
            const progress =
              20 + Math.min(70, Math.floor(draftChars / 40) + (activity?.events.length || 0))
            pushLiveAgent(progress, { result: activity?.draftText || undefined })
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
          // Keep the final answer in the assistant bubble, while retaining
          // the bounded thought/process digest for this run.
          act.clearDraft(runId)
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

        // Learning loop on CLI success (same as builtin finalizeSuccess).
        // Keep this before the terminal publish so the adapter cannot regress
        // a completed run back to `running` while appending its learning log.
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
            definitionOfDone: EXTERNAL_CLI_DOD_LABEL,
            maxIterations: 1,
            fallbackProtocol: '',
            nextState: opts.nextState || 'Halt',
          },
          executionKind: 'external',
          runnerCapabilities: { ...EXTERNAL_CLI_RUNNER_CAPABILITIES },
          externalRunnerKind: opts.kind,
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
              message: r.ok
                ? '外部 CLI 結束（未驗證內建 DoD）'
                : r.error || 'failed',
            },
          ],
          steps: [
            {
              step: 1,
              action: 'local-cli',
              description: `外部 CLI · ${opts.kind}`,
              status: r.ok ? 'COMPLETED' : 'FAILED',
              // 完整輸出放主對話 assistant 泡泡；右側面板只留摘要
              result: r.ok
                ? r.output.trim()
                  ? `輸出 ${r.output.length.toLocaleString()} 字 · 完整內容見主對話（非 DoD 判定）`
                  : 'CLI 結束（無輸出 · 非 DoD 判定）'
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
          scheduleTrigger: opts.scheduleTrigger,
          eventTrigger: opts.eventTrigger,
          postState: undefined,
        })
        final.finishedAt = new Date().toISOString()
        publishRun(set, get, runId, final)
        const postState = await consumeNextState(
          final.loopConfig.nextState,
          {
            runId,
            objective: prompt,
            status: final.status,
            loopType: final.loopConfig.loopType,
            result: final.result,
            finishedAt: final.finishedAt,
            webhookTarget: opts.webhookTarget || useSettingsStore.getState().settings.webhookTarget,
            scheduleTrigger: final.scheduleTrigger,
            eventTrigger: final.eventTrigger,
          },
        )
        get().applyPostState(runId, postState)
        const settled = get().getRunState(runId) || { ...final, postState }
        try {
          const { useRunActivityStore } = await import('./runActivityStore')
          useRunActivityStore
            .getState()
            .end(runId, r.ok && settled.status === 'success' ? '完成' : settled.status === 'halted' ? '已停止' : '失敗')
        } catch {
          /* ignore */
        }

        try {
          const { usePermissionAskStore } = await import('./permissionAskStore')
          usePermissionAskStore.getState().setSessionAllow(false, opts.threadId)
        } catch {
          /* ignore */
        }
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
          scheduleTrigger: opts.scheduleTrigger,
          eventTrigger: opts.eventTrigger,
        })
        publishRun(set, get, runId, final)
        try {
          const { usePermissionAskStore } = await import('./permissionAskStore')
          usePermissionAskStore.getState().setSessionAllow(false, opts.threadId)
        } catch {
          /* ignore */
        }
      }
    },

    stopExecution: (runId) => {
      const target = runId
      if (!target) return
      agentEngine.stop(target)
      void window.subagents?.piHost?.turn?.cancel?.(target)
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
      // Phase 3 item 5: stop only terminates the run. Capacity release + queue drain
      // wait for coordinator finalization.
    },

    continueTurn: (runId) => {
      if (!runId) return
      agentEngine.continueTurn(runId)
    },

    resolveIntervention: (decision, runId) => {
      if (!runId) return
      agentEngine.resolveIntervention(decision, runId)
    },

    reset: () => {
      agentEngine.stop()
      for (const runId of reservedRuns.keys()) agentEngine.release(runId)
      reservedRuns.clear()
      liveEngines.clear()
      runAgentStates.clear()
      lastRunIdByThread.clear()
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
        scheduleTrigger: agent.scheduleTrigger,
        eventTrigger: agent.eventTrigger,
        postState: agent.postState,
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
