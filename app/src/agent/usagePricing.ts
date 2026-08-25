/**
 * What one step's measured tokens cost, priced by rates somebody stated.
 *
 * The Pi Host path does not come here: Pi prices every message from its own
 * model catalog and the Host records that number. This is the direct
 * OpenAI-compatible path's answer to the same question, and it holds the same
 * line — a cost appears only when the rates were actually known.
 *
 * The rule the whole effect rests on: absent is not zero. A model with no
 * stated pricing yields `undefined`, never `0`, because 「這個模型沒填價格」
 * and 「這一步是免費的」 are different facts and a panel that renders them the
 * same way is lying. No price list is built in here, and none is guessed.
 *
 * Leaf module by design — no I/O, no store, no clock — so the transport, the
 * capture path and any smoke can all import it.
 */
import type { ModelPricing } from './types.ts'
import type { RecordedUsage } from './turnRecord.ts'

/**
 * Token counts as a provider reported them.
 *
 * Deliberately the record's own `RecordedUsage` rather than a parallel
 * definition: the capture side and the recorded side are one shape, so the
 * projection downstream never has to branch on which path measured it.
 */
export type MeasuredUsage = RecordedUsage

const PER_MILLION = 1_000_000

function rate(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function tokens(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Price measured tokens, or return `undefined`.
 *
 * `undefined` comes back whenever the answer would be invented: no pricing at
 * all, no rate that applies to anything this step actually spent, or a step
 * that measured no tokens. A priced step that genuinely costs 0 — every rate
 * stated as 0 — is not reachable, because a 0 rate is not a rate here; that is
 * the deliberate trade for never showing a fabricated number.
 */
export function computeUsageCostUsd(
  usage: MeasuredUsage | undefined,
  pricing: ModelPricing | undefined,
): number | undefined {
  if (!usage || !pricing) return undefined
  // Cache reads and writes are billed apart from ordinary input, so each is
  // priced by its own rate and only when that rate was stated.
  const parts: Array<[number, number | undefined]> = [
    [tokens(usage.input), rate(pricing.input)],
    [tokens(usage.output), rate(pricing.output)],
    [tokens(usage.cachedRead), rate(pricing.cacheRead)],
    [tokens(usage.cachedWrite), rate(pricing.cacheWrite)],
  ]
  let total = 0
  let priced = false
  for (const [count, perMillion] of parts) {
    if (count <= 0 || perMillion === undefined) continue
    total += (count * perMillion) / PER_MILLION
    priced = true
  }
  return priced ? total : undefined
}

/**
 * A recordable `timing.usage` from what a transport reported.
 *
 * Only fields the provider actually reported survive, so the record keeps the
 * distinction between «回報了 0» and «沒有回報». Returns `undefined` when
 * nothing was measured at all — a step with no usage records no usage.
 */
export function buildRecordedUsage(
  usage: MeasuredUsage | undefined,
  pricing?: ModelPricing,
): MeasuredUsage | undefined {
  if (!usage) return undefined
  const keep = (value: number | undefined): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
  const built: MeasuredUsage = {}
  for (const field of ['input', 'output', 'total', 'cachedRead', 'cachedWrite'] as const) {
    const value = keep(usage[field])
    if (value !== undefined) built[field] = value
  }
  if (Object.keys(built).length === 0) return undefined
  const costUsd = usage.costUsd !== undefined && Number.isFinite(usage.costUsd) && usage.costUsd > 0
    ? usage.costUsd
    : computeUsageCostUsd(built, pricing)
  return costUsd === undefined ? built : { ...built, costUsd }
}
