/**
 * Unified task dispatch: builtin engine vs local CLI specialist.
 *
 * Phase 3 item 3: this module only selects a runner and builds runner context
 * from a frozen `RunDispatchSnapshot`. Capacity, attachments, thread bind, and
 * beforeRun are owned by taskRunCoordinator — never re-done here.
 */

import type {
  AgentMode,
  ExternalRunRef,
  LlmSettings,
  RuntimeOverrides,
} from './types.ts'
import type { ThinkingDepth } from './thinking.ts'
import type { LocalRunnerKind } from './localCliRun.ts'
import { useAgentStore } from '../store/agentStore.ts'
import { useThreadStore, type ThreadRunner } from '../store/threadStore.ts'
import { buildIntentPreloadIds } from './intentPreload.ts'
import { buildSubDesignRuntimeContext } from './subdesign/prompt.ts'
import { getSubDesignBriefForThread } from '../store/subDesignStore.ts'
import {
  attachmentsToTextAppendix,
  attachmentsPathAppendix,
  defaultGoalForAttachments,
} from '../lib/chatAttachments.ts'
import { buildPiTurnContext, withPiTurnContext } from './piTurnContext.ts'
import { parseSubagentMentions } from './subagentMentions.ts'
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

function resolveCliServiceTier(kind: LocalRunnerKind, settings: LlmSettings): RuntimeOverrides['providerServiceTier'] {
  const mapId = kind === 'claude' ? 'anthropic' : kind === 'gemini' ? 'google' : kind
  return (settings.cliProviders || []).find((provider) => provider.id === mapId || provider.id === kind)?.serviceTier
    || 'provider-default'
}

function admittedCliServiceTier(
  snapshot: RunDispatchSnapshot,
  kind: LocalRunnerKind,
): RuntimeOverrides['providerServiceTier'] {
  return snapshot.overrides.providerServiceTier || resolveCliServiceTier(kind, snapshot.settings)
}

function isRunnerAuthorized(kind: LocalRunnerKind, settings: LlmSettings): boolean {
  const mapId = kind === 'claude' ? 'anthropic' : kind === 'gemini' ? 'google' : kind
  return (settings.cliProviders || []).some(
    (p) =>
      (p.id === mapId || p.id === kind) && p.enabled !== false && p.authorized,
  )
}

type ExternalPromptThread = { bubbles?: Array<{ role: string; content: string }> }

