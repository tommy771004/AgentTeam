import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { projectTrajectory, type TrajectoryRow } from '../agent/trajectoryProjection'
import type { TurnRecordPage } from '../agent/turnRecord'
import { mergeTrajectoryPages } from '../agent/trajectoryPaging'
import { Icon } from './Icon'
import { formatTokens, formatUsd } from '../agent/contextUsageView'

/**
 * Walk back through what a run actually did.
 *
 * The record is read a page at a time, so a long run's earliest steps are no
 * longer the first thing the product forgets. Two rules the view holds to:
 * a step still running shows as running and NEVER borrows a duration, and the
 * prefix nobody has loaded is marked as unloaded rather than given a length.
 */

export type RecordPageLoader = (sessionId: string, before?: number, limit?: number) => Promise<TurnRecordPage>

const PAGE_LIMIT = 50

function hostPageLoader(): RecordPageLoader | undefined {
  const read = window.subagents?.piHost?.sessions?.record
  if (typeof read !== 'function') return undefined
  return async (sessionId, before, limit) => (await read(sessionId, before, limit)).page
}

function formatMs(ms: number): string {
  return ms >= 1_000 ? `${(ms / 1_000).toFixed(1)}s` : `${Math.round(ms)}ms`
}

/** Material Symbols names, matching the set the rest of the app already uses. */
function rowIcon(kind: TrajectoryRow['kind']): string {
  switch (kind) {
    case 'tool':
      return 'terminal'
    case 'user':
      return 'person'
    case 'assistant':
      return 'deployed_code'
    case 'reasoning':
      return 'psychology'
    default:
      return 'info'
  }
}

function rowLabel(row: TrajectoryRow): string {
  switch (row.kind) {
    case 'user':
      return row.content
    case 'assistant':
      return row.content
    case 'tool':
      return `${row.tool}${row.approval ? ` · ${row.approval}` : ''}${row.settlement ? ` · ${row.settlement}` : ''}${row.detail ? ` · ${row.detail}` : ''}`
    case 'notice':
      return row.content
    case 'reasoning':
      // Named and measured on the line; the thought itself is read by
      // selecting the row, so a long one cannot push the walk off screen.
      return `推理 · ${row.content.length.toLocaleString()} 字`
    default:
      return ''
  }
}

