/**
 * What one Pi step spent, reduced from the messages Pi reports for it.
 *
 * Pi measures usage per assistant message and prices it from its own model
 * catalog. One step can produce SEVERAL such messages — every model call the
 * agent made while working through its tools — so turning them into one step's
 * usage is a real reduction with two rules that are easy to get wrong:
 *
 *  - A field is summed only over the messages that actually reported it, and
 *    written only if at least one did. A provider that never mentions caching
 *    must record no cache rather than a measured 0: the panel renders those
 *    two differently and only one of them is true.
 *  - `contextTokens` is the LAST message's prompt, never the sum. The sum
 *    answers «這一步買了多少 token»; only the last call's prompt answers «模型
 *    現在握著多滿的 context», which is what a ratio against the window means.
 *    An earlier build summed them, and every tool-looping turn then reported a
 *    context several times fuller than the model actually held.
 *
 * Lives in `src/agent/` rather than beside the runtime so it is pure and
 * importable — the rule above is a claim a test can check, not one a reader
 * has to take on trust.
 */
import type { RecordedUsage } from './turnRecord.ts'

/** The subset of a Pi assistant message this reduction reads. */
export type PiReportedMessage = {
  usage?: {
    input?: unknown
    output?: unknown
    totalTokens?: unknown
    cacheRead?: unknown
    cacheWrite?: unknown
    cost?: { total?: unknown }
  }
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Reduce a step's messages to one recorded usage, or `undefined`.
 *
 * `undefined` means the step spent nothing measurable — no tokens were
 * reported at all — and a step with no usage records no usage.
 */
export function reducePiStepUsage(messages: readonly PiReportedMessage[]): RecordedUsage | undefined {
  const totals: Partial<Record<keyof RecordedUsage, number>> = {}
  const add = (field: keyof RecordedUsage, value: number | undefined) => {
    if (value === undefined) return
    totals[field] = (totals[field] ?? 0) + value
  }
  let contextTokens: number | undefined

  for (const message of messages) {
    const reported = message?.usage
    if (!reported || typeof reported !== 'object') continue
    add('input', num(reported.input))
    add('output', num(reported.output))
    add('total', num(reported.totalTokens))
    add('cachedRead', num(reported.cacheRead))
    add('cachedWrite', num(reported.cacheWrite))
    add('costUsd', num(reported.cost?.total))
    const prompt = num(reported.input)
    if (prompt !== undefined) {
      contextTokens = prompt + (num(reported.cacheRead) ?? 0) + (num(reported.cacheWrite) ?? 0)
    }
  }

  const spent = (totals.total ?? 0) > 0 || (totals.input ?? 0) > 0 || (totals.output ?? 0) > 0
  if (!spent) return undefined

  return {
    ...(totals.input === undefined ? {} : { input: totals.input }),
    ...(totals.output === undefined ? {} : { output: totals.output }),
    ...(totals.total === undefined ? {} : { total: totals.total }),
    ...(totals.cachedRead === undefined ? {} : { cachedRead: totals.cachedRead }),
    ...(totals.cachedWrite === undefined ? {} : { cachedWrite: totals.cachedWrite }),
    // Pi computes cost from catalog rates that are 0 for a model it has no
    // price for, so a 0 total cannot tell «免費» from «沒有定價». Only a
    // positive figure means what a panel would say it means; anything else is
    // left to the user's own stated rates downstream.
    ...((totals.costUsd ?? 0) > 0 ? { costUsd: totals.costUsd } : {}),
    ...(contextTokens === undefined ? {} : { contextTokens }),
  }
}
