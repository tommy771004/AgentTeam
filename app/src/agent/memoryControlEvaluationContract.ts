import type { MemoryControlPackageIdentity } from './memoryControlPackage.ts'

export type MemoryControlEvaluationTraceRef = { runId: string; firstSeq: number; lastSeq: number; entryCount: number; digest: string }
export type MemoryControlRunMetrics = {
  taskSuccess: boolean; falseDone: boolean; requiredActionRecall: number
  skillInvocationPrecision: number; skillInvocationReach: number; promptTokens: number
}
export type MemoryControlEvaluationRun = {
  phase: 'baseline' | 'candidate'; cohort: 'source-failure' | 'held-out-anchor'
  taskId: string; runId: string; governingPackage: MemoryControlPackageIdentity
  metrics: MemoryControlRunMetrics; traceRef: MemoryControlEvaluationTraceRef
}
export type MemoryControlEvaluationMetrics = {
  taskSuccessRate: number; falseDoneRate: number; requiredActionRecall: number
  skillInvocationPrecision: number; skillInvocationReach: number; promptTokens: number
  tokensPerSuccess: number | null
}
export type MemoryControlEvaluationReport = {
  schemaVersion: 1; reportId: string; corpusVersion: string
  baselinePackage: MemoryControlPackageIdentity; candidatePackage: MemoryControlPackageIdentity
  decision: 'promoted' | 'rejected'; reasons: string[]
  tokenBudget: { maxRegressionRatio: number }; runs: MemoryControlEvaluationRun[]
  metrics: MemoryControlEvaluationMetrics
}

export function canonicalMemoryControlEvaluationJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalMemoryControlEvaluationJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalMemoryControlEvaluationJson(child)}`).join(',')}}`
}
