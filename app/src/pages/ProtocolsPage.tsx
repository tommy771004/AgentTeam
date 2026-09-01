import { Fragment, useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Icon } from '../components/Icon'
import { CommandComposer } from '../components/CommandComposer'
import { ThreadSidebar } from '../components/ThreadSidebar'
import { ThreadCapabilityDiagnostics } from '../components/ThreadCapabilityDiagnostics'
import { ModelDepthMenu } from '../components/ModelDepthMenu'
import { ApprovalModeMenu } from '../components/ApprovalModeMenu'
import { ProjectContextBar } from '../components/ProjectContextBar'
import { ExecutionStepsProgress } from '../components/ExecutionStepsProgress'
import { WorkspacePanelSession } from '../components/WorkspacePanelSession'
import { RunProcessFeed } from '../components/RunProcessFeed'
import { ComposerQuickActions } from '../components/ComposerQuickActions'
import { PermissionAskPanel } from '../components/PermissionAskModal'
import { usePermissionAskStore } from '../store/permissionAskStore'
import { IDLE_AGENT_STATE, useAgentStore } from '../store/agentStore'
import { useRunActivityStore, type FileChangeRecord, type RunTaskItem } from '../store/runActivityStore'
import { useSlashExecutor } from '../hooks/useSlashExecutor'
import { useThreadStore, type ThreadRunner } from '../store/threadStore'
import { useSettingsStore } from '../store/settingsStore'
import { resolveModelRunnerSelection } from '../agent/localCliRun'
import { deriveRunLifecycle, orchestrationFromAgent } from '../agent/runLifecycle'
import { continuationAnchorBubbleId } from '../agent/conversationRunLifecycle'
import type { AgentMode, FollowUpMode, LoopType } from '../agent/types'
import type { ThinkingDepth } from '../agent/thinking'
import { getThinkingDepth } from '../agent/thinking'
import { nextPrimaryAgent } from '../agent/agentModes'
import { parseSubagentMentions } from '../agent/subagentMentions'
import type { ChatAttachment } from '../agent/types'
import { detectAutomationSuggestion } from '../agent/automationSuggestion'
import {
  defaultGoalForAttachments,
} from '../lib/chatAttachments'
import { useProjectStore } from '../store/projectStore'
import { listQueuedRuns, moveQueuedRun, queueLength, removeQueuedRun } from '../agent/runQueue'
import { ChatBubble } from '../components/ChatBubble'
import { RunSummaryCard } from '../components/RunSummaryCard'
import { RunContinuationActions } from '../components/RunContinuationActions'
import { CliDoctorCard } from '../components/CliDoctorCard'
import { SuggestedPrompts } from '../components/SuggestedPrompts'
import { requestFocusComposer } from '../store/commandHistoryStore'
import { useWorkspacePanelSessionStore } from '../store/workspacePanelSessionStore'
import type { ApprovalMode } from '../agent/types'
import {
  buildComposerRunInput,
  buildHandoffAvailability,
  buildHandoffDocument,
  isConversationComposerBusy,
  readArtifactIndex,
  resolveBuiltinRunnerTransition,
} from '../agent/composerRunControls'
import {
  beginComposerApprovalHandoff,
  finishComposerApprovalHandoff,
} from '../agent/composerApprovalHandoff'
import {
  createFollowUpClientMessageId,
  createSubmittingFollowUpProjection,
  followUpActionForRunner,
  projectPendingFollowUps,
  projectRendererQueuedFollowUps,
  type FollowUpAction,
  type PendingFollowUpProjection,
} from '../agent/interactiveFollowUp'
import type { ExternalRunOpts, ExternalRunResult } from '../agent/taskRunTypes'

type RejectedFollowUp = {
  projection: PendingFollowUpProjection
  input: ExternalRunOpts
}

function ComposerExecutionContext({
  live,
  tasks,
  fileChanges,
}: {
  live: boolean
  tasks: readonly Pick<RunTaskItem, 'id' | 'text' | 'status'>[]
  fileChanges?: readonly Pick<FileChangeRecord, 'added' | 'removed'>[]
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <ProjectContextBar />
      {live ? <ExecutionStepsProgress tasks={tasks} fileChanges={fileChanges} /> : null}
    </div>
  )
}

function visibleFollowUps(
  hostItems: readonly PendingFollowUpProjection[],
  submitting: Record<string, PendingFollowUpProjection>,
  rejected: Record<string, RejectedFollowUp>,
  threadId: string | null,
) {
  const merged = new Map<string, PendingFollowUpProjection>()
  for (const item of Object.values(submitting)) {
    if (item.threadId === threadId) merged.set(item.id, item)
  }
  for (const item of Object.values(rejected)) {
    if (item.projection.threadId === threadId) merged.set(item.projection.id, item.projection)
  }
  // Host acknowledgement wins over the optimistic renderer projection with
  // the same client message identity.
  for (const item of hostItems) merged.set(item.id, item)
  return [...merged.values()]
}

function busyComposerPlaceholder(runner: ThreadRunner, mode: FollowUpMode | undefined): string {
  if (mode === 'queue') return '輸入追問（將排隊）…'
  return runner === 'builtin' ? '輸入以引導目前任務…' : '輸入後中止目前 CLI 並接手…'
}

