/**
 * One vocabulary for presenting what a run spent.
 *
 * The panel, the process-feed microcopy, `/cost` and the finished-run bubble
 * all show the same figures, so they read them the same way and format them
 * the same way here. A second place that rounded differently, or resolved a
 * context window differently, would let two surfaces of one run disagree —
 * which is the exact failure the Turn Record exists to make impossible.
 *
 * Pure: no store, no clock, no I/O. Callers pass what they know.
 */
import type { ContextUsage } from './contextUsageProjection.ts'
import type { LlmSettings } from './types.ts'

/**
 * The model's context window, or nothing.
 *
 * Only a window somebody actually established counts — a verified or assumed
 * `ModelProfile.contextWindow`. `settings.defaultContextWindowTokens` is
 * deliberately NOT consulted: it ships as 64,000 for everyone, so it is a
 * conservative floor for the compaction gate, not knowledge about this model.
 * Rendering a percentage against it would put a confident, wrong number on
 * screen — and a missing ratio is the honest answer to a window nobody knows.
 */
export function resolveKnownContextWindow(
  settings: Pick<LlmSettings, 'modelProfiles' | 'model'> | undefined,
  modelId?: string,
): number | undefined {
  const id = (modelId || settings?.model || '').trim()
  if (!id) return undefined
  const window = settings?.modelProfiles?.[id]?.contextWindow
  return typeof window === 'number' && Number.isFinite(window) && window > 0 ? window : undefined
}

/** `73,166` — full precision, for a figure the reader may compare exactly. */
export function formatTokens(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

/** `73.2k` — for a glance, where the exact digit does not change a decision. */
export function formatTokensCompact(value: number): string {
  const rounded = Math.round(value)
  if (rounded < 10_000) return rounded.toLocaleString('en-US')
  if (rounded < 1_000_000) return `${(rounded / 1_000).toFixed(1)}k`
  return `${(rounded / 1_000_000).toFixed(2)}M`
}

/** `7%` — whole percent, because a tenth of a context window is not a decision. */
export function formatRatio(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/**
 * `US$0.0124` — enough places that a real cost never rounds away to `US$0.00`.
 *
 * A run that genuinely cost a hundredth of a cent must not render as free;
 * showing zero for a nonzero charge is the same lie as inventing one.
 */
export function formatUsd(value: number): string {
  if (value >= 1) return `US$${value.toFixed(2)}`
  if (value >= 0.01) return `US$${value.toFixed(3)}`
  return `US$${value.toFixed(4)}`
}

/**
 * `本次執行累積 73.2k tok (7%)` — the one microcopy, for every surface that shows one.
 *
 * Returns an empty string when nothing was measured, which is how a runner
 * that reports no usage shows no figure instead of a fabricated one. Lives
 * here because two surfaces rendered it with different separators before, and
 * one run reading two ways in two places is exactly what one projection is
 * supposed to make impossible.
 */
export function contextUsageMicrocopy(usage: ContextUsage): string {
  if (usage.measuredSteps === 0) return ''
  const total = `本次執行累積 ${formatTokensCompact(usage.tokens.total)} tok`
  return usage.ratio === undefined ? total : `${total} (${formatRatio(usage.ratio)})`
}

/** Live facts that exist before a provider has settled the first token bill. */
export function contextUsageActivityMicrocopy(usage: ContextUsage): string {
  const messages = usage.messages.user + usage.messages.assistant
  return `訊息 ${messages} · 工具 ${usage.toolCalls} · 步驟 ${usage.steps}`
}

/**
 * `/cost`'s lines, built from the projection so the composer and the panel
 * cannot drift. A figure nobody measured contributes no line at all — an
 * omitted row reads as «沒有這筆資料», where a `0` would read as a measurement.
 */
export function contextUsageReportLines(usage: ContextUsage): string[] {
  const lines: string[] = []
  const total = `本次執行累積 Tokens：${formatTokens(usage.tokens.total)}`
  lines.push(
    usage.contextTokens !== undefined && usage.contextWindow !== undefined && usage.ratio !== undefined
      ? `${total} · 上下文 ${formatTokens(usage.contextTokens)}/${formatTokens(usage.contextWindow)}（${formatRatio(usage.ratio)}）`
      : total,
  )
  // A field the provider never reported is left out entirely. Printing
  // `快取讀 0` would put a measurement on screen that nobody made.
  const split = [
    usage.reported.input ? `輸入 ${formatTokens(usage.tokens.input)}` : '',
    usage.reported.output ? `輸出 ${formatTokens(usage.tokens.output)}` : '',
    usage.reported.cachedRead ? `快取讀 ${formatTokens(usage.tokens.cachedRead)}` : '',
    usage.reported.cachedWrite ? `快取寫 ${formatTokens(usage.tokens.cachedWrite)}` : '',
  ].filter(Boolean)
  if (split.length > 0) lines.push(split.join(' · '))
  if (usage.costUsd !== undefined) lines.push(`成本：${formatUsd(usage.costUsd)}`)
  lines.push(`步驟：${usage.steps} · 工具呼叫：${usage.toolCalls} · 訊息：${usage.messages.assistant}`)
  if (usage.runningSteps > 0) {
    lines.push(`${usage.runningSteps} 個步驟執行中，尚未計入本次執行累積用量。`)
  }
  if (usage.partial) {
    lines.push(`尚有 ${usage.unloadedBefore} 筆更早的記錄未載入，以上為已載入範圍。`)
  }
  return lines
}

/** The four estimated shares, in the order the panel renders them. */
export const CONTEXT_BREAKDOWN_ORDER = [
  { key: 'tool', label: '工具' },
  { key: 'assistant', label: '助理' },
  { key: 'reasoning', label: '推理' },
  { key: 'user', label: '使用者' },
] as const satisfies ReadonlyArray<{ key: keyof ContextUsage['breakdown']; label: string }>
