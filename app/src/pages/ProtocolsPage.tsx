import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { CommandComposer } from '../components/CommandComposer'
import { ThreadSidebar } from '../components/ThreadSidebar'
import { ModelDepthMenu } from '../components/ModelDepthMenu'
import { ApprovalModeMenu } from '../components/ApprovalModeMenu'
import { ProjectContextBar } from '../components/ProjectContextBar'
import { InlineRunPanel } from '../components/InlineRunPanel'
import { TerminalPanel } from '../components/TerminalPanel'
import { usePermissionAskStore } from '../store/permissionAskStore'
import { useAgentStore } from '../store/agentStore'
import { useSlashExecutor } from '../hooks/useSlashExecutor'
import { useThreadStore, type ThreadRunner } from '../store/threadStore'
import { useSettingsStore } from '../store/settingsStore'
import { useLearningStore } from '../store/learningStore'
import { inferRunnerFromModel } from '../agent/localCliRun'
import type { AgentMode, LoopType } from '../agent/types'
import type { ThinkingDepth } from '../agent/thinking'
import { getThinkingDepth } from '../agent/thinking'
import {
  getPrimaryAgent,
  nextPrimaryAgent,
  parseSubagentMentions,
} from '../agent/opencode/agents'
import { loopTypeZh } from '../i18n/zh'
import {
  countReadyConnectors,
  listPrimaryAbilities,
  type CapabilityCard,
  type CapabilityReadyState,
} from '../lib/capabilityStatus'
import type { ChatAttachment } from '../agent/types'
import {
  defaultGoalForAttachments,
  materializeAttachmentsOnDisk,
} from '../lib/chatAttachments'
import { useProjectStore } from '../store/projectStore'
import { queueLength, subscribeRunQueue } from '../agent/runQueue'
import { RunQueueStrip } from '../components/RunQueueStrip'
import { AttachmentThumb } from '../components/AttachmentThumb'

const MODES: Array<{ type: LoopType; label: string }> = [
  { type: 'Goal-based', label: '目標' },
  { type: 'Turn-based', label: '回合' },
  { type: 'Time-based', label: '定時' },
  { type: 'Proactive', label: '事件' },
]

const SUGGESTIONS = [
  { text: '幫我找 3 款 AI 剪輯軟體並比較價格', icon: 'search' },
  { text: '/plan 先規劃再實作這個功能', icon: 'map' },
  { text: '@explore 專案結構是什麼？', icon: 'travel_explore' },
  { text: '/depth deep', icon: 'psychology' },
  { text: '/model', icon: 'smart_toy' },
  { text: '/help', icon: 'help' },
]

const ABILITY_STATE_LABEL: Record<CapabilityReadyState, string> = {
  ready: '可用',
  needs_auth: '需授權',
  not_installed: '可安裝',
  optional_extra: '內建',
}

const ABILITY_ICON: Record<string, string> = {
  github: 'code',
  notion: 'description',
  web: 'public',
  workspace: 'folder_open',
}

