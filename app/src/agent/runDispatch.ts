/**
 * Unified task dispatch: builtin engine vs local CLI specialist.
 *
 * Phase 3 item 3: this module only selects a runner and builds runner context
 * from a frozen `RunDispatchSnapshot`. Capacity, attachments, thread bind, and
 * beforeRun are owned by taskRunCoordinator — never re-done here.
 */

import type {
  AgentMode,
  CliConfigSnapshot,
  LoopType,
  PostStateOutcome,
  RuntimeOverrides,
} from './types'
import type { ThinkingDepth } from './thinking'
import type { LocalRunnerKind } from './localCliRun'
import { useSettingsStore } from '../store/settingsStore'
import { useProjectStore } from '../store/projectStore'
import { useAgentStore } from '../store/agentStore'
import { useThreadStore, type ThreadRunner } from '../store/threadStore'
import { parseSubagentMentions } from './opencode/agents'
import {
  openCodeRuntimeOverrides,
  getRegistryAgent,
  parseRegistryMentions,
} from './opencode/agentRegistry'
import { buildIntentPreloadIds } from './intentPreload'
import { buildSubDesignRuntimeContext } from './subdesign/prompt'
import { getSubDesignBriefForThread, useSubDesignStore } from '../store/subDesignStore'
import type { ChatAttachment } from './types'
import {
  attachmentsToTextAppendix,
  attachmentsPathAppendix,
  defaultGoalForAttachments,
} from '../lib/chatAttachments'
import type { RunDispatchSnapshot } from './taskRunCoordinator'

export type DispatchResult = {
  path: 'builtin' | 'cli'
  /** Phase 5: same outcome shape, different execution semantics. */
  executionKind?: 'loop' | 'external'
  kind?: LocalRunnerKind
  status: string
  result?: string
  error?: string
  postState?: PostStateOutcome
}

function resolveCliBinary(kind: LocalRunnerKind): string | undefined {
  const settings = useSettingsStore.getState().settings
  const mapId = kind === 'claude' ? 'anthropic' : kind === 'gemini' ? 'google' : kind
  const p = (settings.cliProviders || []).find((x) => x.id === mapId || x.id === kind)
  return p?.cliBinary || undefined
}

function isRunnerAuthorized(kind: LocalRunnerKind): boolean {
  const settings = useSettingsStore.getState().settings
  const mapId = kind === 'claude' ? 'anthropic' : kind === 'gemini' ? 'google' : kind
  return (settings.cliProviders || []).some(
    (p) =>
      (p.id === mapId || p.id === kind) && p.enabled !== false && p.authorized,
  )
}

async function captureOpenCodeConfigSnapshot(
  projectRoot: string,
  agentMode: AgentMode,
  model: string,
): Promise<CliConfigSnapshot> {
  const { useOpenCodeConfigStore } = await import('../store/opencodeConfigStore')
  const store = useOpenCodeConfigStore.getState()
  if (!store.loaded || store.lastProjectRoot !== projectRoot) {
    await store.hydrate(projectRoot)
  }
  const current = useOpenCodeConfigStore.getState()
  const agent = getRegistryAgent(agentMode)
  let instructions: CliConfigSnapshot['instructions']
  if (window.subagents?.opencode?.resolveInstructions) {
    try {
      const resolved = await window.subagents.opencode.resolveInstructions(
        projectRoot,
        current.instructionsByRoot[projectRoot] || current.instructionsEntries,
      )
      instructions = resolved.map((item) => ({
        entry: item.entry,
        path: item.path,
        bytes: item.bytes,
        sha256: item.sha256,
      }))
    } catch {
      instructions = undefined
    }
  }
  return {
    provider: 'opencode',
    sources: [...(current.sources || [])].slice(0, 12),
    agent: agent?.id || agentMode,
    model: model || current.model || undefined,
    permission: agent?.permissionProjection || {
      rules: {},
      unsupported: [],
    },
    instructions,
    capturedAt: new Date().toISOString(),
  }
}

function isRunDispatchSnapshot(value: unknown): value is RunDispatchSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<RunDispatchSnapshot>
  return (
    typeof v.runId === 'string' &&
    typeof v.threadId === 'string' &&
    typeof v.objective === 'string' &&
    typeof v.runner === 'string' &&
    Array.isArray(v.attachments) &&
    Boolean(v.overrides && typeof v.overrides === 'object')
  )
}

/**
 * Dispatch from a coordinator-built snapshot.
 * Capacity and attachments must already be prepared — never re-check / re-I/O.
 */
export async function dispatchThreadTask(
  snapshot: RunDispatchSnapshot,
): Promise<DispatchResult>
/**
 * @deprecated Prefer `RunDispatchSnapshot`. Kept only for transitional typing;
 * production ingress always builds a snapshot via `buildRunDispatchSnapshot`.
 */
