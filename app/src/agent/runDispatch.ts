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
  ExternalRunRef,
  LlmSettings,
  RuntimeOverrides,
} from './types.ts'
import type { ThinkingDepth } from './thinking.ts'
import type { LocalRunnerKind } from './localCliRun.ts'
import { useAgentStore } from '../store/agentStore.ts'
import { useThreadStore, type ThreadRunner } from '../store/threadStore.ts'
import { parseSubagentMentions } from './opencode/agents.ts'
import {
  openCodeRuntimeOverrides,
  getRegistryAgent,
  parseRegistryMentions,
} from './opencode/agentRegistry.ts'
import { buildIntentPreloadIds } from './intentPreload.ts'
import { buildSubDesignRuntimeContext } from './subdesign/prompt.ts'
import { getSubDesignBriefForThread } from '../store/subDesignStore.ts'
import {
  attachmentsToTextAppendix,
  attachmentsPathAppendix,
  defaultGoalForAttachments,
} from '../lib/chatAttachments.ts'
import type { RunDispatchSnapshot } from './taskRunCoordinator.ts'

export type { DispatchResult } from './dispatchResult.ts'
import type { DispatchResult } from './dispatchResult.ts'
import {
  buildCliContinueGoalContract,
  formatCliContinueGoalPrompt,
  isCompleteCliContinueGoalContract,
} from './runners/types.ts'

function resolveCliBinary(kind: LocalRunnerKind, settings: LlmSettings): string | undefined {
  const mapId = kind === 'claude' ? 'anthropic' : kind === 'gemini' ? 'google' : kind
  const p = (settings.cliProviders || []).find((x) => x.id === mapId || x.id === kind)
  return p?.cliBinary || undefined
}

