/**
 * 本地運行指標(G11,grok OTel 指標的離線版)。
 *
 * 每個 run 累積計數(工具 ask/deny、compaction、LLM retry),
 * finalization 時收斂成一筆紀錄存 localStorage ring(上限 300 筆)。
 * 隱私模型同 grok:只記數字與狀態,不含 prompt / 工具 payload 內容。
 * `metricsSummary()` 的 denial ratio 是調整 approvalMode / allowlist
 * 的關鍵回饋;之後要接 OTLP 再由此匯出。
 */

import { isGoalVerdict, isRunExecutionSettlement } from './goalOutcome.ts'

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
  /** Optional measured facts. Missing means unknown, never zero. */
  facts?: GoalWorkflowMetricFacts
}

export type GoalWorkflowMetricFacts = Readonly<{
  executionSettlement?: import('./goalOutcome.ts').RunExecutionSettlement
  goalVerdict?: import('./goalOutcome.ts').GoalVerdict
  iterations?: number
  criteria?: readonly Readonly<{ kind: string; evaluated: number; failed: number; invalidated: number }>[]
  repair?: Readonly<{ attempts: number; succeeded: number; impactedNodes: number }>
  artifacts?: Readonly<{ produced: number; accepted: number }>
  workflow?: Readonly<{
    parallelNodeSlotsUsed: number
    parallelNodeSlotsAvailable: number
    fanoutWidth: number
    nodeAttempts: number
    retriedNodes: number
  }>
  verifier?: Readonly<{ tokens: number; passedArtifacts: number }>
  finalization?: Readonly<{ attempts: number; recoveries: number; claimAttempts: number; claimConflicts: number }>
}>

export type MeasuredRate = Readonly<{ numerator: number; denominator: number; value: number }>
export type MeasuredAverage = Readonly<{ total: number; observations: number; value: number }>

/** Stable observability vocabulary; every rate below remains absent without a measured denominator. */
export const GOAL_WORKFLOW_METRIC_NAMES = [
  'execution_completion_rate',
  'goal_pass_rate',
  'goal_unverifiable_rate',
  'goal_exhausted_rate',
  'criterion_failure_rate{kind}',
  'evidence_invalidation_rate',
  'repair_success_rate',
  'iterations_to_pass',
  'accepted_artifacts/produced_artifacts',
  'workflow_parallelism_ratio',
  'fanout_width',
  'node_retry_rate',
  'impacted_subgraph_size',
  'verifier_tokens_per_passed_artifact',
  'finalization_recovery_rate',
  'finalization_claim_conflict_rate',
] as const

export type GoalWorkflowMetricsSummary = Readonly<{
  executionCompletionRate?: MeasuredRate
  goalPassRate?: MeasuredRate
  goalUnverifiableRate?: MeasuredRate
  goalExhaustedRate?: MeasuredRate
  criterionFailureRate: Readonly<Record<string, MeasuredRate>>
  evidenceInvalidationRate?: MeasuredRate
  repairSuccessRate?: MeasuredRate
  iterationsToPass?: MeasuredAverage
  artifactKeepRate?: MeasuredRate
  workflowParallelismRatio?: MeasuredRate
  fanoutWidth?: MeasuredAverage
  nodeRetryRate?: MeasuredRate
  impactedSubgraphSize?: MeasuredAverage
  verifierTokensPerPassedArtifact?: MeasuredRate
  finalizationRecoveryRate?: MeasuredRate
  finalizationClaimConflictRate?: MeasuredRate
}>

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
  info: { sourceKind?: string; path?: string; status?: string; ok: boolean; facts?: GoalWorkflowMetricFacts },
): RunMetricRecord {
  const record: RunMetricRecord = {
    runId,
    at: new Date().toISOString(),
    sourceKind: info.sourceKind,
    path: info.path,
    status: info.status || (info.ok ? 'success' : 'failed'),
    ok: info.ok,
    counters: liveCounters.get(runId) || emptyCounters(),
    ...(info.facts ? { facts: structuredClone(info.facts) } : {}),
  }
  liveCounters.delete(runId)
  writeRecords([...readRecords(), record])
  return record
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
  goalWorkflow: GoalWorkflowMetricsSummary
}

function measuredRate(numerator: number, denominator: number): MeasuredRate | undefined {
  return denominator > 0 ? { numerator, denominator, value: numerator / denominator } : undefined
}

function measuredAverage(total: number, observations: number): MeasuredAverage | undefined {
  return observations > 0 ? { total, observations, value: total / observations } : undefined
}

function measuredCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

type GoalWorkflowTotals = {
  execution: number; executionCompleted: number; goals: number; goalsPassed: number; goalsUnverifiable: number; goalsExhausted: number
  criteria: Map<string, { evaluated: number; failed: number }>; evidence: number; invalidated: number
  repairAttempts: number; repairSucceeded: number; impactedNodes: number; produced: number; accepted: number
  slotsUsed: number; slotsAvailable: number; fanout: number; workflowRuns: number; nodeAttempts: number; retriedNodes: number
  verifierTokens: number; verifierPassedArtifacts: number; finalizationAttempts: number; recoveries: number
  claimAttempts: number; claimConflicts: number; passIterations: number; passedWithIterations: number
}

