import type { ContextUsage } from '../agent/contextUsageProjection'
import {
  CONTEXT_BREAKDOWN_ORDER,
  contextUsageActivityMicrocopy,
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
 * The line it holds — ADR-0048's principle that a component may not
 * manufacture what it did not observe, applied to numbers: only measured
 * values appear. A step still
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
 * Where the conversation's volume sits: one hue, four clearly separated values.
 *
 * Tonal rather than four colours, so the bar reads as one measured quantity
 * divided up rather than a row of unrelated swatches. The ladder runs from the
 * accent's emphasis ink down toward the inset, spread WIDE — a first pass used
 * narrow steps and the whole bar rendered as one flat colour, which is a chart
 * nobody can read. The floor stays well clear of the surface so even a 3%
 * sliver is visible, in both themes: `accent-ink` is the emphasis tone either
 * way, and mixing toward `inset` recedes either way, so the ladder keeps its
 * direction when the theme flips.
 *
 * Colour is tied to the CATEGORY, never to its rank, so 工具 looks the same
 * from run to run and the legend stays learnable.
 */
const BREAKDOWN_TONE: Record<string, string> = {
  tool: 'var(--color-accent-ink)',
  assistant: 'var(--color-accent)',
  reasoning: 'color-mix(in srgb, var(--color-accent) 68%, var(--color-inset))',
  user: 'color-mix(in srgb, var(--color-accent) 44%, var(--color-inset))',
}

function breakdownColor(key: string): string {
  return BREAKDOWN_TONE[key] ?? 'var(--color-accent)'
}

function BreakdownBar({ breakdown }: { breakdown: ContextUsage['breakdown'] }) {
  const segments = CONTEXT_BREAKDOWN_ORDER
    .map((item) => ({ ...item, share: breakdown[item.key] }))
    .filter((item) => item.share > 0)
  if (segments.length === 0) return null
  return (
    <div className="mt-3">
      {/* No track behind this one, deliberately. The ratio bar above measures
          against a maximum, so it has a track showing the headroom left. This
          bar is a whole divided up — there is no headroom to show, and a track
          would invite reading one as the other. The gaps say «分段», not
          «未填滿». */}
      <div className="flex h-1.5 gap-[3px]" role="presentation">
        {segments.map((segment, index) => (
          <div
            key={segment.key}
            style={{
              flexBasis: `${segment.share * 100}%`,
              // The last segment absorbs sub-pixel rounding so the row always
              // resolves exactly, never stopping a hair short of its end.
              flexGrow: index === segments.length - 1 ? 1 : 0,
              flexShrink: 1,
              minWidth: '3px',
              background: breakdownColor(segment.key),
            }}
            className="h-full rounded-full transition-[flex-basis] duration-500 motion-reduce:transition-none"
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

/**
 * Four parallel figures on one grid, so no value floats out of line.
 *
 * A field nobody reported shows an em dash rather than `0`: printing zero for
 * an unreported figure states a measurement this build never made. The row
 * still holds its slot, so the grid stays aligned instead of collapsing into
 * a ragged one — a missing value is shown as missing, not omitted.
 */
function TokenGrid({
  tokens,
  reported,
}: {
  tokens: ContextUsage['tokens']
  reported: ContextUsage['reported']
}) {
  const rows: Array<[string, number, boolean]> = [
    ['輸入', tokens.input, reported.input],
    ['輸出', tokens.output, reported.output],
    ['快取讀', tokens.cachedRead, reported.cachedRead],
    ['快取寫', tokens.cachedWrite, reported.cachedWrite],
  ]
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
      {rows.map(([label, value, isReported]) => (
        <div key={label} className="flex items-baseline justify-between gap-2">
          <dt className="text-[10px] text-ink-3">{label}</dt>
          <dd
            className={`font-[family-name:var(--font-mono)] text-[11px] tabular-nums ${isReported ? 'text-ink-2' : 'text-ink-3'}`}
            title={isReported ? undefined : 'provider 未回報這個欄位'}
          >
            {isReported ? formatTokens(value) : '—'}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function InstructionUsage({ instructions }: { instructions: NonNullable<ContextUsage['instructions']> }) {
  return (
    <div className="mt-3 bg-inset px-3 py-2 text-[10px] leading-relaxed text-ink-3">
      <p className="text-ink-2">指令 context · revision {instructions.revision} 已於本 run admission 凍結 · {instructions.deliveryMode}{instructions.exactSnapshot ? ' · exact snapshot' : ' · 未能證明 exact'}</p>
      <p className="mt-1">個人化 {formatTokens(instructions.personalizationBytes)} / {formatTokens(instructions.personalizationBudgetBytes ?? instructions.budgetBytes)} B · 專案 {formatTokens(instructions.projectInstructionBytes)} / {formatTokens(instructions.projectInstructionBudgetBytes ?? instructions.budgetBytes)} B</p>
      <p className="mt-1">共同預算 {formatTokens(instructions.totalBytes)} / {formatTokens(instructions.budgetBytes)} B · lower-authority 可用 {formatTokens(instructions.lowerAuthorityAvailableBytes ?? Math.max(0, instructions.budgetBytes - instructions.totalBytes))} B</p>
      <p className="mt-1 break-all">effective hash {instructions.hashAvailable ? instructions.effectiveHash.slice(0, 16) : 'unavailable'}</p>
      {instructions.limitationReason && <p className="mt-1">限制：{instructions.limitationReason}</p>}
      {instructions.sourceSummary.length > 0 && (
        <div className="mt-1">
          <p className="text-ink-2">來源摘要</p>
          <ul className="mt-0.5 list-disc pl-4">
            {instructions.sourceSummary.map((source) => (
              <li key={source.id} className="break-all [overflow-wrap:anywhere]">
                {source.scope}/{source.kind} · {source.status} · {source.bytes} B · hash {source.hashAvailable ? 'available' : 'unavailable'}{source.effectiveOrder === null ? '' : ` · order ${source.effectiveOrder}`}
                {source.path ? ` · ${source.path}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-1">執行期間的指令變更不會熱替換此 snapshot，將從下一個 run 生效。</p>
    </div>
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
  // A runner with no Turn Record gets only the scalar it actually reported.
  if (degraded) {
    return (
      <div>
        <p className="font-[family-name:var(--font-mono)] text-[13px] tabular-nums text-ink">
          {fallbackTokens && fallbackTokens > 0 ? `${formatTokens(fallbackTokens)} tokens` : '尚無用量資料'}
        </p>
        <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
          這個 runner 只回報總量，沒有輸入／輸出／快取的分解。
        </p>
      </div>
    )
  }

  // Exact token usage arrives at step settlement. Until then, keep the panel
  // visibly live with facts already present in the Turn Record; none of these
  // counts guesses token usage.
  if (usage.measuredSteps === 0) {
    return (
      <div>
        <p className="font-[family-name:var(--font-mono)] text-[13px] tabular-nums text-ink">
          {fallbackTokens && fallbackTokens > 0 ? `${formatTokens(fallbackTokens)} tokens` : '執行中'}
        </p>
        <BreakdownBar breakdown={usage.breakdown} />
        {usage.instructions && <InstructionUsage instructions={usage.instructions} />}
        <p className="mt-3 text-[10px] text-ink-3">
          {contextUsageActivityMicrocopy(usage)}
        </p>
        <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
          {usage.runningSteps > 0
            ? '即時活動持續更新；token 用量會在目前步驟結算後計入。'
            : 'provider 未回報用量分解，面板不代為推算。'}
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* Two different questions, two labelled rows, so neither figure can be
          read as the other: 用量 is what this run SPENT (summed over steps),
          上下文 is how full the model's window currently is (the last prompt).
          Both labels sit in one column so the numbers line up beside them. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="w-10 shrink-0 text-[10px] text-ink-3">用量</span>
            <span className="font-[family-name:var(--font-mono)] text-[13px] tabular-nums text-ink">
              {formatTokens(usage.tokens.total)}
              <span className="text-ink-3"> tokens</span>
              {usage.costUsd === undefined ? null : (
                <>
                  <span className="text-ink-3"> · </span>
                  {formatUsd(usage.costUsd)}
                </>
              )}
            </span>
          </div>
          {usage.contextTokens === undefined ? null : (
            <div className="flex items-baseline gap-2">
              <span className="w-10 shrink-0 text-[10px] text-ink-3">上下文</span>
              <span className="font-[family-name:var(--font-mono)] text-[11px] tabular-nums text-ink-2">
                {formatTokens(usage.contextTokens)}
                {usage.contextWindow === undefined ? (
                  <span className="font-[family-name:var(--font-inter)] text-[10px] text-ink-3">
                    {' '}tokens · context window 未知
                  </span>
                ) : (
                  <> / {formatTokens(usage.contextWindow)}</>
                )}
              </span>
            </div>
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

      <TokenGrid tokens={usage.tokens} reported={usage.reported} />

      {usage.instructions && <InstructionUsage instructions={usage.instructions} />}

      <BreakdownBar breakdown={usage.breakdown} />

      <p className="mt-3 text-[10px] text-ink-3">
        <span className="font-[family-name:var(--font-mono)] tabular-nums">
          {contextUsageActivityMicrocopy(usage)}
        </span>
      </p>

      {/* Every qualification the numbers need, stated rather than implied. */}
      {usage.runningSteps > 0 ? (
        <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
          {usage.runningSteps} 個步驟執行中，用量要等結算後才計入。
        </p>
      ) : null}
      <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
        分解比例為字元量估算，token、快取與成本為 provider 實測值，— 表示未回報。
      </p>
      {usage.partial ? (
        <p className="mt-1 text-[10px] leading-relaxed text-orange">
          尚有 {usage.unloadedBefore} 筆更早的記錄未載入，以上僅計已載入範圍。
        </p>
      ) : null}
    </div>
  )
}
