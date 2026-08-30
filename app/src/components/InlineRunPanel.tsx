import { memo, useEffect, useState, type ReactNode } from 'react'
import { ContextUsageChip } from './ContextUsageChip'
import { Icon } from './Icon'
import { LogViewer } from './LogViewer'
import { emptyAgentLike } from '../agent/localCliRun'
import { deriveRunLifecycle, lifecycleToneClass, orchestrationFromAgent } from '../agent/runLifecycle'
import {
  formatRunnerCapabilitiesSummary,
  projectRunnerCapabilitySnapshot,
} from '../agent/runners'
import { recordRunnerDeclaration, TURN_RECORD_FORMAT_VERSION } from '../agent/turnRecord'
import { useAgentStore } from '../store/agentStore'
import { usePermissionAskStore } from '../store/permissionAskStore'
import { useRunActivityStore } from '../store/runActivityStore'
import { ReasoningFocusPanel } from './ReasoningFocusPanel'
import { ContextUsagePanel } from './ContextUsagePanel'
import { TrajectoryPanel } from './TrajectoryPanel'
import { pickThreadPiSession } from '../agent/piHostRun'
import { formatTokensCompact } from '../agent/contextUsageView'
import { useRunContextUsage } from '../hooks/useRunContextUsage'
import { useRunUsageRefresher } from '../hooks/useRunUsageRefresher'
import type { TurnRecordEntry } from '../agent/turnRecord'
import { useThreadStore } from '../store/threadStore'
import { useWorkingStateProjectionStore } from '../store/workingStateProjectionStore'
import type { AgentState } from '../agent/types'
import type { ReviewTarget } from '../agent/reviewContract.ts'
import { WorkingStateDiagnostics } from './WorkingStateView'
import { projectRunStatusSurface } from '../agent/runStatusSurface.ts'
import { RunStatusSurface } from './RunStatusSurface.tsx'

/**
 * CloudCLI-style embedded run progress — no page navigation.
 *
 * The panel deliberately uses one continuous surface. The chat already owns
 * the live trace, so this rail is the compact control surface: current state,
 * progress, and optional diagnostics when someone needs to inspect them.
 */
const EMPTY_AGENT = emptyAgentLike({ objective: '', status: 'idle', progress: 0 })
// Stable references — a fresh object/array literal returned from a zustand
// selector fallback breaks Object.is identity every render and triggers
// "Maximum update depth exceeded" (React getSnapshot-must-be-cached loop).
const EMPTY_RECORD_ENTRIES: TurnRecordEntry[] = []
const EMPTY_ACTIVITY = { active: false, tasks: [], events: [], fileChanges: [], statusLine: '', thought: '', startedAt: 0, updatedAt: 0, phase: 'starting' as const, terminal: null, interaction: null, stopping: false, recordEntries: EMPTY_RECORD_ENTRIES, recordTotal: 0 } as const

// The trajectory section remembers being opened across remounts — repeated
// walks through a long run should not re-collapse it every time.
const TRAJECTORY_OPEN_KEY = 'subagents.runPanel.trajectoryOpen.v1'
const RUNNER_GUARANTEE_LABEL = {
  'host-verified': 'Host verified',
  'run-snapshot': 'Run snapshot',
  reduced: 'Reduced guarantee',
  unavailable: 'Unavailable / degraded',
  'legacy-unrecorded': 'Legacy record · guarantee not recorded',
} as const

function inlineRunnerPresentation(agent: AgentState, recordEntries: TurnRecordEntry[]) {
  const liveRecord = recordEntries.length
    ? { version: TURN_RECORD_FORMAT_VERSION, entries: recordEntries }
    : agent.turnRecord
  const declaration = recordRunnerDeclaration(liveRecord)
  const isExternal = agent.executionKind === 'external'
    || agent.loopConfig.trigger === 'local-cli'
    || Boolean(declaration?.runner && declaration.runner !== 'builtin')
  const snapshot = projectRunnerCapabilitySnapshot(declaration, agent.runnerCapabilities)
  return {
    declaration,
    isExternal,
    capabilities: snapshot.capabilities,
    guarantee: RUNNER_GUARANTEE_LABEL[snapshot.guarantee],
  }
}

function readStoredTrajectoryOpen(): boolean {
  try {
    return localStorage.getItem(TRAJECTORY_OPEN_KEY) === 'true'
  } catch {
    return false
  }
}

