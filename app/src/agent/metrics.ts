/**
 * 本地運行指標(G11,grok OTel 指標的離線版)。
 *
 * 每個 run 累積計數(工具 ask/deny、compaction、LLM retry),
 * finalization 時收斂成一筆紀錄存 localStorage ring(上限 300 筆)。
 * 隱私模型同 grok:只記數字與狀態,不含 prompt / 工具 payload 內容。
 * `metricsSummary()` 的 denial ratio 是調整 approvalMode / allowlist
 * 的關鍵回饋;之後要接 OTLP 再由此匯出。
 */

export interface RunCounters {
  toolAsks: number
  toolDenials: number
  compactions: number
  llmRetries: number
}

export interface RunMetricRecord {
  runId: string
  at: string
  sourceKind?: string
  path?: string
  status: string
  ok: boolean
  counters: RunCounters
}

const STORAGE_KEY = 'subagents.metrics.runs.v1'
const MAX_RECORDS = 300

const liveCounters = new Map<string, RunCounters>()

function emptyCounters(): RunCounters {
  return { toolAsks: 0, toolDenials: 0, compactions: 0, llmRetries: 0 }
}

/** Run 進行中累加;無 runId(單元測試/瀏覽器工具直呼)靜默忽略。 */
export function bumpRunMetric(runId: string | undefined, key: keyof RunCounters): void {
  if (!runId) return
  const c = liveCounters.get(runId) || emptyCounters()
  c[key] += 1
  liveCounters.set(runId, c)
}

function readRecords(): RunMetricRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? (arr as RunMetricRecord[]) : []
  } catch {
    return []
  }
}

function writeRecords(records: RunMetricRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-MAX_RECORDS)))
  } catch {
    /* quota / test env — metrics must never break runs */
  }
}

/** Finalization 唯一出口呼叫:收斂 live counters 成一筆紀錄。 */
export function finalizeRunMetric(
  runId: string,
  info: { sourceKind?: string; path?: string; status?: string; ok: boolean },
): RunMetricRecord {
  const record: RunMetricRecord = {
    runId,
    at: new Date().toISOString(),
    sourceKind: info.sourceKind,
    path: info.path,
    status: info.status || (info.ok ? 'success' : 'failed'),
    ok: info.ok,
    counters: liveCounters.get(runId) || emptyCounters(),
  }
  liveCounters.delete(runId)
  writeRecords([...readRecords(), record])
  return record
}

export function listRunMetrics(): RunMetricRecord[] {
  return readRecords()
}

/** JSONL 匯出(每行一筆,可餵外部收集器)。 */
export function exportRunMetricsJsonl(): string {
  return readRecords()
    .map((r) => JSON.stringify(r))
    .join('\n')
}

export interface MetricsSummary {
  runs: number
  okRuns: number
  toolAsks: number
  toolDenials: number
  /** denials / (asks + denials);調 approvalMode 與 allowlist 的回饋 */
  denialRatio: number
  compactions: number
  llmRetries: number
}

export function metricsSummary(records = readRecords()): MetricsSummary {
  const sum: MetricsSummary = {
    runs: records.length,
    okRuns: 0,
    toolAsks: 0,
    toolDenials: 0,
    denialRatio: 0,
    compactions: 0,
    llmRetries: 0,
  }
  for (const r of records) {
    if (r.ok) sum.okRuns += 1
    sum.toolAsks += r.counters?.toolAsks || 0
    sum.toolDenials += r.counters?.toolDenials || 0
    sum.compactions += r.counters?.compactions || 0
    sum.llmRetries += r.counters?.llmRetries || 0
  }
  const decisions = sum.toolAsks + sum.toolDenials
  sum.denialRatio = decisions > 0 ? sum.toolDenials / decisions : 0
  return sum
}

/** 測試隔離用。 */
export function resetRunMetrics(): void {
  liveCounters.clear()
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
