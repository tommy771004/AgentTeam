import { useEffect, useState } from 'react'
import { capabilitiesForRunner } from '../agent/runners'
import { decideResume, isResumableTerminalRun, type ResumeDecision } from '../agent/runResume'
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
  const [resuming, setResuming] = useState(false)
  const [resumeError, setResumeError] = useState('')
  // Whether a resume is offered is a property of the durable checkpoint, so it
  // is read from the store rather than guessed from the run's status alone.
  const [resume, setResume] = useState<ResumeDecision | null>(null)
  const interrupted = isResumableTerminalRun({
    status: runState?.status,
    interruptReason: runState?.interruptReason,
  })

  useEffect(() => {
    let cancelled = false
    setResume(null)
    setResumeError('')
    if (!runId || !interrupted) return
    void (async () => {
      const { loadCompactionCheckpoint } = await import('../agent/compactionCheckpoint')
      const checkpoint = await loadCompactionCheckpoint(runId)
      if (cancelled) return
      setResume(decideResume(checkpoint, { hasOwningThread: Boolean(threadId) }))
    })()
    return () => {
      cancelled = true
    }
  }, [runId, interrupted, threadId])

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

  if (!canContinueTurn && !hasPendingGoal && !resume) return null

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

  const onResume = async () => {
    if (!runId || resuming || !resume?.allowed) return
    setResuming(true)
    setResumeError('')
    try {
      const [{ claimCheckpointResume, loadCompactionCheckpoint }, { buildResumeObjective }, { runTask }] =
        await Promise.all([
          import('../agent/compactionCheckpoint'),
          import('../agent/runResume'),
          import('../agent/taskRunCoordinator'),
        ])
      // Claim first: the durable marker is what stops a second press, a retry,
      // or another window from continuing the same checkpoint twice.
      const claim = await claimCheckpointResume(runId)
      if (!claim.ok || !claim.checkpoint) {
        const latest = await loadCompactionCheckpoint(runId)
        const refused = decideResume(latest, { hasOwningThread: Boolean(threadId) })
        setResume(refused)
        setResumeError(refused.allowed ? '續跑未能取得檢查點鎖定，請稍後再試。' : refused.detail)
        return
      }
      await runTask({
        objective: buildResumeObjective(claim.checkpoint),
        sourceKind: 'retry',
        reuseThreadId: threadId,
        runner: thread?.runner || 'builtin',
        skipUserBubble: false,
        projectRoot: useProjectStore.getState().root || undefined,
      })
      setResume(null)
    } catch (error) {
      setResumeError(error instanceof Error ? error.message : '續跑失敗')
    } finally {
      setResuming(false)
    }
  }

  return (
    <section className="agent-result-actions" aria-label="結果後續操作">
      <div className="flex items-center gap-2 text-[11px] text-ink-3">
        <span className="font-medium text-ink-2">下一步</span>
        <span>{interrupted ? '這次執行被中止，可以從斷點接續' : '結果已完成，可繼續這個對話'}</span>
      </div>

      {resume?.allowed ? (
        <button
          type="button"
          disabled={resuming}
          onClick={() => void onResume()}
          className="agent-result-action disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-[12px] font-medium text-ink">
              {resuming ? '正在從斷點續跑…' : '從斷點續跑'}
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-ink-3">
              {resume.checkpoint.effects?.length
                ? `已完成的 ${resume.checkpoint.effects.length} 個動作不會重做`
                : '接續中斷時的進度，不重跑已完成的步驟'}
            </span>
          </span>
          <Icon
            name={resuming ? 'progress_activity' : 'play_circle'}
            size={15}
            className={`shrink-0 text-ink-3 ${resuming ? 'animate-spin' : ''}`}
          />
        </button>
      ) : null}

      {resume && !resume.allowed ? (
        <p className="text-[10px] leading-relaxed text-ink-3">{resume.detail}</p>
      ) : null}
      {resumeError ? <p className="text-[10px] leading-relaxed text-red">{resumeError}</p> : null}

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
