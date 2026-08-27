import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

type DecisionCardProps = {
  kind: 'question' | 'approval'
  titleId: string
  title: string
  reason: string
  meta: string
  runId?: string
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
  children,
  denyLabel,
  onDeny,
  approveLabel,
  approveDisabled = false,
  onApprove,
}: DecisionCardProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-reason ${titleId}-meta`}
      onCancel={(event) => {
        event.preventDefault()
        onDeny()
      }}
      data-decision-kind={kind}
      data-run-id={runId || undefined}
      className="agent-decision-card overflow-hidden rounded-card bg-surface text-ink animate-macos-sheet"
    >
        <header className="agent-decision-header primitive-card-pad flex items-start gap-3">
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
            <p id={`${titleId}-meta`} aria-live="polite" className="mt-1 text-[11px] tabular-nums text-ink-3">{meta}</p>
          </div>
        </header>

        <div className="agent-decision-body p-4">{children}</div>

        <footer className="primitive-card-footer flex items-center justify-end gap-2 bg-inset">
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
    </dialog>
  )
}
