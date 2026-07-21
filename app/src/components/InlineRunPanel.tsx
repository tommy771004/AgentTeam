import { Icon } from './Icon'
import { StepTimeline } from './StepTimeline'
import { LogViewer } from './LogViewer'
import { InterventionPanel } from './InterventionPanel'
import { emptyAgentLike } from '../agent/localCliRun'
import {
  EXTERNAL_CLI_UI_LABEL,
  capabilitiesForRunner,
  formatRunnerCapabilitiesSummary,
} from '../agent/runners'
import { useAgentStore } from '../store/agentStore'
import { useProjectStore } from '../store/projectStore'
import { useRunActivityStore } from '../store/runActivityStore'
import { useThreadStore, type ThreadPlanItem } from '../store/threadStore'
import { loopTypeZh } from '../i18n/zh'

/**
 * CloudCLI-style embedded run progress — no page navigation
 */
const EMPTY_AGENT = emptyAgentLike({ objective: '', status: 'idle', progress: 0 })
// Stable references — a fresh object/array literal returned from a zustand
// selector fallback breaks Object.is identity every render and triggers
// "Maximum update depth exceeded" (React getSnapshot-must-be-cached loop).
const EMPTY_ACTIVITY = { active: false, tasks: [], statusLine: '', thought: '' } as const
const EMPTY_RUN_PLAN: ThreadPlanItem[] = []

