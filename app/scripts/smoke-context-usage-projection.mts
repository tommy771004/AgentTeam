import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { appendTurnRecord, parseTurnRecord, type TurnRecordAppend } from '../src/agent/turnRecord.ts'
import { projectContextUsage } from '../src/agent/contextUsageProjection.ts'
import { computeUsageCostUsd } from '../src/agent/usagePricing.ts'
import { reducePiStepUsage } from '../src/agent/piStepUsage.ts'
import {
  contextUsageActivityMicrocopy,
  contextUsageMicrocopy,
  contextUsageReportLines,
  formatTokensCompact,
  formatUsd,
  resolveKnownContextWindow,
} from '../src/agent/contextUsageView.ts'

/**
 * What a run actually spent, derived from the Turn Record and nothing else.
 *
 * Before this, the only visible figure was one scalar and a corner line reading
 * `tokens N · Nms`. The cache split and the cost were measured by the Host at
 * every step and discarded one line before they were recorded, so nobody could
 * answer «這個 run 為什麼燒了這麼多 token».
 *
 * The rules asserted here are all one rule — ADR-0048's principle that a
 * component may not manufacture what it did not observe, applied to
 * measurement rather than to execution evidence: every surface shows
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

const instructionRecord = appendTurnRecord(record, [{
  kind: 'instruction-snapshot', source: 'host', turn: 1, step: 1, at: 1,
  snapshot: {
    id: 'ins_test', revision: 7, effectiveHash: 'a'.repeat(64), effectiveText: '規則',
    sources: [], diagnostics: [],
    usage: { personalizationBytes: 120, projectInstructionBytes: 80, totalBytes: 200, budgetBytes: 1024 },
    deliveryMode: 'explicit', exactSnapshot: true,
  },
}])
assert.deepEqual(projectContextUsage(instructionRecord).instructions, {
  personalizationBytes: 120,
  projectInstructionBytes: 80,
  totalBytes: 200,
  budgetBytes: 1024,
  revision: 7,
  effectiveHash: 'a'.repeat(64),
  deliveryMode: 'explicit',
  exactSnapshot: true,
  hashAvailable: true,
  sourceSummary: [],
}, 'live and replay usage reads exact instruction slots from the Turn Record')

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

// Before the first provider settlement there are no honest token figures yet,
// but the live Turn Record already contains useful activity. The context panel
// must keep changing with those entries instead of looking frozen until the run
// ends.
let preSettlement = appendTurnRecord(undefined, [
  { kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 0 },
  { kind: 'step-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'user-text', source: 'user', content: 'inspect', turn: 1, step: 1, at: 2 },
])
assert.equal(
  contextUsageActivityMicrocopy(projectContextUsage(preSettlement)),
  '訊息 1 · 工具 0 · 步驟 1',
  'the panel exposes live structural activity before the first token settlement',
)
preSettlement = appendTurnRecord(preSettlement, [
  { kind: 'tool-call', source: 'model', tool: 'read', callId: 'live-1', args: { path: 'src/App.tsx' }, turn: 1, step: 1, at: 3 },
])
assert.equal(
  contextUsageActivityMicrocopy(projectContextUsage(preSettlement)),
  '訊息 1 · 工具 1 · 步驟 1',
  'new live entries change the context activity immediately',
)

// ── Absent is not zero ─────────────────────────────────────────────────────
let unpriced = appendTurnRecord(undefined, [{ kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 0 }])
unpriced = appendTurnRecord(unpriced, step(1, { input: 100, output: 10, total: 110 }))
const noCost = projectContextUsage(unpriced, { contextWindow: 32_000 })
assert.equal(noCost.costUsd, undefined, 'no reported cost yields no cost, never US$0.00')
assert.equal(noCost.tokens.cachedRead, 0)
assert.equal(noCost.tokens.cachedWrite, 0)

// A sum of zero must not be mistaken for a measurement of zero. This provider
// never mentioned caching, so the panel is told to print no figure at all —
// `快取讀 0` would be this build stating something nobody measured.
assert.deepEqual(
  noCost.reported,
  { input: true, output: true, cachedRead: false, cachedWrite: false },
  'only fields a step actually reported are reportable',
)
assert.deepEqual(
  full.reported,
  { input: true, output: true, cachedRead: true, cachedWrite: true },
  'a provider that reports the cache split is reportable on all four',
)
// A provider that reports a genuine zero IS reportable — that zero is a fact.
let zeroCache = appendTurnRecord(undefined, [{ kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 0 }])
zeroCache = appendTurnRecord(zeroCache, step(1, { input: 100, output: 10, total: 110, cachedRead: 0, cachedWrite: 0 }))
const zeroed = projectContextUsage(zeroCache, {})
assert.equal(zeroed.reported.cachedRead, true, 'a reported 0 is a measurement and stays visible')
assert.equal(zeroed.tokens.cachedRead, 0)

// A step whose only reported figure is a zero, or only a cache split, is still
// a measured step: dropping it would lose a measurement the provider did make.
let oddities = appendTurnRecord(undefined, [{ kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 0 }])
oddities = appendTurnRecord(oddities, [
  { kind: 'step-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'step-end', source: 'host', turn: 1, step: 1, at: 2, timing: { requestAt: 1, completedAt: 2, usage: { input: 0, output: 0, total: 0 } } },
  { kind: 'step-start', source: 'host', turn: 1, step: 2, at: 3 },
  { kind: 'step-end', source: 'host', turn: 1, step: 2, at: 4, timing: { requestAt: 3, completedAt: 4, usage: { cachedRead: 1_200 } } },
])
const odd = projectContextUsage(oddities, {})
assert.equal(odd.measuredSteps, 2, 'a reported zero and a cache-only report are both measurements')
assert.equal(odd.tokens.cachedRead, 1_200, 'a cache-only step still contributes its cache')
assert.equal(odd.reported.cachedRead, true)
assert.equal(odd.contextTokens, 1_200, 'and still tells the panel how full the context is')

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
assert.deepEqual(cli.reported, { input: false, output: false, cachedRead: false, cachedWrite: false })
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
assert.equal(before.tokens.cachedRead, 0)
assert.equal(before.tokens.cachedWrite, 0)
assert.equal(before.reported.cachedRead, false, 'an older record reports no cache split, rather than a zero one')
assert.equal(before.reported.cachedWrite, false)
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

// ── The Host's reduction: never a fabricated zero ──────────────────────────
/*
 * Ticket 01: 「無回報時欄位缺席（不補 0）」. The first build reduced with a
 * missing→0 helper and wrote the cache split unconditionally, so a provider
 * that never mentions caching recorded a *measured* 0 and the panel printed
 * 快取讀 0 — the exact 「回報了 0」vs「沒回報」conflation the whole effect
 * exists to prevent. These assert the rule at the point it is decided.
 */
