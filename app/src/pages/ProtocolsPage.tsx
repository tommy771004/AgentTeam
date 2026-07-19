import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { CommandComposer } from '../components/CommandComposer'
import { ThreadSidebar } from '../components/ThreadSidebar'
import { ModelDepthMenu } from '../components/ModelDepthMenu'
import { ApprovalModeMenu } from '../components/ApprovalModeMenu'
import { ProjectContextBar } from '../components/ProjectContextBar'
import { InlineRunPanel } from '../components/InlineRunPanel'
import { RunProcessFeed } from '../components/RunProcessFeed'
import { TerminalPanel } from '../components/TerminalPanel'
import { ComposerQuickActions } from '../components/ComposerQuickActions'
import { usePermissionAskStore } from '../store/permissionAskStore'
import { useAgentStore } from '../store/agentStore'
import { useRunActivityStore } from '../store/runActivityStore'
import { useSlashExecutor } from '../hooks/useSlashExecutor'
import { useThreadStore, type ThreadRunner } from '../store/threadStore'
import { useSettingsStore } from '../store/settingsStore'
import { inferRunnerFromModel } from '../agent/localCliRun'
import type { AgentMode, LoopType } from '../agent/types'
import type { ThinkingDepth } from '../agent/thinking'
import { getThinkingDepth } from '../agent/thinking'
import { nextPrimaryAgent, parseSubagentMentions } from '../agent/opencode/agents'
import type { ChatAttachment } from '../agent/types'
import { detectAutomationSuggestion } from '../agent/automationSuggestion'
import {
  defaultGoalForAttachments,
} from '../lib/chatAttachments'
import { useProjectStore } from '../store/projectStore'
import { listQueuedRuns, queueLength } from '../agent/runQueue'
import { ChatBubble } from '../components/ChatBubble'
import { RunSummaryCard } from '../components/RunSummaryCard'
import { CliDoctorCard } from '../components/CliDoctorCard'
import { requestFocusComposer } from '../store/commandHistoryStore'

/**
 * OpenCode 風格：Build/Plan + 模型/深度 + Threads + 內嵌執行
 */