function focusComposerWithDraft(text: string) {
  window.dispatchEvent(
    new CustomEvent('subagents:focus-composer', {
      detail: { openSlash: text.startsWith('/') },
    }),
  )
}

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
  } = useAgentStore()
  const [busy, setBusy] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  const { run: runSlash } = useSlashExecutor()
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.update)
  const plugins = useLearningStore((s) => s.plugins)
  const loadLearning = useLearningStore((s) => s.load)
  const primaryAbilities = useMemo(() => listPrimaryAbilities(plugins), [plugins])
  const projectRoot = useProjectStore((s) => s.root)
  const readyCaps = useMemo(() => countReadyConnectors(plugins), [plugins])
  const fcOn = settings.functionCalling !== false
  const toolsOn = settings.toolsEnabled !== false

  const {
    hydrate,
    activeId,
    activeThread,
    threads,
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
  const sessionAllow = usePermissionAskStore((s) => s.sessionAllow)
  const setSessionAllow = usePermissionAskStore((s) => s.setSessionAllow)

  const scrollRef = useRef<HTMLDivElement>(null)
  /** Ability-card try → force preload on next run */
  const pendingPreloadIds = useRef<string[]>([])
  const [globalQueueLen, setGlobalQueueLen] = useState(0)
  const thread = activeThread()

  useEffect(() => {
    setGlobalQueueLen(queueLength())
    return subscribeRunQueue(() => setGlobalQueueLen(queueLength()))
  }, [])

  useEffect(() => {
    hydrate()
  }, [hydrate])

  useEffect(() => {
    void loadLearning()
  }, [loadLearning])

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [thread?.bubbles.length, isRunning, agent.logs.length])

  useEffect(() => {
    if (thread?.loopType) setSelectedLoopType(thread.loopType)
  }, [thread?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeType =
    thread?.loopType ?? selectedLoopType ?? agent.loopConfig.loopType ?? 'Goal-based'
  const depth: ThinkingDepth = thread?.thinkingDepth || 'deep'
  const depthDef = getThinkingDepth(depth)
  const speed = thread?.speed || 'standard'
  const agentMode: AgentMode = thread?.agentMode || 'build'
  const agentDef = getPrimaryAgent(agentMode)
  const threadModel = thread?.model || ''
  const runner: ThreadRunner = thread?.runner || 'builtin'
  const effectiveModel = threadModel.trim() || settings.model || '—'
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
      id: 'cursor',
      label: 'Cursor',
      ready: authorizedRunners.some((p) => p.id === 'cursor'),
      blurb: '本機 CLI：訂閱/登入；無權限細粒度 · 無 FC 工具迴圈',
    },
  ]

  const runEmbedded = async (
    goal: string,
    attachmentsIn: ChatAttachment[] = [],
    preloadIds?: string[],
  ) => {
    let raw = goal.trim()
    if (raw.startsWith('/')) return
    let attachments = attachmentsIn
    if (!raw && attachments.length) {
      raw = defaultGoalForAttachments(attachments)
    }
    if (!raw) return
    if (!activeId) return

    // Persist attachments to disk early (bubble + queue + vision share filePath)
    if (attachments.length) {
      attachments = await materializeAttachmentsOnDisk(attachments, {
        projectRoot: projectRoot || undefined,
        sessionId: activeId,
      })
    }

    const forcePreload = [
      ...(preloadIds || []),
      ...pendingPreloadIds.current,
    ].filter(Boolean)
    pendingPreloadIds.current = []

    const { subagents } = parseSubagentMentions(raw)

    setBusy(true)
    setDraftInput('')
    if (thread?.loopType) setSelectedLoopType(thread.loopType)

    // Informational bubbles (before controller takes over lifecycle)
    if (subagents.length) {
      pushBubble(activeId, 'system', `Subagent: @${subagents.join(' @')}`)
    }
    if (settings.temporaryChatDefault) {
      pushBubble(activeId, 'system', '臨時對話：本次不讀寫跨對話記憶')
    }
    if (forcePreload.length) {
      pushBubble(
        activeId,
        'system',
        `強制預載能力：${forcePreload.join(', ')}`,
      )
    }
    if (runner === 'builtin' && (!fcOn || !toolsOn)) {
      pushBubble(
        activeId,
        'system',
        '提示：函式呼叫/工具已關閉 — MCP 漸進載入與 connector fallback 會降級；圖片仍盡力以 multimodal 送出。',
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
      const { runTask } = await import('../agent/runExternal')
      const r = await runTask({
        objective: raw,
        sourceKind: 'composer',
        reuseThreadId: activeId,
        runner,
        attachments,
        overrides: forcePreload.length
          ? { preloadCapabilityIds: forcePreload }
          : undefined,
      })
      if (r.queued) {
        pushBubble(
          activeId,
          'system',
          `已加入全域待跑佇列（約 ${queueLength()} 則），目前任務完成後自動執行`,
        )
      } else if (r.skipped) {
        pushBubble(activeId, 'system', r.error || '忙碌中')
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
      setShowRunPanel(true)
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

  const onModeChange = (t: LoopType) => {
    setSelectedLoopType(t)
    if (activeId) setLoopType(activeId, t)
    // Time / Proactive 真正規則在「自動化」；此處僅標記語意
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
            <span className={`hidden sm:inline text-[10px] px-1.5 py-0.5 rounded border font-semibold ${agentDef.color}`}>
              {agentDef.label}
            </span>
            <span className="hidden md:inline text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-outline font-[family-name:var(--font-mono)] truncate max-w-[120px]">
              {effectiveModel}
            </span>
            <span className="hidden lg:inline text-[10px] px-1.5 py-0.5 rounded border border-primary/25 text-primary">
              {depthDef.label}
            </span>
            <span className="text-[11px] text-outline hidden lg:inline">
              {loopTypeZh(activeType)}
            </span>
            {live && (
              <span className="flex items-center gap-1 text-[11px] text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                執行中
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="hidden md:flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-container border border-white/10">
              {MODES.map((m) => (
                <button
                  key={m.type}
                  type="button"
                  onClick={() => onModeChange(m.type)}
                  className={`px-2 py-1 rounded-md text-[10px] font-semibold ${
                    activeType === m.type
                      ? 'bg-primary/20 text-primary'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              title="終端（多頁籤 soft PTY）"
              onClick={() => {
                setShowTerminal((v) => !v)
                if (!showTerminal) setShowRunPanel(false)
              }}
              className={`px-2 py-1.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1 ${
                showTerminal
                  ? 'border-primary/40 text-primary bg-primary/10'
                  : 'border-white/10 text-on-surface-variant'
              }`}
            >
              <Icon name="terminal" size={14} />
              <span className="hidden sm:inline">Term</span>
            </button>
            <button
              type="button"
              title="內嵌執行面板"
              onClick={() => {
                setShowRunPanel(!showRunPanel)
                if (!showRunPanel) setShowTerminal(false)
              }}
              className={`px-2 py-1.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1 ${
                showRunPanel
                  ? 'border-primary/40 text-primary bg-primary/10'
                  : 'border-white/10 text-on-surface-variant'
              }`}
            >
              <Icon name="vertical_split" size={14} />
              <span className="hidden sm:inline">Run</span>
            </button>
            <button
              type="button"
              title="新 Thread"
              onClick={() =>
                createThread({
                  model: threadModel,
                  thinkingDepth: depth,
                  agentMode,
                })
              }
              className="p-1.5 rounded-lg border border-white/10 text-on-surface-variant hover:text-primary"
            >
              <Icon name="add" size={16} />
            </button>
          </div>
        </div>

        {/* Build/Plan + 執行引擎（內建 / 本機 CLI） */}
        <div className="shrink-0 px-3 md:px-4 py-1.5 border-b border-white/5 bg-surface/20 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-container border border-white/10 max-w-[50%] overflow-x-auto custom-scrollbar">
            {/* Built-in Build/Plan + any primary from opencode.json / agents/*.md (id still maps to build|plan for thread storage if custom) */}
            {(['build', 'plan'] as const).map((m) => {
              const a = getPrimaryAgent(m)
              return (
                <button
                  key={m}
                  type="button"
                  title={a.description}
                  onClick={() => activeId && setAgentMode(activeId, m)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-bold shrink-0 ${
                    agentMode === m ? a.color : 'text-on-surface-variant'
                  }`}
                >
                  {a.label}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-container border border-white/10 max-w-full overflow-x-auto custom-scrollbar">
            <span className="text-[9px] text-outline px-1.5 shrink-0">引擎</span>
            {runnerOptions.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={!r.ready && r.id !== 'builtin'}
                title={
                  r.ready
                    ? `${r.label}：${r.blurb}`
                    : `${r.label} 未授權 — 設定 → CLI 授權 → 一鍵偵測`
                }
                onClick={() => activeId && r.ready && setRunner(activeId, r.id)}
                className={`px-2 py-1 rounded-md text-[10px] font-semibold shrink-0 disabled:opacity-35 ${
                  runner === r.id
                    ? 'bg-primary/20 text-primary'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-outline hidden lg:inline truncate max-w-[280px]" title={runnerOptions.find((x) => x.id === runner)?.blurb}>
            {runner === 'builtin'
              ? '內建：工具 · HITL · 學習'
              : `CLI ${runner}：無內建工具／細權限`}
          </span>
        </div>

        {/* Loop 模式語意：Time/Proactive 真正規則在自動化 */}
        {(activeType === 'Time-based' || activeType === 'Proactive') && (
          <div className="shrink-0 px-3 md:px-4 py-1.5 border-b border-amber-500/20 bg-amber-500/10 text-[11px] text-amber-100/90 flex items-center justify-between gap-2 flex-wrap">
            <span>
              {activeType === 'Time-based'
                ? '「定時」僅標記此對話語意；真正的 cron 請在自動化建立任務。'
                : '「主動」僅標記此對話語意；真正的事件規則請在自動化建立。'}
            </span>
            <a
              href="#/automation"
              className="shrink-0 text-primary font-semibold hover:underline"
              onClick={(e) => {
                e.preventDefault()
                window.location.hash =
                  activeType === 'Time-based' ? '#/automation' : '#/automation?tab=events'
              }}
            >
              前往自動化 →
            </a>
          </div>
        )}

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
                <div className="flex flex-col items-center justify-center pt-[8vh] pb-6 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/25 flex items-center justify-center mb-4">
                    <Icon name="auto_awesome" size={24} className="text-primary" />
                  </div>
                  <h1 className="font-[family-name:var(--font-sora)] text-xl md:text-2xl font-semibold mb-2">
                    今天要完成什麼？
                  </h1>
                  <p className="text-sm text-on-surface-variant max-w-md mb-2">
                    直接下任務即可——GitHub、Notion 等連線授權後，不必再管底層工具。
                    <strong className="text-on-surface"> Build</strong> 實作 ·{' '}
                    <strong className="text-on-surface">Plan</strong> 規劃。
                  </p>
                  <p className="text-[11px] text-outline mb-6 font-[family-name:var(--font-mono)]">
                    {agentDef.label} · {effectiveModel} · {depthDef.label}
                  </p>

                  {/* Task-first ability chips — no MCP jargon */}
                  <div className="w-full mb-5">
                    <div className="flex items-center justify-between gap-2 mb-2 px-0.5">
                      <p className="text-[11px] font-semibold tracking-wide text-outline uppercase">
                        直接試用
                      </p>
                      <a
                        href="#/learning?tab=plugins"
                        className="text-[11px] font-semibold text-primary hover:underline"
                        onClick={(e) => {
                          e.preventDefault()
                          window.location.hash = '#/learning?tab=plugins'
                        }}
                      >
                        擴充能力 →
                      </a>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                      {primaryAbilities.map((ability) => (
                        <AbilityTryCard
                          key={ability.id}
                          ability={ability}
                          onTry={() => {
                            pendingPreloadIds.current = [
                              ...ability.preloadCapabilityIds,
                            ]
                            setDraftInput(ability.tryPrompt)
                            focusComposerWithDraft(ability.tryPrompt)
                          }}
                          onSetup={() => {
                            window.location.hash = '#/learning?tab=plugins'
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {settings.ambientSuggestions !== false && (
                    <div className="w-full">
                      <p className="text-[11px] font-semibold tracking-wide text-outline uppercase mb-2 text-left px-0.5">
                        快捷建議
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                        {SUGGESTIONS.map((s) => (
                          <button
                            key={s.text}
                            type="button"
                            onClick={() => {
                              setDraftInput(s.text)
                              focusComposerWithDraft(s.text)
                            }}
                            className="text-left px-3 py-2.5 rounded-xl border border-white/10 bg-surface-container/50 hover:border-primary/30 flex items-start gap-2"
                          >
                            <Icon name={s.icon} size={16} className="text-outline mt-0.5 shrink-0" />
                            <span className="text-xs text-on-surface-variant">{s.text}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {threads.length > 1 && (
                    <p className="mt-6 text-[11px] text-outline">
                      {threads.length} 個 thread · 各可獨立模型與深度
                    </p>
                  )}
                </div>
              ) : (
                <div className="w-full space-y-3 pb-2">
                  {thread?.bubbles.map((b) => (
                    <div
                      key={b.id}
                      className={`flex w-full ${b.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words box-border ${
                          b.role === 'user'
                            ? 'max-w-[85%] bg-primary/15 border border-primary/25'
                            : b.role === 'system'
                              ? 'w-full max-w-full bg-surface-container border border-white/8 text-on-surface-variant font-[family-name:var(--font-mono)] text-[12px]'
                              : 'w-full max-w-full bg-surface-container-high/80 border border-white/10'
                        }`}
                      >
                        {b.role !== 'user' && (
                          <div className="text-[10px] uppercase tracking-wider text-outline mb-1 font-semibold">
                            {b.role === 'system' ? 'system' : 'assistant'}
                          </div>
                        )}
                        {b.attachments && b.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {b.attachments.map((a) => (
                              <AttachmentThumb key={a.id} attachment={a} />
                            ))}
                          </div>
                        )}
                        <div className="whitespace-pre-wrap">{b.content}</div>
                      </div>
                    </div>
                  ))}
                  {live && (
                    <div className="flex w-full justify-start">
                      <div className="w-full max-w-full rounded-2xl px-4 py-2.5 bg-surface-container border border-white/10 text-sm text-outline flex items-center gap-2 box-border">
                        <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        思考中（{depthDef.label}）…
                        <button
                          type="button"
                          className="text-primary text-xs underline"
                          onClick={() => setShowRunPanel(true)}
                        >
                          看進度
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 輸入外框：與上方對話欄同寬（同一 chat-column 內容寬） */}
            <div className="shrink-0 w-full pt-3 pb-4 space-y-2 border-t border-white/8">
              <ProjectContextBar />
              <RunQueueStrip compact className="mb-0" />
              {/* Feature matrix — path capabilities at a glance */}
              <div className="flex flex-wrap items-center gap-1.5 px-0.5 text-[10px]">
                <StatusPill
                  ok={runner === 'builtin'}
                  label={runner === 'builtin' ? '內建引擎' : `CLI · ${runner}`}
                  title={
                    runner === 'builtin'
                      ? '完整工具 · 能力包 · HITL'
                      : '本機 CLI：無內建 MCP/connector 工具生態'
                  }
                />
                <StatusPill
                  ok={fcOn && toolsOn && runner === 'builtin'}
                  label={
                    runner !== 'builtin'
                      ? 'CLI 模式'
                      : !toolsOn
                        ? '工具關'
                        : fcOn
                          ? 'FC 開'
                          : 'FC 關 · 降級'
                  }
                  title={
                    runner !== 'builtin'
                      ? 'CLI 不跑內建 function-calling 迴圈'
                      : fcOn && toolsOn
                        ? 'Function calling + 工具已啟用'
                        : '關 FC/工具時無 MCP 漸進載入與多模態圖'
                  }
                />
                <StatusPill
                  ok={Boolean(projectRoot)}
                  label={projectRoot ? '專案已選' : '未選專案'}
                  title={projectRoot || '選專案後檔案工具 / 部分 MCP 才對準工作區'}
                />
                <StatusPill
                  ok={readyCaps > 0}
                  label={readyCaps > 0 ? `已授權 ${readyCaps}` : '未授權連線'}
                  title="已授權的 connector（GitHub / Notion…）"
                />
                {globalQueueLen > 0 && (
                  <StatusPill
                    ok
                    label={`佇列 ${globalQueueLen}`}
                    title="全域待跑佇列（自動化 + 對話追問共用）· 見自動化頁"
                  />
                )}
              </div>
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
                    : '什麼都能做'
                }
                enterBehavior={settings.enterBehavior || 'enter'}
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

      {showRunPanel && (
        <aside className="w-full sm:w-[320px] lg:w-[360px] shrink-0 max-w-[100vw] absolute sm:relative inset-0 sm:inset-auto z-30 sm:z-0 bg-background sm:bg-transparent">
          <InlineRunPanel onClose={() => setShowRunPanel(false)} />
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

function StatusPill({
  ok,
  label,
  title,
}: {
  ok: boolean
  label: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center px-2 py-0.5 rounded-full border font-medium ${
        ok
          ? 'border-primary/25 bg-primary/10 text-primary'
          : 'border-white/10 bg-white/5 text-outline'
      }`}
    >
      {label}
    </span>
  )
}

function AbilityTryCard({
  ability,
  onTry,
  onSetup,
}: {
  ability: CapabilityCard
  onTry: () => void
  onSetup: () => void
}) {
  const needsSetup = ability.state === 'needs_auth' || ability.state === 'not_installed'
  const stateCls =
    ability.state === 'ready'
      ? 'text-primary bg-primary/10 border-primary/20'
      : ability.state === 'needs_auth' || ability.state === 'not_installed'
        ? 'text-amber-200/90 bg-amber-500/10 border-amber-500/20'
        : 'text-outline bg-white/5 border-white/10'

  return (
    <div className="text-left px-3 py-2.5 rounded-xl border border-white/10 bg-surface-container/50 hover:border-primary/25 transition-colors">
      <div className="flex items-start gap-2">
        <Icon
          name={ABILITY_ICON[ability.id] || 'extension'}
          size={16}
          className="text-outline mt-0.5 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-on-surface">{ability.title}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${stateCls}`}>
              {ABILITY_STATE_LABEL[ability.state]}
            </span>
          </div>
          <p className="text-[11px] text-on-surface-variant/90 mt-0.5 leading-snug">{ability.blurb}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            <button
              type="button"
              onClick={onTry}
              className="text-[11px] font-semibold text-primary hover:underline"
            >
              填入試用句
            </button>
            {needsSetup && (
              <button
                type="button"
                onClick={onSetup}
                className="text-[11px] font-semibold text-on-surface-variant hover:text-primary hover:underline"
              >
                去授權
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
