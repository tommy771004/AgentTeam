import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { appendTurnRecord, parseTurnRecord, type TurnRecordAppend } from '../src/agent/turnRecord.ts'
import { projectContextUsage } from '../src/agent/contextUsageProjection.ts'
import { computeUsageCostUsd } from '../src/agent/usagePricing.ts'

/**
 * What a run actually spent, derived from the Turn Record and nothing else.
 *
 * Before this, the only visible figure was one scalar and a corner line reading
 * `tokens N · Nms`. The cache split and the cost were measured by the Host at
 * every step and discarded one line before they were recorded, so nobody could
 * answer «這個 run 為什麼燒了這麼多 token».
 *
 * The rules asserted here are all the same rule (ADR-0048): the panel shows
 * MEASURED values. A step still running contributes no guessed tokens. A model
 * with no known context window gets no ratio rather than a ratio off a default.
 * A provider that reported no cost yields no cost rather than US$0.00. And a
 * record written before these fields existed projects EXACTLY as it did then.
 */

// ── A two-step run that measured everything ────────────────────────────────
function step(
  index: number,
  usage: { input: number; output: number; total: number; cachedRead?: number; cachedWrite?: number; costUsd?: number },
  extras: TurnRecordAppend[] = [],
): TurnRecordAppend[] {
  return [
    { kind: 'step-start', source: 'host', turn: 1, step: index, at: index * 10 },
    ...extras,
    {
      kind: 'step-end',
      source: 'host',
      turn: 1,
      step: index,
      at: index * 10 + 9,
      timing: { requestAt: index * 10, firstTokenAt: index * 10 + 2, completedAt: index * 10 + 9, usage },
    },
  ]
}

let record = appendTurnRecord(undefined, [{ kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 0 }])
record = appendTurnRecord(record, [
  ...step(
    1,
    { input: 4_000, output: 200, total: 4_200, cachedRead: 3_000, cachedWrite: 500, costUsd: 0.012 },
    [
      { kind: 'user-text', source: 'user', content: 'x'.repeat(400), turn: 1, step: 1, at: 1 },
      { kind: 'reasoning', source: 'model', content: 'r'.repeat(200), turn: 1, step: 1, at: 2 },
      { kind: 'tool-call', source: 'model', tool: 'grep', callId: 'c1', args: { pattern: 'p' }, turn: 1, step: 1, at: 3 },
      { kind: 'tool-result', source: 'host', tool: 'grep', callId: 'c1', settlement: 'success', detail: 'd'.repeat(1_000), turn: 1, step: 1, at: 4 },
    ],
  ),
  ...step(
    2,
    { input: 6_000, output: 300, total: 6_300, cachedRead: 5_000, cachedWrite: 0, costUsd: 0.018 },
    [
      { kind: 'tool-call', source: 'model', tool: 'read', callId: 'c2', args: { path: '/a.ts' }, turn: 1, step: 2, at: 21 },
      { kind: 'tool-result', source: 'host', tool: 'read', callId: 'c2', settlement: 'success', detail: 'e'.repeat(400), turn: 1, step: 2, at: 22 },
      { kind: 'assistant-text', source: 'model', content: 'a'.repeat(600), turn: 1, step: 2, at: 23 },
    ],
  ),
  { kind: 'turn-end', source: 'host', settlement: 'answered', turn: 1, step: 2, at: 30 },
])

const full = projectContextUsage(record, { contextWindow: 200_000 })

// Totals are the sum of what the steps measured, and nothing else.
assert.equal(full.tokens.input, 10_000)
assert.equal(full.tokens.output, 500)
assert.equal(full.tokens.cachedRead, 8_000)
assert.equal(full.tokens.cachedWrite, 500)
assert.equal(full.tokens.total, 10_500)
assert.ok(Math.abs((full.costUsd ?? 0) - 0.03) < 1e-9, 'cost is the sum of what the provider priced')

// Counts relate spend to the work that produced it.
assert.equal(full.steps, 2)
assert.equal(full.measuredSteps, 2)
assert.equal(full.runningSteps, 0)
assert.equal(full.toolCalls, 2)
assert.deepEqual(full.messages, { user: 1, assistant: 1 })
assert.equal(full.lastActivityAt, 30, 'the last activity is the newest entry, by seq')