function emptyGoalWorkflowTotals(): GoalWorkflowTotals {
  return {
    execution: 0, executionCompleted: 0, goals: 0, goalsPassed: 0, goalsUnverifiable: 0, goalsExhausted: 0,
    criteria: new Map(), evidence: 0, invalidated: 0, repairAttempts: 0, repairSucceeded: 0, impactedNodes: 0,
    produced: 0, accepted: 0, slotsUsed: 0, slotsAvailable: 0, fanout: 0, workflowRuns: 0,
    nodeAttempts: 0, retriedNodes: 0, verifierTokens: 0, verifierPassedArtifacts: 0,
    finalizationAttempts: 0, recoveries: 0, claimAttempts: 0, claimConflicts: 0,
    passIterations: 0, passedWithIterations: 0,
  }
}

function addGoalFacts(total: GoalWorkflowTotals, facts: GoalWorkflowMetricFacts): void {
  if (isRunExecutionSettlement(facts.executionSettlement)) {
    total.execution += 1
    if (facts.executionSettlement === 'completed') total.executionCompleted += 1
  }
  if (isGoalVerdict(facts.goalVerdict) && facts.goalVerdict !== 'not-applicable') {
    total.goals += 1
    if (facts.goalVerdict === 'passed') total.goalsPassed += 1
    if (facts.goalVerdict === 'unverifiable') total.goalsUnverifiable += 1
    if (facts.goalVerdict === 'exhausted') total.goalsExhausted += 1
    if (facts.goalVerdict === 'passed' && Number.isSafeInteger(facts.iterations) && Number(facts.iterations) >= 0) {
      total.passIterations += Number(facts.iterations)
      total.passedWithIterations += 1
    }
  }
  for (const criterion of facts.criteria || []) {
    if (typeof criterion.kind !== 'string' || !criterion.kind.trim()) continue
    const current = total.criteria.get(criterion.kind) || { evaluated: 0, failed: 0 }
    current.evaluated += measuredCount(criterion.evaluated)
    current.failed += measuredCount(criterion.failed)
    total.criteria.set(criterion.kind, current)
    total.evidence += measuredCount(criterion.evaluated)
    total.invalidated += measuredCount(criterion.invalidated)
  }
}

function addWorkflowFacts(total: GoalWorkflowTotals, facts: GoalWorkflowMetricFacts): void {
  if (facts.repair) {
    total.repairAttempts += measuredCount(facts.repair.attempts); total.repairSucceeded += measuredCount(facts.repair.succeeded)
    total.impactedNodes += measuredCount(facts.repair.impactedNodes)
  }
  if (facts.artifacts) {
    total.produced += measuredCount(facts.artifacts.produced); total.accepted += measuredCount(facts.artifacts.accepted)
  }
  if (facts.workflow) {
    total.slotsUsed += measuredCount(facts.workflow.parallelNodeSlotsUsed)
    total.slotsAvailable += measuredCount(facts.workflow.parallelNodeSlotsAvailable)
    total.fanout += measuredCount(facts.workflow.fanoutWidth); total.workflowRuns += 1
    total.nodeAttempts += measuredCount(facts.workflow.nodeAttempts); total.retriedNodes += measuredCount(facts.workflow.retriedNodes)
  }
  if (facts.verifier) {
    total.verifierTokens += measuredCount(facts.verifier.tokens)
    total.verifierPassedArtifacts += measuredCount(facts.verifier.passedArtifacts)
  }
  if (facts.finalization) {
    total.finalizationAttempts += measuredCount(facts.finalization.attempts)
    total.recoveries += measuredCount(facts.finalization.recoveries)
    total.claimAttempts += measuredCount(facts.finalization.claimAttempts)
    total.claimConflicts += measuredCount(facts.finalization.claimConflicts)
  }
}

export function goalWorkflowMetricsSummary(records: readonly RunMetricRecord[]): GoalWorkflowMetricsSummary {
  const total = emptyGoalWorkflowTotals()
  for (const record of records) {
    if (!record.facts) continue
    addGoalFacts(total, record.facts)
    addWorkflowFacts(total, record.facts)
  }
  return {
    executionCompletionRate: measuredRate(total.executionCompleted, total.execution),
    goalPassRate: measuredRate(total.goalsPassed, total.goals),
    goalUnverifiableRate: measuredRate(total.goalsUnverifiable, total.goals),
    goalExhaustedRate: measuredRate(total.goalsExhausted, total.goals),
    criterionFailureRate: Object.freeze(Object.fromEntries([...total.criteria]
      .filter(([, value]) => value.evaluated > 0)
      .map(([kind, value]) => [kind, measuredRate(value.failed, value.evaluated)!]))),
    evidenceInvalidationRate: measuredRate(total.invalidated, total.evidence),
    repairSuccessRate: measuredRate(total.repairSucceeded, total.repairAttempts),
    iterationsToPass: measuredAverage(total.passIterations, total.passedWithIterations),
    artifactKeepRate: measuredRate(total.accepted, total.produced),
    workflowParallelismRatio: measuredRate(total.slotsUsed, total.slotsAvailable),
    fanoutWidth: measuredAverage(total.fanout, total.workflowRuns),
    nodeRetryRate: measuredRate(total.retriedNodes, total.nodeAttempts),
    impactedSubgraphSize: measuredAverage(total.impactedNodes, total.repairAttempts),
    verifierTokensPerPassedArtifact: measuredRate(total.verifierTokens, total.verifierPassedArtifacts),
    finalizationRecoveryRate: measuredRate(total.recoveries, total.finalizationAttempts),
    finalizationClaimConflictRate: measuredRate(total.claimConflicts, total.claimAttempts),
  }
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
    goalWorkflow: goalWorkflowMetricsSummary(records),
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
