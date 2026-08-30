import type { AgentState, ArchiveRecord, ModelPricing } from './types.ts'
import { projectContextUsage } from './contextUsageProjection.ts'

export const USAGE_LEDGER_VERSION = 1 as const

export type UsageRunStatus = 'success' | 'failed' | 'halted' | 'warning'
export type UsageMeasurement = 'turn-record' | 'runner-total'

export type UsageLedgerEntry = {
  runId: string
  settledAt: string
  status: UsageRunStatus
  executionKind: 'loop' | 'external'
  runner: string
  models: string[]
  projectRoot?: string
  sourceKind?: string
  measurement: UsageMeasurement
  tokens: {
    total: number
    input?: number
    output?: number
    cachedRead?: number
    cachedWrite?: number
  }
  costUsd?: number
  measuredSteps: number
  steps: number
  toolCalls: number
  messages: number
  durationMs?: number
}

export type UsageLedger = {
  version: typeof USAGE_LEDGER_VERSION
  createdAt: string
  backfillCompletedAt?: string
  entries: UsageLedgerEntry[]
}

export type UsageRange = '7d' | '30d' | '90d' | 'all' | 'custom'
export type UsageBucketUnit = 'day' | 'week' | 'month'

export type UsageQuery = {
  range?: UsageRange
  from?: string
  to?: string
  runner?: string
  model?: string
  projectRoot?: string
  status?: UsageRunStatus
  now?: number
}

export type UsageBucket = {
  key: string
  label: string
  from: string
  runs: number
  measuredRuns: number
  pricedRuns: number
  tokens: UsageLedgerEntry['tokens']
  costUsd?: number
}

export type UsageBreakdownRow = {
  key: 'input' | 'output' | 'cachedRead' | 'cachedWrite'
  label: string
  value: number
  reportedRuns: number
}

export type UsageRankingRow = {
  key: string
  runs: number
  tokens: number
  costUsd?: number
  pricedRuns: number
  averageTokens: number
  lastUsedAt: string
}

