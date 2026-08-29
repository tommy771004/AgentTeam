/**
 * What a run spent, and how full its context is — derived from the Turn Record.
 *
 * One pure function from what the Host recorded to the numbers a usage panel
 * shows. It exists because the only figures the product could offer were a
 * scalar `tokensUsed` and a corner line reading `tokens N · Nms`: no split, no
 * cache, no cost, no ratio. The values were measured at every step and thrown
 * away at the reducer, so «這個 run 為什麼燒了這麼多 token» had no answer an
 * hour later.
 *
 * Pure by contract — no I/O, no store reads, no clock, no randomness — because
 * it runs on live turns and replayed records alike, and the live panel and the
 * replayed one must not be able to disagree. Ordering comes from `seq` and from
 * nothing else.
 *
 * The rule underneath every field — the same one ADR-0048 holds for execution
 * evidence, applied to measurement: what was measured is reported,
 * and what was not is ABSENT. Never a 0 standing in for an unreported figure,
 * never a ratio against a guessed window, never a token count for a step that
 * has not finished.
 */
import { stepTimings, turnRecordEntries, type RecordedUsage, type TurnRecord } from './turnRecord.ts'
import { computeUsageCostUsd } from './usagePricing.ts'
import type { ModelPricing } from './types.ts'
import { instructionDeliveryEvidence } from './instructionSnapshot.ts'

/**
 * Estimated shares of the conversation's volume, by who produced it.
 *
 * These are the one deliberately INEXACT numbers here, and they are inexact by
 * necessity: a provider bills a step, not a message, so no measurement exists
 * at this granularity. They are character-volume proportions, they always sum
 * to 1 (or are all 0 when there is nothing to divide), and they are only ever
 * for showing which part of a conversation dominates — never for token counts,
 * which come from measurement alone. Any surface rendering them must say so.
 */
export type ContextUsageBreakdown = {
  assistant: number
  tool: number
  user: number
  reasoning: number
}

export type ContextUsage = {
  /** Steps the record started. */
  steps: number
  /** Steps started and not yet ended. They contribute no tokens (ADR-0048). */
  runningSteps: number
  /** Steps that reported usage. Zero means nothing was measured at all. */
  measuredSteps: number
  messages: { user: number; assistant: number }
  /** Distinct invocations, counted by `callId` so a re-recorded call is one. */
  toolCalls: number
  /**
   * The run's cumulative SPEND. Every field is a sum over measured steps, so
   * `input` counts the prompt once per step — which is what the run paid for,
   * and deliberately not what the model is currently holding.
   */
  tokens: { input: number; output: number; cachedRead: number; cachedWrite: number; total: number }
  /**
   * Which of those sums any step actually reported.
   *
   * A sum of 0 is ambiguous on its own — «provider 說快取省了 0» and «這個
   * provider 根本不談快取» add up to the same number, and a surface that
   * printed `快取讀 0` for the second would be stating a measurement nobody
   * made. A false here means: show no figure, not a zero.
   */
  reported: { input: boolean; output: boolean; cachedRead: boolean; cachedWrite: boolean }
  /** Summed from steps that were priced. Absent when none were. */
  costUsd?: number
  breakdown: ContextUsageBreakdown
  /** Exact Host-recorded instruction slots for this run, absent on legacy/external records. */
  instructions?: {
    personalizationBytes: number
    personalizationBudgetBytes?: number
    projectInstructionBytes: number
    projectInstructionBudgetBytes?: number
    totalBytes: number
    budgetBytes: number
    lowerAuthorityAvailableBytes?: number
    revision: number
    effectiveHash: string
    deliveryMode: 'explicit' | 'native' | 'unverified'
    exactSnapshot: boolean
    hashAvailable: boolean
    sourceSummary: ReturnType<typeof instructionDeliveryEvidence>['sourceSummary']
    limitationReason?: string
  }
  /**
   * How full the context actually is: the prompt the most recent MEASURED step
   * sent, cache included.
   *
   * Kept apart from `tokens.input` on purpose. The question a ratio bar answers
   * is «離壓縮還有多遠», and cumulative spend cannot answer it — summing every
   * step's prompt counts one conversation once per step and would report a
   * context several times fuller than the one the model holds. Absent when no
   * step reported a prompt size.
   */
  contextTokens?: number
  /**
   * Only when genuinely known; never a default standing in for knowledge.
   *
   * Preference order: the window the record itself carries for the last
   * measured step (the model catalog's own figure for the model that ran),
   * then whatever the caller could establish. A conversation that switched
   * models is therefore measured against the model that actually ran.
   */
  contextWindow?: number
  /** `contextTokens / contextWindow`, and only when both are known. */
  ratio?: number
  /** The newest entry's timestamp; 0 for an empty record. */
  lastActivityAt: number
  /** Entries ahead of this view that the caller has not loaded. */
  unloadedBefore: number
  /** True when this view is missing a prefix, so it can say so rather than undercount. */
  partial: boolean
}

