/**
 * Unified task dispatch: builtin engine vs local CLI specialist.
 * Used by ProtocolsPage and slash commands so runner selection always applies.
 */

import type { AgentMode, LoopType, RuntimeOverrides } from './types'
import type { ThinkingDepth } from './thinking'
import type { LocalRunnerKind } from './localCliRun'
import { useSettingsStore } from '../store/settingsStore'
import { useProjectStore } from '../store/projectStore'
import { useAgentStore } from '../store/agentStore'
import { useThreadStore, type ThreadRunner } from '../store/threadStore'
import { selectToolsForStep } from './tools/registry'
import { assembleCapabilities, capabilityOwnsTool } from './capabilities'
import { parseSubagentMentions } from './opencode/agents'
import {
  openCodeRuntimeOverrides,
  parseRegistryMentions,
} from './opencode/agentRegistry'

export type DispatchResult = {
  path: 'builtin' | 'cli'
  kind?: LocalRunnerKind
  status: string
  result?: string
  error?: string
}

function resolveCliBinary(kind: LocalRunnerKind): string | undefined {
  const settings = useSettingsStore.getState().settings
  const mapId = kind === 'claude' ? 'anthropic' : kind
  const p = (settings.cliProviders || []).find((x) => x.id === mapId || x.id === kind)
  return p?.cliBinary || undefined
}

function isRunnerAuthorized(kind: LocalRunnerKind): boolean {
  const settings = useSettingsStore.getState().settings
  const mapId = kind === 'claude' ? 'anthropic' : kind
  return (settings.cliProviders || []).some(
    (p) =>
      (p.id === mapId || p.id === kind) && p.enabled !== false && p.authorized,
  )
}

/**
 * Run current thread's goal via selected runner (builtin | codex | claude | …).
 * Guards against concurrent runs at the store layer.
 */
export async function dispatchThreadTask(
  goal: string,
  opts?: {
    threadId?: string
    /** Force runner (else thread.runner) */
    runner?: ThreadRunner
    /** Force loop type for this run (automation / external) */
    forceLoopType?: LoopType
    /** Merged into OpenCode + history overrides */
    overrides?: RuntimeOverrides
  },
): Promise<DispatchResult> {
  const raw = goal.trim()
  if (!raw) {
    return { path: 'builtin', status: 'failed', error: 'empty goal' }
  }

  const thr = useThreadStore.getState()
  const tid = opts?.threadId || thr.activeId
  const thread = thr.threads.find((t) => t.id === tid)
  const settings = useSettingsStore.getState().settings
  const projectRoot = useProjectStore.getState().root
  const agent = useAgentStore.getState()

  if (agent.isRunning) {
    return {
      path: 'builtin',
      status: 'failed',
      error: '已有任務執行中（全域單一執行，避免 CLI 併發踩踏）。請先停止再發。',
    }
  }

  const runner: ThreadRunner = opts?.runner || thread?.runner || 'builtin'
  const mentioned = parseRegistryMentions(raw)
  const legacy = parseSubagentMentions(raw)
  const subId = mentioned.subagents[0] || legacy.subagents[0]
  const text = mentioned.cleaned || legacy.cleaned || raw
  const depth = (thread?.thinkingDepth || 'deep') as ThinkingDepth
  const agentMode = (thread?.agentMode || 'build') as AgentMode
  const model = thread?.model || settings.model
  const speed = thread?.speed || 'standard'
  // FC starts with the highest-signal 1–2 relevant capability packs, matching
  // the heuristic router without exposing the whole catalog.
  const intentTools = selectToolsForStep(text, text, '', {
    webSearchEnabled: settings.webSearchEnabled !== false,
  })
  const preloadCandidates = assembleCapabilities(settings, {
    includeMcpCaps: settings.mcpEnabled,
    projectRoot,
  }).all
    .filter((cap) => intentTools.some((tool) => capabilityOwnsTool(cap, tool)))
    .map((cap) => cap.id)
    .filter((id) => id !== 'core-utils')
    .slice(0, 2)
  if (projectRoot) {
    for (const id of ['codegraph', 'workspace']) {
      if (!preloadCandidates.includes(id)) preloadCandidates.push(id)
    }
  }

  if (runner !== 'builtin') {
    const kind = runner as LocalRunnerKind
    if (!isRunnerAuthorized(kind)) {
      return {
        path: 'cli',
        kind,
        status: 'failed',
        error: `執行引擎 ${kind} 未在設定中啟用/授權。請到設定 → CLI 提供者勾選授權並掃描。`,
      }
    }
    await agent.startLocalCliExecution({
      kind,
      prompt: text,
      binary: resolveCliBinary(kind),
      cwd: projectRoot || undefined,
      model,
      depth,
      agentMode,
      approvalMode: settings.approvalMode,
      unattended: opts?.overrides?.unattended === true,
    })
    const a = useAgentStore.getState().agent
    return {
      path: 'cli',
      kind,
      status: a.status,
      result: a.result,
      error: a.haltReason,
    }
  }

  const baseOverrides: RuntimeOverrides = openCodeRuntimeOverrides({
    agentMode,
    model,
    depth,
    speed,
    subagent: subId,
  })

  // ChatGPT-style: reference chat history from current thread
  let extra = baseOverrides.extraSystemContext || ''
  if (settings.referenceChatHistory !== false && thread?.bubbles?.length) {
    const hist = thread.bubbles
      .filter((b) => b.role === 'user' || b.role === 'assistant')
      .slice(-12)
      .map((b) => `${b.role === 'user' ? 'User' : 'Assistant'}: ${b.content.slice(0, 600)}`)
      .join('\n')
    if (hist.trim()) {
      extra = [extra, '## 近期對話歷史（Reference chat history）', hist]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 6000)
    }
  }
  if (opts?.overrides?.extraSystemContext) {
    extra = [extra, opts.overrides.extraSystemContext].filter(Boolean).join('\n\n')
  }

  // G1: cross-run capability restore from thread history
  const threadCaps = thread?.lastCapabilityIds || []
  const threadUnlocks = thread?.lastUnlockedTools || []
  const overrides: RuntimeOverrides = {
    ...baseOverrides,
    ...(opts?.overrides || {}),
    extraSystemContext: extra || undefined,
    temporary:
      opts?.overrides?.temporary ??
      (settings.temporaryChatDefault === true ? true : undefined),
    preloadCapabilityIds: [
      ...preloadCandidates,
      ...(opts?.overrides?.preloadCapabilityIds || []),
      ...threadCaps,
    ],
    preloadUnlockedTools: [
      ...(opts?.overrides?.preloadUnlockedTools || []),
      ...threadUnlocks,
    ],
  }

  const forceLoop =
    opts?.forceLoopType || thread?.loopType || undefined
  if (forceLoop) {
    agent.setSelectedLoopType(forceLoop)
  }
  await agent.startExecution(text, overrides)
  const a = useAgentStore.getState().agent
  // Persist loaded caps for next turn on this thread
  if (tid && (a.loadedCapabilityIds?.length || a.unlockedToolNames?.length)) {
    useThreadStore
      .getState()
      .setLastCapabilities(tid, a.loadedCapabilityIds || [], a.unlockedToolNames || [])
  }
  return {
    path: 'builtin',
    status: a.status,
    result: a.result,
    error: a.haltReason,
  }
}