assert.equal(reducePiStepUsage([]), undefined, 'a step with no messages spent nothing measurable')
assert.equal(reducePiStepUsage([{}, { usage: undefined }]), undefined)
assert.deepEqual(
  reducePiStepUsage([{ usage: { input: 900, output: 100, totalTokens: 1_000 } }]),
  { input: 900, output: 100, total: 1_000, contextTokens: 900 },
  'a provider that never mentions caching records NO cache, not a zero one',
)
assert.deepEqual(
  reducePiStepUsage([{ usage: { input: 900, output: 100, totalTokens: 1_000, cacheRead: 0, cacheWrite: 0 } }]),
  { input: 900, output: 100, total: 1_000, cachedRead: 0, cachedWrite: 0, contextTokens: 900 },
  'a provider that reports 0 cache records that 0 — it is a measurement',
)
// Cost is recorded only when positive: Pi prices from catalog rates that are 0
// for a model it has no price for, so a 0 cannot tell 免費 from 沒有定價.
assert.equal(reducePiStepUsage([{ usage: { input: 5, output: 5, totalTokens: 10, cost: { total: 0 } } }])?.costUsd, undefined)
assert.equal(reducePiStepUsage([{ usage: { input: 5, output: 5, totalTokens: 10, cost: { total: 0.5 } } }])?.costUsd, 0.5)

// Several model calls in one step: fields sum, but the prompt is the LAST call's.
const looping = reducePiStepUsage([
  { usage: { input: 10_000, output: 200, totalTokens: 10_200, cacheRead: 8_000 } },
  { usage: { input: 14_000, output: 300, totalTokens: 14_300, cacheRead: 11_000 } },
  { usage: { input: 16_000, output: 400, totalTokens: 16_400, cacheRead: 13_000 } },
])
assert.equal(looping?.input, 40_000, 'spend sums every call in the step')
assert.equal(looping?.total, 40_900)
assert.equal(looping?.cachedRead, 32_000)
assert.equal(looping?.contextTokens, 29_000, 'fullness is the LAST call: 16,000 + 13,000')
assert.ok((looping?.contextTokens ?? 0) < (looping?.input ?? 0), 'and is never the inflated sum')

// ── The window comes from the record first ─────────────────────────────────
/*
 * The catalog's window for the model that actually served the step is recorded
 * ON the step. Reading it from the record rather than from settings is what
 * makes a ratio possible out of the box — `modelProfiles` is empty until a
 * user clicks 驗證模型能力, so a settings-only lookup showed no ratio to
 * anyone — and it is what makes a mid-run model switch measure against the
 * model that ran.
 */