export type UsageProjection = {
  entries: UsageLedgerEntry[]
  bucketUnit: UsageBucketUnit
  buckets: UsageBucket[]
  totals: {
    runs: number
    measuredRuns: number
    pricedRuns: number
    tokens: number
    costUsd?: number
    averageTokens: number
    cachedRead?: number
    firstRecordedAt?: string
    lastRecordedAt?: string
  }
  breakdown: UsageBreakdownRow[]
  runnerRanking: UsageRankingRow[]
  modelRanking: UsageRankingRow[]
  projectRanking: UsageRankingRow[]
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function knownString(value: unknown, max = 1000): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function hasUsageIdentity(row: Record<string, unknown>): boolean {
  if (!knownString(row.runId, 512)) return false
  if (!knownString(row.settledAt, 64)) return false
  if (Number.isNaN(Date.parse(row.settledAt))) return false
  if (!['success', 'failed', 'halted', 'warning'].includes(String(row.status))) return false
  if (!['loop', 'external'].includes(String(row.executionKind))) return false
  if (!knownString(row.runner, 160)) return false
  if (!Array.isArray(row.models)) return false
  if (row.models.some((model) => !knownString(model, 240))) return false
  return ['turn-record', 'runner-total'].includes(String(row.measurement))
}

function hasUsageMeasurements(
  row: Record<string, unknown>,
  tokens: Record<string, unknown> | undefined,
): boolean {
  if (!tokens || !finiteNonNegative(tokens.total)) return false
  for (const key of ['input', 'output', 'cachedRead', 'cachedWrite'] as const) {
    if (tokens[key] !== undefined && !finiteNonNegative(tokens[key])) return false
  }
  for (const key of ['measuredSteps', 'steps', 'toolCalls', 'messages'] as const) {
    if (!finiteNonNegative(row[key])) return false
  }
  if (row.costUsd !== undefined && !finiteNonNegative(row.costUsd)) return false
  return row.durationMs === undefined || finiteNonNegative(row.durationMs)
}

function hasUsageMetadata(row: Record<string, unknown>): boolean {
  if (row.projectRoot !== undefined && !knownString(row.projectRoot, 2000)) return false
  return row.sourceKind === undefined || knownString(row.sourceKind, 120)
}

export function isUsageLedgerEntry(value: unknown): value is UsageLedgerEntry {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  const tokens = row.tokens as Record<string, unknown> | undefined
  return hasUsageIdentity(row)
    && hasUsageMeasurements(row, tokens)
    && hasUsageMetadata(row)
}

export function emptyUsageLedger(now = new Date().toISOString()): UsageLedger {
  return { version: USAGE_LEDGER_VERSION, createdAt: now, entries: [] }
}

export function normalizeUsageLedger(value: unknown): UsageLedger {
  if (!value || typeof value !== 'object') return emptyUsageLedger()
  const raw = value as Record<string, unknown>
  const createdAt = knownString(raw.createdAt, 64) && !Number.isNaN(Date.parse(raw.createdAt))
    ? raw.createdAt
    : new Date().toISOString()
  const backfillCompletedAt = knownString(raw.backfillCompletedAt, 64) && !Number.isNaN(Date.parse(raw.backfillCompletedAt))
    ? raw.backfillCompletedAt
    : undefined
  const byRun = new Map<string, UsageLedgerEntry>()
  if (Array.isArray(raw.entries)) {
    for (const entry of raw.entries) if (isUsageLedgerEntry(entry)) byRun.set(entry.runId, entry)
  }
  return {
    version: USAGE_LEDGER_VERSION,
    createdAt,
    ...(backfillCompletedAt ? { backfillCompletedAt } : {}),
    entries: [...byRun.values()].sort((a, b) => Date.parse(b.settledAt) - Date.parse(a.settledAt)),
  }
}

function archiveStatus(status: ArchiveRecord['status'] | AgentState['status']): UsageRunStatus {
  if (status === 'success' || status === 'halted' || status === 'warning') return status
  return 'failed'
}

function knownModels(steps: AgentState['steps'] | ArchiveRecord['steps']): string[] {
  return [...new Set(steps.map((step) => step.modelUsed?.trim()).filter((model): model is string => Boolean(model)))].sort()
}

function usageTokens(
  record: AgentState['turnRecord'] | ArchiveRecord['turnRecord'],
  fallback?: number,
  pricing?: ModelPricing,
) {
  const usage = projectContextUsage(record, { pricing })
  if (usage.measuredSteps > 0) {
    return {
      usage,
      measurement: 'turn-record' as const,
      tokens: {
        total: usage.tokens.total,
        ...(usage.reported.input ? { input: usage.tokens.input } : {}),
        ...(usage.reported.output ? { output: usage.tokens.output } : {}),
        ...(usage.reported.cachedRead ? { cachedRead: usage.tokens.cachedRead } : {}),
        ...(usage.reported.cachedWrite ? { cachedWrite: usage.tokens.cachedWrite } : {}),
      },
    }
  }
  if (finiteNonNegative(fallback) && fallback > 0) {
    return { usage, measurement: 'runner-total' as const, tokens: { total: fallback } }
  }
  return undefined
}

export function usageEntryFromAgent(input: {
  agent: AgentState
  runId: string
  status?: UsageRunStatus
  sourceKind?: string
  projectRoot?: string
  pricing?: ModelPricing
}): UsageLedgerEntry | undefined {
  const measured = usageTokens(input.agent.turnRecord, input.agent.tokensUsed, input.pricing)
  if (!measured) return undefined
  const finished = input.agent.finishedAt || input.agent.startedAt || new Date().toISOString()
  return {
    runId: input.runId,
    settledAt: finished,
    status: input.status || archiveStatus(input.agent.status),
    executionKind: input.agent.executionKind === 'external' ? 'external' : 'loop',
    runner: input.agent.executionKind === 'external'
      ? input.agent.externalRun?.provider || input.agent.externalRunnerKind || 'external'
      : 'builtin',
    models: knownModels(input.agent.steps),
    ...(input.projectRoot?.trim() ? { projectRoot: input.projectRoot.trim() } : {}),
    ...(input.sourceKind?.trim() ? { sourceKind: input.sourceKind.trim() } : {}),
    measurement: measured.measurement,
    tokens: measured.tokens,
    ...(measured.usage.costUsd === undefined ? {} : { costUsd: measured.usage.costUsd }),
    measuredSteps: measured.usage.measuredSteps,
    steps: measured.usage.steps || input.agent.steps.length,
    toolCalls: measured.usage.toolCalls || input.agent.toolCalls.length,
    messages: measured.usage.messages.user + measured.usage.messages.assistant,
    ...(input.agent.metrics?.executionMs === undefined ? {} : { durationMs: input.agent.metrics.executionMs }),
  }
}

export function usageEntryFromArchive(record: ArchiveRecord): UsageLedgerEntry | undefined {
  const measured = usageTokens(record.turnRecord, record.tokensUsed)
  if (!measured) return undefined
  return {
    runId: record.id,
    settledAt: record.timestamp,
    status: archiveStatus(record.status),
    executionKind: record.executionKind === 'external' ? 'external' : 'loop',
    runner: record.executionKind === 'external' ? record.externalRun?.provider || 'external' : 'builtin',
    models: knownModels(record.steps),
    measurement: measured.measurement,
    tokens: measured.tokens,
    ...(measured.usage.costUsd === undefined ? {} : { costUsd: measured.usage.costUsd }),
    measuredSteps: measured.usage.measuredSteps,
    steps: measured.usage.steps || record.steps.length,
    toolCalls: measured.usage.toolCalls || record.toolCalls?.length || 0,
    messages: measured.usage.messages.user + measured.usage.messages.assistant,
  }
}

function startOfRange(query: UsageQuery, now: number): number | undefined {
  if (query.range === 'custom' && query.from) {
    const value = Date.parse(`${query.from}T00:00:00`)
    return Number.isNaN(value) ? undefined : value
  }
  const days = query.range === '7d' ? 7 : query.range === '30d' ? 30 : query.range === '90d' ? 90 : 0
  if (!days) return undefined
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - days + 1)
  return start.getTime()
}

