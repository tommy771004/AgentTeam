import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeUsageLedger,
  projectUsageLedger,
  usageEntryFromArchive,
  type UsageLedgerEntry,
} from '../src/agent/usageLedger.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const now = Date.parse('2026-08-30T12:00:00.000Z')
const base = (patch: Partial<UsageLedgerEntry>): UsageLedgerEntry => ({
  runId: 'run-1',
  settledAt: '2026-08-30T08:00:00.000Z',
  status: 'success',
  executionKind: 'loop',
  runner: 'builtin',
  models: ['gpt-5'],
  measurement: 'turn-record',
  tokens: { total: 120, input: 100, output: 20 },
  costUsd: 0.02,
  measuredSteps: 1,
  steps: 1,
  toolCalls: 0,
  messages: 2,
  ...patch,
})

const ledger = normalizeUsageLedger({
  version: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  entries: [
    base({}),
    base({ runId: 'run-1', tokens: { total: 125, input: 105, output: 20 } }),
    base({
      runId: 'run-2',
      settledAt: '2026-08-29T08:00:00.000Z',
      executionKind: 'external',
      runner: 'codex',
      models: [],
      measurement: 'runner-total',
      tokens: { total: 75 },
      costUsd: undefined,
      measuredSteps: 0,
    }),
  ],
})
assert.equal(ledger.entries.length, 2, 'runId upsert must be idempotent')

const projection = projectUsageLedger(ledger, { range: '7d', now })
assert.equal(projection.totals.tokens, 200)
assert.equal(projection.totals.pricedRuns, 1)
assert.equal(projection.totals.costUsd, 0.02)
assert.equal(projection.breakdown.find((row) => row.key === 'input')?.reportedRuns, 1)
assert.equal(projection.breakdown.find((row) => row.key === 'cachedRead')?.reportedRuns, 0)
assert.equal(projection.runnerRanking[0].runs, 1)
assert.ok(projection.buckets.length >= 2, 'separate local days must remain separate buckets')

const scalar = usageEntryFromArchive({
  id: 'external-1',
  status: 'failed',
  objective: 'fixture',
  loopType: 'Turn-based',
  confidence: null,
  timestamp: '2026-08-30T08:00:00.000Z',
  iterations: 1,
  maxIterations: 1,
  steps: [],
  logs: [],
  executionKind: 'external',
  externalRun: { provider: 'claude' },
  tokensUsed: 88,
})
assert.equal(scalar?.measurement, 'runner-total')
assert.deepEqual(scalar?.tokens, { total: 88 })
assert.equal(scalar?.status, 'failed', 'failed runs with measured usage must be retained')

const mainSource = fs.readFileSync(path.join(here, '../electron/main.ts'), 'utf-8')
assert.match(mainSource, /usage:upsert/)
assert.match(mainSource, /row\.runId !== entry\.runId/)
assert.match(mainSource, /renameSync\(temporary, file\)/, 'ledger writes must publish atomically')
const coordinatorSource = fs.readFileSync(path.join(here, '../src/agent/taskRunCoordinator.ts'), 'utf-8')
assert.match(coordinatorSource, /recordPermanentUsage/)
assert.match(coordinatorSource, /Archive \+ permanent usage ledger/)
const clientSource = fs.readFileSync(path.join(here, '../src/agent/usageLedgerClient.ts'), 'utf-8')
assert.match(clientSource, /window\.subagents\?\.usage/)
assert.match(clientSource, /backfillCompletedAt/)

console.log('usage ledger smoke: ok')