/*
 * The ratio answers «離壓縮還有多遠», so it is the size of the prompt the most
 * recent measured step ACTUALLY sent — not the run's cumulative spend. Summing
 * every step's prompt counts the same conversation once per step, which on any
 * multi-step run reports a context far fuller than the one the model is
 * holding. Spend and fullness are different questions and get different fields.
 */
assert.equal(full.contextTokens, 11_000, 'context fullness is the last measured prompt: input + cache')
assert.ok(Math.abs((full.ratio ?? 0) - 11_000 / 200_000) < 1e-12)

// The breakdown is an ESTIMATE by character volume, and says so by summing to 1.
const shares = Object.values(full.breakdown)
assert.ok(Math.abs(shares.reduce((sum, value) => sum + value, 0) - 1) < 1e-9, 'shares are proportions of one whole')
assert.ok(full.breakdown.tool > full.breakdown.assistant, 'tool traffic dominates this record')
assert.ok(full.breakdown.reasoning > 0 && full.breakdown.user > 0)

// ── A step still running never contributes a guessed number ────────────────
let live = appendTurnRecord(undefined, [{ kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 0 }])
live = appendTurnRecord(live, [
  ...step(1, { input: 4_000, output: 200, total: 4_200 }),
  { kind: 'step-start', source: 'host', turn: 1, step: 2, at: 20 },
  { kind: 'assistant-text', source: 'model', content: 'partial', turn: 1, step: 2, at: 21 },
])
const running = projectContextUsage(live, { contextWindow: 100_000 })
assert.equal(running.steps, 2)
assert.equal(running.runningSteps, 1, 'the unfinished step reads as running')
assert.equal(running.measuredSteps, 1, 'and contributes no measurement')
assert.equal(running.tokens.total, 4_200, 'an unmeasured step adds no tokens')
assert.equal(running.contextTokens, 4_000, 'fullness comes from the last MEASURED step')

// ── Absent is not zero ─────────────────────────────────────────────────────
let unpriced = appendTurnRecord(undefined, [{ kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 0 }])
unpriced = appendTurnRecord(unpriced, step(1, { input: 100, output: 10, total: 110 }))
const noCost = projectContextUsage(unpriced, { contextWindow: 32_000 })
assert.equal(noCost.costUsd, undefined, 'no reported cost yields no cost, never US$0.00')
assert.equal(noCost.tokens.cachedRead, 0)
assert.equal(noCost.tokens.cachedWrite, 0)

// An unknown context window yields NO ratio rather than one off a default.
const noWindow = projectContextUsage(unpriced, {})
assert.equal(noWindow.contextWindow, undefined)
assert.equal(noWindow.ratio, undefined, 'a ratio off a guessed window would mislead')
assert.equal(noWindow.tokens.total, 110, 'everything else still projects')
// A window given as zero or nonsense is not a window.
assert.equal(projectContextUsage(unpriced, { contextWindow: 0 }).ratio, undefined)