function endOfRange(query: UsageQuery): number | undefined {
  if (query.range !== 'custom' || !query.to) return undefined
  const value = Date.parse(`${query.to}T23:59:59.999`)
  return Number.isNaN(value) ? undefined : value
}

function localDay(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function bucketKey(timestamp: number, unit: UsageBucketUnit): string {
  const date = new Date(timestamp)
  if (unit === 'day') return localDay(timestamp)
  if (unit === 'month') return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  const day = date.getDay() || 7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - day + 1)
  return localDay(date.getTime())
}

function bucketLabel(key: string, unit: UsageBucketUnit): string {
  if (unit === 'month') {
    const [year, month] = key.split('-')
    return `${year}/${month}`
  }
  const date = new Date(`${key}T00:00:00`)
  return unit === 'week'
    ? `${date.getMonth() + 1}/${date.getDate()} 週`
    : `${date.getMonth() + 1}/${date.getDate()}`
}

function chooseBucketUnit(entries: UsageLedgerEntry[]): UsageBucketUnit {
  if (entries.length < 2) return 'day'
  const span = Date.parse(entries[0].settledAt) - Date.parse(entries[entries.length - 1].settledAt)
  const days = Math.max(1, span / 86_400_000)
  return days > 180 ? 'month' : days > 60 ? 'week' : 'day'
}

function rank(entries: UsageLedgerEntry[], keys: (entry: UsageLedgerEntry) => string[]): UsageRankingRow[] {
  const rows = new Map<string, UsageRankingRow>()
  for (const entry of entries) {
    const values = keys(entry)
    for (const key of values.length ? values : ['未知']) {
      const current = rows.get(key) || { key, runs: 0, tokens: 0, pricedRuns: 0, averageTokens: 0, lastUsedAt: entry.settledAt }
      current.runs += 1
      current.tokens += entry.tokens.total
      if (entry.costUsd !== undefined) {
        current.costUsd = (current.costUsd ?? 0) + entry.costUsd
        current.pricedRuns += 1
      }
      if (Date.parse(entry.settledAt) > Date.parse(current.lastUsedAt)) current.lastUsedAt = entry.settledAt
      current.averageTokens = current.tokens / current.runs
      rows.set(key, current)
    }
  }
  return [...rows.values()].sort((a, b) => b.tokens - a.tokens || b.runs - a.runs)
}

