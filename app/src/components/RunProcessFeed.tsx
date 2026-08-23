/**
 * Live in-chat process feed (OpenCode-style parts).
 * Always visible while a run is active; completed work is also written into
 * ThreadRunSummary bubbles via runExternal (RunSummaryCard).
 */

import { useEffect, useMemo, useState } from 'react'
import { emptyAgentLike } from '../agent/localCliRun'
import { EXTERNAL_CLI_UI_LABEL } from '../agent/runners'
import { deriveRunLifecycle, orchestrationFromAgent } from '../agent/runLifecycle'
import { useAgentStore } from '../store/agentStore'
import { useThreadStore, type ThreadRunner } from '../store/threadStore'
import { usePermissionAskStore } from '../store/permissionAskStore'
import {
  useRunActivityStore,
  type FileChangeRecord,
  type RunActivityEvent,
  type RunTaskItem,
} from '../store/runActivityStore'
import { Icon } from './Icon'
import { MarkdownBody } from './MarkdownBody'
import { ContextCards } from './ContextCards'
import { ElapsedTime } from './primitives/ElapsedTime'
import { AgentThinking } from './primitives/AgentThinking'
import { thinkingVariantForPhase } from './primitives/agentThinkingVariant'
import { Reveal } from './primitives/Reveal'
import { ShimmerLabel } from './primitives/ShimmerLabel'
import {
  contextSummary,
  groupProcessOperations,
  type ProcessOperation,
} from '../lib/runPresentation'

function basen(p: string) {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || p
}

function kindIcon(kind: string): string {
  switch (kind) {
    case 'tool':
      return 'terminal'
    case 'file':
      return 'edit'
    case 'thought':
      return 'psychology'
    case 'error':
      return 'error'
    case 'done':
      return 'check_circle'
    case 'step':
      return 'checklist'
    default:
      return 'bolt'
  }
}

const EMPTY_AGENT = emptyAgentLike({ objective: '', status: 'idle', progress: 0 })
const EMPTY_EVENTS: RunActivityEvent[] = []
const EMPTY_FILES: FileChangeRecord[] = []
const EMPTY_TASKS: RunTaskItem[] = []

