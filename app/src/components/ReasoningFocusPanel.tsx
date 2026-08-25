import { useEffect, useMemo, useRef, useState } from 'react'
import { projectLiveTimeline, runTimelineRows, type RunTimelineRow } from '../agent/liveTimeline'
import type { TurnRecordEntry } from '../agent/turnRecord'
import { Icon } from './Icon'

/**
 * The reasoning rail, in focus mode.
 *
 * It used to be one aggregated blob of every thought a run ever had, growing
 * downward while the user was reading the middle of it. Focus mode fixes the
 * two halves of that: the rail follows the step being reasoned about right
 * now, and the moment the user scrolls away it STOPS following, because being
 * yanked back to the tail while reading is worse than being out of date.
 * «回到目前» resumes following on purpose rather than by accident.
 *
 * Each block is one recorded thought, so a step's reasoning stays legible as a
 * unit instead of dissolving into the one before it.
 */
export function ReasoningFocusPanel({
  entries,
  total,
  fallbackThought,
}: {
  entries: readonly TurnRecordEntry[]
  total: number
  /** Aggregated stream for a runner that publishes no Turn Record. */
  fallbackThought: string
}) {
  const rows = useMemo(
    () => runTimelineRows(projectLiveTimeline(entries, total))
      .filter((row): row is Extract<RunTimelineRow, { kind: 'reasoning' }> => row.kind === 'reasoning'),
    [entries, total],
  )
  const scroller = useRef<HTMLDivElement | null>(null)
  const [following, setFollowing] = useState(true)
  const latest = rows[rows.length - 1]
  // The tail moves when a thought is added AND when the current one grows;
  // both are what "current" means here.
  const latestChars = latest?.chars ?? 0

  useEffect(() => {
    if (!following || !scroller.current) return
    scroller.current.scrollTop = scroller.current.scrollHeight
  }, [following, rows.length, latestChars])

  if (rows.length === 0) {
    if (!fallbackThought.trim()) return null
    return (
      <pre className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap rounded-control bg-inset p-2.5 text-[10px] leading-relaxed text-ink-2 font-[family-name:var(--font-mono)] custom-scrollbar">
        {fallbackThought}
      </pre>
    )
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between gap-2 text-[10px] text-ink-3">
        <span>
          {rows.length} 段推理 · 聚焦步驟 {latest?.turn}.{latest?.step}
        </span>
        {following ? (
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
            跟隨中
          </span>
        ) : (
          <button
            type="button"
            className="flex items-center gap-1 text-accent-ink transition-colors hover:text-ink"
            onClick={() => setFollowing(true)}
          >
            <Icon name="vertical_align_bottom" size={12} />
            回到目前
          </button>
        )}
      </div>
      <div
        ref={scroller}
        data-reasoning-focus
        data-following={following}
        className="max-h-56 space-y-2 overflow-y-auto rounded-control bg-inset p-2.5 custom-scrollbar"
        onScroll={(event) => {
          const element = event.currentTarget
          // Reading an earlier thought must not be interrupted by a new one.
          setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < 24)
        }}
      >
        {rows.map((row) => (
          <div key={row.id} className={row.id === latest?.id ? '' : 'opacity-70'}>
            <div className="mb-0.5 flex items-center gap-1.5 text-[9.5px] uppercase tracking-wider text-ink-3">
              <Icon name="psychology" size={11} />
              <span>步驟 {row.turn}.{row.step}</span>
              <span>· {row.chars.toLocaleString()} 字</span>
            </div>
            <pre className="whitespace-pre-wrap text-[10px] leading-relaxed text-ink-2 font-[family-name:var(--font-mono)]">
              {row.content}
            </pre>
          </div>
        ))}
      </div>
    </div>
  )
}