function isRunnerAuthorized(kind: LocalRunnerKind, settings: LlmSettings): boolean {
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
  const { useOpenCodeConfigStore } = await import('../store/opencodeConfigStore.ts')
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

/**
 * Dispatch from a coordinator-built snapshot.
 * Capacity and attachments must already be prepared — never re-check / re-I/O.
 */
export async function dispatchThreadTask(
  snapshot: RunDispatchSnapshot,
): Promise<DispatchResult> {

  // Trust snapshot attachments; never re-run normalize/materialize/hydrate.
  const attachments = snapshot.attachments
  let raw = snapshot.objective.trim()
  if (!raw && attachments.length) {
    raw = defaultGoalForAttachments(attachments)
  }
  if (!raw) {
    return { path: 'builtin', status: 'failed', error: 'empty goal' }
  }

  const thr = useThreadStore.getState()
  const settings = snapshot.settings
  const tid = snapshot.threadId
  const thread = thr.threads.find((t) => t.id === tid)
  const electronRuntime = typeof window !== 'undefined' && typeof window.subagents?.platform === 'function'
  const piHostAvailable = typeof window !== 'undefined' && typeof window.subagents?.piHost?.sessions?.list === 'function'

  // Electron production is fail-closed: a missing Pi Host must never silently
  // revive the legacy renderer engine. Plain browser development keeps its
  // intentionally documented fallback because it has no Electron bridge.
  if (snapshot.runner === 'builtin' && electronRuntime && tid && !piHostAvailable) {
    return { path: 'builtin', status: 'failed', error: 'Pi Core Host bridge is unavailable' }
  }

  // Electron cutover: once the real Pi Host bridge is present, dispatch the
  // builtin turn before reading legacy renderer model/tool/capability state.
  // The coordinator still owns admission and finalization; AgentStore only
  // projects the Host settlement for the existing UI contract.
  if (snapshot.runner === 'builtin' && piHostAvailable && tid) {
    const appendix = [
      attachmentsToTextAppendix(attachments),
      attachmentsPathAppendix(attachments),
    ].filter(Boolean).join('\n\n')
    const piText = appendix ? `${raw}\n\n${appendix}`.slice(0, 120_000) : raw
    await useAgentStore.getState().startExecution(piText, {
      ...snapshot.overrides,
      runId: snapshot.runId,
      threadId: tid,
      model: snapshot.overrides.model || thread?.model || undefined,
      forceLoopType: snapshot.forceLoopType,
      loopTypeMode: snapshot.forceLoopType ? 'force' : snapshot.overrides.loopTypeMode,
    })
    const state = useAgentStore.getState().getRunState(snapshot.runId) || useAgentStore.getState().agent
    return {
      path: 'builtin',
      executionKind: 'loop',
      status: state.status,
      result: state.result,
      error: state.haltReason,
      postState: state.postState,
    }
  }

  // Coordinator snapshot is authoritative for project identity and runner selection.
  const projectRoot = snapshot.overrides.projectRoot?.trim() || ''
  const agent = useAgentStore.getState()

  const runner: ThreadRunner = snapshot.runner
  const mentioned = parseRegistryMentions(raw)
  const legacy = parseSubagentMentions(raw)
  const subId = mentioned.subagents[0] || legacy.subagents[0]
  let text = mentioned.cleaned || legacy.cleaned || raw
  const depth = (snapshot.overrides.thinkingDepth ||
    thread?.thinkingDepth ||
    'deep') as ThinkingDepth
  const agentMode = (snapshot.overrides.agentMode ||
    thread?.agentMode ||
    'build') as AgentMode
  const model = snapshot.overrides.model || thread?.model || settings.model
  const speed = snapshot.overrides.speed || thread?.speed || 'standard'
  const subDesignBrief = tid ? getSubDesignBriefForThread(tid) : null
  const subDesignContext = subDesignBrief
    ? buildSubDesignRuntimeContext(subDesignBrief)
    : ''
  // Intent preload v2: builtins + skills + enabled plugins/MCP + project packs
  const preloadCandidates = buildIntentPreloadIds(text, settings, projectRoot, {
    max: 8,
    entitlement: (await import('../store/subscriptionStore.ts')).useSubscriptionStore.getState().entitlement,
  })
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
    if (!isRunnerAuthorized(kind, settings)) {
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
    const initialExternalRun: ExternalRunRef = {
      provider: kind,
      adapter: kind,
      runId: snapshot.runId,
      conversationId: tid || snapshot.runId,
      processId: `cli:${snapshot.runId}`,
      status: 'starting',
      completionReason: 'session-admitted',
      eventCursor: 0,
      startedAt: new Date().toISOString(),
    }
    // Persist the identity before process creation so a renderer reload can
    // associate the Host-owned live session with this conversation.
    if (tid) useThreadStore.getState().setExternalRun(tid, initialExternalRun)
    // Keep CLI follow-ups coherent with builtin runs. The current request is
    // deliberately first, so the runner's prompt cap never cuts it off.
    let cliPrompt = subDesignContext ? `${subDesignContext}\n\n## Current request\n${text}` : text
    const continueContract = buildCliContinueGoalContract(snapshot.overrides, {
      projectRoot,
      approvalMode: settings.approvalMode,
    })
    if (isCompleteCliContinueGoalContract(continueContract)) {
      cliPrompt = [
        formatCliContinueGoalPrompt(continueContract),
        subDesignContext,
      ]
        .filter(Boolean)
        .join('\n\n')
    }
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
      binary: resolveCliBinary(kind, settings),
      cwd: projectRoot || undefined,
      model,
      depth,
      agentMode,
      approvalMode: snapshot.overrides.approvalMode || settings.approvalMode,
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
      externalCliContract: snapshot.overrides.externalCliContract,
      externalCliPolicy: snapshot.overrides.externalCliPolicy,
      requiredConnectors: snapshot.overrides.externalCliRequiredConnectors,
    })
    const a =
      useAgentStore.getState().getRunState(snapshot.runId) || useAgentStore.getState().agent
    if (tid) {
      const fallbackStatus: ExternalRunRef['status'] =
        a.status === 'success'
          ? 'success'
          : a.status === 'halted'
            ? 'aborted'
            : a.status === 'interrupted'
              ? 'interrupted'
              : 'failed'
      useThreadStore.getState().setExternalRun(
        tid,
        a.externalRun || {
          ...initialExternalRun,
          status: fallbackStatus,
          completionReason: a.haltReason || fallbackStatus,
          finishedAt: new Date().toISOString(),
        },
      )
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
    const { buildChatHistoryContext, CHAT_HISTORY_CONTEXT_CHARS } = await import('./chatHistory.ts')
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
    overrides.loopTypeMode = 'force'
    overrides.forceLoopType = forceLoop
  } else {
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
