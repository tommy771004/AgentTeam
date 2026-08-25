import type { ContextUsage } from '../agent/contextUsageProjection'
import {
  CONTEXT_BREAKDOWN_ORDER,
  formatRatio,
  formatTokens,
  formatUsd,
} from '../agent/contextUsageView'

/**
 * 上下文 — what this run spent, and how full the model's context is.
 *
 * Every figure here comes from `projectContextUsage` and from nothing else, so
 * this panel, the feed header, `/cost` and the finished-run bubble cannot
 * disagree about one run. The component's whole job is presentation.
 *
 * The line it holds (ADR-0048): only measured values appear. A step still
 * running says so instead of contributing a guess, a model with no known
 * context window shows no percentage rather than one against a default, and a
 * provider that reported no cost shows no cost rather than US$0.00.
 */

/** Track and fill share a radius so the fill never changes shape as it grows. */
function RatioBar({ ratio }: { ratio: number }) {
  const width = Math.min(100, Math.max(0, ratio * 100))
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-inset" role="presentation">
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-500 motion-reduce:transition-none"
        style={{ width: `${width}%` }}
      />
    </div>
  )
}

/**
 * Where the conversation's volume sits, as one bar of tonal steps.
 *
 * Tonal rather than four colours: the segments are one accent mixed toward the
 * surface at descending strengths, so the bar reads as a single measured
 * quantity divided up rather than a row of unrelated swatches. Each step is
 * mixed with the inset it sits on, not faded to transparent, so the quietest
 * segment still has a value gap to stand on.
 */
const BREAKDOWN_STRENGTH: Record<string, number> = { tool: 100, assistant: 68, reasoning: 44, user: 26 }

function breakdownColor(key: string): string {
  return `color-mix(in srgb, var(--color-accent) ${BREAKDOWN_STRENGTH[key] ?? 40}%, var(--color-inset))`
}

function BreakdownBar({ breakdown }: { breakdown: ContextUsage['breakdown'] }) {
  const segments = CONTEXT_BREAKDOWN_ORDER
    .map((item) => ({ ...item, share: breakdown[item.key] }))
    .filter((item) => item.share > 0)
  if (segments.length === 0) return null
  return (
    <div className="mt-3">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-inset" role="presentation">
        {segments.map((segment) => (
          <div
            key={segment.key}
            style={{ width: `${segment.share * 100}%`, background: breakdownColor(segment.key) }}
            className="h-full transition-[width] duration-500 motion-reduce:transition-none"
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-3">
        {segments.map((segment) => (
          <span key={segment.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: breakdownColor(segment.key) }}
            />
            {segment.label}
            <span className="font-[family-name:var(--font-mono)] tabular-nums">
              {Math.round(segment.share * 100)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** Four parallel figures on one grid, so no value floats out of line. */
function TokenGrid({ tokens }: { tokens: ContextUsage['tokens'] }) {
  const rows: Array<[string, number]> = [
    ['輸入', tokens.input],
    ['輸出', tokens.output],
    ['快取讀', tokens.cachedRead],
    ['快取寫', tokens.cachedWrite],
  ]
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-2">
          <dt className="text-[10px] text-ink-3">{label}</dt>
          <dd className="font-[family-name:var(--font-mono)] text-[11px] tabular-nums text-ink-2">
            {formatTokens(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function ContextUsagePanel({
  usage,
  fallbackTokens,
  degraded,
}: {
  /**
   * The projection, computed by the caller.
   *
   * Taken as a prop rather than derived here so the section head's summary and
   * this body are literally the same object — one run cannot show two totals
   * because there is only ever one to show.
   */
  usage: ContextUsage
  /** The scalar an external CLI reports, used only when nothing was measured. */
  fallbackTokens?: number
  /** True for a runner that publishes no Turn Record at all. */
  degraded?: boolean
}) {
  // A runner with no record, or one whose provider never reported usage, gets
  // the scalar it actually has — and no breakdown invented around it.
  if (degraded || usage.measuredSteps === 0) {
    return (
      <div>
        <p className="font-[family-name:var(--font-mono)] text-[13px] tabular-nums text-ink">
          {fallbackTokens && fallbackTokens > 0 ? `${formatTokens(fallbackTokens)} tokens` : '尚無用量資料'}
        </p>
        <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
          {degraded
            ? '這個 runner 只回報總量，沒有輸入／輸出／快取的分解。'
            : usage.runningSteps > 0
              ? '第一個步驟尚未結束，用量要等步驟結算後才會出現。'
              : 'provider 未回報用量分解，面板不代為推算。'}
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-[family-name:var(--font-mono)] text-[13px] tabular-nums text-ink">
            {formatTokens(usage.tokens.total)}
            <span className="text-ink-3"> tokens</span>
            {usage.costUsd === undefined ? null : (
              <>
                <span className="text-ink-3"> · </span>
                {formatUsd(usage.costUsd)}
              </>
            )}
          </p>
          {usage.contextTokens === undefined ? null : (
            <p className="mt-1 text-[10px] text-ink-3">
              上下文 <span className="font-[family-name:var(--font-mono)] tabular-nums">{formatTokens(usage.contextTokens)}</span>
              {usage.contextWindow === undefined
                ? ' tokens（模型 context window 未知）'
                : <> / <span className="font-[family-name:var(--font-mono)] tabular-nums">{formatTokens(usage.contextWindow)}</span></>}
            </p>
          )}
        </div>
        {usage.ratio === undefined ? null : (
          <span className="shrink-0 font-[family-name:var(--font-mono)] text-[18px] font-semibold tabular-nums text-accent-ink">
            {formatRatio(usage.ratio)}
          </span>
        )}
      </div>

      {usage.ratio === undefined ? null : (
        <div className="mt-3">
          <RatioBar ratio={usage.ratio} />
        </div>
      )}

      <TokenGrid tokens={usage.tokens} />

      <BreakdownBar breakdown={usage.breakdown} />

      <p className="mt-3 text-[10px] text-ink-3">
        訊息 <span className="font-[family-name:var(--font-mono)] tabular-nums">{usage.messages.user + usage.messages.assistant}</span>
        {' · '}工具 <span className="font-[family-name:var(--font-mono)] tabular-nums">{usage.toolCalls}</span>
        {' · '}步驟 <span className="font-[family-name:var(--font-mono)] tabular-nums">{usage.steps}</span>
      </p>

      {/* Every qualification the numbers need, stated rather than implied. */}
      {usage.runningSteps > 0 ? (
        <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
          {usage.runningSteps} 個步驟執行中，用量要等結算後才計入。
        </p>
      ) : null}
      <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
        分解比例依各類記錄的字元量估算；token、快取與成本皆為 provider 實測值。
      </p>
      {usage.partial ? (
        <p className="mt-1 text-[10px] leading-relaxed text-orange">
          尚有 {usage.unloadedBefore} 筆更早的記錄未載入，以上僅計已載入範圍。
        </p>
      ) : null}
    </div>
  )
}
