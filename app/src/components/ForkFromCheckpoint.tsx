/**
 * Fork and rerun from a selected step.
 *
 * The steps a fork may start from are exactly the thread's replay-safe
 * checkpoints (ADR-0042). Selecting one reruns through the coordinator with
 * `sourceKind: 'retry'` — this component never calls dispatch or startExecution.
 */
import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import { useThreadStore } from '../store/threadStore'
import { listReplaySafeCheckpoints } from '../agent/runFork'
import { rerunFromReplaySafeCheckpoint } from '../agent/taskRunCoordinator'

export function ForkFromCheckpoint({
  threadId,
  compact = false,
  allowThreadPick = false,
}: {
  threadId?: string | null
  compact?: boolean
  /** Archive records carry no thread link, so let the user name the conversation. */
  allowThreadPick?: boolean
}) {
  const threads = useThreadStore((state) => state.threads)
  const activeId = useThreadStore((state) => state.activeId)
  const [pickedId, setPickedId] = useState('')
  const targetId = threadId || pickedId || activeId
  const thread = threads.find((item) => item.id === targetId)
  const checkpoints = useMemo(
    () => (thread ? listReplaySafeCheckpoints(thread) : []),
    [thread],
  )
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string>('')
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  if (!thread) return null

  const fork = async (bubbleId: string) => {
    if (!bubbleId || busy) return
    setBusy(true)
    setNotice('')
    try {
      const result = await rerunFromReplaySafeCheckpoint({
        sourceThreadId: thread.id,
        checkpointBubbleId: bubbleId,
        continueHint: hint.trim() || undefined,
      })
      if (result.skipped) {
        // A non-replay-safe point is refused with its reason, never adjusted.
        setNotice(result.error || '該步驟不是 replay-safe checkpoint，無法重跑。')
      } else {
        setOpen(false)
        setHint('')
      }
    } finally {
      setBusy(false)
    }
  }

  if (checkpoints.length === 0) {
    return compact ? null : (
      <p className="text-[11px] text-on-surface-variant">此對話沒有可重播的 checkpoint。</p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setSelected(checkpoints.at(-1)?.bubbleId || '')
          setOpen((value) => !value)
        }}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-control text-xs font-semibold border border-line hover:border-primary disabled:opacity-50"
        title="選擇一個 replay-safe 步驟並重跑"
      >
        <Icon name="replay" size={14} />
        從步驟重跑
      </button>

      {open && (
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-line bg-surface-container">
          <p className="text-[11px] text-on-surface-variant">
            只有已保存的使用者輪次可作為分岔點；工具結果與 side effect 不會被 replay。
          </p>
          {allowThreadPick && !threadId && (
            <select
              value={targetId || ''}
              onChange={(e) => {
                setPickedId(e.target.value)
                setSelected('')
              }}
              className="w-full px-3 py-2 rounded-control text-xs bg-surface-container-high border border-line"
            >
              {threads.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          )}
          <div className="flex flex-col max-h-52 overflow-y-auto divide-y divide-line/50">
            {checkpoints.map((checkpoint) => (
              <label
                key={checkpoint.bubbleId}
                className="flex items-start gap-2 py-2 cursor-pointer"
              >
                <input
                  type="radio"
                  name={`fork-${thread.id}`}
                  className="mt-1"
                  checked={selected === checkpoint.bubbleId}
                  onChange={() => setSelected(checkpoint.bubbleId)}
                />
                <span className="min-w-0">
                  <span className="text-xs font-semibold">步驟 {checkpoint.stepIndex}</span>
                  <span className="block text-[11px] text-on-surface-variant truncate">
                    {checkpoint.objective.slice(0, 120)}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <input
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="這次要調整什麼？（選填）"
            className="w-full px-3 py-2 rounded-control text-xs bg-surface-container-high border border-line"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!selected || busy}
              onClick={() => void fork(selected)}
              className="px-3 py-2 rounded-control text-xs font-semibold bg-primary-container text-on-primary-container disabled:opacity-50"
            >
              {busy ? '重跑中…' : '從此步驟重跑'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-2 rounded-control text-xs text-on-surface-variant"
            >
              取消
            </button>
          </div>
          {notice && <p className="text-[11px] text-error">{notice}</p>}
        </div>
      )}
    </div>
  )
}