let switched = appendTurnRecord(undefined, [{ kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 0 }])
switched = appendTurnRecord(switched, [
  { kind: 'step-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'step-end', source: 'host', turn: 1, step: 1, at: 2, timing: { requestAt: 1, completedAt: 2, contextWindow: 8_000, usage: { input: 1_000, output: 10, total: 1_010, contextTokens: 1_000 } } },
  { kind: 'step-start', source: 'host', turn: 1, step: 2, at: 3 },
  { kind: 'step-end', source: 'host', turn: 1, step: 2, at: 4, timing: { requestAt: 3, completedAt: 4, contextWindow: 200_000, usage: { input: 5_000, output: 20, total: 5_020, contextTokens: 5_000 } } },
])
const afterSwitch = projectContextUsage(switched, {})
assert.equal(afterSwitch.contextWindow, 200_000, 'the window of the model that served the LAST step wins')
assert.ok(Math.abs((afterSwitch.ratio ?? 0) - 5_000 / 200_000) < 1e-12)
// The record outranks whatever the caller could establish from settings.
assert.equal(projectContextUsage(switched, { contextWindow: 32_000 }).contextWindow, 200_000)
// And a record that carries none still accepts what the caller knows.
assert.equal(projectContextUsage(unpriced, { contextWindow: 32_000 }).contextWindow, 32_000)

/*
 * `contextTokens` is the LAST model call's prompt, not the step's summed
 * input. One step can make many model calls when the agent uses tools, so the
 * sum answers «這一步買了多少» while only the last prompt answers «模型現在握
 * 著多滿的 context». Here the step bought 40,000 input across its calls and
 * ended holding 12,000 — a ratio off the sum would claim a context 3× fuller
 * than the model actually has.
 */
let looped = appendTurnRecord(undefined, [{ kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 0 }])
looped = appendTurnRecord(looped, [
  { kind: 'step-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'step-end', source: 'host', turn: 1, step: 1, at: 2, timing: { requestAt: 1, completedAt: 2, contextWindow: 100_000, usage: { input: 40_000, output: 900, total: 40_900, contextTokens: 12_000 } } },
])
const loopedUsage = projectContextUsage(looped, {})
assert.equal(loopedUsage.tokens.input, 40_000, 'spend is still the sum')
assert.equal(loopedUsage.contextTokens, 12_000, 'fullness is the last prompt')
assert.ok(Math.abs((loopedUsage.ratio ?? 0) - 0.12) < 1e-12, 'the ratio follows fullness, not spend')
// A record from before the recorder measured this falls back to input + cache.
let noPrompt = appendTurnRecord(undefined, [{ kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 0 }])
noPrompt = appendTurnRecord(noPrompt, step(1, { input: 4_000, output: 10, total: 4_010, cachedRead: 1_000 }))
assert.equal(projectContextUsage(noPrompt, {}).contextTokens, 5_000, 'older records fall back to input + cache')

// ── User-stated rates price what the recorder could not ────────────────────
// Ticket 02: the catalog prices the Pi path, but where it has no price for a
// model the user's own ModelProfile rates are the only thing that can answer
// «這個 run 花了多少錢». They never override a recorded price.
const pricing = { input: 3, output: 15 }
assert.equal(projectContextUsage(unpriced, {}).costUsd, undefined, 'no rates, no cost')
const userPriced = projectContextUsage(unpriced, { pricing })
assert.ok(
  Math.abs((userPriced.costUsd ?? 0) - ((100 * 3) / 1e6 + (10 * 15) / 1e6)) < 1e-12,
  'stated rates price the measured tokens',
)
// A recorded price is authoritative and is not recomputed from user rates.
assert.ok(
  Math.abs((projectContextUsage(record, { pricing: { input: 999, output: 999 } }).costUsd ?? 0) - 0.03) < 1e-9,
  'what the recorder priced stands',
)

// ── The shared presentation vocabulary ─────────────────────────────────────
// The panel, the feed microcopy, `/cost` and the archived bubble all format
// through these, so a run cannot read one way in one place and another way in
// the next.

// A window is known only when a model profile states it. `defaultContextWindowTokens`
// ships as 64,000 for everyone, so it is a compaction floor, not knowledge —
// resolving through it would put a confident wrong percentage on screen.
assert.equal(
  resolveKnownContextWindow({ model: 'm', modelProfiles: { m: { modelId: 'm', source: 'verified', contextWindow: 200_000 } } }, 'm'),
  200_000,
)
assert.equal(resolveKnownContextWindow({ model: 'm', modelProfiles: {} }, 'm'), undefined, 'no profile, no window')
assert.equal(
  resolveKnownContextWindow({ model: 'm', modelProfiles: { m: { modelId: 'm', source: 'assumed' } } }, 'm'),
  undefined,
  'a profile without a window is still no window',
)
assert.equal(resolveKnownContextWindow(undefined, undefined), undefined)
// The run's own model wins over the global one, so a mid-session switch is
// measured against the model that actually ran.
assert.equal(
  resolveKnownContextWindow(
    { model: 'old', modelProfiles: { old: { modelId: 'old', source: 'verified', contextWindow: 8_000 }, now: { modelId: 'now', source: 'verified', contextWindow: 200_000 } } },
    'now',
  ),
  200_000,
)

assert.equal(formatTokensCompact(9_999), '9,999')
assert.equal(formatTokensCompact(73_166), '73.2k')
assert.equal(formatTokensCompact(1_250_000), '1.25M')
// A real charge must never round away to US$0.00; showing zero for something
// that cost money is the same lie as inventing a cost.
assert.equal(formatUsd(0.00012), 'US$0.0001')
assert.equal(formatUsd(0.0124), 'US$0.012')
assert.equal(formatUsd(3.5), 'US$3.50')

// `/cost` prints the split, and prints NOTHING for what nobody measured.
const report = contextUsageReportLines(full)
assert.ok(report[0]?.startsWith('本次執行累積 Tokens：'), 'the report names the run-cumulative scope')
assert.ok(report.some((line) => line.includes('快取讀 8,000')), 'a reported cache split is printed')
assert.ok(report.some((line) => line.startsWith('成本：')), 'a priced run prints its cost')
assert.ok(report.some((line) => line.includes('（6%）')), 'a known window prints the ratio')
const unpricedReport = contextUsageReportLines(noCost)
assert.ok(!unpricedReport.some((line) => line.startsWith('成本：')), 'an unpriced run prints no cost line')
assert.ok(!unpricedReport.some((line) => line.includes('快取讀')), 'an unreported cache split prints no cache figures')
assert.ok(unpricedReport.some((line) => line.includes('輸入 100')), 'what WAS reported is still printed')
// A live run says which of its numbers are not in yet.
assert.ok(contextUsageReportLines(running).some((line) => line.includes('執行中')))
assert.ok(contextUsageReportLines(partial).some((line) => line.includes('未載入')))

// One microcopy, so two surfaces cannot render one run two ways.
assert.equal(contextUsageMicrocopy(loopedUsage), '本次執行累積 40.9k tok (12%)')
assert.equal(contextUsageMicrocopy(noWindow), '本次執行累積 110 tok', 'no window, no ratio — but still the count')
assert.equal(contextUsageMicrocopy(cli), '', 'a runner that measured nothing shows nothing')

// ── Purity is a contract, not a hope ───────────────────────────────────────
const source = await readFile(resolve(import.meta.dirname, '../src/agent/contextUsageProjection.ts'), 'utf8')
for (const forbidden of [/Date\.now/, /Math\.random/, /useState|useStore|zustand/, /require\(|await import\(/, /window\./, /localStorage/]) {
  assert.doesNotMatch(source, forbidden, `the context-usage projection must stay pure: ${forbidden}`)
}
const panelSource = await readFile(resolve(import.meta.dirname, '../src/components/ContextUsagePanel.tsx'), 'utf8')
assert.ok(panelSource.includes('>本次執行累積</span>'), 'the expanded panel names the cumulative scope')
assert.ok(panelSource.includes('本次執行累積會加總每次模型呼叫'), 'the expanded panel explains how accumulation works')

// ── The live refresher keeps its lifecycle contract (effort: subscription-surface-hardening #04) ──
// Polling is a self-heal over the push stream; its writes must never resurrect
// a finished run, and the timer must always be cleaned up.
const refresherSource = await readFile(resolve(import.meta.dirname, '../src/hooks/useRunUsageRefresher.ts'), 'utf8')
assert.match(refresherSource, /activeRunIds\.includes\(runId\)/, 'a polled page may only be written back while the run is still active')
assert.match(refresherSource, /newestPage <= newestKnown/, 'a page bringing nothing new must be a store no-op (identity preserved, siblings do not re-render)')
assert.match(refresherSource, /clearInterval/, 'the polling interval is cleared on unmount/deactivate — lifecycle contract')
assert.match(refresherSource, /inflight/, 'concurrent polls for one run are deduplicated across mounting surfaces')
assert.match(refresherSource, /typeof attach !== 'function'/, 'the bridge is feature-detected before use')
assert.match(refresherSource, /void pullLatestPage\(runId\)[\s\S]*setInterval/, 'mounting an active panel synchronizes immediately before interval polling begins')

console.log('what a run spent is one pure projection of the Turn Record; unmeasured stays unmeasured')