export function RunProcessFeed({
  runId,
  depthLabel,
  onOpenPanel,
}: {
  runId: string
  depthLabel: string
  onOpenPanel?: () => void
}) {
  const agent = useAgentStore((s) => s.runStates[runId]) || EMPTY_AGENT
  const isRunning = useAgentStore((s) => s.activeRunIds.includes(runId))
  const activity = useRunActivityStore((s) => s.presentations[runId])
  const approvalPending = usePermissionAskStore((s) =>
    Boolean(
      (s.current?.runId && s.current.runId === runId) ||
        s.queue.some((item) => item.runId === runId),
    ),
  )
  const activityActive = activity?.active || false
  const startedAt = activity?.startedAt ?? 0
  const events = activity?.events ?? EMPTY_EVENTS
  const thought = activity?.thought || ''
  const draftText = activity?.draftText || ''
  const statusLine = activity?.statusLine || ''
  const activityPhase = activity?.phase || 'starting'
  const fileChanges = activity?.fileChanges ?? EMPTY_FILES
  const tasks = activity?.tasks ?? EMPTY_TASKS

  // OpenCode keeps reasoning compact by default; raw streamed thought remains
  // available for inspection without pushing the answer below the fold.
  const [thoughtOpen, setThoughtOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [processOpen, setProcessOpen] = useState(true)

  useEffect(() => {
    // Each submitted prompt starts with the compact run trace available. The
    // user's previous disclosure choice must not hide the next run's status.
    setThoughtOpen(false)
    setExpanded(null)
    setProcessOpen(true)
  }, [runId])

  const runActive = isRunning || activityActive

  /** Flat timeline: stream events + steps + toolCalls + recent logs */
  const timeline = useMemo(() => {
    const rows: ProcessOperation[] = []
    const seen = new Set<string>()

    const add = (row: (typeof rows)[0]) => {
      if (seen.has(row.id)) return
      seen.add(row.id)
      rows.push(row)
    }

    for (const e of events) {
      // The header owns the current status. Keeping every orchestration status
      // as a row makes a long turn look like a log dump instead of a response.
      if (e.kind === 'thought' || e.kind === 'text' || e.kind === 'status') continue
      if (e.kind === 'log' && (e.title === 'stdout' || e.title === 'stderr')) continue
      add({
        id: e.id,
        kind: e.kind,
        title:
          e.kind === 'tool'
            ? e.title || '已執行指令'
            : e.kind === 'file'
              ? e.title || (e.path ? `已編輯 ${basen(e.path)}` : '已編輯檔案')
              : e.title || e.kind,
        detail: e.detail,
        path: e.path,
        ok: e.ok,
      })
    }

    for (const s of agent.steps || []) {
      add({
        id: `step_${s.step}_${s.action}`,
        kind: 'step',
        title: s.description || s.action || `步驟 ${s.step}`,
        detail:
          s.status === 'IN_PROGRESS'
            ? '進行中…'
            : s.status === 'FAILED'
              ? (s.result || '失敗').slice(0, 200)
              : s.status === 'COMPLETED'
                ? '完成'
                : s.status,
        ok: s.status !== 'FAILED',
      })
    }

    for (const t of agent.toolCalls || []) {
      const path = String(t.input?.path ?? t.input?.file ?? t.input?.filePath ?? '')
      const isFile = /write|edit|create|patch/i.test(t.tool) && Boolean(path)
      add({
        id: `tc_${t.id}`,
        kind: isFile ? 'file' : 'tool',
        title: isFile
          ? `已編輯 ${basen(path)}`
          : /bash|shell/i.test(t.tool)
            ? '已執行指令'
            : `已執行 ${t.tool}`,
        detail:
          path ||
          (typeof t.input?.command === 'string'
            ? t.input.command
            : (t.output || '').slice(0, 160)),
        path: path || undefined,
        ok: t.ok,
      })
    }

    // Logs are a last-resort process trail for runners without structured
    // events. Do not mix engine diagnostics into an already useful parts view.
    if (rows.length === 0) {
      for (const l of (agent.logs || []).slice(-12)) {
        const m = l.message || ''
        if (!m || m.startsWith('$ ') || m.length > 240) continue
        add({
          id: `log_${l.id}`,
          kind: l.level === 'ERROR' ? 'error' : 'status',
          title: m.slice(0, 160),
          detail: m,
          ok: l.level !== 'ERROR',
        })
      }
    }

    return rows.slice(-48)
  }, [events, agent.steps, agent.toolCalls, agent.logs])

  const groups = useMemo(() => groupProcessOperations(timeline), [timeline])
  const lifecycle = deriveRunLifecycle({
    phase: activityPhase,
    status: agent.status,
    statusLine,
    active: runActive,
    approvalPending,
    terminal: Boolean(activity?.terminal),
    objective: agent.objective,
    orchestration: orchestrationFromAgent(agent),
  })
  const phase = lifecycle.label
  const toolCount = new Set(
    [
      ...agent.toolCalls.map((tool) => tool.id),
      ...events
        .filter((event) => event.kind === 'tool')
        .map((event) => event.callId || event.id),
    ],
  ).size
  const messageCount = draftText.trim() ? 1 : events.some((event) => event.kind === 'text') ? 1 : 0
  const completedTasks = tasks.filter((task) => task.status === 'done').length
  const taskSummary = tasks.length ? ` · ${completedTasks}/${tasks.length} 任務` : ''
  const recovery = activity?.recovery || null
  const interaction = activity?.interaction || null
  const recoveryThread = useThreadStore((state) =>
    recovery?.conversationId
      ? state.threads.find((thread) => thread.id === recovery.conversationId)
      : undefined,
  )
  const [recoveryActionStatus, setRecoveryActionStatus] = useState('')
  const [interactionInput, setInteractionInput] = useState('')
  const [interactionStatus, setInteractionStatus] = useState('')

  useEffect(() => {
    setRecoveryActionStatus('')
    setInteractionInput('')
    setInteractionStatus('')
  }, [runId])

  const submitExternalCliInteraction = async (approved?: boolean) => {
    const api = window.subagents?.cli
    if (!api) {
      setInteractionStatus('目前環境沒有 external CLI interaction bridge')
      return
    }
    try {
      const ok = interaction?.kind === 'user'
        ? await api.sessionInput?.({ runId, value: interactionInput, providerSessionId: interaction.providerSessionId })
        : await api.sessionApproval?.({ runId, approved: approved === true, providerSessionId: interaction?.providerSessionId })
      if (!ok) {
        setInteractionStatus('Host 未確認 provider 收到這次回覆')
        return
      }
      setInteractionInput('')
      setInteractionStatus('已送出，等待 external CLI 更新')
      useRunActivityStore.getState().setInteraction(null, runId)
    } catch (error) {
      setInteractionStatus(error instanceof Error ? error.message : String(error))
    }
  }

  const runRecoveryAction = async (action: 'resume' | 'retry') => {
    const api = window.subagents?.cli
    if (!api?.sessionRecoveryAction) {
      setRecoveryActionStatus('目前環境沒有 recovery action bridge')
      return
    }
    try {
      const decision = await api.sessionRecoveryAction({ runId, action })
      if (!decision.ok) {
        setRecoveryActionStatus(decision.reason || '此 run 不具備安全恢復條件')
        return
      }
      if (action === 'resume') {
        setRecoveryActionStatus('此 shipped adapter 不支援自動 resume；請使用手動重新執行')
        return
      }
      const objective = recoveryThread?.bubbles.filter((bubble) => bubble.role === 'user').at(-1)?.content?.trim()
      if (!objective || !recovery?.conversationId) {
        setRecoveryActionStatus('找不到可重播的使用者任務；請重新提交原任務')
        return
      }
      const supportedRunner = new Set<ThreadRunner>(['codex', 'claude', 'grok', 'opencode', 'gemini', 'cursor'])
      const runner = supportedRunner.has(recovery.adapter as ThreadRunner)
        ? recovery.adapter as ThreadRunner
        : recoveryThread?.runner && recoveryThread.runner !== 'builtin'
          ? recoveryThread.runner
          : null
      if (!runner) {
        setRecoveryActionStatus('找不到原 external CLI adapter；請重新選擇 runner 後執行')
        return
      }
      const { runTask } = await import('../agent/taskRunCoordinator')
      const result = await runTask({
        objective,
        sourceKind: 'retry',
        runner,
        reuseThreadId: recovery.conversationId,
        runId: `retry_${Date.now().toString(36)}_${runId.slice(-8)}`,
      })
      setRecoveryActionStatus(result.queued ? '已加入佇列' : result.error || '已重新送出任務')
    } catch (error) {
      setRecoveryActionStatus(error instanceof Error ? error.message : String(error))
    }
  }

  const allFiles = useMemo(() => {
    const map = new Map<string, { path: string; action: string; added?: number; removed?: number }>()
    for (const f of fileChanges) {
      map.set(f.path, {
        path: f.path,
        action: f.action,
        added: f.added,
        removed: f.removed,
      })
    }
    for (const t of agent.toolCalls || []) {
      if (!/write|edit|create|patch/i.test(t.tool)) continue
      const path = String(t.input?.path ?? t.input?.file ?? t.input?.filePath ?? '')
      if (path && !map.has(path)) {
        map.set(path, {
          path,
          action: /create|write/i.test(t.tool) ? 'create' : 'edit',
        })
      }
    }
    for (const e of events) {
      if (e.kind === 'file' && e.path && !map.has(e.path)) {
        map.set(e.path, { path: e.path, action: 'edit', added: e.added, removed: e.removed })
      }
    }
    return [...map.values()]
  }, [fileChanges, agent.toolCalls, events])

  // ALWAYS show while live — even before first event (spinner + objective)
  if (!lifecycle.live) return null

  return (
    <section
      className="agent-process-feed w-full space-y-3 py-2"
      aria-live="polite"
      aria-busy={lifecycle.live && !lifecycle.needsAttention}
      data-run-phase={lifecycle.phase}
    >
      {/* ChatGPT Desktop-style compact run header. The current phase and counts
          stay visible; the noisy execution trace lives behind one disclosure. */}
      <div className={`agent-process-status flex w-full items-center gap-2.5 text-left text-[13px] text-ink-2 ${lifecycle.needsAttention ? 'text-orange' : ''}`}>
        <button
          type="button"
          aria-expanded={processOpen}
          aria-label={processOpen ? '收合執行細節' : '展開執行細節'}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          onClick={() => setProcessOpen((value) => !value)}
        >
          {lifecycle.needsAttention ? (
            <Icon name={lifecycle.icon} size={16} className="shrink-0 text-orange" />
          ) : (
            <AgentThinking variant={thinkingVariantForPhase(lifecycle.phase)} className="shrink-0 text-ink" />
          )}
          <span className="min-w-0 flex-1">
            <ShimmerLabel active={!lifecycle.needsAttention} className="block truncate font-medium">
              {phase ||
                (agent.executionKind === 'external' || agent.loopConfig?.trigger === 'local-cli'
                  ? `${EXTERNAL_CLI_UI_LABEL}${agent.externalRunnerKind || agent.steps[0]?.assignedAgent ? ` · ${agent.externalRunnerKind || agent.steps[0]?.assignedAgent}` : ''}…`
                  : `思考中（${depthLabel}）…`)}
            </ShimmerLabel>
            <span className="mt-0.5 block text-[10px] text-ink-3">
              {toolCount} 個工具 · {messageCount} 則訊息{taskSummary}
            </span>
          </span>
          <Icon name={processOpen ? 'expand_less' : 'expand_more'} size={16} className="shrink-0 text-ink-3" />
        </button>
        <span className="flex shrink-0 items-center gap-1.5 font-[family-name:var(--font-mono)] text-[10px] text-ink-3">
          {startedAt > 0 ? <ElapsedTime startedAt={startedAt} /> : null}
        </span>
        {onOpenPanel ? (
          <button
            type="button"
            className="agent-process-link shrink-0"
            onClick={onOpenPanel}
          >
            開啟執行摘要
          </button>
        ) : null}
      </div>

      <Reveal open={processOpen}>
        <div className="space-y-3">
          {recovery ? (
            <div className="agent-process-recovery space-y-2 text-[12px] text-ink-2" role="status">
              <div>
                <span className="font-medium">這次外部 CLI 在 Host 重啟時中斷。</span>{' '}
                <span className="text-ink-3">目前不會自動重播舊 prompt；請明確選擇下一步。</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {recovery.resumable ? (
                  <button
                    type="button"
                    className="agent-process-link"
                    onClick={() => { void runRecoveryAction('resume') }}
                  >
                    嘗試恢復
                  </button>
                ) : null}
                <button
                  type="button"
                  className="agent-process-link"
                  onClick={() => { void runRecoveryAction('retry') }}
                >
                  手動重新執行
                </button>
              </div>
              {recoveryActionStatus ? <div className="text-[11px] text-ink-3">{recoveryActionStatus}</div> : null}
            </div>
          ) : null}
          {interaction ? (
            <div className="agent-process-interaction space-y-2 text-[12px] text-ink-2" role="group" aria-label={interaction.kind === 'user' ? 'External CLI 回覆' : 'External CLI 核准'}>
              <div className="font-medium">{interaction.kind === 'user' ? 'External CLI 需要你的回覆' : 'External CLI 等待核准'}</div>
              {interaction.detail ? <div className="text-ink-3">{interaction.detail}</div> : null}
              {interaction.kind === 'user' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={interactionInput}
                    onChange={(event) => setInteractionInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && interactionInput.trim()) void submitExternalCliInteraction()
                    }}
                    aria-label="External CLI 回覆內容"
                    className="min-w-48 border-b border-line bg-transparent px-1 py-1 text-[12px] text-ink outline-none"
                    placeholder="輸入回覆"
                  />
                  <button
                    type="button"
                    className="agent-process-link"
                    disabled={!interactionInput.trim()}
                    onClick={() => { void submitExternalCliInteraction() }}
                  >
                    送出回覆
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="agent-process-link" onClick={() => { void submitExternalCliInteraction(true) }}>核准</button>
                  <button type="button" className="agent-process-link" onClick={() => { void submitExternalCliInteraction(false) }}>拒絕</button>
                </div>
              )}
              {interactionStatus ? <div className="text-[11px] text-ink-3">{interactionStatus}</div> : null}
            </div>
          ) : null}
          {/* Task Rows keep a structured plan readable without turning the
              process feed into a second full task-management panel. */}
          {tasks.length > 0 ? (
            <div className="agent-process-trace space-y-1">
              <div className="agent-process-trace-head flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-[0.12em]">
                <span>任務進度</span>
                <span className="normal-case tracking-normal">{completedTasks}/{tasks.length} 完成</span>
              </div>
              {tasks.map((task) => {
                const failed = task.status === 'failed'
                const active = task.status === 'active'
                const done = task.status === 'done'
                return (
                  <div key={task.id} className={`agent-process-row flex max-w-full items-center gap-2 text-left text-[12px] ${failed ? 'text-red' : 'text-ink-2'}`}>
                    <Icon
                      name={done ? 'check_circle' : failed ? 'cancel' : active ? 'progress_activity' : 'radio_button_unchecked'}
                      size={15}
                      className={`shrink-0 ${done ? 'text-green' : failed ? 'text-red' : active ? 'animate-spin text-ink-2' : 'text-ink-3'}`}
                    />
                    <span className={`${done ? 'text-ink-2 opacity-70' : 'text-ink'} min-w-0 flex-1 truncate ${done ? 'line-through' : ''}`}>
                      {task.text}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-ink-3">
                      {done ? '完成' : failed ? '失敗' : active ? '進行中' : '待處理'}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : null}

          {/* Reasoning is an optional detail, not a competing second answer. */}
          {thought.trim() ? (
            <div className="agent-process-disclosure">
              <button
                type="button"
                aria-expanded={thoughtOpen}
                className="agent-process-toggle flex items-center gap-1.5 text-[12.5px] text-ink-2"
                onClick={() => setThoughtOpen((v) => !v)}
              >
                <Icon name="auto_awesome" size={15} className="text-ink-3" />
                <span className="font-medium">推理摘要</span>
                <span className="text-[10px] text-ink-3">
                  {thought.length.toLocaleString()} 字 · {thoughtOpen ? '收合內容' : '檢視內容'}
                </span>
                <Icon name={thoughtOpen ? 'expand_less' : 'expand_more'} size={14} className="ml-0.5 text-ink-3" />
              </button>
              <Reveal open={thoughtOpen}>
                <pre className="agent-process-detail mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2 font-[family-name:var(--font-mono)] custom-scrollbar">
                  {thought}
                </pre>
              </Reveal>
            </div>
          ) : null}

          {/* Consecutive read/search parts become one compact context group. */}
          {groups.length > 0 ? (
            <div className="agent-process-trace space-y-1">
              <div className="agent-process-trace-head flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-[0.12em]">
                <span>執行訊息</span>
                <span className="normal-case tracking-normal">
                  {toolCount} 個工具 · {messageCount} 則訊息{taskSummary}
                </span>
              </div>
              {groups.map((group, index) => {
                const open = expanded === group.id
                const lastOperation = group.type === 'context' ? group.operations[group.operations.length - 1] : group.operation
                const active = index === groups.length - 1 && !draftText.trim() && lastOperation?.ok === undefined
                if (group.type === 'context') {
                  return (
                    <div
                      key={group.id}
                      style={{ animation: 'fade-up 320ms cubic-bezier(0.23,1,0.32,1) both' }}
                    >
                      <button
                        type="button"
                        aria-expanded={open}
                        className="agent-process-row group/context flex max-w-full items-center gap-2 text-left text-[12px] text-ink-2"
                        onClick={() => setExpanded((id) => (id === group.id ? null : group.id))}
                      >
                        <Icon
                          name={active ? 'progress_activity' : 'folder_open'}
                          size={15}
                          className={active ? 'shrink-0 animate-spin text-ink' : 'shrink-0 text-ink-3'}
                        />
                        <span className="shrink-0 font-medium">{active ? '正在蒐集上下文' : '已蒐集上下文'}</span>
                        <span className="agent-process-chip inline-flex min-w-0 flex-1 truncate px-1.5 py-0.5 text-[11.5px]">
                          {contextSummary(group.operations)}
                        </span>
                        <Icon name={open ? 'expand_less' : 'expand_more'} size={14} className="shrink-0 text-ink-3" />
                      </button>
                      <Reveal open={open}>
                        <ContextCards operations={group.operations} />
                      </Reveal>
                    </div>
                  )
                }

                const row = group.operation
                const hasDetail = Boolean((row.detail || row.path) && row.detail !== row.title)
                return (
                  <div
                    key={group.id}
                    style={{ animation: 'fade-up 320ms cubic-bezier(0.23,1,0.32,1) both' }}
                  >
                    <button
                      type="button"
                      aria-expanded={hasDetail ? open : undefined}
                      className={`agent-process-row group/tool flex max-w-full items-center gap-2 text-left text-[12px] ${
                        row.ok === false ? 'text-red' : 'text-ink-2'
                      }`}
                      onClick={() => hasDetail && setExpanded((id) => (id === group.id ? null : group.id))}
                    >
                      <Icon
                        name={active ? 'progress_activity' : kindIcon(row.kind)}
                        size={15}
                        className={active ? 'shrink-0 animate-spin text-ink' : 'shrink-0 text-ink-3'}
                      />
                      <span className="shrink-0 font-medium">{row.title}</span>
                      {hasDetail ? (
                        <span className="agent-process-chip inline-flex min-w-0 flex-1 truncate px-1.5 py-0.5 text-[11.5px] font-[family-name:var(--font-mono)]">
                          {row.path || row.detail}
                        </span>
                      ) : null}
                      {hasDetail ? <Icon name={open ? 'expand_less' : 'expand_more'} size={14} className="shrink-0 text-ink-3" /> : null}
                    </button>
                    <Reveal open={open && hasDetail}>
                      <pre className="agent-process-detail ml-5 mt-0.5 whitespace-pre-wrap break-all text-[11px] text-ink-2 font-[family-name:var(--font-mono)] line-clamp-5">
                        {row.path && row.path !== row.detail ? `${row.path}\n` : ''}
                        {row.detail}
                      </pre>
                    </Reveal>
                  </div>
                )
              })}
            </div>
          ) : null}

          {/* Files touched so far */}
          {allFiles.length > 0 ? (
            <div className="agent-process-files">
              <div className="mb-1.5 text-[11px] text-ink-3">已變更 {allFiles.length} 個檔案</div>
              <div className="flex flex-wrap gap-1.5">
              {allFiles.slice(-8).map((f, i) => (
                <button
                  type="button"
                  key={f.path}
                  className="agent-file-chip"
                  title={`${f.action}: ${f.path.replace(/\\/g, '/')}`}
                  style={{ animation: `pop-in 250ms cubic-bezier(0.23,1,0.32,1) ${i * 60}ms both` }}
                >
                  <Icon name="edit" size={14} className="shrink-0" />
                  <span className="max-w-48 truncate">{basen(f.path)}</span>
                  {f.added !== undefined ? (
                    <span className="shrink-0 text-emerald-400 tabular-nums">+{f.added}</span>
                  ) : null}
                  {f.removed !== undefined && f.removed > 0 ? (
                    <span className="shrink-0 text-rose-300 tabular-nums">−{f.removed}</span>
                  ) : null}
                </button>
              ))}
              </div>
            </div>
          ) : null}
        </div>
      </Reveal>

      {/* Streaming draft (markdown). The answer resolves out of blur once when
          it first appears, and carries the docs/ui caret on its last line so
          "still writing" is visible without a second status row. */}
      {draftText ? (
        <div className="agent-streaming-answer pt-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            assistant · 回覆中
          </div>
          <div
            className="agent-streaming-body"
            style={{ animation: 'stream-in 420ms cubic-bezier(0.22,0.61,0.25,1) both' }}
          >
            <MarkdownBody content={draftText} />
          </div>
        </div>
      ) : null}
    </section>
  )
}
