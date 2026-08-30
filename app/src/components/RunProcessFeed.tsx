/**
 * Live in-chat process feed.
 * Always visible while a run is active; completed work is also written into
 * ThreadRunSummary bubbles via runExternal (RunSummaryCard).
 */

import { useEffect, useMemo, useState } from 'react'
import { emptyAgentLike } from '../agent/localCliRun'
import { EXTERNAL_CLI_UI_LABEL } from '../agent/runners'
import { deriveRunLifecycle, orchestrationFromAgent } from '../agent/runLifecycle'
import { projectLiveTimeline, runTimelineRows } from '../agent/liveTimeline'
import { latestConversationTurn } from '../agent/agentWorkTreeProjection.ts'
import type { TurnRecordEntry } from '../agent/turnRecord'
import { ContextUsageChip } from './ContextUsageChip'
import { useRunUsageRefresher } from '../hooks/useRunUsageRefresher'
import { useAgentStore } from '../store/agentStore'
import { useThreadStore, type ThreadRunner } from '../store/threadStore'
import { usePermissionAskStore } from '../store/permissionAskStore'
import {
  useRunActivityStore,
  type FileChangeRecord,
  type RunActivityEvent,
  type RunTaskItem,
} from '../store/runActivityStore'
import { ExecutionStepsProgress } from './ExecutionStepsProgress'
import { Icon } from './Icon'
import { MarkdownBody } from './MarkdownBody'
import { RunTimelineList } from './RunTimelineList'
import { AgentWorkTree } from './AgentWorkTree.tsx'
import { ContextCards } from './ContextCards'
import { ElapsedTime } from './primitives/ElapsedTime'
import { useStallNotice } from '../hooks/useStallNotice'
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

type DisplayFileChange = { path: string; action: string; added?: number; removed?: number }

function FileDiffChips({ files }: { files: readonly DisplayFileChange[] }) {
  if (files.length === 0) return null
  const visible = files.slice(-8)
  const hidden = files.length - visible.length
  return (
    <div className="agent-process-files">
      <div className="mb-1.5 text-[11px] text-ink-3">已變更 {files.length} 個檔案</div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((file, index) => (
          <span
            key={file.path}
            className="agent-file-chip rounded-chip font-[family-name:var(--font-mono)]"
            title={`${file.action}: ${file.path.replace(/\\/g, '/')}`}
            style={{ animation: `pop-in 250ms cubic-bezier(0.23,1,0.32,1) ${index * 60}ms both` }}
          >
            <span className="max-w-48 min-w-0 truncate">{basen(file.path)}</span>
            {file.added !== undefined ? <span className="shrink-0 text-green tabular-nums">+{file.added}</span> : null}
            {file.removed !== undefined && file.removed > 0 ? <span className="shrink-0 text-red tabular-nums">−{file.removed}</span> : null}
          </span>
        ))}
        {hidden > 0 ? (
          <span className="inline-flex h-7 items-center px-1.5 font-[family-name:var(--font-mono)] text-[11px] text-ink-3">+{hidden} 個</span>
        ) : null}
      </div>
    </div>
  )
}

