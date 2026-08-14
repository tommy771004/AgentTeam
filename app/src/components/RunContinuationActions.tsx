import { useState } from 'react'
import { capabilitiesForRunner } from '../agent/runners'
import { Icon } from './Icon'
import { useAgentStore } from '../store/agentStore'
import { useProjectStore } from '../store/projectStore'
import { useThreadStore } from '../store/threadStore'

/**
 * Actions that only make sense after the answer has settled.
 *
 * Keeping these below the result prevents the live execution surface from
 * turning into a second composer. It also means collapsing the run summary
 * never hides the one action that can move the conversation forward.
 */
export function RunContinuationActions({
  threadId,
  runId,
}: {
  threadId: string
  runId?: string | null
}) {
  const thread = useThreadStore((state) => state.threads.find((item) => item.id === threadId))
  const continueTurn = useAgentStore((state) => state.continueTurn)
  const activeRunIds = useAgentStore((state) => state.activeRunIds)
  const runState = useAgentStore((state) => (runId ? state.runStates[runId] : undefined))
  const [startingGoal, setStartingGoal] = useState(false)

  const live = Boolean(
    runId &&
      (activeRunIds.includes(runId) ||
        runState?.status === 'running' ||
        runState?.status === 'parsing' ||
        runState?.status === 'manual_intervention'),
  )
  const continueGoal = thread?.continueGoal || null
  const canContinueTurn = Boolean(!live && runId && (thread?.awaitingReply || runState?.status === 'awaiting_user'))
  const canContinueGoal = Boolean(
    !live && continueGoal && capabilitiesForRunner(thread?.runner || 'builtin').continueGoal,
  )
  const hasPendingGoal = Boolean(!live && continueGoal)

  if (!canContinueTurn && !hasPendingGoal) return null

  const onContinueGoal = async () => {
    if (!canContinueGoal || !continueGoal || startingGoal) return
    setStartingGoal(true)
    try {
      const { runTask } = await import('../agent/taskRunCoordinator')
      await runTask({
        objective: continueGoal.objective,
        sourceKind: 'retry',
        reuseThreadId: threadId,
        continueGoal: true,
        runner: 'builtin',
        loopType: 'Goal-based',
        skipUserBubble: false,
        projectRoot: useProjectStore.getState().root || undefined,
      })
    } finally {
      setStartingGoal(false)
    }
  }

  return (
    <section className="agent-result-actions" aria-label="結果後續操作">
      <div className="flex items-center gap-2 text-[11px] text-ink-3">
        <span className="font-medium text-ink-2">下一步</span>
        <span>結果已完成，可繼續這個對話</span>
      </div>

      {canContinueTurn ? (
        <button
          type="button"
          onClick={() => runId && continueTurn(runId)}
          className="agent-result-action"
        >
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-[12px] font-medium text-ink">繼續回合</span>
            <span className="mt-0.5 block text-[10px] text-ink-3">回到 agent 的下一個回覆</span>
          </span>
          <Icon name="arrow_forward" size={15} className="shrink-0 text-ink-3" />
        </button>
      ) : null}

      {hasPendingGoal && continueGoal ? (
        <button
          type="button"
          disabled={!canContinueGoal || startingGoal}
          onClick={() => void onContinueGoal()}
          className="agent-result-action disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-[12px] font-medium text-ink">
              {startingGoal ? '正在繼續 Goal…' : '繼續 Goal'}
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-ink-3">
              {continueGoal.missing.length > 0
                ? `還有 ${continueGoal.missing.length} 個缺口：${continueGoal.missing[0]}`
                : continueGoal.definitionOfDone}
            </span>
          </span>
          <Icon
            name={startingGoal ? 'progress_activity' : 'arrow_forward'}
            size={15}
            className={`shrink-0 text-ink-3 ${startingGoal ? 'animate-spin' : ''}`}
          />
        </button>
      ) : null}

      {hasPendingGoal && continueGoal && !canContinueGoal ? (
        <p className="text-[10px] leading-relaxed text-ink-3">
          目前 runner 不支援繼續 Goal，請切換至內建引擎後再繼續。
        </p>
      ) : null}
    </section>
  )
}