export function TrajectoryPanel({ sessionId, loadPage }: { sessionId: string; loadPage?: RecordPageLoader }) {
  const [page, setPage] = useState<TurnRecordPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  // Following the tail is the default, and the user's own scroll ends it.
  const following = useRef(true)
  const scroller = useRef<HTMLDivElement | null>(null)
  // `hostPageLoader` closes over the bridge. Memoising it is required: a fresh
  // function per render would recreate `read`, rerun the loading effect, and
  // start another async page request after every state update.
  const loader = useMemo(() => loadPage || hostPageLoader(), [loadPage])
  // A late page from the previous session/request may resolve after the user
  // has already moved on. Only the newest generation may mutate the view.
  const requestGeneration = useRef(0)

  const read = useCallback(async (before?: number) => {
    if (!loader) return
    const generation = ++requestGeneration.current
    setLoading(true)
    setError(null)
    try {
      const next = await loader(sessionId, before, PAGE_LIMIT)
      if (generation !== requestGeneration.current) return
      setPage((current) => (current && before !== undefined
        // An older page is merged by record identity; overlapping/retried
        // pages cannot duplicate a row or lower the Host high-watermark.
        ? mergeTrajectoryPages(next, current)
        : next))
    } catch (cause) {
      if (generation !== requestGeneration.current) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
    }
  }, [loader, sessionId])

  useEffect(() => {
    requestGeneration.current += 1
    following.current = true
    setPage(null)
    setSelected(null)
    void read()
    return () => {
      // Invalidate a request whose component/session lifetime just ended.
      requestGeneration.current += 1
    }
  }, [read])

  useEffect(() => {
    if (!following.current || !scroller.current) return
    scroller.current.scrollTop = scroller.current.scrollHeight
  }, [page])

  if (!loader) return null

  const view = page ? projectTrajectory(page) : null
  const selectedRow = view?.rows.find((row) => row.seq === selected)
  const selectedStep = selectedRow
    ? view?.steps.find((step) => step.turn === selectedRow.turn && step.step === selectedRow.step)
    : undefined

  return (
    <section className="trajectory-panel flex min-h-0 flex-col gap-2" aria-label="執行軌跡">
      <header className="flex items-center gap-2 text-xs text-muted">
        <span>執行軌跡</span>
        {view ? <span>{view.rows.length} 列</span> : null}
        {view && view.unloadedBefore > 0 ? <span>· 尚有 {view.unloadedBefore} 筆更早</span> : null}
        {view?.runner?.capabilities && !view.runner.capabilities.validateDoD ? (
          <span title="外部 CLI 不執行內建 Parse／DoD 驗證／iterate">
            · {view.runner.runner}（未驗證 DoD）
          </span>
        ) : null}
      </header>

      <div
        ref={scroller}
        data-trajectory-scroll
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
        onScroll={(event) => {
          const element = event.currentTarget
          const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24
          // Reading older rows must not be interrupted by new ones arriving.
          following.current = atBottom
        }}
      >
        {view && view.unloadedBefore > 0 ? (
          <button
            type="button"
            className="self-start rounded px-2 py-1 text-xs text-muted hover:text-fg disabled:opacity-60"
            disabled={loading}
            onClick={() => void read(view.nextBefore)}
          >
            {loading ? '載入中…' : `載入更早的 ${Math.min(PAGE_LIMIT, view.unloadedBefore)} 筆`}
          </button>
        ) : null}

        {error ? <p className="px-2 py-1 text-xs text-red">讀取軌跡失敗：{error}</p> : null}

        {view?.rows.map((row) => {
          const isSelected = row.seq === selected
          return (
            <button
              key={row.seq}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelected(isSelected ? null : row.seq)}
              className={`flex items-start gap-2 rounded px-2 py-1 text-left text-xs ${isSelected ? 'bg-surface-2' : ''}`}
            >
              <span className="shrink-0 tabular-nums text-muted">
                {row.turn}.{row.step}
              </span>
              <span className="shrink-0 text-muted">
                <Icon name={rowIcon(row.kind)} size={12} />
              </span>
              <span className="min-w-0 flex-1 truncate">{rowLabel(row)}</span>
              <span className="shrink-0 tabular-nums text-muted">
                {row.timing?.totalMs === undefined ? '' : formatMs(row.timing.totalMs)}
              </span>
            </button>
          )
        })}
      </div>

      {selectedRow ? (
        <footer className="flex flex-col gap-1 border-t border-hairline px-2 py-1 text-xs text-muted">
          {/* The thought in full. This is the whole point of recording it: an
              hour later, «它那時在想什麼» has an answer that survived the run. */}
          {selectedRow.kind === 'reasoning' ? (
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-fg">
              {selectedRow.content}
            </pre>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <span>回合 {selectedRow.turn} · 步驟 {selectedRow.step}</span>
            {selectedStep?.running ? (
              <span>執行中</span>
            ) : (
              <>
                {selectedStep?.waitingMs === undefined ? null : <span>等待首 token {formatMs(selectedStep.waitingMs)}</span>}
                {selectedStep?.generatingMs === undefined ? null : <span>產生 {formatMs(selectedStep.generatingMs)}</span>}
                {/* Per-step usage, so «哪一步最貴» has an answer. Each figure
                    appears only when the provider reported it: an absent cache
                    split or price is omitted, never shown as 0. */}
                {selectedStep?.usage?.total ? <span className="tabular-nums">{formatTokens(selectedStep.usage.total)} tokens</span> : null}
                {selectedStep?.usage?.input === undefined ? null : (
                  <span className="tabular-nums">輸入 {formatTokens(selectedStep.usage.input)}</span>
                )}
                {selectedStep?.usage?.output === undefined ? null : (
                  <span className="tabular-nums">輸出 {formatTokens(selectedStep.usage.output)}</span>
                )}
                {/* Each half is guarded on its own. A provider that reports
                    only reads must not have a 快取寫 0 invented for it — that
                    is a measurement nobody made, the exact thing this panel
                    exists to stop showing. */}
                {selectedStep?.usage?.cachedRead === undefined ? null : (
                  <span className="tabular-nums">快取讀 {formatTokens(selectedStep.usage.cachedRead)}</span>
                )}
                {selectedStep?.usage?.cachedWrite === undefined ? null : (
                  <span className="tabular-nums">快取寫 {formatTokens(selectedStep.usage.cachedWrite)}</span>
                )}
                {selectedStep?.usage?.costUsd === undefined ? null : (
                  <span className="tabular-nums">{formatUsd(selectedStep.usage.costUsd)}</span>
                )}
              </>
            )}
          </div>
        </footer>
      ) : null}
    </section>
  )
}