function kindIcon(kind: string): string {
  switch (kind) {
    case 'tool':
      return 'terminal'
    case 'file':
      return 'edit'
    case 'thought':
      return 'psychology'
    case 'compaction':
      return 'unfold_less'
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
const EMPTY_RECORD_ENTRIES: TurnRecordEntry[] = []

function runPhaseLabel(reattaching: boolean, fallback: string): string {
  return reattaching ? '正在重新附著…' : fallback
}

function ReattachmentNotices({
  reattaching,
  gap,
}: {
  reattaching: boolean
  gap: { missingBefore: number; earliestSeq: number } | null
}) {
  return (
    <>
      {reattaching ? (
        <div className="agent-process-recovery flex items-center gap-2 rounded-md border border-line-strong/60 bg-surface-2 px-3 py-2 text-[11px] text-ink-3" role="status" aria-label="Pi Core Host 重新附著中">
          <Icon name="sync" size={14} className="shrink-0" />
          <span>正在重新附著到 Pi Core Host；這不是執行失敗。</span>
        </div>
      ) : null}
      {gap ? (
        <div className="agent-process-recovery flex items-center gap-2 rounded-md border border-line-strong/60 bg-surface-2 px-3 py-2 text-[11px] text-ink-3" role="status">
          <Icon name="history" size={14} className="shrink-0" />
          <span>較早的 {gap.missingBefore} 筆紀錄不在目前保留範圍；時間軸從 seq {gap.earliestSeq} 開始。</span>
        </div>
      ) : null}
    </>
  )
}
const EMPTY_FILES: FileChangeRecord[] = []
const EMPTY_TASKS: RunTaskItem[] = []

function LiveAgentWork({ entries, sessionId }: { entries: readonly TurnRecordEntry[]; sessionId?: string }) {
  const originTurn = useMemo(() => latestConversationTurn(entries), [entries])
  if (originTurn <= 0) return null
  return <AgentWorkTree entries={entries} originTurn={originTurn} sessionId={sessionId} live />
}

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
  const draftText = activity?.draftText || ''
  const statusLine = activity?.statusLine || ''
  const activityPhase = activity?.phase || 'starting'
  const fileChanges = activity?.fileChanges ?? EMPTY_FILES
  const tasks = activity?.tasks ?? EMPTY_TASKS
  const recordEntries = activity?.recordEntries ?? EMPTY_RECORD_ENTRIES
  const reattaching = activity?.reattaching ?? false
  const reattachGap = activity?.reattachGap ?? null
  const [expanded, setExpanded] = useState<string | null>(null)
  const [processOpen, setProcessOpen] = useState(true)

  useEffect(() => {
    // Each submitted prompt starts with the compact run trace available. The
    // user's previous disclosure choice must not hide the next run's status.
    setExpanded(null)
    setProcessOpen(true)
  }, [runId])

  const runActive = isRunning || activityActive

  // 用量自癒輪詢：只在 run 活著期間向 Host 對時，補回推送漏掉的記錄項。
  useRunUsageRefresher(runId, runActive)

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

  /**
   * The unified timeline: 思考 → 工具 → 結果 → 回應, in recorded order.
   *
   * It comes out of the SAME projection the finished trajectory uses, over the
   * Turn Record entries this run has published. The activity-event trace below
   * is not a second way to build it — it is the fallback for a runner that
   * keeps no record at all (external CLI), and it renders only when this is
   * empty.
   */
  const currentRecordTurn = useMemo(() => latestConversationTurn(recordEntries), [recordEntries])
  const currentTurnEntries = useMemo(
    () => recordEntries.filter((entry) => entry.turn === currentRecordTurn),
    [recordEntries, currentRecordTurn],
  )
  const recordView = useMemo(
    () => projectLiveTimeline(currentTurnEntries, currentTurnEntries.length, Math.max(currentTurnEntries.length, 1)),
    [currentTurnEntries],
  )
  const recordTimeline = useMemo(
    () => runTimelineRows(recordView, draftText),
    [recordView, draftText],
  )
  const hasRecordTimeline = recordTimeline.length > 0
  const lifecycle = deriveRunLifecycle({
    phase: activityPhase,
    status: agent.status,
    statusLine,
    active: runActive,
    approvalPending,
    terminal: Boolean(activity?.terminal),
    objective: agent.objective,
    orchestration: orchestrationFromAgent(agent),
    interruptReason: agent.interruptReason,
    stopping: activity?.stopping,
  })
  const phase = runPhaseLabel(reattaching, lifecycle.label)
  // One honest notice when a live run goes quiet — never a repeated alarm.
  const stall = useStallNotice(runId)
  // Counted from whichever source is actually on screen, so the header never
  // describes a trace the reader is not looking at.
  const toolCount = hasRecordTimeline
    ? new Set(recordTimeline.filter((row) => row.kind === 'tool').map((row) => (row.kind === 'tool' ? row.callId : ''))).size
    : new Set(
        [
          // Guarded like every other access in this file: a run snapshot without a
          // tool list must degrade to an empty trace, never blank the whole app.
          ...(agent.toolCalls || []).map((tool) => tool.id),
          ...events
            .filter((event) => event.kind === 'tool')
            .map((event) => event.callId || event.id),
        ],
      ).size
  const messageCount = hasRecordTimeline
    ? recordTimeline.filter((row) => row.kind === 'assistant').length
    : draftText.trim() ? 1 : events.some((event) => event.kind === 'text') ? 1 : 0
  const completedTasks = tasks.filter((task) => task.status === 'done').length
  const taskSummary = tasks.length ? ` · ${completedTasks}/${tasks.length} 任務` : ''

  // 用量微縮文字改由 <ContextUsageChip> 自行訂閱投影——父層不再每次渲染都重算，
  // 用量變動也不會牽動 feed 兄弟區塊。
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
      const supportedRunner = new Set<ThreadRunner>(['codex', 'claude', 'grok', 'gemini', 'cursor'])
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
      data-run-id={runId}
      data-run-phase={lifecycle.phase}
      data-record-count={recordEntries.length}
    >
      {/* Compact run status remains independently collapsible; the canonical
          Turn Record stays in the conversation itself, in recorded order. */}
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
          ) : lifecycle.stopping ? (
            // A stop already registered must not keep spinning as if nothing
            // happened; the pause mark is the immediate answer to the press.
            <Icon name={lifecycle.icon} size={16} className="shrink-0 text-ink" />
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
        <ContextUsageChip runId={runId} onClick={onOpenPanel} />
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

      <ReattachmentNotices reattaching={reattaching} gap={reattachGap} />

      {stall.stalled && !lifecycle.needsAttention ? (
        <div
          className="agent-process-stall flex items-center gap-2 rounded-md border border-line-strong/60 bg-surface-2 px-3 py-2 text-[11px] text-ink-3"
          role="status"
          data-stall-idle-ms={stall.idleMs}
        >
          <Icon name="hourglass_top" size={14} className="shrink-0 text-orange" />
          <span>{stall.label}</span>
        </div>
      ) : null}

      <ExecutionStepsProgress tasks={tasks} />

      <LiveAgentWork entries={recordEntries} sessionId={agent.hostSessionId} />

      {/* The task conversation shows narration and actions. Reasoning remains
          in the Host Turn Record for Trajectory/audit views, but is not exposed
          as conversational content. */}
      {hasRecordTimeline ? (
        <section
          aria-label="執行時間軸"
          className="agent-conversation-timeline space-y-1"
          data-run-timeline="record"
        >
          <RunTimelineList rows={recordTimeline} hideReasoning />
        </section>
      ) : null}

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
          {/* Consecutive read/search parts become one compact context group.
              This is the fallback trace, for a runner that publishes no Turn
              Record; the timeline above owns the Pi path and this must never
              render beside it. */}
          {!hasRecordTimeline && groups.length > 0 ? (
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
                        name={active && row.kind !== 'compaction' ? 'progress_activity' : kindIcon(row.kind)}
                        size={15}
                        className={
                          active && row.kind !== 'compaction'
                            ? 'shrink-0 animate-spin text-ink'
                            : 'shrink-0 text-ink-3'
                        }
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

          <FileDiffChips files={allFiles} />
        </div>
      </Reveal>

      {/* Streaming draft (markdown), fallback path only. On the record path the
          draft is the timeline's current assistant line — showing it here too
          would be the same text in two places. The answer resolves out of blur
          once when it first appears, and carries the docs/ui caret on its last
          line so "still writing" is visible without a second status row. */}
      {draftText && !hasRecordTimeline ? (
        <div className="agent-streaming-answer pt-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            assistant · 回覆中
          </div>
          <div
            className="agent-streaming-body"
            style={{ animation: 'stream-in 420ms cubic-bezier(0.22,0.61,0.25,1) both' }}
          >
            <MarkdownBody content={draftText} streaming />
          </div>
        </div>
      ) : null}
    </section>
  )
}
