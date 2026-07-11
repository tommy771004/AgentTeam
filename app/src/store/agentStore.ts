import { create } from 'zustand'
import type { AgentState, ApprovalMode, ArchiveRecord, LoopType, RuntimeOverrides } from '../agent/types'
import { agentEngine } from '../agent/engine'
import { emptyKnowledge, extractKnowledge } from '../agent/knowledge'
import { learningLoop } from '../agent/hermes/learning'
import { useSettingsStore } from './settingsStore'
import { useLearningStore } from './learningStore'
import {
  emptyAgentLike,
  runPromptViaLocalCli,
  type LocalRunnerKind,
} from '../agent/localCliRun'

interface AgentStore {
  agent: AgentState
  selectedLoopType: LoopType | null
  isRunning: boolean
  archive: ArchiveRecord[]
  draftInput: string
  showReport: boolean

  setDraftInput: (v: string) => void
  setSelectedLoopType: (t: LoopType | null) => void
  setShowReport: (v: boolean) => void
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
  }) => Promise<void>
  stopExecution: () => void
  continueTurn: () => void
  resolveIntervention: (decision: {
    action: 'approve' | 'reject' | 'abort'
    payloadJson?: string
  }) => void
  reset: () => void
  loadArchive: () => Promise<void>
  saveToArchive: () => Promise<void>
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

export const useAgentStore = create<AgentStore>((set, get) => {
  agentEngine.subscribe((agent) => {
    set({
      agent,
      isRunning:
        agent.status === 'running' ||
        agent.status === 'parsing' ||
        agent.status === 'manual_intervention' ||
        agent.status === 'awaiting_user',
    })
  })

  return {
    agent: agentEngine.getState(),
    selectedLoopType: null,
    isRunning: false,
    archive: [],
    draftInput: '',
    showReport: false,

    setDraftInput: (v) => set({ draftInput: v }),
    setSelectedLoopType: (t) => set({ selectedLoopType: t }),
    setShowReport: (v) => set({ showReport: v }),

    startExecution: async (input, overrides) => {
      const text = (input ?? get().draftInput).trim()
      if (!text) return
      if (get().isRunning) {
        console.warn('[agentStore] startExecution blocked: already running')
        return
      }

      const settings = useSettingsStore.getState().settings
      agentEngine.configure(settings)

      set({ isRunning: true, showReport: false })
      try {
        // Per-run HITL counters for Archive
        try {
          const { usePermissionAskStore } = await import('./permissionAskStore')
          usePermissionAskStore.getState().beginRunAudit()
        } catch {
          /* ignore */
        }
        const force = get().selectedLoopType ?? undefined
        const final = await agentEngine.start(text, force, overrides)
        set({ agent: final, isRunning: false })
        // End of run: clear sticky "代我核准" unless user wants multi-run (opt-in later)
        try {
          const { usePermissionAskStore } = await import('./permissionAskStore')
          usePermissionAskStore.getState().setSessionAllow(false)
        } catch {
          /* ignore */
        }

        if (['success', 'failed', 'halted'].includes(final.status)) {
          await get().saveToArchive()
        }
      } catch (e) {
        set({ isRunning: false })
        try {
          const { usePermissionAskStore } = await import('./permissionAskStore')
          usePermissionAskStore.getState().setSessionAllow(false)
        } catch {
          /* ignore */
        }
        throw e
      }
    },

    startLocalCliExecution: async (opts) => {
      const prompt = opts.prompt.trim()
      if (!prompt) return
      if (get().isRunning) {
        console.warn('[agentStore] startLocalCliExecution blocked: already running')
        return
      }
      const t0 = Date.now()
      const logs: AgentState['logs'] = []
      const pushLog = (message: string, level: AgentState['logs'][0]['level'] = 'INFO') => {
        logs.push({
          id: `l_${logs.length}`,
          timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
          level,
          message,
        })
        set({
          agent: emptyAgentLike({
            objective: prompt,
            status: 'running',
            progress: 30,
            logs: [...logs],
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
            startedAt: new Date(t0).toISOString(),
            finishedAt: null,
          }),
        })
      }

      set({ isRunning: true, showReport: false })
      const modelLabel = opts.model?.trim() || opts.kind
      pushLog(`Local CLI runner: ${opts.kind}`)
      if (opts.model) pushLog(`model: ${opts.model}`)
      if (opts.depth) pushLog(`depth: ${opts.depth}`)
      if (opts.approvalMode) pushLog(`approvalMode: ${opts.approvalMode}${opts.unattended ? ' · unattended' : ''}`)

      try {
        try {
          const { usePermissionAskStore } = await import('./permissionAskStore')
          usePermissionAskStore.getState().beginRunAudit()
        } catch {
          /* ignore */
        }
        const r = await runPromptViaLocalCli({
          ...opts,
          onLog: (line) => pushLog(line),
        })
        // Knowledge graph from CLI output
        const knowledge = extractKnowledge(
          prompt,
          [r.output || r.error || ''],
          r.ok ? 0.88 : 0.4,
        )
        knowledge.phase = r.ok ? 'CLI Synthesis' : 'CLI Failed'

        // If user hit stop mid-run, still finalize state
        const final = emptyAgentLike({
          objective: prompt,
          status: r.ok ? 'success' : r.error === '使用者取消' ? 'halted' : 'failed',
          progress: 100,
          result: r.output,
          knowledge,
          confidence: r.ok ? 0.88 : 0.35,
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
              result: r.output.slice(0, 4000),
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

        set({ agent: final, isRunning: false })
        try {
          const { usePermissionAskStore } = await import('./permissionAskStore')
          usePermissionAskStore.getState().setSessionAllow(false)
        } catch {
          /* ignore */
        }
        if (['success', 'failed', 'halted'].includes(final.status)) {
          await get().saveToArchive()
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const final = emptyAgentLike({
          objective: prompt,
          status: 'failed',
          progress: 100,
          result: msg,
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
        })
        set({ agent: final, isRunning: false })
        try {
          const { usePermissionAskStore } = await import('./permissionAskStore')
          usePermissionAskStore.getState().setSessionAllow(false)
        } catch {
          /* ignore */
        }
      }
    },

    stopExecution: () => {
      agentEngine.stop()
      // Cancel in-flight local CLI / bash tagged cli-agent
      void window.subagents?.cli?.cancel?.()
      set({ isRunning: false })
      // Clear sticky "代我核准" so a stopped run cannot auto-allow the next one
      try {
        void import('./permissionAskStore').then(({ usePermissionAskStore }) => {
          usePermissionAskStore.getState().setSessionAllow(false)
        })
      } catch {
        /* ignore */
      }
    },

    continueTurn: () => {
      agentEngine.continueTurn()
    },

    resolveIntervention: (decision) => {
      agentEngine.resolveIntervention(decision)
    },

    reset: () => {
      agentEngine.stop()
      set({
        agent: emptyAgent(),
        isRunning: false,
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

    saveToArchive: async () => {
      const { agent } = get()
      if (!agent.id) return
      let hitl: ArchiveRecord['hitl']
      try {
        const { usePermissionAskStore } = await import('./permissionAskStore')
        const snap = usePermissionAskStore.getState().getRunHitlSnapshot()
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
      }
      if (window.subagents?.archive) {
        await window.subagents.archive.save(record)
        await get().loadArchive()
      } else {
        const prev = get().archive.filter((a) => a.id !== record.id)
        set({ archive: [record, ...prev] })
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