function rejectedFollowUpFromResult(
  result: ExternalRunResult,
  input: ExternalRunOpts,
  threadId: string,
): RejectedFollowUp | undefined {
  if (!result.followUpRecovery || !result.runId) return undefined
  const recovery = result.followUpRecovery
  return {
    input: { ...input, runId: result.runId },
    projection: {
      id: recovery.id,
      runId: result.runId,
      sessionId: 'host-rejected',
      threadId,
      text: recovery.text,
      action: recovery.action,
      state: 'rejected',
      revision: 0,
      queueRevision: 0,
      editable: true,
      cancellable: true,
      reorderable: false,
      targetRunId: recovery.targetRunId,
      reason: recovery.reason,
      attachmentCount: input.attachments?.length || 0,
    },
  }
}

function rememberRejectedFollowUp(
  setRejected: Dispatch<SetStateAction<Record<string, RejectedFollowUp>>>,
  result: ExternalRunResult,
  input: ExternalRunOpts,
  threadId: string,
): void {
  const rejected = rejectedFollowUpFromResult(result, input, threadId)
  if (!rejected) return
  setRejected((current) => ({ ...current, [rejected.projection.id]: rejected }))
}

function DesktopThreadListButton({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  if (!visible) return null
  return (
    <button
      type="button"
      className="hidden sm:inline-flex p-1.5 rounded-control hover:bg-hover-2 text-ink-3"
      onClick={onClick}
      title="Threads"
    >
      <Icon name="menu" size={18} />
    </button>
  )
}

function LiveRunBadge({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <span className="flex items-center gap-1 text-[11px] text-accent-ink">
      <span className="w-1.5 h-1.5 rounded-full bg-accent" />
      執行中
    </span>
  )
}

/**
 * Build/Plan + 模型/深度 + Threads + 內嵌執行
 */
export function ProtocolsPage() {
  const {
    draftInput,
    setDraftInput,
    selectedLoopType,
    setSelectedLoopType,
    stopExecution,
    getRunIdForThread,
    selectRun,
  } = useAgentStore(useShallow((state) => ({
    draftInput: state.draftInput,
    setDraftInput: state.setDraftInput,
    selectedLoopType: state.selectedLoopType,
    setSelectedLoopType: state.setSelectedLoopType,
    stopExecution: state.stopExecution,
    getRunIdForThread: state.getRunIdForThread,
    selectRun: state.selectRun,
  })))
  const [submittingByThread, setSubmittingByThread] = useState<Record<string, number>>({})
  const [showTerminal, setShowTerminal] = useState(false)
  const [composerApprovalModes, setComposerApprovalModes] = useState<Record<string, ApprovalMode>>({})
  const [composerFollowUpModes, setComposerFollowUpModes] = useState<Record<string, FollowUpMode>>({})
  const [pendingFollowUps, setPendingFollowUps] = useState<PendingFollowUpProjection[]>([])
  const [submittingFollowUps, setSubmittingFollowUps] = useState<Record<string, PendingFollowUpProjection>>({})
  const [rejectedFollowUps, setRejectedFollowUps] = useState<Record<string, RejectedFollowUp>>({})
  const { run: runSlash } = useSlashExecutor()
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.update)
  const projectRoot = useProjectStore((s) => s.root)
  const pickProjectFolder = useProjectStore((s) => s.pickFolder)

  const {
    hydrate,
    activeId,
    showRunPanel,
    showThreadList,
    setShowRunPanel,
    setShowThreadList,
    setThreadStatus,
    pushBubble,
    setModel,
    setThinkingDepth,
    setSpeed,
    setAgentMode,
    setRunner,
    setLoopType,
    createThread,
    clearBubbles,
    setThreadDraft,
  } = useThreadStore(useShallow((state) => ({
    hydrate: state.hydrate,
    activeId: state.activeId,
    showRunPanel: state.showRunPanel,
    showThreadList: state.showThreadList,
    setShowRunPanel: state.setShowRunPanel,
    setShowThreadList: state.setShowThreadList,
    setThreadStatus: state.setThreadStatus,
    pushBubble: state.pushBubble,
    setModel: state.setModel,
    setThinkingDepth: state.setThinkingDepth,
    setSpeed: state.setSpeed,
    setAgentMode: state.setAgentMode,
    setRunner: state.setRunner,
    setLoopType: state.setLoopType,
    createThread: state.createThread,
    clearBubbles: state.clearBubbles,
    setThreadDraft: state.setThreadDraft,
  })))
  const selectActivityRun = useRunActivityStore((s) => s.selectRun)
  // Per-thread, matching where the grant is actually stored and enforced. The
  // legacy `sessionAllow` scalar is only ever set for a run with no thread, so
  // reading it here showed the badge for a grant this conversation never made —
  // and never showed one it did, leaving the user no way to revoke it.
  const sessionAllow = usePermissionAskStore((s) =>
    activeId ? s.sessionAllowByThread[activeId] === true : s.sessionAllow,
  )
  const setSessionAllow = usePermissionAskStore((s) => s.setSessionAllow)

  const scrollRef = useRef<HTMLDivElement>(null)
  // This is render state, so subscribe to the active thread object itself.
  // Calling the stable `activeThread` getter here would not notify React when
  // only `threads` changes (model, runner, depth, mode, bubbles, and so on).
  const thread = useThreadStore((state) =>
    state.threads.find((item) => item.id === state.activeId) || null,
  )
  // 草稿跟著對話走：每個 thread 一份輸入草稿，切換任務互不干擾；
  // 沒有 active thread 時退回全域 draftInput。
  const threadDraft = useThreadStore((s) => (activeId ? s.draftByThread[activeId] || '' : ''))
  const setComposerDraft = useCallback(
    (v: string) => {
      if (activeId) setThreadDraft(activeId, v)
      setDraftInput(v)
    },
    [activeId, setThreadDraft, setDraftInput],
  )
  const presentationRunId = activeId ? getRunIdForThread(activeId) : null
  useEffect(() => {
    const panel = useWorkspacePanelSessionStore.getState()
    panel.restore()
    if (useWorkspacePanelSessionStore.getState().tabs.length > 0) setShowRunPanel(true)
  }, [setShowRunPanel])
  useEffect(() => {
    if (showRunPanel && presentationRunId && activeId) {
      useWorkspacePanelSessionStore.getState().openTab({ kind: 'summary', runId: presentationRunId, threadId: activeId })
    }
  }, [showRunPanel, presentationRunId, activeId])
  useEffect(() => {
    if (showTerminal) useWorkspacePanelSessionStore.getState().openTab({ kind: 'terminal' })
  }, [showTerminal])
  const activity = useRunActivityStore((s) =>
    presentationRunId ? s.presentations[presentationRunId] : undefined,
  )
  const presentationActive = useAgentStore((s) =>
    presentationRunId ? s.activeRunIds.includes(presentationRunId) : false,
  )
  // Strictly run-scoped: a conversation with no run of its own shows nothing,
  // never `s.agent`, which is whichever run the store last had selected.
  const presentationAgent = useAgentStore((s) =>
    (presentationRunId ? s.runStates[presentationRunId] : undefined) || IDLE_AGENT_STATE,
  )
  const approvalPending = usePermissionAskStore((s) =>
    Boolean(
      presentationRunId &&
        ((s.current?.runId && s.current.runId === presentationRunId) ||
          s.queue.some((item) => item.runId === presentationRunId)),
    ),
  )
  const lifecycle = deriveRunLifecycle({
    phase: activity?.phase,
    status: presentationAgent.status,
    statusLine: activity?.statusLine,
    active: presentationActive || Boolean(activity?.active),
    approvalPending,
    terminal: Boolean(activity?.terminal),
    objective: presentationAgent.objective,
    orchestration: orchestrationFromAgent(presentationAgent),
    interruptReason: presentationAgent.interruptReason,
    stopping: activity?.stopping,
  })
  const composerApprovalMode = activeId ? composerApprovalModes[activeId] : undefined
  const composerBusy = isConversationComposerBusy(submittingByThread, activeId, lifecycle.live)
  const visiblePendingFollowUps = visibleFollowUps(pendingFollowUps, submittingFollowUps, rejectedFollowUps, activeId)
  const refreshPendingFollowUps = useCallback(async () => {
    const api = window.subagents?.piHost?.runs
    if (!activeId) {
      setPendingFollowUps([])
      return
    }
    const compatibility = projectRendererQueuedFollowUps(listQueuedRuns(), activeId)
    if (!api?.list) {
      setPendingFollowUps(compatibility)
      return
    }
    try {
      const result = await api.list()
      const projected = projectPendingFollowUps(Array.isArray(result.queue) ? result.queue : [], activeId)
        .filter((item) => item.state === 'queued' || item.state === 'dispatching' || (item.action === 'steer' && lifecycle.live))
      setPendingFollowUps([...projected, ...compatibility])
    } catch {
      // Host projection is optional in plain-browser mode; only show the
      // renderer queue items that renderer itself owns.
      setPendingFollowUps(compatibility)
    }
  }, [activeId, lifecycle.live])

  useEffect(() => {
    void refreshPendingFollowUps()
    const api = window.subagents?.piHost
    const unsubscribe = api?.onEvent?.((event) => {
      if (event.event === 'host/queue' || event.event === 'host/agent-lifecycle') void refreshPendingFollowUps()
    })
    const interval = window.setInterval(() => void refreshPendingFollowUps(), 1_500)
    return () => { unsubscribe?.(); window.clearInterval(interval) }
  }, [refreshPendingFollowUps])

  const editPendingFollowUp = useCallback(async (item: PendingFollowUpProjection, text: string) => {
    if (item.state === 'rejected') {
      setRejectedFollowUps((current) => {
        const found = current[item.id]
        if (!found) return current
        return { ...current, [item.id]: { projection: { ...found.projection, text }, input: { ...found.input, objective: text } } }
      })
      return
    }
    try {
      const update = window.subagents?.piHost?.runs?.update
      if (!update) throw new Error('Pi Host queue bridge unavailable')
      await update({ runId: item.runId, prompt: text, expectedRevision: item.queueRevision })
      await refreshPendingFollowUps()
    } catch (error) {
      if (activeId) pushBubble(activeId, 'system', `排隊指令未更新：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [activeId, pushBubble, refreshPendingFollowUps])

  const cancelPendingFollowUp = useCallback(async (item: PendingFollowUpProjection) => {
    if (item.state === 'rejected') {
      setRejectedFollowUps((current) => {
        const { [item.id]: _removed, ...rest } = current
        return rest
      })
      return
    }
    if (item.sessionId === 'renderer-compatibility') {
      removeQueuedRun(item.id)
      await refreshPendingFollowUps()
      return
    }
    try {
      const cancel = window.subagents?.piHost?.runs?.cancel
      if (!cancel) throw new Error('Pi Host queue bridge unavailable')
      await cancel(item.runId, item.queueRevision)
      await refreshPendingFollowUps()
    } catch (error) {
      if (activeId) pushBubble(activeId, 'system', `排隊指令未刪除：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [activeId, pushBubble, refreshPendingFollowUps])

  const movePendingFollowUp = useCallback(async (item: PendingFollowUpProjection, direction: 'up' | 'down') => {
    if (item.sessionId === 'renderer-compatibility') {
      moveQueuedRun(item.id, direction === 'up' ? -1 : 1)
      await refreshPendingFollowUps()
      return
    }
    const siblings = pendingFollowUps.filter((candidate) => candidate.sessionId === item.sessionId && candidate.reorderable)
    const index = siblings.findIndex((candidate) => candidate.id === item.id)
    const target = direction === 'up' ? index - 1 : index + 1
    if (index < 0 || target < 0 || target >= siblings.length) return
    const reordered = [...siblings]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    try {
      await window.subagents?.piHost?.runs?.reorder?.({ sessionId: item.sessionId, runIds: reordered.map((candidate) => candidate.runId), expectedRevision: item.queueRevision })
      await refreshPendingFollowUps()
    } catch (error) {
      if (activeId) pushBubble(activeId, 'system', `排隊順序未更新：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [activeId, pendingFollowUps, pushBubble, refreshPendingFollowUps])

  const queueRejectedFollowUp = useCallback(async (item: PendingFollowUpProjection) => {
    const rejected = rejectedFollowUps[item.id]
    if (!rejected) return
    try {
      const { runTask } = await import('../agent/taskRunCoordinator')
      const result = await runTask({ ...rejected.input, runId: item.runId, followUpAction: 'queue' })
      if (result.followUpRecovery) throw new Error(result.followUpRecovery.reason)
      setRejectedFollowUps((current) => {
        const { [item.id]: _removed, ...rest } = current
        return rest
      })
      void refreshPendingFollowUps()
      if (result.error && activeId) pushBubble(activeId, 'system', result.error)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      setRejectedFollowUps((current) => {
        const found = current[item.id]
        return found ? { ...current, [item.id]: { ...found, projection: { ...found.projection, reason } } } : current
      })
    }
  }, [activeId, pushBubble, refreshPendingFollowUps, rejectedFollowUps])
  const runnerTransitionRevision = useRef(0)
  // Keep the latest run artifact index available for explicit handoff export.
  // Conversation UI no longer projects generic run evidence as workflow stages.
  const artifactIndex = readArtifactIndex(
    typeof window === 'undefined' ? undefined : window.localStorage,
    activeId || '',
  )
  const handoff = buildHandoffAvailability(artifactIndex, activeId || '')

  useEffect(() => {
    hydrate()
  }, [hydrate])

  // Phase 1: thread selection is the UI seam for run presentation selection.
  // Keep the run identity explicit so a late update from another thread does
  // not become the visible state merely because it published last.
  useEffect(() => {
    selectRun(presentationRunId)
    selectActivityRun(presentationRunId)
  }, [presentationRunId, selectActivityRun, selectRun])


  // Auto-open right task panel while running (Codex-style split)
  useEffect(() => {
    if (lifecycle.live) setShowRunPanel(true)
  }, [lifecycle.live, setShowRunPanel])

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [
    thread?.bubbles.length,
    presentationActive,
    presentationAgent.logs.length,
    presentationAgent.toolCalls?.length,
    presentationAgent.progress,
    activity?.events.length,
    activity?.draftText,
  ])

  useEffect(() => {
    // Sync pin; null = auto classify for this thread
    setSelectedLoopType(thread?.loopType ?? null)
  }, [thread?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  /** null = 自動分類（Chat-lite Turn / Goal …）；非 null = 使用者釘選 */
  const pinnedLoopType: LoopType | null = thread?.loopType ?? selectedLoopType
  const depth: ThinkingDepth = thread?.thinkingDepth || 'deep'
  const depthDef = getThinkingDepth(depth)
  const speed = thread?.speed || 'standard'
  const agentMode: AgentMode = thread?.agentMode || 'build'
  const threadModel = thread?.model || ''
  const runner: ThreadRunner = thread?.runner || 'builtin'
  const composerFollowUpMode = activeId
    ? composerFollowUpModes[activeId] || settings.followUpMode || 'steer'
    : settings.followUpMode || 'steer'
  const immediateFollowUpAction = followUpActionForRunner(runner, 'steer') as Extract<FollowUpAction, 'steer' | 'takeover'>
  const selectedFollowUpAction = followUpActionForRunner(runner, composerFollowUpMode)
  const live = lifecycle.live
  const empty = !thread?.bubbles.length && !live

  const authorizedRunners = (settings.cliProviders || []).filter(
    (p) => p.enabled && p.authorized,
  )

  const runnerOptions: Array<{
    id: ThreadRunner
    label: string
    ready: boolean
    /** Capability blurb for title tooltip */
    blurb: string
  }> = [
    {
      id: 'builtin',
      label: '內建',
      ready: true,
      blurb: '完整：工具 · HITL 權限 · 學習 · 知識圖譜',
    },
    {
      id: 'codex',
      label: 'Codex',
      ready: authorizedRunners.some((p) => p.id === 'codex'),
      blurb: '本機 CLI：訂閱/登入；無權限細粒度 · 無 FC 工具迴圈',
    },
    {
      id: 'claude',
      label: 'Claude',
      ready: authorizedRunners.some((p) => p.id === 'anthropic' || p.id === 'claude'),
      blurb: '本機 CLI：訂閱/登入；無權限細粒度 · 無 FC 工具迴圈',
    },
    {
      id: 'grok',
      label: 'Grok',
      ready: authorizedRunners.some((p) => p.id === 'grok'),
      blurb: '本機 CLI：訂閱/登入；無權限細粒度 · 無 FC 工具迴圈',
    },
    {
      id: 'gemini',
      label: 'Gemini',
      ready: authorizedRunners.some((p) => p.id === 'google' || p.id === 'gemini'),
      blurb: '本機 Gemini CLI：登入狀態由 CLI 管理；圖片可用性依本機版本診斷',
    },
    {
      id: 'cursor',
      label: 'Cursor',
      ready: authorizedRunners.some((p) => p.id === 'cursor'),
      blurb: '本機 CLI：訂閱/登入；無權限細粒度 · 無 FC 工具迴圈',
    },
  ]

  const runEmbedded = async (
    goal: string,
    attachmentsIn: ChatAttachment[] = [],
  ) => {
    let raw = goal.trim()
    if (raw.startsWith('/')) return
    let attachments = attachmentsIn
    if (!raw && attachments.length) {
      raw = defaultGoalForAttachments(attachments)
    }
    if (!raw) return
    if (!activeId) return

    const { subagents } = parseSubagentMentions(raw)
    const conversationSuggestion =
      !pinnedLoopType && detectAutomationSuggestion(raw)
    const isFollowUpSubmission = lifecycle.live
    const submissionFollowUpAction = selectedFollowUpAction
    const followUpClientMessageId = isFollowUpSubmission ? createFollowUpClientMessageId() : undefined
    const runInput: ExternalRunOpts = {
      ...buildComposerRunInput({
        objective: raw,
        threadId: activeId,
        runner,
        followUpAction: submissionFollowUpAction,
        loopType: pinnedLoopType,
        attachments,
        projectRoot: projectRoot || undefined,
        settingsApprovalMode: settings.approvalMode || 'auto',
        selectedApprovalMode: composerApprovalMode,
        agentMode,
        model: threadModel || settings.model,
        thinkingDepth: depth,
        speed,
        temporary: settings.temporaryChatDefault === true,
      }),
      ...(followUpClientMessageId ? { runId: followUpClientMessageId } : {}),
    }

    const submissionThreadId = activeId
    if (followUpClientMessageId) {
      setSubmittingFollowUps((current) => ({
        ...current,
        [followUpClientMessageId]: createSubmittingFollowUpProjection({
          id: followUpClientMessageId,
          threadId: submissionThreadId,
          text: raw,
          action: submissionFollowUpAction,
          attachmentCount: attachments.length,
        }),
      }))
    }
    setSubmittingByThread((current) => ({
      ...current,
      [submissionThreadId]: (current[submissionThreadId] || 0) + 1,
    }))
    setComposerApprovalModes((current) => {
      const { [submissionThreadId]: _consumed, ...rest } = current
      return rest
    })
    setComposerDraft('')
    if (thread?.loopType) setSelectedLoopType(thread.loopType)
    else setSelectedLoopType(null)

    // Informational bubbles (before controller takes over lifecycle)
    if (subagents.length) {
      pushBubble(activeId, 'system', `Subagent: @${subagents.join(' @')}`)
    }
    if (settings.temporaryChatDefault) {
      pushBubble(activeId, 'system', '臨時對話：本次不讀寫跨對話記憶')
    }
    if (!thread?.loopType) {
      pushBubble(
        activeId,
        'system',
        conversationSuggestion
          ? 'Loop：偵測到自動化語意 → 僅提出建議，不啟動 Time/Proactive'
          : 'Loop：自動分類（短訊息→回合 · 複雜目標→目標迴圈）',
      )
    }
    if (runner !== 'builtin') {
      pushBubble(
        activeId,
        'system',
        attachments.length
          ? `執行引擎：本機 ${runner} CLI · 附件 ${attachments.length} 個將寫入 .subagents/chat-attachments/ 供 CLI 讀取`
          : `執行引擎：本機 ${runner} CLI（使用既有登入，不複製 token）`,
      )
    }

    try {
      // Single lifecycle controller: busy policy (steer/queue), thread status,
      // user/assistant bubbles, trace runId, drain — all owned by runTask.
      // Omit loopType when unpinned → engine auto-classifies (Chat-lite / Goal).
      const { runTask } = await import('../agent/taskRunCoordinator')
      const r = await runTask(runInput)
      rememberRejectedFollowUp(setRejectedFollowUps, r, runInput, activeId)
      if (r.queued) {
        const n = queueLength()
        const pos =
          r.queueId != null
            ? listQueuedRuns().findIndex((q) => q.id === r.queueId) + 1
            : n
        pushBubble(
          activeId,
          'system',
          r.error ||
            `全域執行中 — 已加入佇列第 ${pos > 0 ? pos : n} 位（${n}/24），完成後自動執行`,
        )
      } else if (r.skipped) {
        pushBubble(activeId, 'system', r.error || '全域執行中')
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      if (followUpClientMessageId) {
        setRejectedFollowUps((current) => ({
          ...current,
          [followUpClientMessageId]: {
            input: runInput,
            projection: {
              id: followUpClientMessageId,
              runId: followUpClientMessageId,
              sessionId: 'renderer-rejected',
              threadId: submissionThreadId,
              text: raw,
              action: submissionFollowUpAction,
              state: 'rejected',
              revision: 0,
              queueRevision: 0,
              editable: true,
              cancellable: true,
              reorderable: false,
              reason,
              attachmentCount: attachments.length,
            },
          },
        }))
      } else {
        setThreadStatus(activeId, 'failed')
        pushBubble(activeId, 'system', `執行失敗：${reason}`)
      }
    } finally {
      await refreshPendingFollowUps()
      if (followUpClientMessageId) {
        setSubmittingFollowUps((current) => {
          const { [followUpClientMessageId]: _acknowledged, ...rest } = current
          return rest
        })
      }
      setComposerFollowUpModes((current) => {
        const { [submissionThreadId]: _consumed, ...rest } = current
        return rest
      })
      setSubmittingByThread((current) => {
        const nextCount = Math.max(0, (current[submissionThreadId] || 0) - 1)
        if (nextCount > 0) return { ...current, [submissionThreadId]: nextCount }
        const { [submissionThreadId]: _finished, ...rest } = current
        return rest
      })
    }
  }

  // Tab（空輸入）切換 Build/Plan
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.tagName !== 'TEXTAREA') return
      const ta = t as HTMLTextAreaElement
      if (ta.value.trim() !== '') return
      e.preventDefault()
      if (!activeId) return
      setAgentMode(activeId, nextPrimaryAgent(agentMode))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [activeId, agentMode, setAgentMode])

  // /term 指令與外部事件
  useEffect(() => {
    const onToggle = () => {
      setShowTerminal((v) => !v)
      setShowRunPanel(false)
    }
    window.addEventListener('subagents:toggle-terminal', onToggle)
    return () => window.removeEventListener('subagents:toggle-terminal', onToggle)
  }, [setShowRunPanel])

  const onModeChange = (t: LoopType | null) => {
    setSelectedLoopType(t)
    if (activeId) setLoopType(activeId, t)
    // Time / Proactive 真正規則在「自動化」；此處僅標記語意
    // null = 自動分類
  }

  const createHandoff = () => {
    if (!handoff.available || !activeId) return
    const runId = handoff.index.runId
    const content = buildHandoffDocument({
      threadId: activeId,
      runId,
      index: handoff.index,
    })
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `handoff-${activeId}.md`
    link.click()
    URL.revokeObjectURL(url)
    const hasStaleReference = handoff.index.entries.some(
      (entry) => entry.status === 'stale' || entry.status === 'missing',
    )
    pushBubble(
      activeId,
      'system',
      hasStaleReference
        ? 'Handoff 已建立為本機 Markdown 檔案，但含 stale/missing references；未傳送或上傳，請先檢查。'
        : 'Handoff 已建立為本機 Markdown 檔案；不會自動傳送或上傳。',
    )
  }

  const chooseComposerApprovalMode = (mode: ApprovalMode) => {
    if (!activeId) return
    setComposerApprovalModes((current) => ({ ...current, [activeId]: mode }))
  }

  const consumeComposerApprovalMode = (threadId: string) => {
    setComposerApprovalModes((current) => {
      const { [threadId]: _consumed, ...rest } = current
      return rest
    })
  }

  return (
    <div className="relative h-full flex min-h-0 bg-canvas text-ink">
      {showThreadList && (
        <>
          <button
            type="button"
            aria-label="關閉對話列表"
            className="absolute inset-0 z-40 bg-black/35 sm:hidden"
            onClick={() => setShowThreadList(false)}
          />
          <aside
            aria-label="對話列表"
            className="absolute inset-y-0 left-0 z-50 flex w-[min(86vw,320px)] shrink-0 flex-col border-r border-line sm:relative sm:inset-auto sm:z-auto sm:w-[200px] md:w-[220px]"
          >
            <ThreadSidebar
              onThreadSelected={() => {
                if (window.matchMedia('(max-width: 639px)').matches) setShowThreadList(false)
              }}
            />
          </aside>
        </>
      )}

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Top bar */}
        <div className="shrink-0 h-12 px-3 md:px-4 border-b border-line flex items-center justify-between gap-2 bg-surface">
          <div className="flex items-center gap-2 min-w-0">
            <DesktopThreadListButton
              visible={!showThreadList}
              onClick={() => setShowThreadList(true)}
            />
            <button
              type="button"
              aria-label="開啟對話列表"
              className="sm:hidden p-1.5 rounded-control hover:bg-hover-2 text-ink-3"
              onClick={() => setShowThreadList(!showThreadList)}
            >
              <Icon name="forum" size={18} />
            </button>
            <Icon name="auto_awesome" size={16} className="text-ink-2 shrink-0" />
            <span className="font-semibold text-[13px] truncate max-w-[140px] md:max-w-[220px]">
              {thread?.title || '新對話'}
            </span>
            <LiveRunBadge visible={live} />
          </div>
          <ThreadCapabilityDiagnostics />
        </div>

        {/*
          對話區與輸入外框：同一個 chat-column 寬度，
          輸入框自己有邊框，左右與對話訊息區對齊、同寬。
        */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="chat-column flex-1 min-h-0 flex flex-col w-full max-w-3xl mx-auto px-4 md:px-5">
            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] py-5"
            >
              {empty ? (
                <div className="flex flex-col items-center justify-center pt-[18vh] pb-6 text-center">
                  <h1 className="font-[family-name:var(--font-sora)] text-xl md:text-2xl font-semibold">
                    今天要完成什麼？
                  </h1>
                  <CliDoctorCard
                    onStartTask={() => {
                      setComposerDraft('請檢查目前專案，完成一個小幅度安全修正並回報 Git diff。')
                      requestFocusComposer({ openSlash: false })
                    }}
                  />
                  <SuggestedPrompts
                    onPick={(prompt) => {
                      setComposerDraft(prompt)
                      requestFocusComposer({ openSlash: false })
                    }}
                  />
                </div>
              ) : (
                <div className="w-full space-y-4 pb-2">
                  {(() => {
                    const items = thread?.bubbles || []
                    // Recorded order, exactly. Bucketing the tail into
                    // "systems, then the live feed, then assistants" put hook
                    // notices that fired AFTER an answer above it, and — while a
                    // follow-up steered a live run — showed the previous turn's
                    // answer under the new question, as if it had replied to it.
                    // The live feed goes last because that is where it belongs
                    // in time: the answer it is working towards has not been
                    // pushed yet, and once the run settles the feed hides itself
                    // and the recorded run summary takes its place in sequence.
                    const continuationAnchorId = continuationAnchorBubbleId(
                      items,
                      presentationRunId,
                    )
                    const renderBubble = (b: (typeof items)[0]) =>
                      b.role === 'run' && b.runSummary ? (
                        <RunSummaryCard key={b.id} summary={b.runSummary} />
                      ) : (
                        <ChatBubble key={b.id} bubble={b} />
                      )
                    return (
                      <>
                        {items.map((bubble) => (
                          <Fragment key={bubble.id}>
                            {renderBubble(bubble)}
                            {bubble.id === continuationAnchorId && activeId ? (
                              <RunContinuationActions
                                threadId={activeId}
                                runId={presentationRunId}
                              />
                            ) : null}
                          </Fragment>
                        ))}
                        {presentationRunId ? (
                          <RunProcessFeed
                            runId={presentationRunId}
                            depthLabel={depthDef.label}
                            onOpenPanel={() => setShowRunPanel(true)}
                          />
                        ) : null}
                      </>
                    )
                  })()}
                </div>
              )}
            </div>

            {/* 專案 pill 置於輸入上方；其餘次要控制集中在左下＋選單。 */}
            <div className="shrink-0 w-full pt-3 pb-4 space-y-2">
              <ComposerExecutionContext
                live={lifecycle.live}
                tasks={activity?.tasks.length ? activity.tasks : thread?.runPlan || []}
                fileChanges={activity?.fileChanges}
              />
              {activeId ? <PermissionAskPanel threadId={activeId} /> : null}
              <CommandComposer
                scopeKey={activeId || 'no-thread'}
                value={activeId ? threadDraft : draftInput}
                onChange={setComposerDraft}
                mode="agent"
                primary
                autoFocus
                disabled={false}
                placeholder={
                  composerBusy
                    ? busyComposerPlaceholder(runner, composerFollowUpMode)
                    : thread?.awaitingReply
                      ? '回覆以繼續…'
                      : '什麼都能做'
                }
                enterBehavior={settings.enterBehavior || 'enter'}
                hideHints
                quickActions={({ openFilePicker, disabled }) => (
                  <ComposerQuickActions
                    disabled={disabled}
                    projectRoot={projectRoot}
                    loopType={pinnedLoopType}
                    agentMode={agentMode}
                    runner={runner}
                    runners={runnerOptions}
                    onAttach={openFilePicker}
                    onPickProject={() => void pickProjectFolder()}
                    onLoopChange={onModeChange}
                    onAgentModeChange={(mode) => activeId && setAgentMode(activeId, mode)}
                    onRunnerChange={(nextRunner) => {
                      if (!activeId) return
                      const transitionRevision = ++runnerTransitionRevision.current
                      if (nextRunner !== 'builtin') {
                        setRunner(activeId, nextRunner)
                        return
                      }
                      const transition = resolveBuiltinRunnerTransition({
                        currentRunner: runner,
                        selectedModel: threadModel,
                      })
                      const settingsPatch = transition.settingsPatch
                      if (settingsPatch) {
                        void (async () => {
                          try {
                            await updateSettings(settingsPatch)
                            if (runnerTransitionRevision.current !== transitionRevision) return
                            setModel(activeId, transition.threadModel)
                            setRunner(activeId, 'builtin')
                          } catch (error) {
                            if (runnerTransitionRevision.current !== transitionRevision) return
                            pushBubble(
                              activeId,
                              'system',
                              `無法切換到 Pi Core：${error instanceof Error ? error.message : String(error)}`,
                            )
                          }
                        })()
                        return
                      }
                      setModel(activeId, transition.threadModel)
                      setRunner(activeId, 'builtin')
                    }}
                    onOpenAutomation={(kind) => {
                      window.location.hash = kind === 'event' ? '#/automation?tab=events' : '#/automation'
                    }}
                    onOpenCapabilities={() => {
                      window.location.hash = '#/learning?tab=plugins'
                    }}
                    runPanelAvailable={Boolean(presentationRunId)}
                    onToggleRunPanel={() => {
                      if (presentationRunId && activeId) useWorkspacePanelSessionStore.getState().openTab({ kind: 'summary', runId: presentationRunId, threadId: activeId })
                      setShowRunPanel(true)
                      setShowTerminal(false)
                    }}
                    onToggleTerminal={() => {
                      useWorkspacePanelSessionStore.getState().openTab({ kind: 'terminal' })
                      setShowTerminal(true)
                      setShowRunPanel(false)
                    }}
                    onCreateThread={() =>
                      createThread({
                        model: threadModel,
                        thinkingDepth: depth,
                        speed,
                        agentMode,
                        runner,
                        loopType: pinnedLoopType,
                      })
                    }
                    handoff={handoff}
                    onCreateHandoff={createHandoff}
                  />
                )}
                onSubmitLine={(line, atts) => void runEmbedded(line, atts)}
                running={lifecycle.canStop}
                followUpAction={lifecycle.live ? selectedFollowUpAction : undefined}
                followUpImmediateAction={lifecycle.live ? immediateFollowUpAction : undefined}
                onFollowUpActionChange={(action) => {
                  if (!activeId) return
                  setComposerFollowUpModes((current) => ({
                    ...current,
                    [activeId]: action === 'queue' ? 'queue' : 'steer',
                  }))
                }}
                pendingFollowUps={visiblePendingFollowUps}
                onEditPendingFollowUp={editPendingFollowUp}
                onCancelPendingFollowUp={cancelPendingFollowUp}
                onMovePendingFollowUp={movePendingFollowUp}
                onQueueRejectedFollowUp={queueRejectedFollowUp}
                onStop={() => {
                  // Resolve at click time so a just-started run cannot be
                  // cancelled with the previous thread's stale projection id.
                  const runId = (activeId && getRunIdForThread(activeId)) || presentationRunId
                  if (runId) stopExecution(runId)
                }}
                onSlashCommand={async (cmd, args, raw) => {
                  const submissionThreadId = activeId
                  if (submissionThreadId) pushBubble(submissionThreadId, 'user', raw)
                  if (cmd.name === 'clear' && submissionThreadId) clearBubbles(submissionThreadId)
                  const approvalHandoff = submissionThreadId && composerApprovalMode
                    ? beginComposerApprovalHandoff(submissionThreadId, composerApprovalMode)
                    : null
                  try {
                    await runSlash(cmd, args, raw)
                  } finally {
                    if (approvalHandoff && finishComposerApprovalHandoff(approvalHandoff)) {
                      consumeComposerApprovalMode(approvalHandoff.threadId)
                    }
                  }
                }}
                footerLeft={
                  <div className="flex items-center gap-2">
                    <ApprovalModeMenu
                      mode={composerApprovalMode || settings.approvalMode || 'auto'}
                      onChange={chooseComposerApprovalMode}
                    />
                    {sessionAllow && (
                      <button
                        type="button"
                        onClick={() => setSessionAllow(false, activeId || undefined)}
                        title="本次 session 其餘 ask 一律允許中，點擊取消"
                        className="inline-flex items-center gap-1 text-[11px] text-amber-300/90 hover:text-amber-200"
                      >
                        <Icon name="verified_user" size={14} />
                        session 全允許中
                      </button>
                    )}
                  </div>
                }
                footerRight={
                  <ModelDepthMenu
                    model={threadModel}
                    depth={depth}
                    speed={speed}
                    globalModel={settings.model}
                    cliProviders={settings.cliProviders}
                    onModelChange={(m) => {
                      if (!activeId) return
                      runnerTransitionRevision.current += 1
                      const transition = resolveModelRunnerSelection({
                        currentRunner: runner,
                        selectedModel: m,
                        providers: settings.cliProviders || [],
                      })
                      setModel(activeId, transition.threadModel)
                      setRunner(activeId, transition.runner)
                    }}
                    onDepthChange={(d) => activeId && setThinkingDepth(activeId, d)}
                    onSpeedChange={(s) => activeId && setSpeed(activeId, s)}
                  />
                }
              />
            </div>
          </div>
        </div>
      </div>

      {(showRunPanel || showTerminal) && (
        <WorkspacePanelSession onEmpty={() => { setShowRunPanel(false); setShowTerminal(false); requestFocusComposer() }} />
      )}
    </div>
  )
}
