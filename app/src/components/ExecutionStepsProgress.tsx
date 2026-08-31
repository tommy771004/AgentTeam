import { useState, type FocusEvent } from 'react'
import type { RunTaskItem } from '../store/runActivityStore'
import { Icon } from './Icon'

type ExecutionStep = Pick<RunTaskItem, 'id' | 'text' | 'status'>

function StepStatusIcon({ task }: { task: ExecutionStep }) {
  if (task.status === 'done') return <Icon name="check_circle" size={16} className="text-green" />
  if (task.status === 'failed') return <Icon name="error" size={16} className="text-red" />
  if (task.status === 'active') return <Icon name="progress_activity" size={16} className="animate-spin text-ink" />
  return <Icon name="radio_button_unchecked" size={16} className="text-ink-3" />
}

export function ExecutionStepsProgress({ tasks }: { tasks: readonly ExecutionStep[] }) {
  const [pinnedOpen, setPinnedOpen] = useState(false)
  const [hoverOpen, setHoverOpen] = useState(false)
  if (tasks.length === 0) return null

  const completed = tasks.filter((task) => task.status === 'done').length
  const failed = tasks.filter((task) => task.status === 'failed').length
  const open = pinnedOpen || hoverOpen
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setHoverOpen(false)
  }
  const togglePinned = () => {
    if (pinnedOpen) setHoverOpen(false)
    setPinnedOpen((value) => !value)
  }

  return (
    <div
      className="execution-steps-progress relative z-20 w-fit max-w-full"
      data-execution-steps-progress
      onMouseEnter={() => setHoverOpen(true)}
      onMouseLeave={() => setHoverOpen(false)}
      onFocusCapture={() => setHoverOpen(true)}
      onBlurCapture={handleBlur}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="agent-process-row inline-flex max-w-full items-center gap-2 text-left text-[12px] text-ink-2"
        onClick={togglePinned}
      >
        <Icon name="checklist" size={16} className="shrink-0 text-ink-3" />
        <span className="font-medium tabular-nums">執行步驟：{completed}/{tasks.length}</span>
        {failed > 0 ? <span className="text-red">{failed} 項失敗</span> : null}
        <Icon name={open ? 'expand_less' : 'expand_more'} size={14} className="shrink-0 text-ink-3" />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-40 w-[min(32rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] pt-1">
          <section
            role="dialog"
            aria-label="執行步驟"
            className="rounded-lg border border-line-strong/70 bg-surface-container-low p-3 shadow-xl"
          >
            <ol className="max-h-72 space-y-2 overflow-y-auto custom-scrollbar" aria-label="執行步驟清單">
              {tasks.map((task, index) => (
                <li key={task.id} className="flex min-w-0 items-start gap-2 text-[12px] leading-relaxed text-ink-2">
                  <span className="mt-0.5 inline-flex shrink-0" aria-hidden="true"><StepStatusIcon task={task} /></span>
                  <span className={`min-w-0 flex-1 ${task.status === 'done' ? 'text-ink-3 line-through decoration-line-strong' : ''}`}>
                    {index + 1}. {task.text}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}
    </div>
  )
}