export async function dispatchThreadTask(
  goal: string,
  opts?: {
    threadId?: string
    runner?: ThreadRunner
    forceLoopType?: LoopType
    overrides?: RuntimeOverrides
    attachments?: ChatAttachment[]
  },
): Promise<DispatchResult>
export async function dispatchThreadTask(
  snapshotOrGoal: RunDispatchSnapshot | string,
  legacyOpts?: {
    threadId?: string
    runner?: ThreadRunner
    forceLoopType?: LoopType
    overrides?: RuntimeOverrides
    attachments?: ChatAttachment[]
  },
): Promise<DispatchResult> {
  const snapshot: RunDispatchSnapshot = isRunDispatchSnapshot(snapshotOrGoal)
    ? snapshotOrGoal
    : {
        runId: legacyOpts?.overrides?.runId || `run_legacy_${Date.now().toString(36)}`,
        threadId: legacyOpts?.threadId || useThreadStore.getState().activeId || '',
        objective: String(snapshotOrGoal || '').trim(),
        runner: legacyOpts?.runner || 'builtin',
        forceLoopType: legacyOpts?.forceLoopType,
        attachments:
          legacyOpts?.attachments ||
          legacyOpts?.overrides?.userAttachments ||
          ([] as ChatAttachment[]),
        overrides: {
          ...(legacyOpts?.overrides || {}),
          runId: legacyOpts?.overrides?.runId,
          threadId: legacyOpts?.threadId,
          forceLoopType: legacyOpts?.forceLoopType || legacyOpts?.overrides?.forceLoopType,
        },
      }

  // Trust snapshot attachments; never re-run normalize/materialize/hydrate.
  const attachments = snapshot.attachments.length
    ? snapshot.attachments
    : snapshot.overrides.userAttachments || ([] as ChatAttachment[])
  let raw = snapshot.objective.trim()
  if (!raw && attachments.length) {
    raw = defaultGoalForAttachments(attachments)
  }
  if (!raw) {
    return { path: 'builtin', status: 'failed', error: 'empty goal' }
  }

  const thr = useThreadStore.getState()
  const tid = snapshot.threadId || thr.activeId
  const thread = thr.threads.find((t) => t.id === tid)
  const settings = useSettingsStore.getState().settings
  // Snapshot project pin wins; UI project is only a last-resort for unpinned runs.
  const projectRoot =
    (snapshot.overrides.projectRoot || '').trim() || useProjectStore.getState().root
  const agent = useAgentStore.getState()

  // Runner is fixed on the snapshot (thread.runner only as legacy fallback).
  const runner: ThreadRunner = snapshot.runner || thread?.runner || 'builtin'
  const mentioned = parseRegistryMentions(raw)
  const legacy = parseSubagentMentions(raw)
  const subId = mentioned.subagents[0] || legacy.subagents[0]
  let text = mentioned.cleaned || legacy.cleaned || raw
  const depth = (thread?.thinkingDepth || 'deep') as ThinkingDepth
  const agentMode = (thread?.agentMode ||
    snapshot.overrides.agentMode ||
    'build') as AgentMode
  const model = thread?.model || settings.model
  const speed = thread?.speed || 'standard'
  const subDesignBrief = tid ? getSubDesignBriefForThread(tid) : null
  const subDesignSystem = subDesignBrief?.designSystemId
    ? useSubDesignStore.getState().systems.find((system) => system.id === subDesignBrief.designSystemId)
    : undefined
  const subDesignContext = subDesignBrief
    ? buildSubDesignRuntimeContext(subDesignBrief, subDesignSystem)
    : ''
  // Intent preload v2: builtins + skills + enabled plugins/MCP + project packs
  const preloadCandidates = buildIntentPreloadIds(text, settings, projectRoot, { max: 8 })
  if (subDesignBrief) {
    preloadCandidates.unshift('subdesign-workflow')
    if (subDesignBrief.stage === 'critique') preloadCandidates.unshift('design-critique')
  }

  if (runner !== 'builtin') {
    const kind = runner as LocalRunnerKind
    const configSnapshot =
      kind === 'opencode'
        ? await captureOpenCodeConfigSnapshot(projectRoot, agentMode, model)
        : undefined
    if (!isRunnerAuthorized(kind)) {
      return {
        path: 'cli',
        kind,
        status: 'failed',
        error: `執行引擎 ${kind} 未在設定中啟用/授權。請到設定 → CLI 提供者勾選授權並掃描。`,
        result: undefined,
      }
    }
    // CLI path: pass already-prepared serializable attachment payloads
    const cliAttachments = attachments.map((a) => ({
      name: a.name,
      mimeType: a.mimeType,
      kind: a.kind,
      // Coordinator persistence owns the canonical filePath. Keep inline
      // payloads only when Electron could not materialize the attachment;
      // otherwise localCliRunner would write a second copy.
      dataUrl: a.filePath ? undefined : a.dataUrl,
      textContent: a.filePath ? undefined : a.textContent,
      filePath: a.filePath,
    }))
    // Keep CLI follow-ups coherent with builtin runs. The current request is
    // deliberately first, so the runner's prompt cap never cuts it off.
    let cliPrompt = subDesignContext ? `${subDesignContext}\n\n## Current request\n${text}` : text
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
          cliPrompt,
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
      unattended: snapshot.overrides.unattended === true,
      attachments: cliAttachments.length ? cliAttachments : undefined,
      runId: snapshot.runId,
      threadId: tid || undefined,
      configSnapshot,
      loopType: snapshot.forceLoopType,
      scheduleTrigger: snapshot.overrides.scheduleTrigger,
      eventTrigger: snapshot.overrides.eventTrigger,
      nextState: snapshot.overrides.nextState,
      webhookTarget: snapshot.overrides.webhookTarget,
      deferFinalization: snapshot.overrides.deferFinalization === true,
    })
    const a =
      useAgentStore.getState().getRunState(snapshot.runId) || useAgentStore.getState().agent
    if (tid && a.externalRun) {
      useThreadStore.getState().setExternalRun(tid, a.externalRun)
    }
    return {
      path: 'cli',
      executionKind: 'external',
      kind,
      status: a.status || 'failed',
      result: a.result,
      error: a.haltReason || (a.status === 'failed' ? a.result : undefined),
      postState: a.postState,
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

  // Chat history: recent verbatim + older condensed (budget-friendly).
  let extra = baseOverrides.extraSystemContext || ''
  if (settings.referenceChatHistory !== false && thread?.bubbles?.length) {
    const { buildChatHistoryContext, CHAT_HISTORY_CONTEXT_CHARS } = await import('./chatHistory')
    const hist = buildChatHistoryContext(
      thread.bubbles.map((b) => ({ role: b.role, content: b.content })),
      { keepRecent: 3, maxChars: CHAT_HISTORY_CONTEXT_CHARS, perMessageChars: 600 },
    )
    if (hist.trim()) {
      extra = [extra, hist].filter(Boolean).join('\n\n').slice(0, CHAT_HISTORY_CONTEXT_CHARS)
    }
  }
  if (snapshot.overrides.extraSystemContext) {
    extra = [extra, snapshot.overrides.extraSystemContext].filter(Boolean).join('\n\n')
  }
  if (subDesignContext) {
    extra = [extra, subDesignContext].filter(Boolean).join('\n\n').slice(0, 16_000)
  }

  // G1: cross-run capability restore from thread history
  const threadCaps = thread?.lastCapabilityIds || []
  const threadUnlocks = thread?.lastUnlockedTools || []
  const overrides: RuntimeOverrides = {
    ...baseOverrides,
    ...snapshot.overrides,
    extraSystemContext: extra || undefined,
    temporary:
      snapshot.overrides.temporary ??
      (settings.temporaryChatDefault === true ? true : undefined),
    preloadCapabilityIds: [
      ...preloadCandidates,
      ...(snapshot.overrides.preloadCapabilityIds || []),
      ...threadCaps,
    ],
    preloadUnlockedTools: [
      ...(snapshot.overrides.preloadUnlockedTools || []),
      ...threadUnlocks,
    ],
    userAttachments: attachments.length
      ? attachments
      : snapshot.overrides.userAttachments,
    runId: snapshot.runId,
    threadId: tid || snapshot.threadId,
    deferFinalization: snapshot.overrides.deferFinalization === true,
  }

  // Pin loop only when the snapshot (or thread) explicitly set one.
  const forceLoop =
    snapshot.forceLoopType ||
    (snapshot.overrides.loopTypeMode === 'force'
      ? snapshot.overrides.forceLoopType
      : undefined) ||
    thread?.loopType ||
    undefined
  if (forceLoop) {
    if (!settings.concurrentRunsEnabled) agent.setSelectedLoopType(forceLoop)
    overrides.loopTypeMode = 'force'
    overrides.forceLoopType = forceLoop
  } else {
    if (!settings.concurrentRunsEnabled) agent.setSelectedLoopType(null)
    overrides.loopTypeMode = overrides.loopTypeMode || 'auto'
  }
  await agent.startExecution(text, overrides)
  const a =
    useAgentStore.getState().getRunState(overrides.runId) || useAgentStore.getState().agent
  // Persist loaded caps for next turn on this thread
  if (tid && (a.loadedCapabilityIds?.length || a.unlockedToolNames?.length)) {
    useThreadStore
      .getState()
      .setLastCapabilities(tid, a.loadedCapabilityIds || [], a.unlockedToolNames || [])
  }
  return {
    path: 'builtin',
    executionKind: 'loop',
    status: a.status,
    result: a.result,
    error: a.haltReason,
    postState: a.postState,
  }
}