// ── A runner that records no timings degrades honestly ─────────────────────
let external = appendTurnRecord(undefined, [
  { kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 0, runner: 'claude-code', capabilities: { parse: false, validateDoD: false, iterate: false } },
])
external = appendTurnRecord(external, [
  { kind: 'step-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'user-text', source: 'user', content: 'go', turn: 1, step: 1, at: 2 },
  { kind: 'assistant-text', source: 'model', content: 'done', turn: 1, step: 1, at: 3 },
  { kind: 'step-end', source: 'host', turn: 1, step: 1, at: 4 },
])
const cli = projectContextUsage(external, { contextWindow: 200_000 })
assert.equal(cli.measuredSteps, 0, 'no step reported usage')
assert.equal(cli.tokens.total, 0)
assert.equal(cli.contextTokens, undefined, 'nothing measured means nothing to report')
assert.equal(cli.ratio, undefined, 'and no ratio, even though the window is known')
assert.equal(cli.messages.assistant, 1, 'the countable facts are still counted')

// ── An unloaded prefix is declared, never quietly omitted ──────────────────
const partial = projectContextUsage(record, { contextWindow: 200_000, unloadedBefore: 40 })
assert.equal(partial.unloadedBefore, 40)
assert.equal(partial.partial, true, 'a view missing a prefix must be able to say so')
assert.equal(projectContextUsage(record, { contextWindow: 200_000 }).partial, false)

// ── Backward compatibility: an older record projects EXACTLY as before ─────
// The same run, written by a build that had only input/output/total. Every
// field the old build could produce must come back identical; the new ones
// must read as absent rather than as zero-valued measurements.
const legacyEntries = record.entries.map((entry) => {
  if (entry.kind !== 'step-end' || !entry.timing?.usage) return entry
  const { input, output, total } = entry.timing.usage
  return { ...entry, timing: { ...entry.timing, usage: { input, output, total } } }
})
const legacy = parseTurnRecord({ version: 1, entries: legacyEntries })
assert.equal(legacy.tornTail, false, 'an older record still parses whole')
const before = projectContextUsage(legacy.record, { contextWindow: 200_000 })
assert.equal(before.tokens.input, full.tokens.input)
assert.equal(before.tokens.output, full.tokens.output)
assert.equal(before.tokens.total, full.tokens.total)
assert.equal(before.steps, full.steps)
assert.equal(before.measuredSteps, full.measuredSteps)
assert.equal(before.toolCalls, full.toolCalls)
assert.deepEqual(before.messages, full.messages)
assert.deepEqual(before.breakdown, full.breakdown)
assert.equal(before.lastActivityAt, full.lastActivityAt)
assert.equal(before.tokens.cachedRead, 0, 'an unreported cache split reads as nothing cached')
assert.equal(before.tokens.cachedWrite, 0)
assert.equal(before.costUsd, undefined, 'an older record prices nothing')
// Fullness falls back to the input the old build did record — the same last
// step, minus the cache it never knew about (11,000 becomes 6,000).
assert.equal(before.contextTokens, 6_000)

// A record whose entries carry the new fields still parses under the same
// format version — they are additions, not a format change.
const reparsed = parseTurnRecord(record)
assert.equal(reparsed.tornTail, false)
assert.deepEqual(
  projectContextUsage(reparsed.record, { contextWindow: 200_000 }),
  full,
  'parse is lossless for the new usage fields',
)

// ── An empty or missing record is a zero, not a crash ──────────────────────
const empty = projectContextUsage(undefined, { contextWindow: 200_000 })
assert.equal(empty.tokens.total, 0)
assert.equal(empty.steps, 0)
assert.equal(empty.ratio, undefined)
assert.equal(empty.lastActivityAt, 0)
assert.deepEqual(empty.breakdown, { assistant: 0, tool: 0, user: 0, reasoning: 0 })

// ── Same input, same output ────────────────────────────────────────────────
assert.deepEqual(
  projectContextUsage(record, { contextWindow: 200_000 }),
  projectContextUsage(record, { contextWindow: 200_000 }),
  'the projection is pure: same input, same output',
)

// ── Pricing: a rate nobody stated prices nothing ───────────────────────────
assert.equal(computeUsageCostUsd({ input: 1_000, output: 100 }, undefined), undefined)
assert.equal(computeUsageCostUsd({ input: 1_000, output: 100 }, {}), undefined, 'empty pricing is not free pricing')
assert.equal(computeUsageCostUsd(undefined, { input: 3 }), undefined)
assert.equal(computeUsageCostUsd({ output: 100 }, { input: 3 }), undefined, 'a rate for a token kind this step never spent prices nothing')
assert.ok(
  Math.abs((computeUsageCostUsd({ input: 1_000_000, output: 500_000, cachedRead: 2_000_000 }, { input: 3, output: 15, cacheRead: 0.3 }) ?? 0) - (3 + 7.5 + 0.6)) < 1e-9,
  'each token kind is priced by its own stated rate',
)

// ── Purity is a contract, not a hope ───────────────────────────────────────
const source = await readFile(resolve(import.meta.dirname, '../src/agent/contextUsageProjection.ts'), 'utf8')
for (const forbidden of [/Date\.now/, /Math\.random/, /useState|useStore|zustand/, /require\(|await import\(/, /window\./, /localStorage/]) {
  assert.doesNotMatch(source, forbidden, `the context-usage projection must stay pure: ${forbidden}`)
}

console.log('what a run spent is one pure projection of the Turn Record; unmeasured stays unmeasured')
