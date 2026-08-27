import { useId, useState } from 'react'
import type { RunTaskStatus } from '../store/runActivityStore'
import { Icon } from './Icon'
import { Reveal } from './primitives/Reveal'
import { SpinnerRing } from './primitives/SpinnerRing'

type TaskRowStatus = RunTaskStatus | 'skipped'

const STATUS_LABELS: Record<TaskRowStatus, string> = {
  pending: '待處理', active: '進行中', done: '已完成', failed: '失敗', skipped: '已略過',
}

function TaskStatusBadge({ status, index, live }: { status: TaskRowStatus; index: number; live: boolean }) {
  if (status === 'done' || status === 'failed') {
    return (
      <span className={`flex size-[22px] items-center justify-center rounded-full ${status === 'done' ? 'bg-green text-on-primary' : 'bg-red text-on-error'}`}>
        <Icon name={status === 'done' ? 'check' : 'close'} size={13} />
      </span>
    )
  }
  return <SpinnerRing size={24} active={live && status === 'active'} tone={status === 'active' ? 'active' : 'idle'}>{index + 1}</SpinnerRing>
}

/** Presentation only: recorded status is never advanced by an animation. */
export function RunTaskRow({
  text, status, index, live = false, variant = 'capsule', detail, meta,
}: {
  text: string
  status: TaskRowStatus
  index: number
  live?: boolean
  variant?: 'capsule' | 'list'
  detail?: string
  meta?: string
}) {
  const [open, setOpen] = useState(false)
  const detailId = useId()
  const label = status === 'active' && !live ? '未完成' : STATUS_LABELS[status]
  const tone = status === 'done' ? 'bg-green-tint text-green' : status === 'failed' ? 'bg-red-tint text-red' : 'bg-inset text-ink-2'
  return (
    <li
      data-task-status={status}
      style={{ animationDelay: `${Math.min(index, 6) * 80}ms` }}
      className={`min-w-0 overflow-hidden animate-[fade-up_450ms_ease-out_both] motion-reduce:animate-none transition-[border-radius] duration-300 motion-reduce:transition-none ${variant === 'list' ? 'border-b border-line last:border-0' : `bg-surface shadow-card ${open ? 'rounded-[14px]' : 'rounded-[22px]'}`}`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full min-w-0 items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-inset focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center">
          <TaskStatusBadge status={status} index={index} live={live} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{text}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{label}</span>
        <span aria-hidden="true" className={`inline-flex shrink-0 text-ink-3 transition-transform duration-300 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}>
          <Icon name="expand_more" size={15} />
        </span>
      </button>
      <div id={detailId}>
        <Reveal open={open}>
          <div className="mb-2.5 ml-[22px] mr-3 space-y-1.5 border-l border-line pl-5 text-[12px] leading-relaxed text-ink-2">
            <p className="whitespace-pre-wrap break-words">{text}</p>
            {detail ? <p className="whitespace-pre-wrap break-words">{detail}</p> : null}
            {meta ? <p className="font-mono text-[11px] tabular-nums text-ink-3">{meta}</p> : null}
          </div>
        </Reveal>
      </div>
    </li>
  )
}
