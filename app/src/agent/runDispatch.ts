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
import { parseSubagentMentions } from './opencode/agents'
import {
  openCodeRuntimeOverrides,
  parseRegistryMentions,
} from './opencode/agentRegistry'
import { buildIntentPreloadIds } from './intentPreload'
import type { ChatAttachment } from './types'
import {
  attachmentsToTextAppendix,
  attachmentsPathAppendix,
  defaultGoalForAttachments,
  hydrateAttachmentsFromDisk,
  materializeAttachmentsOnDisk,
} from '../lib/chatAttachments'

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
    /** Chat composer attachments for this turn */
    attachments?: ChatAttachment[]
  },
): Promise<DispatchResult> {
  let attachments =
    opts?.attachments || opts?.overrides?.userAttachments || ([] as ChatAttachment[])
  let raw = goal.trim()
  if (!raw && attachments.length) {
    raw = defaultGoalForAttachments(attachments)
  }
  if (!raw) {
    return { path: 'builtin', status: 'failed', error: 'empty goal' }
  }

  const thr = useThreadStore.getState()
  const tid = opts?.threadId || thr.activeId
  const thread = thr.threads.find((t) => t.id === tid)
  const settings = useSettingsStore.getState().settings
  // Per-run project pin (scheduler) overrides UI project for this dispatch only
  const projectRoot =
    (opts?.overrides?.projectRoot || '').trim() || useProjectStore.getState().root
  const agent = useAgentStore.getState()

  if (agent.isRunning) {
    return {
      path: 'builtin',
      status: 'failed',
      error: '已有任務執行中（全域單一執行，避免 CLI 併發踩踏）。請先停止再發。',
    }
  }

  // Materialize + hydrate for vision / CLI shared paths
  if (attachments.length) {
    attachments = await materializeAttachmentsOnDisk(attachments, {
      projectRoot: projectRoot || undefined,
      sessionId: tid || undefined,
    })
    attachments = await hydrateAttachmentsFromDisk(attachments)
  }

  const runner: ThreadRunner = opts?.runner || thread?.runner || 'builtin'
  const mentioned = parseRegistryMentions(raw)
  const legacy = parseSubagentMentions(raw)
  const subId = mentioned.subagents[0] || legacy.subagents[0]
  let text = mentioned.cleaned || legacy.cleaned || raw
  const depth = (thread?.thinkingDepth || 'deep') as ThinkingDepth
  const agentMode = (thread?.agentMode || 'build') as AgentMode
  const model = thread?.model || settings.model
  const speed = thread?.speed || 'standard'
  // Intent preload v2: builtins + skills + enabled plugins/MCP + project packs
  // (use raw goal text for intent; attachment paths added later)
  const preloadCandidates = buildIntentPreloadIds(text, settings, projectRoot, { max: 8 })

  if (runner !== 'builtin') {
    const kind = runner as LocalRunnerKind
    if (!isRunnerAuthorized(kind)) {
      // P0: explicit failed result — do not leave thread on stale agent state
      return {
        path: 'cli',
        kind,
        status: 'failed',
        error: `執行引擎 ${kind} 未在設定中啟用/授權。請到設定 → CLI 提供者勾選授權並掃描。`,
        result: undefined,
      }
    }
    // CLI path: materialize attachments to disk in Electron; pass serializable payloads
    const cliAttachments = attachments.map((a) => ({
      name: a.name,
      mimeType: a.mimeType,
      kind: a.kind,
      dataUrl: a.dataUrl,
      textContent: a.textContent,
      filePath: a.filePath,
    }))
    // Keep CLI follow-ups coherent with builtin runs. The current request is
    // deliberately first, so the runner's prompt cap never cuts it off.
    let cliPrompt = text
    if (settings.referenceChatHistory !== false && thread?.bubbles?.length) {
      const chat = thread.bubbles.filter(
        (b) => b.role === 'user' || b.role === 'assistant',
      )
      const currentWasStored =
        chat.at(-1)?.role === 'user' && chat.at(-1)?.content === raw
      const history = (currentWasStored ? chat.slice(0, -1) : chat)
        .slice(-12)
        .map(
          (b) =>
            `${b.role === 'user' ? 'User' : 'Assistant'}: ${b.content.slice(0, 600)}`,
        )
        .join('\n')
      if (history) {
        cliPrompt = [
          text,
          '## 近期對話歷史（Reference chat history）',
          history,
        ]
          .join('\n\n')
          .slice(0, 12_000)
      }
    }
    await agent.startLocalCliExecution({
      kind,
      prompt: cliPrompt,
      binary: resolveCliBinary(kind),
      cwd: projectRoot || undefined,
      model,
      depth,
      agentMode,
      approvalMode: settings.approvalMode,
      unattended: opts?.overrides?.unattended === true,
      attachments: cliAttachments.length ? cliAttachments : undefined,
      runId: opts?.overrides?.runId,
      loopType: opts?.forceLoopType,
    })
    const a = useAgentStore.getState().agent
    return {
      path: 'cli',
      kind,
      status: a.status || 'failed',
      result: a.result,
      error: a.haltReason || (a.status === 'failed' ? a.result : undefined),
    }
  }

  // Builtin: embed text files + multimodal images in the engine path
  const appendix = [
    attachmentsToTextAppendix(attachments),
    attachmentsPathAppendix(attachments),
  ]
    .filter(Boolean)
    .join('\n\n')
  if (appendix) {
    text = `${text}\n\n${appendix}`.slice(0, 120_000)
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
    userAttachments: attachments.length
      ? attachments
      : opts?.overrides?.userAttachments,
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