export function projectUsageLedger(ledger: UsageLedger, query: UsageQuery = {}): UsageProjection {
  const now = query.now ?? Date.now()
  const from = startOfRange(query, now)
  const to = endOfRange(query)
  const entries = ledger.entries.filter((entry) => {
    const at = Date.parse(entry.settledAt)
    if (from !== undefined && at < from) return false
    if (to !== undefined && at > to) return false
    if (query.runner && entry.runner !== query.runner) return false
    if (query.model && !entry.models.includes(query.model)) return false
    if (query.projectRoot && entry.projectRoot !== query.projectRoot) return false
    if (query.status && entry.status !== query.status) return false
    return true
  }).sort((a, b) => Date.parse(b.settledAt) - Date.parse(a.settledAt))

  const bucketUnit = chooseBucketUnit(entries)
  const bucketsByKey = new Map<string, UsageBucket>()
  for (const entry of [...entries].reverse()) {
    const key = bucketKey(Date.parse(entry.settledAt), bucketUnit)
    const current = bucketsByKey.get(key) || {
      key,
      label: bucketLabel(key, bucketUnit),
      from: key,
      runs: 0,
      measuredRuns: 0,
      pricedRuns: 0,
      tokens: { total: 0 },
    }
    current.runs += 1
    current.measuredRuns += 1
    current.tokens.total += entry.tokens.total
    for (const tokenKey of ['input', 'output', 'cachedRead', 'cachedWrite'] as const) {
      const value = entry.tokens[tokenKey]
      if (value !== undefined) current.tokens[tokenKey] = (current.tokens[tokenKey] ?? 0) + value
    }
    if (entry.costUsd !== undefined) {
      current.costUsd = (current.costUsd ?? 0) + entry.costUsd
      current.pricedRuns += 1
    }
    bucketsByKey.set(key, current)
  }

  const priced = entries.filter((entry) => entry.costUsd !== undefined)
  const cacheReported = entries.filter((entry) => entry.tokens.cachedRead !== undefined)
  const tokens = entries.reduce((sum, entry) => sum + entry.tokens.total, 0)
  const breakdownMeta = [
    ['input', '輸入'],
    ['output', '輸出'],
    ['cachedRead', '快取讀'],
    ['cachedWrite', '快取寫'],
  ] as const
  const breakdown = breakdownMeta.map(([key, label]) => ({
    key,
    label,
    value: entries.reduce((sum, entry) => sum + (entry.tokens[key] ?? 0), 0),
    reportedRuns: entries.filter((entry) => entry.tokens[key] !== undefined).length,
  }))

  return {
    entries,
    bucketUnit,
    buckets: [...bucketsByKey.values()],
    totals: {
      runs: entries.length,
      measuredRuns: entries.length,
      pricedRuns: priced.length,
      tokens,
      ...(priced.length ? { costUsd: priced.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0) } : {}),
      averageTokens: entries.length ? tokens / entries.length : 0,
      ...(cacheReported.length ? { cachedRead: cacheReported.reduce((sum, entry) => sum + (entry.tokens.cachedRead ?? 0), 0) } : {}),
      ...(entries.length ? { firstRecordedAt: entries.at(-1)?.settledAt, lastRecordedAt: entries[0].settledAt } : {}),
    },
    breakdown,
    runnerRanking: rank(entries, (entry) => [entry.runner]),
    // A mixed-model run has no per-model token attribution in the record. Keep
    // it as one explicit bucket instead of crediting the full bill to every model.
    modelRanking: rank(entries, (entry) => entry.models.length <= 1
      ? entry.models
      : [`Mixed · ${entry.models.join(' + ')}`]),
    projectRanking: rank(entries, (entry) => [entry.projectRoot || '未綁定專案']),
  }
}
