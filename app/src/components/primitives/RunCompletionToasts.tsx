import { useEffect, useRef } from 'react'
import { Icon } from '../Icon'
import {
  stackCompletionToasts,
  type RunCompletionNotice,
  type RunCompletionTone,
} from '../../lib/runCompletionNotice'

type RunCompletionToastsProps = {
  notices: RunCompletionNotice[]
  /** Auto-dismiss delay per toast; 0 keeps them until dismissed. */
  dismissAfterMs?: number
  onDismiss: (runId: string) => void
  onOpen?: (notice: RunCompletionNotice) => void
}

const DEFAULT_DISMISS_MS = 7_000

function toneClass(tone: RunCompletionTone): string {
  switch (tone) {
    case 'success':
      return 'text-green'
    case 'attention':
      return 'text-orange'
    case 'danger':
      return 'text-red'
    default:
      return 'text-ink-3'
  }
}

/**
 * One completion card, owning its own dismissal clock.
 *
 * The timer lives per card so a burst of finishing runs cannot keep resetting
 * an older card's countdown — each announces itself and leaves on its own.
 */
function CompletionToast({
  notice,
  index,
  dismissAfterMs,
  onDismiss,
  onOpen,
}: {
  notice: RunCompletionNotice
  index: number
  dismissAfterMs: number
  onDismiss: (runId: string) => void
  onOpen?: (notice: RunCompletionNotice) => void
}) {
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  const runId = notice.runId

  useEffect(() => {
    if (!dismissAfterMs) return
    const timer = window.setTimeout(() => dismiss.current(runId), dismissAfterMs)
    return () => window.clearTimeout(timer)
  }, [runId, dismissAfterMs])

  return (
    <div
      className="run-complete-toast pointer-events-auto relative overflow-hidden rounded-card border border-line bg-surface-container-high shadow-raised"
      style={{ animationDelay: `${Math.min(index, 2) * 45}ms` }}
    >
      <button
        type="button"
        onClick={() => onOpen?.(notice)}
        disabled={!onOpen}
        title={onOpen ? '前往這個對話' : undefined}
        className="flex w-full items-start gap-2.5 py-3 pl-3 pr-9 text-left transition-colors duration-200 enabled:hover:bg-hover-2 disabled:cursor-default"
      >
        <Icon name={notice.icon} size={17} className={`mt-px shrink-0 ${toneClass(notice.tone)}`} />
        <span className="min-w-0 flex-1">
          <span className={`block text-[12.5px] font-semibold ${toneClass(notice.tone)}`}>
            {notice.title}
          </span>
          <span className="mt-0.5 block break-words text-[11.5px] leading-snug text-ink-2">
            {notice.body}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onDismiss(runId)}
        aria-label="關閉通知"
        title="關閉通知"
        className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-control text-ink-3 transition-colors duration-200 hover:bg-hover hover:text-ink"
      >
        <Icon name="close" size={15} />
      </button>
    </div>
  )
}

/**
 * Completion cards for runs that finished off-screen.
 *
 * Content is opaque from the first frame — the entrance animates position
 * only — so a throttled or skipped animation can never leave an empty card
 * where the news should be.
 */
export function RunCompletionToasts({
  notices,
  dismissAfterMs = DEFAULT_DISMISS_MS,
  onDismiss,
  onOpen,
}: RunCompletionToastsProps) {
  const { visible, overflow, overflowLabel } = stackCompletionToasts(notices)
  if (!visible.length) return null

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[130] flex w-[min(340px,calc(100vw-32px))] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {visible.map((notice, index) => (
        <CompletionToast
          key={notice.runId}
          notice={notice}
          index={index}
          dismissAfterMs={dismissAfterMs}
          onDismiss={onDismiss}
          onOpen={onOpen}
        />
      ))}
      {overflow ? (
        <button
          type="button"
          onClick={() => notices.forEach((notice) => onDismiss(notice.runId))}
          className="run-complete-toast pointer-events-auto rounded-card border border-line bg-surface-container px-3 py-2 text-left text-[11.5px] text-ink-2 transition-colors duration-200 hover:bg-hover-2"
        >
          {overflowLabel} · 點一下全部清除
        </button>
      ) : null}
    </div>
  )
}