export type ContextUsageOptions = {
  /**
   * A window the caller could establish, used only when the record carries
   * none of its own. Pass nothing rather than a default: an absent window
   * yields no ratio, which is the honest answer to a window nobody knows.
   */
  contextWindow?: number
  /**
   * Rates the user stated for this model, used ONLY to price steps whose
   * recorder could not. On the Pi path the catalog usually prices the run and
   * this is never consulted; where the catalog has no price for a model, this
   * is the only thing that can answer «這個 run 花了多少錢». Absent rates
   * still mean no cost — never a zero.
   */
  pricing?: ModelPricing
  /** Entries older than this view, when it is a bounded window onto a longer record. */
  unloadedBefore?: number
}

const EMPTY_BREAKDOWN: ContextUsageBreakdown = { assistant: 0, tool: 0, user: 0, reasoning: 0 }

/** A number a provider actually reported; anything else is not a measurement. */
function measured(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * One step's total.
 *
 * A provider that reports a total is believed. One that reports only the two
 * halves gets them added — arithmetic over measured values, not a guess — so a
 * provider's choice of shape never reads as a run that spent nothing.
 */
function stepTotal(usage: RecordedUsage): number {
  const total = measured(usage.total)
  if (total !== undefined) return total
  const input = measured(usage.input)
  const output = measured(usage.output)
  if (input === undefined && output === undefined) return 0
  return (input ?? 0) + (output ?? 0)
}

/**
 * How full the context was after this step, cache included.
 *
 * The recorder's own `contextTokens` is preferred because it is the LAST model
 * call's prompt, which is the only figure that answers «模型現在握著多滿的
 * context». Falling back to `input + cache` is a knowingly generous estimate:
 * one step can make several model calls and those fields sum all of them, so
 * on a tool-looping turn the fallback over-reports. Records written before the
 * recorder measured this take the fallback; new ones do not.
 */
function stepPrompt(usage: RecordedUsage): number | undefined {
  const recorded = measured(usage.contextTokens)
  if (recorded !== undefined) return recorded
  const input = measured(usage.input)
  const cachedRead = measured(usage.cachedRead)
  const cachedWrite = measured(usage.cachedWrite)
  if (input === undefined && cachedRead === undefined && cachedWrite === undefined) return undefined
  return (input ?? 0) + (cachedRead ?? 0) + (cachedWrite ?? 0)
}

/** Character volume an entry contributes, by whose volume it is. */
function volumeOf(entry: ReturnType<typeof turnRecordEntries>[number]): { key: keyof ContextUsageBreakdown; chars: number } | undefined {
  switch (entry.kind) {
    case 'user-text':
      return { key: 'user', chars: entry.content.length }
    case 'assistant-text':
      return { key: 'assistant', chars: entry.content.length }
    case 'reasoning':
      return { key: 'reasoning', chars: entry.content.length }
    case 'tool-call':
      // The arguments are what the model actually spent context writing; a
      // shape this build cannot serialize contributes only the name it knows.
      return { key: 'tool', chars: entry.tool.length + safeArgLength(entry.args) }
    case 'tool-result':
      return { key: 'tool', chars: entry.tool.length + (entry.detail?.length ?? 0) }
    default:
      return undefined
  }
}

function safeArgLength(args: unknown): number {
  if (args === undefined || args === null) return 0
  if (typeof args === 'string') return args.length
  try {
    return JSON.stringify(args)?.length ?? 0
  } catch {
    // A circular or unserializable argument still happened; it simply cannot
    // be sized, and an unsizable entry contributes nothing to a proportion.
    return 0
  }
}

function instructionUsageOf(entry: ReturnType<typeof turnRecordEntries>[number]): ContextUsage['instructions'] {
  if (entry.kind !== 'instruction-snapshot') return undefined
  const evidence = instructionDeliveryEvidence(entry.snapshot)
  return {
    ...entry.snapshot.usage,
    revision: entry.snapshot.revision,
    effectiveHash: entry.snapshot.effectiveHash,
    deliveryMode: entry.snapshot.deliveryMode,
    exactSnapshot: entry.snapshot.exactSnapshot,
    hashAvailable: evidence.hashAvailable,
    sourceSummary: evidence.sourceSummary,
    ...(evidence.limitationReason ? { limitationReason: evidence.limitationReason } : {}),
  }
}

function retainInstructionUsage(
  holder: { value: ContextUsage['instructions'] },
  entry: ReturnType<typeof turnRecordEntries>[number],
): void {
  const observed = instructionUsageOf(entry)
  if (observed) holder.value = observed
}

export function projectContextUsage(
  record: TurnRecord | undefined,
  options: ContextUsageOptions = {},
): ContextUsage {
  const entries = turnRecordEntries(record)

  let user = 0
  let assistant = 0
  const callIds = new Set<string>()
  const chars: ContextUsageBreakdown = { ...EMPTY_BREAKDOWN }
  let lastActivityAt = 0
  const instructionUsage = { value: undefined as ContextUsage['instructions'] }

  for (const entry of entries) {
    if (entry.at > lastActivityAt) lastActivityAt = entry.at
    if (entry.kind === 'user-text') user += 1
    if (entry.kind === 'assistant-text') assistant += 1
    if (entry.kind === 'tool-call') callIds.add(entry.callId)
    retainInstructionUsage(instructionUsage, entry)
    const volume = volumeOf(entry)
    if (volume) chars[volume.key] += volume.chars
  }

  // Tokens come from `stepTimings` and nowhere else: it is the one reader that
  // already knows a step still running has no measurement to give.
  const steps = stepTimings(record)
  const tokens = { input: 0, output: 0, cachedRead: 0, cachedWrite: 0, total: 0 }
  const reported = { input: false, output: false, cachedRead: false, cachedWrite: false }
  let runningSteps = 0
  let measuredSteps = 0
  let costUsd: number | undefined
  let contextTokens: number | undefined
  let recordedWindow: number | undefined

  for (const step of steps) {
    if (step.running) {
      runningSteps += 1
      continue
    }
    const usage = step.usage
    if (!usage) continue
    // A step counts as measured when the provider reported ANY figure for it —
    // including a cache-only report, and including a genuine zero. Testing the
    // sums instead would silently drop a step whose only reported number was 0,
    // which is a measurement, and one that reported cache but no totals.
    const anyReported = (['input', 'output', 'total', 'cachedRead', 'cachedWrite'] as const)
      .some((field) => measured(usage[field]) !== undefined)
    if (!anyReported) continue
    const total = stepTotal(usage)
    const input = measured(usage.input) ?? 0
    const output = measured(usage.output) ?? 0
    measuredSteps += 1
    tokens.input += input
    tokens.output += output
    tokens.cachedRead += measured(usage.cachedRead) ?? 0
    tokens.cachedWrite += measured(usage.cachedWrite) ?? 0
    tokens.total += total
    for (const field of ['input', 'output', 'cachedRead', 'cachedWrite'] as const) {
      if (measured(usage[field]) !== undefined) reported[field] = true
    }
    // The recorder prices the step when it can. When it could not, the user's
    // own rates are the only thing that can — and if there are none, the step
    // contributes no cost rather than a zero.
    const cost = measured(usage.costUsd) ?? computeUsageCostUsd(usage, options.pricing)
    if (cost !== undefined) costUsd = (costUsd ?? 0) + cost
    // Steps arrive oldest-first, so the last one that measured a prompt wins.
    const prompt = stepPrompt(usage)
    if (prompt !== undefined) contextTokens = prompt
    if (step.contextWindow && step.contextWindow > 0) recordedWindow = step.contextWindow
  }

  const totalChars = chars.assistant + chars.tool + chars.user + chars.reasoning
  const breakdown: ContextUsageBreakdown = totalChars > 0
    ? {
        assistant: chars.assistant / totalChars,
        tool: chars.tool / totalChars,
        user: chars.user / totalChars,
        reasoning: chars.reasoning / totalChars,
      }
    : { ...EMPTY_BREAKDOWN }

  // The record's own figure wins: it is the catalog's window for the model
  // that actually served the last measured step, and it replays unchanged.
  const givenWindow = typeof options.contextWindow === 'number'
    && Number.isFinite(options.contextWindow)
    && options.contextWindow > 0
    ? options.contextWindow
    : undefined
  const contextWindow = recordedWindow ?? givenWindow
  const unloadedBefore = typeof options.unloadedBefore === 'number'
    && Number.isFinite(options.unloadedBefore)
    && options.unloadedBefore > 0
    ? Math.floor(options.unloadedBefore)
    : 0

  return {
    steps: steps.length,
    runningSteps,
    measuredSteps,
    messages: { user, assistant },
    toolCalls: callIds.size,
    tokens,
    reported,
    ...(costUsd === undefined ? {} : { costUsd }),
    breakdown,
    instructions: instructionUsage.value,
    ...(contextTokens === undefined ? {} : { contextTokens }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(contextWindow === undefined || contextTokens === undefined
      ? {}
      : { ratio: contextTokens / contextWindow }),
    lastActivityAt,
    unloadedBefore,
    partial: unloadedBefore > 0,
  }
}