export function ProtocolsPage() {
  const {
    draftInput,
    setDraftInput,
    selectedLoopType,
    setSelectedLoopType,
    isRunning,
    agent,
    getRunIdForThread,
    selectRun,
  } = useAgentStore()
  const [busy, setBusy] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  const { run: runSlash } = useSlashExecutor()
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.update)
  const projectRoot = useProjectStore((s) => s.root)
  const pickProjectFolder = useProjectStore((s) => s.pickFolder)

  const {
    hydrate,
    activeId,
    activeThread,
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
  } = useThreadStore()
  const selectActivityRun = useRunActivityStore((s) => s.selectRun)
  const sessionAllow = usePermissionAskStore((s) => s.sessionAllow)
  const setSessionAllow = usePermissionAskStore((s) => s.setSessionAllow)

  const scrollRef = useRef<HTMLDivElement>(null)
  const thread = activeThread()
  const presentationRunId = activeId ? getRunIdForThread(activeId) : null

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
    if (isRunning || agent.status === 'running' || agent.status === 'parsing') {
      setShowRunPanel(true)
    }
  }, [isRunning, agent.status, setShowRunPanel])

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [thread?.bubbles.length, isRunning, agent.logs.length, agent.toolCalls?.length, agent.progress])

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
  const empty = !thread?.bubbles.length && !isRunning
  const live =
    isRunning ||
    agent.status === 'running' ||
    agent.status === 'parsing' ||
    agent.status === 'manual_intervention'

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
      id: 'opencode',
      label: 'OpenCode',
      ready: authorizedRunners.some((p) => p.id === 'opencode'),
      blurb: '本機 CLI：agents/commands 另見設定；此路徑不跑內建工具',
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

    const conversationSuggestion =
      !pinnedLoopType && detectAutomationSuggestion(raw)
    let suggestionOnly = false

    const { subagents } = parseSubagentMentions(raw)

    setBusy(true)
    setDraftInput('')
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
      const r = await runTask({
        objective: raw,
        sourceKind: 'composer',
        reuseThreadId: activeId,
        runner,
        loopType: pinnedLoopType || undefined,
        attachments,
        // Snapshot the project pinned at dispatch time — a concurrent run must not
        // silently re-resolve to whatever project the UI switches to mid-flight.
        projectRoot: projectRoot || undefined,
      })
      suggestionOnly = Boolean(r.suggestion)
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
      setThreadStatus(activeId, 'failed')
      pushBubble(
        activeId,
        'system',
        `執行失敗：${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      setBusy(false)
      setShowRunPanel(!suggestionOnly)
    }
  }

  // Tab（空輸入）切換 Build/Plan — OpenCode
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

  return (
    <div className="h-full flex min-h-0 bg-background">
      {showThreadList && (
        <aside className="w-[200px] md:w-[220px] shrink-0 hidden sm:flex flex-col min-h-0">
          <ThreadSidebar />
        </aside>
      )}

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Top bar */}
        <div className="shrink-0 h-12 px-3 md:px-4 border-b border-white/8 flex items-center justify-between gap-2 bg-surface/30">
          <div className="flex items-center gap-2 min-w-0">
            {!showThreadList && (
              <button
                type="button"
                className="p-1.5 rounded-lg hover:bg-white/10 text-outline"
                onClick={() => setShowThreadList(true)}
                title="Threads"
              >
                <Icon name="menu" size={18} />
              </button>
            )}
            <button
              type="button"
              className="sm:hidden p-1.5 rounded-lg hover:bg-white/10 text-outline"
              onClick={() => setShowThreadList(!showThreadList)}
            >
              <Icon name="forum" size={18} />
            </button>
            <Icon name="auto_awesome" size={16} className="text-primary shrink-0" />
            <span className="font-semibold text-sm truncate max-w-[140px] md:max-w-[220px]">
              {thread?.title || '新對話'}
            </span>
            {live && (
              <span className="flex items-center gap-1 text-[11px] text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                執行中
              </span>
            )}
          </div>
        </div>

        {/*
          對話區與輸入外框：同一個 chat-column 寬度，
          輸入框自己有邊框，左右與對話訊息區對齊、同寬。
        */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="chat-column flex-1 min-h-0 flex flex-col w-full max-w-3xl mx-auto px-4 md:px-5">
            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] py-6"
            >
              {empty ? (
                <div className="flex flex-col items-center justify-center pt-[18vh] pb-6 text-center">
                  <h1 className="font-[family-name:var(--font-sora)] text-xl md:text-2xl font-semibold">
                    今天要完成什麼？
                  </h1>
                  <CliDoctorCard
                    onStartTask={() => {
                      setDraftInput('請檢查目前專案，完成一個小幅度安全修正並回報 Git diff。')
                      requestFocusComposer({ openSlash: false })
                    }}
                  />
                </div>
              ) : (
                <div className="w-full space-y-3 pb-2">
                  {(() => {
                    const items = thread?.bubbles || []
                    // Codex order: …user → system → [process] → assistant
                    const lastUser = items.map((b) => b.role).lastIndexOf('user')
                    const head = lastUser >= 0 ? items.slice(0, lastUser + 1) : items
                    const rest = lastUser >= 0 ? items.slice(lastUser + 1) : []
                    const midSystems = rest.filter((b) => b.role === 'system')
                    const midAssistants = rest.filter((b) => b.role !== 'system')
                    const renderBubble = (b: (typeof items)[0]) =>
                      b.role === 'run' && b.runSummary ? (
                        <RunSummaryCard key={b.id} summary={b.runSummary} />
                      ) : (
                        <ChatBubble key={b.id} bubble={b} />
                      )
                    return (
                      <>
                        {head.map(renderBubble)}
                        {midSystems.map(renderBubble)}
                        {/* Live process sits ABOVE the final answer (Codex order) */}
                        {presentationRunId ? (
                          <RunProcessFeed
                            runId={presentationRunId}
                            depthLabel={depthDef.label}
                            onOpenPanel={() => setShowRunPanel(true)}
                          />
                        ) : null}
                        {midAssistants.map(renderBubble)}
                      </>
                    )
                  })()}
                </div>
              )}
            </div>

            {/* 專案 pill 置於輸入上方；其餘次要控制集中在左下＋選單。 */}
            <div className="shrink-0 w-full pt-3 pb-4 space-y-2">
              <ProjectContextBar />
              <CommandComposer
                value={draftInput}
                onChange={setDraftInput}
                mode="agent"
                primary
                autoFocus
                disabled={false}
                placeholder={
                  busy || isRunning
                    ? settings.followUpMode === 'queue'
                      ? '輸入追問（將排隊）…'
                      : '輸入以轉向目前任務…'
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
                    onRunnerChange={(nextRunner) => activeId && setRunner(activeId, nextRunner)}
                    onOpenCapabilities={() => {
                      window.location.hash = '#/learning?tab=plugins'
                    }}
                    onToggleRunPanel={() => {
                      setShowRunPanel(!showRunPanel)
                      setShowTerminal(false)
                    }}
                    onToggleTerminal={() => {
                      setShowTerminal((value) => !value)
                      setShowRunPanel(false)
                    }}
                    onCreateThread={() =>
                      createThread({
                        model: threadModel,
                        thinkingDepth: depth,
                        agentMode,
                      })
                    }
                  />
                )}
                onSubmitLine={(line, atts) => void runEmbedded(line, atts)}
                onSlashCommand={async (cmd, args, raw) => {
                  if (activeId) pushBubble(activeId, 'user', raw)
                  if (cmd.name === 'clear' && activeId) clearBubbles(activeId)
                  await runSlash(cmd, args, raw)
                }}
                footerLeft={
                  <div className="flex items-center gap-2">
                    <ApprovalModeMenu
                      mode={settings.approvalMode || 'auto'}
                      onChange={(m) => void updateSettings({ approvalMode: m })}
                    />
                    {sessionAllow && (
                      <button
                        type="button"
                        onClick={() => setSessionAllow(false)}
                        title="本次 session 其餘 ask 一律允許中 — 點擊取消"
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
                      setModel(activeId, m)
                      const inferred = inferRunnerFromModel(m, settings.cliProviders || [])
                      if (inferred !== 'builtin') setRunner(activeId, inferred)
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

      {showRunPanel && presentationRunId && activeId && (
        <aside className="w-full sm:w-[320px] lg:w-[360px] shrink-0 max-w-[100vw] absolute sm:relative inset-0 sm:inset-auto z-30 sm:z-0 bg-background sm:bg-transparent">
          <InlineRunPanel
            runId={presentationRunId}
            threadId={activeId}
            onClose={() => setShowRunPanel(false)}
          />
        </aside>
      )}
      {showTerminal && (
        <aside className="w-full sm:w-[380px] lg:w-[420px] shrink-0 max-w-[100vw] absolute sm:relative inset-0 sm:inset-auto z-30 sm:z-0">
          <TerminalPanel onClose={() => setShowTerminal(false)} />
        </aside>
      )}
    </div>
  )
}