function useTrajectoryBinding(threadId: string, recordEntryCount: number) {
  const [open, setOpen] = useState(readStoredTrajectoryOpen)
  const [sessionId, setSessionId] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!open || sessionId !== undefined) return
    const bridge = window.subagents?.piHost?.sessions
    if (typeof bridge?.record !== 'function' || typeof bridge.list !== 'function') {
      setSessionId(null)
      return
    }
    let cancelled = false
    void bridge.list().then(({ sessions }) => {
      if (cancelled) return
      const match = pickThreadPiSession(sessions || [], threadId)
      setSessionId(match ? match.id : recordEntryCount > 0 ? undefined : null)
    }).catch(() => {
      if (!cancelled) setSessionId(undefined)
    })
    return () => { cancelled = true }
  }, [open, sessionId, threadId, recordEntryCount])
  useEffect(() => setSessionId(undefined), [threadId])
  const toggle = () => setOpen((value) => {
    try { localStorage.setItem(TRAJECTORY_OPEN_KEY, String(!value)) } catch { /* blocked storage */ }
    return !value
  })
  return { open, sessionId, toggle }
}

/**
 * The 上下文 section body as a self-subscribing leaf: the projection is
 * computed here and only while the section is open, so a usage-only update
 * never re-renders the rail's other sections.
 */
const RunContextBody = memo(function RunContextBody({
  runId,
  fallbackTokens,
  degraded,
}: {
  runId: string
  fallbackTokens?: number
  degraded?: boolean
}) {
  const contextUsage = useRunContextUsage(runId)
  return <ContextUsagePanel usage={contextUsage} fallbackTokens={fallbackTokens} degraded={degraded} />
})

function TrajectorySection({ binding }: { binding: ReturnType<typeof useTrajectoryBinding> }) {
  if (!binding.sessionId) return null
  return (
    <PanelSection
      id="run-trajectory"
      title="執行軌跡"
      summary="回看 Turn Record"
      open={binding.open}
      onToggle={binding.toggle}
    >
      <div className="h-72">
        <TrajectoryPanel sessionId={binding.sessionId} />
      </div>
    </PanelSection>
  )
}