export function InlineRunPanel({
  runId,
  threadId,
  onClose,
}: {
  runId: string
  threadId: string
  onClose?: () => void
}) {
  const agent = useAgentStore((s) => s.runStates[runId]) || EMPTY_AGENT
  const isRunning = useAgentStore((s) => s.activeRunIds.includes(runId))
  const stopExecution = useAgentStore((s) => s.stopExecution)
  const continueTurn = useAgentStore((s) => s.continueTurn)
  const resolveIntervention = useAgentStore((s) => s.resolveIntervention)
  const activity = useRunActivityStore((s) => s.presentations[runId]) || EMPTY_ACTIVITY
  const continueGoal = useThreadStore((s) => s.threads.find((t) => t.id === threadId)?.continueGoal)
  const activeId = threadId
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

  const done = ['success', 'failed', 'halted'].includes(agent.status)
  const isExternal =
    agent.executionKind === 'external' ||
    agent.loopConfig.trigger === 'local-cli' ||
    threadRunner !== 'builtin'
  const runnerCaps =
    agent.runnerCapabilities || capabilitiesForRunner(isExternal ? threadRunner : 'builtin')
  const canContinueGoal = Boolean(continueGoal && runnerCaps.continueGoal)

  const onContinueGoal = async () => {
    if (!canContinueGoal || !continueGoal || !activeId || isRunning) return
    const { runTask } = await import('../agent/taskRunCoordinator')
    await runTask({
      objective: continueGoal.objective,
      sourceKind: 'retry',
      reuseThreadId: activeId,
      continueGoal: true,
      // Force builtin — only loop adapter can honor DoD/missing.
      runner: 'builtin',
      loopType: 'Goal-based',
      skipUserBubble: false,
      // Snapshot the project pinned at dispatch time — a concurrent run must not
      // silently re-resolve to whatever project the UI switches to mid-flight.
      projectRoot: useProjectStore.getState().root || undefined,
    })
  }

  return (
    <div className="h-full flex flex-col min-h-0 border-l border-white/10 bg-surface/40">
      <div className="shrink-0 h-11 px-3 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name="play_circle" size={16} className="text-primary shrink-0" />
          <span className="text-xs font-semibold truncate">執行</span>
          {live && (
            <span className="flex items-center gap-1 text-[10px] text-primary">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              LIVE
            </span>
          )}
          {done && (
            <span
              className={`text-[10px] font-semibold ${
                agent.status === 'success' ? 'text-primary' : 'text-error'
              }`}
            >
              {agent.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {live && (
            <button
              type="button"
              onClick={() => stopExecution(runId)}
              className="px-2 py-1 rounded text-[10px] font-semibold border border-error/30 text-error hover:bg-error/10"
            >
              停止
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-white/10 text-outline"
              title="收合面板"
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-3">
        <div className="rounded-xl border border-white/10 bg-surface-container/60 p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-outline font-semibold">
            {isExternal
              ? `${EXTERNAL_CLI_UI_LABEL}${agent.externalRunnerKind ? ` · ${agent.externalRunnerKind}` : ''}`
              : `${loopTypeZh(agent.loopConfig.loopType)} · 迭代 ${agent.currentIteration}/${agent.loopConfig.maxIterations}`}
          </div>
          {isExternal && (
            <p className="text-[10px] text-outline leading-snug">
              {formatRunnerCapabilitiesSummary(runnerCaps)}
            </p>
          )}
          {!isExternal && (
            <p className="text-[10px] text-outline">
              DoD：{agent.loopConfig.definitionOfDone?.slice(0, 80) || '—'}
            </p>
          )}
          {isExternal && (
            <p className="text-[10px] text-amber-400/90 leading-snug">
              外部執行結束 ≠ 內建 DoD 已滿足；不顯示 iterate／能力包進度。
            </p>
          )}
          <p className="text-xs text-on-surface leading-relaxed line-clamp-3">
            {agent.objective || '—'}
          </p>
          {activity.statusLine ? (
            <p className="text-[11px] text-secondary line-clamp-2">{activity.statusLine}</p>
          ) : null}
          {activity.thought ? (
            <div className="rounded-lg border border-white/8 bg-surface/50 p-2">
              <div className="text-[10px] uppercase tracking-wider text-outline font-semibold mb-1">
                思考
              </div>
              <pre className="text-[10px] text-on-surface-variant whitespace-pre-wrap font-[family-name:var(--font-mono)] max-h-20 overflow-y-auto custom-scrollbar line-clamp-6">
                {activity.thought.slice(-800)}
              </pre>
            </div>
          ) : null}
          <div>
            <div className="flex justify-between text-[10px] text-outline mb-1">
              <span>進度</span>
              <span className="text-primary font-[family-name:var(--font-mono)]">
                {agent.progress}%
              </span>
            </div>
            <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary-container to-primary rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, agent.progress)}%` }}
              />
            </div>
          </div>
          <div className="text-[10px] text-outline font-[family-name:var(--font-mono)]">
            tokens {agent.tokensUsed} · {agent.metrics?.executionMs || 0}ms
          </div>
          {!isExternal && (agent.loadedCapabilityIds?.length ?? 0) > 0 && (
            <div className="pt-1">
              <div className="text-[10px] uppercase tracking-wider text-outline font-semibold mb-1.5">
                Capabilities
              </div>
              <div className="flex flex-wrap gap-1">
                {agent.loadedCapabilityIds.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-[family-name:var(--font-mono)] border border-primary/25 bg-primary/10 text-primary"
                    title={id}
                  >
                    {id}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {(tasks.length > 0 || (live && agent.loopConfig.trigger === 'local-cli')) && (
          <div className="rounded-xl border border-white/10 bg-surface-container/40 p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[10px] uppercase tracking-wider text-outline font-semibold">
                任務清單
              </h4>
              {tasks.length > 0 && (
                <span className="text-[10px] text-outline font-[family-name:var(--font-mono)]">
                  {tasks.filter((t) => t.status === 'done').length}/
                  {tasks.length}
                </span>
              )}
            </div>
            {tasks.length === 0 ? (
              <p className="text-xs text-outline flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                分析任務中…
              </p>
            ) : (
              <ul className="space-y-1.5">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-2 text-xs">
                    {t.status === 'done' ? (
                      <Icon name="check_circle" size={14} filled className="text-primary shrink-0 mt-px" />
                    ) : t.status === 'active' ? (
                      <Icon
                        name="progress_activity"
                        size={14}
                        className="text-primary animate-spin shrink-0 mt-px"
                      />
                    ) : t.status === 'failed' ? (
                      <Icon name="cancel" size={14} className="text-error shrink-0 mt-px" />
                    ) : (
                      <Icon
                        name="radio_button_unchecked"
                        size={14}
                        className="text-outline shrink-0 mt-px"
                      />
                    )}
                    <span
                      className={
                        t.status === 'done'
                          ? 'text-on-surface-variant line-through opacity-70'
                          : t.status === 'active'
                            ? 'text-on-surface'
                            : 'text-on-surface-variant'
                      }
                    >
                      {t.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {agent.subAgents.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-surface-container/40 p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[10px] uppercase tracking-wider text-outline font-semibold">
                子代理工作樹
              </h4>
              <span className="text-[10px] text-outline font-[family-name:var(--font-mono)]">
                {agent.subAgents.filter((item) => item.status === 'done').length}/{agent.subAgents.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {agent.subAgents.map((item) => (
                <div key={item.id} className="flex items-start gap-2 text-xs">
                  <Icon
                    name={item.status === 'done' ? 'check_circle' : item.status === 'error' ? 'cancel' : item.status === 'active' ? 'progress_activity' : 'radio_button_unchecked'}
                    size={14}
                    className={item.status === 'done' ? 'text-primary' : item.status === 'error' ? 'text-error' : item.status === 'active' ? 'animate-spin text-primary' : 'text-outline'}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-on-surface">{item.name}</span>
                    <span className="ml-1 text-outline">· {item.role}</span>
                    {item.model ? <span className="ml-1 text-outline font-mono">· {item.model}</span> : null}
                    {item.lastMessage ? <span className="mt-0.5 block truncate text-[10px] text-outline">{item.lastMessage}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {agent.intervention?.active && (
          <InterventionPanel
            intervention={agent.intervention}
            onApprove={(payloadJson) =>
              resolveIntervention({ action: 'approve', payloadJson }, runId)
            }
            onReject={() => resolveIntervention({ action: 'reject' }, runId)}
          />
        )}

        {agent.status === 'awaiting_user' && (
          <button
            type="button"
            onClick={() => continueTurn(runId)}
            className="w-full py-2 rounded-lg border border-primary/40 text-primary text-xs font-semibold hover:bg-primary/10"
          >
            繼續下一回合
          </button>
        )}

        {continueGoal && !live && canContinueGoal && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
            <p className="text-[11px] text-on-surface font-medium">
              未完成 Goal 可保留 DoD 繼續
            </p>
            <p className="text-[10px] text-outline line-clamp-2">
              {continueGoal.definitionOfDone}
            </p>
            {continueGoal.missing.length > 0 && (
              <ul className="text-[10px] text-on-surface-variant space-y-0.5">
                {continueGoal.missing.slice(0, 4).map((m) => (
                  <li key={m}>· {m}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => void onContinueGoal()}
              className="w-full py-2 rounded-lg border border-primary/40 text-primary text-xs font-semibold hover:bg-primary/10"
            >
              補齊缺口繼續
            </button>
          </div>
        )}
        {continueGoal && !live && !canContinueGoal && (
          <div className="rounded-xl border border-white/15 bg-surface-container/50 p-3 space-y-1.5">
            <p className="text-[11px] text-on-surface font-medium">
              外部 CLI 不支援「補齊缺口繼續」
            </p>
            <p className="text-[10px] text-outline leading-snug">
              已保留原 Goal 快照（DoD／缺口），但目前 runner 未宣告 continueGoal。
              請切換至內建引擎後再繼續，或重新開啟外部任務。
            </p>
            {continueGoal.missing.length > 0 && (
              <ul className="text-[10px] text-on-surface-variant space-y-0.5">
                {continueGoal.missing.slice(0, 4).map((m) => (
                  <li key={m}>· {m}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-surface-container/40 p-3">
          <h4 className="text-[10px] uppercase tracking-wider text-outline font-semibold mb-2">
            步驟
          </h4>
          {agent.steps.length === 0 ? (
            <p className="text-xs text-outline">等待引擎…</p>
          ) : (
            <StepTimeline steps={agent.steps} />
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-[#060e20] overflow-hidden flex flex-col min-h-[160px] max-h-[240px]">
          <div className="px-3 py-1.5 border-b border-white/10 text-[10px] uppercase tracking-wider text-outline font-semibold">
            日誌
          </div>
          <div className="flex-1 min-h-0">
            <LogViewer logs={agent.logs.slice(-80)} live={live} />
          </div>
        </div>

        {agent.toolCalls.length > 0 && (
          <div className="rounded-xl border border-white/10 p-3 space-y-1">
            <h4 className="text-[10px] uppercase tracking-wider text-outline font-semibold mb-1">
              工具 ({agent.toolCalls.length})
            </h4>
            {agent.toolCalls.slice(-6).map((t) => (
              <div
                key={t.id}
                className="text-[11px] font-[family-name:var(--font-mono)] flex gap-1.5"
              >
                <span className={t.ok ? 'text-primary' : 'text-error'}>{t.ok ? '✓' : '✗'}</span>
                <span className="text-secondary shrink-0">{t.tool}</span>
                <span className="text-outline truncate">{t.output.slice(0, 60)}</span>
              </div>
            ))}
          </div>
        )}

        {agent.result && done ? (
          <p className="px-0.5 text-[10px] text-outline">
            最終結果已放入主對話，可在主對話收合或展開。
          </p>
        ) : null}
      </div>
    </div>
  )
}
