import type { ReactNode } from 'react'
import { Icon } from './Icon'

type DecisionCardProps = {
  kind: 'question' | 'approval'
  titleId: string
  title: string
  reason: string
  meta?: string
  runId?: string
  threadId?: string
  children: ReactNode
  denyLabel: string
  onDeny: () => void
  approveLabel?: string
  approveDisabled?: boolean
  onApprove?: () => void
}

/** Presentation only. The caller owns queueing, timeout, authority, and resolution. */
export function DecisionCard({
  kind,
  titleId,
  title,
  reason,
  meta,
  runId,
  threadId,
  children,
  denyLabel,
  onDeny,
  approveLabel,
  approveDisabled = false,
  onApprove,
}: DecisionCardProps) {
  return (
    <section
      role="region"
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-reason${meta ? ` ${titleId}-meta` : ''}`}
      aria-live="polite"
      data-decision-kind={kind}
      data-run-id={runId || undefined}
      data-thread-id={threadId || undefined}
      className="agent-decision-panel overflow-hidden rounded-control text-ink"
    >
        <header className="agent-decision-header flex items-start gap-3 px-3.5 pb-3 pt-3.5">
          <Icon
            name={kind === 'question' ? 'question_mark' : 'shield'}
            size={18}
            className="mt-0.5 shrink-0 text-orange"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h2 id={titleId} className="text-[14px] font-semibold text-ink">{title}</h2>
              <span className="text-[11px] font-medium text-orange">等待你的決定</span>
            </div>
            <p id={`${titleId}-reason`} className="mt-1 text-[13px] leading-relaxed text-ink-2">{reason}</p>
            {meta ? <p id={`${titleId}-meta`} className="mt-1 text-[11px] text-ink-3">{meta}</p> : null}
          </div>
        </header>

        <div className="agent-decision-body p-4">{children}</div>

        <footer className="agent-decision-footer flex items-center justify-end gap-2 px-3 py-2.5">
          <button
            type="button"
            onClick={onDeny}
            className="rounded-control px-3 py-1.5 text-[12px] font-semibold text-ink-2 transition-colors hover:bg-hover hover:text-ink"
          >
            {denyLabel}
          </button>
          {approveLabel && onApprove ? (
            <button
              type="button"
              disabled={approveDisabled}
              onClick={onApprove}
              className="agent-decision-primary rounded-control bg-ink px-3 py-1.5 text-[12px] font-semibold text-canvas transition-colors disabled:cursor-not-allowed disabled:bg-field disabled:text-ink-3"
            >
              {approveLabel}
            </button>
          ) : null}
        </footer>
    </section>
  )
}