function PanelSection({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  id: string
  title: string
  /** ReactNode so a section head can host a self-subscribing leaf (usage chip). */
  summary?: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const contentId = `${id}-content`

  return (
    <section className="border-b border-line last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-hover-2"
      >
        <span className="min-w-0 flex-1 text-[12px] font-semibold text-ink">{title}</span>
        {summary ? (
          <span className="shrink-0 text-[10px] font-[family-name:var(--font-mono)] text-ink-3">
            {summary}
          </span>
        ) : null}
        <Icon name={open ? 'expand_less' : 'expand_more'} size={16} className="shrink-0 text-ink-3" />
      </button>
      {open ? (
        <div id={contentId} className="px-4 pb-4">
          {children}
        </div>
      ) : null}
    </section>
  )
}

function RunPanelHeaderActions({
  reviewSnapshotRef,
  onOpenReview,
  onOpenVerification,
  onClose,
}: {
  reviewSnapshotRef?: { snapshotId: string }
  onOpenReview?: (target: ReviewTarget) => void
  onOpenVerification?: (snapshotId: string) => void
  onClose?: () => void
}) {
  const [verificationStatus, setVerificationStatus] = useState<string>()
  useEffect(() => {
    const snapshotId = reviewSnapshotRef?.snapshotId
    const list = window.subagents?.piHost?.review?.listVerifications
    if (!snapshotId || !list) { setVerificationStatus(undefined); return }
    let cancelled = false
    void list(snapshotId).then(({ reviewVerifications }) => {
      if (!cancelled) setVerificationStatus(reviewVerifications[0]?.status)
    }).catch(() => { if (!cancelled) setVerificationStatus(undefined) })
    return () => { cancelled = true }
  }, [reviewSnapshotRef?.snapshotId])
  return (
    <div className="flex shrink-0 items-center gap-1">
      {reviewSnapshotRef && onOpenReview ? (
        <button
          type="button"
          onClick={() => onOpenReview({ kind: 'run-snapshot', snapshotId: reviewSnapshotRef.snapshotId })}
          className="flex items-center gap-1 rounded-control px-2 py-1.5 text-[11px] text-ink-2 transition-colors hover:bg-hover-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          aria-label="開啟本次執行的審查快照"
        >
          <Icon name="difference" size={15} />審查
        </button>
      ) : null}
      {reviewSnapshotRef && onOpenVerification ? (
        <button
          type="button"
          onClick={() => onOpenVerification(reviewSnapshotRef.snapshotId)}
          className="flex items-center gap-1 rounded-control px-2 py-1.5 text-[11px] text-ink-2 transition-colors hover:bg-hover-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          aria-label="開啟本次執行的驗證記錄"
        >
          <Icon name="fact_check" size={15} />驗證{verificationStatus ? ` · ${verificationStatus}` : ''}
        </button>
      ) : null}
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="rounded-control p-1.5 text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
          title="收合面板"
          aria-label="收合執行面板"
        >
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  )
}

export function InlineRunPanel({
  runId,
  threadId,
  onClose,
  onOpenReview,
  onOpenVerification,
}: {
  runId: string
  threadId: string
  onClose?: () => void
  onOpenReview?: (target: ReviewTarget) => void
  onOpenVerification?: (snapshotId: string) => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [thoughtOpen, setThoughtOpen] = useState(false)
  // Context remains available, but the default rail is status + one adaptive
  // secondary surface. Opening diagnostics is an explicit user choice.
  const [contextOpen, setContextOpen] = useState(false)
  // 執行軌跡 — collapsed until asked; the choice persists across remounts.

  const agent = useAgentStore((s) => s.runStates[runId]) || EMPTY_AGENT
  const isRunning = useAgentStore((s) => s.activeRunIds.includes(runId))
  const activity = useRunActivityStore((s) => s.presentations[runId]) || EMPTY_ACTIVITY
  const workingStateProjection = useWorkingStateProjectionStore((state) => state.byRunId[runId])
  const approvalPending = usePermissionAskStore((s) =>
    Boolean(
      (s.current?.runId && s.current.runId === runId) ||
        s.queue.some((item) => item.runId === runId),
    ),
  )
  const reviewSnapshotRef = useThreadStore((state) => state.threads
    .find((thread) => thread.id === threadId)?.bubbles
    .find((bubble) => bubble.role === 'run' && bubble.runSummary?.runId === runId)?.runSummary?.reviewSnapshotRef)
  const runActive = isRunning || activity.active

  // 與 feed 共用同一道用量對時輪詢；in-flight 去重，兩個掛載面不會疊加 IPC。
  useRunUsageRefresher(runId, runActive)
  const lifecycle = deriveRunLifecycle({
    phase: activity.phase,
    status: agent.status,
    statusLine: activity.statusLine,
    active: runActive,
    approvalPending,
    terminal: Boolean(activity.terminal),
    objective: agent.objective,
    orchestration: orchestrationFromAgent(agent),
    interruptReason: agent.interruptReason,
    stopping: activity.stopping,
  })
  const live = lifecycle.live

  const runnerPresentation = inlineRunnerPresentation(agent, activity.recordEntries)
  const { declaration: runnerDeclaration, isExternal } = runnerPresentation
  const runnerCaps = runnerPresentation.capabilities
  const runnerGuarantee = runnerPresentation.guarantee
  const reasoningCount = activity.recordEntries.filter((entry) => entry.kind === 'reasoning').length
  const detailSummary = [
    reasoningCount ? `${reasoningCount} 段推理` : activity.thought ? '推理' : '',
    agent.toolCalls.length ? `${agent.toolCalls.length} 工具` : '',
    agent.logs.length ? `${agent.logs.length} 日誌` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const statusSurface = projectRunStatusSurface({
    lifecycle,
    capabilities: runnerCaps,
    isExternal,
    activity,
    workingState: workingStateProjection,
    approvalPending,
  })

  // 上下文 — the section head hosts a self-subscribing chip and the body is a
  // memo leaf with its own projection, so usage changes re-render neither the
  // rail nor its sibling sections.
  const contextSummary = !isExternal
    ? <ContextUsageChip runId={runId} variant="inline" />
    : agent.tokensUsed > 0
      ? `${formatTokensCompact(agent.tokensUsed)} tok`
      : undefined

  // Resolve this thread's Host session lazily — only once the reader opens
  // the trajectory section. The binding choice is pickThreadPiSession, the
  // same owner submitPiHostRun uses, so this panel shows the record runs
  // actually write to. Absence semantics: no bridge functions at all is a
  // permanent null (the section stays hidden); an absent match or failed
  // list() while the run is producing record events stays undefined and
  // retries as events arrive — a binding created moments later is found,
  // instead of one unlucky race hiding the entry for the mount's lifetime.
  const trajectory = useTrajectoryBinding(threadId, activity.recordEntries.length)
  return (
    <div className="flex h-full min-h-0 flex-col border-l border-line bg-surface text-ink">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            name={lifecycle.icon}
            size={17}
            className={`${lifecycleToneClass(lifecycle.tone)} shrink-0 ${live && !lifecycle.needsAttention && !lifecycle.stopping ? 'animate-spin' : ''}`}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-ink">{live ? '任務狀態' : '結果摘要'}</span>
              <span className={`text-[11px] font-medium ${lifecycleToneClass(lifecycle.tone)}`}>
                {statusSurface.label}
              </span>
            </div>
          </div>
        </div>
        <RunPanelHeaderActions
          reviewSnapshotRef={reviewSnapshotRef}
          onOpenReview={onOpenReview}
          onOpenVerification={onOpenVerification}
          onClose={onClose}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        <RunStatusSurface projection={statusSurface} startedAt={activity.startedAt} />

        <PanelSection
          id="run-context"
          title="上下文"
          summary={contextSummary}
          open={contextOpen}
          onToggle={() => setContextOpen((value) => !value)}
        >
          <RunContextBody runId={runId} fallbackTokens={agent.tokensUsed} degraded={isExternal} />
        </PanelSection>

        <TrajectorySection binding={trajectory} />

        {detailSummary || isExternal || agent.loadedCapabilityIds.length > 0 || workingStateProjection ? (
          <PanelSection
            id="run-details"
            title="執行資訊"
            summary={detailSummary || '執行資訊'}
            open={detailsOpen}
            onToggle={() => setDetailsOpen((value) => !value)}
          >
            <div className="space-y-4">
              {workingStateProjection ? <WorkingStateDiagnostics projection={workingStateProjection} /> : null}
              {reasoningCount || activity.thought ? (
                <div>
                  <button
                    type="button"
                    aria-expanded={thoughtOpen}
                    onClick={() => setThoughtOpen((value) => !value)}
                    className="flex w-full items-center gap-2 text-left text-[11px] text-ink-2 transition-colors hover:text-ink"
                  >
                    <span className="flex-1 font-medium">推理摘要</span>
                    <span className="font-[family-name:var(--font-mono)] text-[10px] text-ink-3">
                      {reasoningCount ? `${reasoningCount} 段` : `${activity.thought.length.toLocaleString()} 字`}
                    </span>
                    <Icon name={thoughtOpen ? 'expand_less' : 'expand_more'} size={15} className="text-ink-3" />
                  </button>
                  {thoughtOpen ? (
                    <ReasoningFocusPanel
                      entries={activity.recordEntries}
                      total={activity.recordTotal}
                      fallbackThought={activity.thought}
                    />
                  ) : null}
                </div>
              ) : null}

              {agent.executionKind || runnerDeclaration || agent.loadedCapabilityIds.length > 0 ? (
                <div>
                  <p className="text-[11px] font-medium text-ink-2">執行資訊</p>
                  <p className="mt-1 text-[10px] leading-snug text-ink-3">
                    {runnerGuarantee}：{formatRunnerCapabilitiesSummary(runnerCaps)}
                  </p>
                  {isExternal ? (
                    <p className="mt-1 text-[10px] leading-snug text-orange">
                      外部執行不代表內建 DoD、Verified Working State、Skill preflight 或 Checker 已執行。
                    </p>
                  ) : runnerGuarantee === 'Unavailable / degraded' ? (
                      <p className="mt-1 text-[10px] leading-snug text-orange">
                        Pi Host capability snapshot 不可用；plain-browser 僅呈現降級狀態，不建立替代執行器。
                      </p>
                  ) : null}
                  {agent.loadedCapabilityIds.length > 0 ? (
                    <p className="mt-1 break-words text-[10px] leading-relaxed text-ink-3 font-[family-name:var(--font-mono)]">
                      能力包：{agent.loadedCapabilityIds.join(' · ')}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {agent.toolCalls.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium text-ink-2">工具呼叫</p>
                    <span className="font-[family-name:var(--font-mono)] text-[10px] text-ink-3">{agent.toolCalls.length}</span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {agent.toolCalls.slice(-6).map((tool) => (
                      <div key={tool.id} className="flex min-w-0 gap-1.5 text-[10px] font-[family-name:var(--font-mono)]">
                        <span className={tool.ok ? 'text-green' : 'text-red'}>{tool.ok ? '✓' : '✗'}</span>
                        <span className="shrink-0 text-ink-2">{tool.tool}</span>
                        <span className="truncate text-ink-3">{tool.output.slice(0, 90)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {agent.logs.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium text-ink-2">日誌</p>
                    <span className="font-[family-name:var(--font-mono)] text-[10px] text-ink-3">{agent.logs.length}</span>
                  </div>
                  <div className="mt-2 h-44 overflow-hidden rounded-control bg-inset">
                    <LogViewer logs={agent.logs.slice(-80)} live={live} />
                  </div>
                </div>
              ) : null}

              {/* Tokens moved to 上下文, which derives them from the record.
                  Repeating the scalar here would be a second source able to
                  disagree with it, so only the duration stays. */}
              {agent.metrics.executionMs > 0 ? (
                <p className="text-[10px] text-ink-3 font-[family-name:var(--font-mono)] tabular-nums">
                  {agent.metrics.executionMs}ms
                </p>
              ) : null}
            </div>
          </PanelSection>
        ) : null}
      </div>

    </div>
  )
}
