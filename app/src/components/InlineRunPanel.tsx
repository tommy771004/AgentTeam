import { useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { LogViewer } from './LogViewer'
import { ElapsedTime } from './primitives/ElapsedTime'
import { PixelLoader } from './primitives/PixelLoader'
import { ShimmerLabel } from './primitives/ShimmerLabel'
import { SpinnerRing } from './primitives/SpinnerRing'
import { emptyAgentLike } from '../agent/localCliRun'
import {
  EXTERNAL_CLI_UI_LABEL,
  capabilitiesForRunner,
  formatRunnerCapabilitiesSummary,
} from '../agent/runners'
import { useAgentStore } from '../store/agentStore'
import { useRunActivityStore } from '../store/runActivityStore'
import { useThreadStore, type ThreadPlanItem } from '../store/threadStore'
import { loopTypeZh } from '../i18n/zh'
import type { ExecutionStep } from '../agent/types'

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
const EMPTY_ACTIVITY = { active: false, tasks: [], statusLine: '', thought: '', startedAt: 0 } as const
const EMPTY_RUN_PLAN: ThreadPlanItem[] = []

function statusLabel(status: string, live: boolean) {
  if (status === 'manual_intervention') return '等待核准'
  if (status === 'awaiting_user') return '等待回覆'
  if (live) return '執行中'
  if (status === 'success') return '已完成'
  if (status === 'failed') return '執行失敗'
  if (status === 'halted') return '已停止'
  if (status === 'parsing') return '準備中'
  return '已待命'
}

function statusIcon(status: string, live: boolean) {
  if (live) return 'progress_activity'
  if (status === 'success') return 'check_circle'
  if (status === 'failed' || status === 'halted') return 'error'
  return 'play_circle'
}

function statusTone(status: string, live: boolean) {
  if (live) return 'text-accent-ink'
  if (status === 'success') return 'text-green'
  if (status === 'failed' || status === 'halted') return 'text-red'
  if (status === 'awaiting_user' || status === 'manual_intervention') return 'text-orange'
  return 'text-ink-2'
}

function CompactStepList({ steps }: { steps: ExecutionStep[] }) {
  return (
    <ol className="space-y-2" aria-label="執行步驟">
      {steps.map((step, index) => {
        const isDone = step.status === 'COMPLETED'
        const isActive = step.status === 'IN_PROGRESS'
        const isFailed = step.status === 'FAILED'
        const tone = isFailed ? 'text-red' : isActive ? 'text-accent-ink' : isDone ? 'text-green' : 'text-ink-3'

        return (
          <li key={step.step} className="flex min-w-0 items-center gap-2 text-[12px]">
            <span
              className={`flex size-[18px] shrink-0 items-center justify-center rounded-full border text-[10px] font-[family-name:var(--font-mono)] ${
                isDone ? 'border-green bg-green text-white' : isFailed ? 'border-red bg-red text-white' : isActive ? 'border-accent text-accent-ink' : 'border-line-strong text-ink-3'
              }`}
            >
              {isDone ? <Icon name="check" size={11} filled /> : isFailed ? <Icon name="close" size={11} /> : index + 1}
            </span>
            <span className={`min-w-0 flex-1 truncate ${isActive ? 'font-medium text-ink' : 'text-ink-2'}`}>
              {step.description}
            </span>
            <span className={`shrink-0 text-[10px] ${tone}`}>
              {isFailed ? '失敗' : isActive ? '進行中' : isDone ? (step.durationMs != null ? `${(step.durationMs / 1000).toFixed(1)}s` : '完成') : '待處理'}
            </span>
          </li>
        )
      })}
    </ol>
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
  summary?: string
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

export function InlineRunPanel({
  runId,
  threadId,
  onClose,
}: {
  runId: string
  threadId: string
  onClose?: () => void
}) {
  const [progressOpen, setProgressOpen] = useState(true)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [stepsOpen, setStepsOpen] = useState(false)
  const [subAgentsOpen, setSubAgentsOpen] = useState(false)
  const [thoughtOpen, setThoughtOpen] = useState(false)

  const agent = useAgentStore((s) => s.runStates[runId]) || EMPTY_AGENT
  const isRunning = useAgentStore((s) => s.activeRunIds.includes(runId))
  const activity = useRunActivityStore((s) => s.presentations[runId]) || EMPTY_ACTIVITY
  const threadRunner = useThreadStore(
    (s) => s.threads.find((t) => t.id === threadId)?.runner || 'builtin',
  )
  const persistedPlan = useThreadStore(
    (s) => s.threads.find((t) => t.id === threadId)?.runPlan || EMPTY_RUN_PLAN,
  )
  const tasks = activity.tasks.length
    ? activity.tasks
    : persistedPlan.map((item) => ({
        id: item.id,
        text: item.text,
        status: item.status,
        at: Date.parse(item.at) || Date.now(),
      }))

  const live =
    isRunning ||
    activity.active ||
    agent.status === 'running' ||
    agent.status === 'parsing' ||
    agent.status === 'manual_intervention' ||
    agent.status === 'awaiting_user'

  const isExternal =
    agent.executionKind === 'external' ||
    agent.loopConfig.trigger === 'local-cli' ||
    threadRunner !== 'builtin'
  const runnerCaps =
    agent.runnerCapabilities || capabilitiesForRunner(isExternal ? threadRunner : 'builtin')
  const completedTasks = tasks.filter((task) => task.status === 'done').length
  const completedSteps = agent.steps.filter((step) => step.status === 'COMPLETED').length
  const progressSummary = tasks.length
    ? `${completedTasks}/${tasks.length}`
    : agent.steps.length
      ? `${completedSteps}/${agent.steps.length}`
      : undefined
  const detailSummary = [
    activity.thought ? '推理' : '',
    agent.toolCalls.length ? `${agent.toolCalls.length} 工具` : '',
    agent.logs.length ? `${agent.logs.length} 日誌` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const currentStatus = activity.statusLine || statusLabel(agent.status, live)

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-line bg-surface text-ink">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            name={statusIcon(agent.status, live)}
            size={17}
            className={`${statusTone(agent.status, live)} shrink-0 ${live ? 'animate-spin' : ''}`}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-ink">執行摘要</span>
              <span className={`text-[11px] font-medium ${statusTone(agent.status, live)}`}>
                {statusLabel(agent.status, live)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
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
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        <section className="border-b border-line px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-ink-3">目前狀態</p>
              <p className={`mt-1 truncate text-[13px] font-medium ${live ? 'text-accent-ink' : 'text-ink'}`}>
                {currentStatus}
              </p>
            </div>
            <span className="shrink-0 font-[family-name:var(--font-mono)] text-[18px] font-semibold tabular-nums text-accent-ink">
              {agent.progress}%
            </span>
          </div>

          <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-ink-2">
            {agent.objective || '等待任務內容…'}
          </p>

          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-inset">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${Math.min(100, Math.max(0, agent.progress))}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-ink-3">
              <span className="truncate">
                {isExternal
                  ? `${EXTERNAL_CLI_UI_LABEL}${agent.externalRunnerKind ? ` · ${agent.externalRunnerKind}` : ''}`
                  : `${loopTypeZh(agent.loopConfig.loopType)} · 第 ${agent.currentIteration}/${agent.loopConfig.maxIterations} 回合`}
              </span>
              <span className="shrink-0 font-[family-name:var(--font-mono)] tabular-nums">
                {live && activity.startedAt > 0 ? <ElapsedTime startedAt={activity.startedAt} /> : null}
                {live && activity.startedAt > 0 ? ' · ' : ''}
                {progressSummary ? `${progressSummary} 項` : '準備中'}
              </span>
            </div>
          </div>

        </section>

        <PanelSection
          id="run-progress"
          title="執行進度"
          summary={progressSummary ? `${progressSummary} 完成` : undefined}
          open={progressOpen}
          onToggle={() => setProgressOpen((value) => !value)}
        >
          {tasks.length > 0 ? (
            <ul className="space-y-2">
              {tasks.map((task, index) => (
                <li key={task.id} className="flex items-start gap-2 text-[12px]">
                  {task.status === 'done' || task.status === 'failed' ? (
                    <span
                      className={`mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full ${
                        task.status === 'failed' ? 'bg-red text-white' : 'bg-green text-white'
                      }`}
                    >
                      <Icon name={task.status === 'failed' ? 'close' : 'check'} size={12} filled={task.status === 'done'} />
                    </span>
                  ) : (
                    <SpinnerRing
                      size={18}
                      active={task.status === 'active'}
                      tone={task.status === 'active' ? 'active' : 'idle'}
                    >
                      {index + 1}
                    </SpinnerRing>
                  )}
                  <span
                    className={
                      task.status === 'done'
                        ? 'text-ink-3 line-through'
                        : task.status === 'active'
                          ? 'text-ink'
                          : 'text-ink-2'
                    }
                  >
                    {task.text}
                  </span>
                </li>
              ))}
            </ul>
          ) : agent.steps.length > 0 ? (
            <CompactStepList steps={agent.steps} />
          ) : live && agent.loopConfig.trigger === 'local-cli' ? (
            <p className="flex items-center gap-2 text-[12px] text-ink-3">
              <PixelLoader className="text-accent-ink" />
              <ShimmerLabel active>正在分析任務…</ShimmerLabel>
            </p>
          ) : (
            <p className="text-[12px] text-ink-3">等待引擎建立進度…</p>
          )}

          {tasks.length > 0 && agent.steps.length > 0 ? (
            <div className="mt-4 border-t border-line pt-3">
              <button
                type="button"
                aria-expanded={stepsOpen}
                onClick={() => setStepsOpen((value) => !value)}
                className="flex w-full items-center gap-2 text-left text-[11px] text-ink-3 transition-colors hover:text-ink"
              >
                <span className="flex-1">引擎步驟</span>
                <span className="font-[family-name:var(--font-mono)]">{agent.steps.length}</span>
                <Icon name={stepsOpen ? 'expand_less' : 'expand_more'} size={15} />
              </button>
              {stepsOpen ? <div className="mt-3"><CompactStepList steps={agent.steps} /></div> : null}
            </div>
          ) : null}

          {agent.subAgents.length > 0 ? (
            <div className="mt-4 border-t border-line pt-3">
              <button
                type="button"
                aria-expanded={subAgentsOpen}
                onClick={() => setSubAgentsOpen((value) => !value)}
                className="flex w-full items-center gap-2 text-left text-[11px] text-ink-3 transition-colors hover:text-ink"
              >
                <span className="flex-1">子代理</span>
                <span className="font-[family-name:var(--font-mono)]">
                  {agent.subAgents.filter((item) => item.status === 'done').length}/{agent.subAgents.length}
                </span>
                <Icon name={subAgentsOpen ? 'expand_less' : 'expand_more'} size={15} />
              </button>
              {subAgentsOpen ? (
                <div className="mt-3 space-y-2">
                  {agent.subAgents.map((item) => (
                    <div key={item.id} className="flex items-start gap-2 text-[11px]">
                      <Icon
                        name={item.status === 'done' ? 'check_circle' : item.status === 'error' ? 'cancel' : item.status === 'active' ? 'progress_activity' : 'radio_button_unchecked'}
                        size={14}
                        className={item.status === 'done' ? 'text-green' : item.status === 'error' ? 'text-red' : item.status === 'active' ? 'animate-spin text-accent-ink' : 'text-ink-3'}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="text-ink-2">{item.name}</span>
                        <span className="ml-1 text-ink-3">· {item.role}</span>
                        {item.model ? <span className="ml-1 font-mono text-[10px] text-ink-3">· {item.model}</span> : null}
                        {item.lastMessage ? <span className="mt-0.5 block truncate text-[10px] text-ink-3">{item.lastMessage}</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </PanelSection>

        {detailSummary || isExternal || agent.loadedCapabilityIds.length > 0 ? (
          <PanelSection
            id="run-details"
            title="詳細紀錄"
            summary={detailSummary || '執行資訊'}
            open={detailsOpen}
            onToggle={() => setDetailsOpen((value) => !value)}
          >
            <div className="space-y-4">
              {activity.thought ? (
                <div>
                  <button
                    type="button"
                    aria-expanded={thoughtOpen}
                    onClick={() => setThoughtOpen((value) => !value)}
                    className="flex w-full items-center gap-2 text-left text-[11px] text-ink-2 transition-colors hover:text-ink"
                  >
                    <span className="flex-1 font-medium">推理摘要</span>
                    <span className="font-[family-name:var(--font-mono)] text-[10px] text-ink-3">
                      {activity.thought.length.toLocaleString()} 字
                    </span>
                    <Icon name={thoughtOpen ? 'expand_less' : 'expand_more'} size={15} className="text-ink-3" />
                  </button>
                  {thoughtOpen ? (
                    <pre className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap rounded-control bg-inset p-2.5 text-[10px] leading-relaxed text-ink-2 font-[family-name:var(--font-mono)] custom-scrollbar">
                      {activity.thought}
                    </pre>
                  ) : null}
                </div>
              ) : null}

              {isExternal || agent.loadedCapabilityIds.length > 0 ? (
                <div>
                  <p className="text-[11px] font-medium text-ink-2">執行資訊</p>
                  {isExternal ? (
                    <>
                      <p className="mt-1 text-[10px] leading-snug text-ink-3">{formatRunnerCapabilitiesSummary(runnerCaps)}</p>
                      <p className="mt-1 text-[10px] leading-snug text-orange">
                        外部執行不代表內建 DoD 已滿足，也不顯示內建能力包進度。
                      </p>
                    </>
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

              {(agent.tokensUsed > 0 || agent.metrics.executionMs > 0) ? (
                <p className="text-[10px] text-ink-3 font-[family-name:var(--font-mono)]">
                  tokens {agent.tokensUsed} · {agent.metrics.executionMs || 0}ms
                </p>
              ) : null}
            </div>
          </PanelSection>
        ) : null}
      </div>

    </div>
  )
}