/** Assemble the exact external prompt from the admitted snapshot. */
async function assembleExternalCliPrompt(input: {
  snapshot: RunDispatchSnapshot
  raw: string
  text: string
  thread?: ExternalPromptThread
  settings: LlmSettings
  projectRoot: string
  subDesignContext: string
}): Promise<string> {
  const { snapshot, raw, text, thread, settings, projectRoot, subDesignContext } = input
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
    const { dropCurrentObjectiveFromHistory } = await import('./chatHistory.ts')
    const history = dropCurrentObjectiveFromHistory(thread.bubbles, raw)
      .filter((b) => b.role === 'user' || b.role === 'assistant')
      .slice(-12)
      .map((b) => `${b.role === 'user' ? 'User' : 'Assistant'}: ${b.content.slice(0, 600)}`)
      .join('\n')
    if (history) {
      cliPrompt = [
        '## 近期對話歷史（Reference chat history）',
        history,
        cliPrompt,
      ]
        .join('\n\n')
      if (cliPrompt.length > 12_000) cliPrompt = cliPrompt.slice(-12_000)
    }
  }
  // The coordinator freezes Host-owned instructions in extraSystemContext.
  // External runners receive that exact admitted wrapper in the actual CLI
  // prompt; recording a snapshot without this join would be false delivery.
  if (snapshot.overrides.extraSystemContext?.trim()) {
    cliPrompt = [snapshot.overrides.extraSystemContext.trim(), cliPrompt]
      .filter(Boolean)
      .join('\n\n')
  }
  return cliPrompt
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

  // No renderer-owned compatibility loop exists. Electron fails closed when
  // its bridge is broken; plain-browser preview reports the same capability as
  // unavailable/degraded instead of pretending it executed Pi guarantees.
  if (snapshot.runner === 'builtin' && !piHostAvailable) {
    return {
      path: 'builtin',
      status: 'failed',
      error: electronRuntime
        ? 'Pi Core Host bridge is unavailable'
        : 'Plain-browser mode: Pi Core Host capabilities are unavailable/degraded',
    }
  }

  // Electron cutover: once the real Pi Host bridge is present, dispatch the
  // builtin turn before reading renderer compatibility settings.
  // The coordinator still owns admission and finalization; AgentStore only
  // projects the Host settlement for the existing UI contract.
  if (snapshot.runner === 'builtin' && piHostAvailable && tid) {
    const appendix = [
      attachmentsToTextAppendix(attachments),
      attachmentsPathAppendix(attachments),
    ].filter(Boolean).join('\n\n')
    const request = appendix ? `${raw}\n\n${appendix}` : raw
    // Pi Host cannot read renderer-owned skills, project guidance or chat
    // history, and has no tool to fetch them. They travel with the prompt or
    // the turn simply never sees them.
    const piContext = await buildPiTurnContext({
      objective: raw,
      settings,
      projectRoot: snapshot.overrides.projectRoot?.trim() || undefined,
      bubbles: thread?.bubbles,
      temporary: snapshot.overrides.temporary === true,
      archive: useAgentStore.getState().archive,
    })
    const piText = withPiTurnContext(request, piContext.assembled)
    if (piContext.projectGuidanceSummary) {
      thr.pushBubble(tid, 'system', `專案指引：${piContext.projectGuidanceSummary}`)
    }
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
      turnRecord: state.turnRecord,
    }
  }

  // Coordinator snapshot is authoritative for project identity and runner selection.
  const projectRoot = snapshot.overrides.projectRoot?.trim() || ''
  const agent = useAgentStore.getState()

  const runner: ThreadRunner = snapshot.runner
  const mentioned = parseSubagentMentions(raw)
  const subId = mentioned.subagents[0]
  let text = mentioned.cleaned || raw
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
    // deliberately last so instruction hierarchy cannot be reversed by old chat.
    const cliPrompt = await assembleExternalCliPrompt({
      snapshot,
      raw,
      text,
      thread,
      settings,
      projectRoot,
      subDesignContext,
    })
    await agent.startLocalCliExecution({
      kind,
      prompt: cliPrompt,
      binary: resolveCliBinary(kind, settings),
      cwd: projectRoot || undefined,
      model,
      depth,
      serviceTier: admittedCliServiceTier(snapshot, kind),
      agentMode,
      approvalMode: snapshot.overrides.approvalMode || settings.approvalMode,
      unattended: snapshot.overrides.unattended === true,
      attachments: cliAttachments.length ? cliAttachments : undefined,
      runId: snapshot.runId,
      threadId: tid || undefined,
      loopType: snapshot.forceLoopType,
      maxIterations: snapshot.overrides.maxIterations,
      scheduleTrigger: snapshot.overrides.scheduleTrigger,
      eventTrigger: snapshot.overrides.eventTrigger,
      nextState: snapshot.overrides.nextState,
      webhookTarget: snapshot.overrides.webhookTarget,
      externalCliContract: snapshot.overrides.externalCliContract,
      externalCliPolicy: snapshot.overrides.externalCliPolicy,
      requiredConnectors: snapshot.overrides.externalCliRequiredConnectors,
      instructionSnapshot: snapshot.overrides.instructionSnapshot,
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
      terminalClassification: a.externalRun?.terminalClassification,
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

  const baseOverrides: RuntimeOverrides = {
    agentMode,
    model,
    thinkingDepth: depth,
    speed,
    subagentId: subId,
  }

  // Chat history: recent verbatim + older condensed (budget-friendly).
  let extra = baseOverrides.extraSystemContext || ''
  if (settings.referenceChatHistory !== false && thread?.bubbles?.length) {
    const {
      buildChatHistoryContext,
      dropCurrentObjectiveFromHistory,
      CHAT_HISTORY_CONTEXT_CHARS,
    } = await import('./chatHistory.ts')
    const hist = buildChatHistoryContext(
      dropCurrentObjectiveFromHistory(
        thread.bubbles.map((b) => ({ role: b.role, content: b.content })),
        raw,
      ),
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
    executionSettlement: a.executionSettlement,
    goalVerdict: a.goalVerdict,
    goalContractDigest: a.goalContractDigest,
    acceptanceDigest: a.acceptanceDigest,
    stopReason: a.stopReason,
    result: a.result,
    error: a.haltReason,
    postState: a.postState,
    turnRecord: a.turnRecord,
  }
}
