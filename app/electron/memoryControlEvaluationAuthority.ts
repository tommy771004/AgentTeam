import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { projectContextUsage } from '../src/agent/contextUsageProjection.ts'
import {
  canonicalMemoryControlEvaluationJson,
  type MemoryControlEvaluationMetrics,
  type MemoryControlEvaluationReport,
  type MemoryControlEvaluationRun,
  type MemoryControlRunMetrics,
} from '../src/agent/memoryControlEvaluationContract.ts'
import type { MemoryControlPackageIdentity } from '../src/agent/memoryControlPackage.ts'
import { TURN_RECORD_FORMAT_VERSION, type TurnRecord, type TurnRecordEntry } from '../src/agent/turnRecord.ts'

type ExpectedOutcome = { requiredActions: string[]; requiredSkills: string[]; allowedSkills: string[]; maxPromptTokens: number }
type CorpusTask = { id: string; cohort: 'source-failure' | 'held-out-anchor'; loopType?: 'Turn-based' | 'Goal-based'; expected: ExpectedOutcome }
type Corpus = { version: string; tasks: CorpusTask[] }
type SessionWithRecord = { id: string; record?: TurnRecord }

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const same = (left: unknown, right: unknown): boolean => canonicalMemoryControlEvaluationJson(left) === canonicalMemoryControlEvaluationJson(right)

function assertCorpusIdentity(corpus: Corpus, registry: ReadonlyMap<string, Corpus>): void {
  if (typeof corpus.version !== 'string' || !corpus.version || corpus.version.length > 128
    || !Array.isArray(corpus.tasks) || corpus.tasks.length < 1 || corpus.tasks.length > 32
    || registry.has(corpus.version)) throw new Error('Memory-Control evaluation corpus identity is invalid')
}

function assertCorpusTask(task: CorpusTask, ids: ReadonlySet<string>): void {
  const expected = task.expected
  if (typeof task.id !== 'string' || !task.id || task.id.length > 256 || ids.has(task.id)
    || !['source-failure', 'held-out-anchor'].includes(task.cohort)
    || task.loopType !== undefined && !['Turn-based', 'Goal-based'].includes(task.loopType)
    || !expected || !Array.isArray(expected.requiredActions) || !Array.isArray(expected.requiredSkills)
    || !Array.isArray(expected.allowedSkills) || !Number.isSafeInteger(expected.maxPromptTokens)
    || expected.maxPromptTokens < 0 || expected.maxPromptTokens > 100_000_000) throw new Error('Memory-Control evaluation corpus task is invalid')
}

function parseCorpusRegistry(value: unknown): Map<string, Corpus> {
  if (!value || typeof value !== 'object' || (value as { schemaVersion?: unknown }).schemaVersion !== 1
    || !Array.isArray((value as { corpora?: unknown }).corpora)) throw new Error('Memory-Control evaluation corpus registry is invalid')
  const registry = new Map<string, Corpus>()
  for (const raw of (value as { corpora: unknown[] }).corpora) {
    if (!raw || typeof raw !== 'object') throw new Error('Memory-Control evaluation corpus is invalid')
    const corpus = raw as Corpus
    assertCorpusIdentity(corpus, registry)
    const ids = new Set<string>()
    for (const task of corpus.tasks) {
      assertCorpusTask(task, ids)
      ids.add(task.id)
    }
    registry.set(corpus.version, structuredClone(corpus))
  }
  return registry
}

export type MemoryControlEvaluationAuthority = {
  verify(report: MemoryControlEvaluationReport, sessions: readonly SessionWithRecord[]): MemoryControlEvaluationReport
}

export async function loadMemoryControlEvaluationAuthority(path?: string): Promise<MemoryControlEvaluationAuthority | undefined> {
  if (!path) return undefined
  return createMemoryControlEvaluationAuthority(parseCorpusRegistry(JSON.parse(await readFile(path, 'utf8'))))
}

function traceEntries(run: MemoryControlEvaluationRun, sessions: readonly SessionWithRecord[]): TurnRecordEntry[] {
  for (const session of sessions) {
    const entries = session.record?.entries.filter((entry) => entry.seq >= run.traceRef.firstSeq && entry.seq <= run.traceRef.lastSeq) || []
    if (entries.length !== run.traceRef.entryCount || entries[0]?.seq !== run.traceRef.firstSeq || entries.at(-1)?.seq !== run.traceRef.lastSeq) continue
    if (sha256(canonicalMemoryControlEvaluationJson(entries)) === run.traceRef.digest) return entries
  }
  throw new Error(`Memory-Control evaluation trace is not present in the Host Turn Record: ${run.runId}`)
}

function packageMatches(entries: readonly TurnRecordEntry[], identity: MemoryControlPackageIdentity): boolean {
  return entries.some((entry) => entry.kind === 'memory-control-package'
    && entry.packageIdentity.id === identity.id && entry.packageIdentity.revision === identity.revision
    && entry.packageIdentity.digest === identity.digest)
}

/** Goal-based DoD is the final Host-committed ledger, never an intermediate accepted check. */
export function finalWorkingStateSatisfiesDoD(entries: readonly TurnRecordEntry[], runId: string): boolean {
  const state = entries
    .filter((entry): entry is Extract<TurnRecordEntry, { kind: 'working-state' }> =>
      entry.kind === 'working-state' && entry.state.runId === runId)
    .at(-1)?.state
  return Boolean(state?.goals.length
    && state.goals.every((goal) => goal.status === 'done' && goal.evidence.length > 0))
}

function runMetrics(run: MemoryControlEvaluationRun, task: CorpusTask, entries: TurnRecordEntry[]): MemoryControlRunMetrics {
  if (!packageMatches(entries, run.governingPackage)) throw new Error(`Memory-Control evaluation package is absent from Host trace: ${run.runId}`)
  const runBound = entries.some((entry) => entry.kind === 'working-state' && entry.state.runId === run.runId)
    || entries.some((entry) => entry.kind === 'tool-evidence' && entry.runId === run.runId)
  if (!runBound) throw new Error(`Memory-Control evaluation run id is absent from Host trace: ${run.runId}`)
  const actions = new Set(entries.flatMap((entry) => entry.kind === 'tool-result' && entry.settlement === 'success' ? [entry.tool] : []))
  const skills = new Set(entries.flatMap((entry) => entry.kind === 'skill-invocation' ? entry.invocation.selectedSkills?.map((skill) => skill.id) || [] : []))
  const expected = task.expected
  const requiredActionRecall = expected.requiredActions.length ? expected.requiredActions.filter((action) => actions.has(action)).length / expected.requiredActions.length : 1
  const skillInvocationReach = expected.requiredSkills.length ? expected.requiredSkills.filter((skill) => skills.has(skill)).length / expected.requiredSkills.length : 1
  const skillInvocationPrecision = skills.size ? [...skills].filter((skill) => expected.allowedSkills.includes(skill)).length / skills.size : 1
  const settled = entries.some((entry) => entry.kind === 'turn-end' && entry.settlement === 'answered')
  const dodMet = task.loopType === 'Goal-based'
    ? finalWorkingStateSatisfiesDoD(entries, run.runId)
    : settled
  const evidenceComplete = requiredActionRecall === 1 && skillInvocationReach === 1
  const usage = projectContextUsage({ version: TURN_RECORD_FORMAT_VERSION, entries })
  return { taskSuccess: settled && dodMet && evidenceComplete, falseDone: dodMet && (!settled || !evidenceComplete), requiredActionRecall, skillInvocationPrecision, skillInvocationReach, promptTokens: usage.tokens.input }
}

function aggregate(runs: readonly MemoryControlEvaluationRun[]): MemoryControlEvaluationMetrics {
  const count = runs.length || 1
  const successes = runs.filter((run) => run.metrics.taskSuccess).length
  const promptTokens = runs.reduce((sum, run) => sum + run.metrics.promptTokens, 0)
  return {
    taskSuccessRate: successes / count,
    falseDoneRate: runs.filter((run) => run.metrics.falseDone).length / count,
    requiredActionRecall: runs.reduce((sum, run) => sum + run.metrics.requiredActionRecall, 0) / count,
    skillInvocationPrecision: runs.reduce((sum, run) => sum + run.metrics.skillInvocationPrecision, 0) / count,
    skillInvocationReach: runs.reduce((sum, run) => sum + run.metrics.skillInvocationReach, 0) / count,
    promptTokens,
    tokensPerSuccess: successes ? promptTokens / successes : null,
  }
}

function reasonsFor(baseline: MemoryControlEvaluationRun[], candidate: MemoryControlEvaluationRun[], tasks: Map<string, CorpusTask>, ratio: number): string[] {
  const reasons: string[] = []
  for (const run of baseline) if (run.cohort === 'held-out-anchor' && !run.metrics.taskSuccess) reasons.push(`${run.taskId}: held-out baseline anchor is not successful`)
  const improved = candidate.some((run) => {
    if (run.cohort !== 'source-failure') return false
    const before = baseline.find((entry) => entry.taskId === run.taskId)!
    return Number(run.metrics.taskSuccess) > Number(before.metrics.taskSuccess) || run.metrics.requiredActionRecall > before.metrics.requiredActionRecall || run.metrics.skillInvocationReach > before.metrics.skillInvocationReach
  })
  if (!improved) reasons.push('candidate did not improve a source-failure task')
  for (const run of candidate) {
    const before = baseline.find((entry) => entry.taskId === run.taskId)!
    const task = tasks.get(run.taskId)!
    if (run.metrics.falseDone) reasons.push(`${run.taskId}: false-done`)
    if (!run.metrics.taskSuccess) reasons.push(`${run.taskId}: task success requirement missed`)
    if (run.metrics.requiredActionRecall < 1 || run.metrics.requiredActionRecall < before.metrics.requiredActionRecall) reasons.push(`${run.taskId}: required-action recall regression`)
    if (run.metrics.skillInvocationReach < 1) reasons.push(`${run.taskId}: required Skill was missed`)
    if (run.metrics.skillInvocationPrecision < 1) reasons.push(`${run.taskId}: unjustified Skill invocation`)
    if (run.metrics.promptTokens > task.expected.maxPromptTokens || run.metrics.promptTokens > Math.floor(before.metrics.promptTokens * (1 + ratio))) reasons.push(`${run.taskId}: token regression exceeded explicit budget`)
  }
  return [...new Set(reasons)]
}

function createMemoryControlEvaluationAuthority(registry: Map<string, Corpus>): MemoryControlEvaluationAuthority {
  return { verify(report, sessions) {
    const corpus = registry.get(report.corpusVersion)
    if (!corpus) throw new Error('Memory-Control evaluation corpus is not registered in the Host')
    const tasks = new Map(corpus.tasks.map((task) => [task.id, task]))
    if (report.runs.length !== corpus.tasks.length * 2) throw new Error('Memory-Control evaluation run set does not cover the Host corpus')
    const verifiedRuns = report.runs.map((run) => {
      const task = tasks.get(run.taskId)
      if (!task || task.cohort !== run.cohort) throw new Error('Memory-Control evaluation run does not match the Host corpus')
      const verified = { ...run, metrics: runMetrics(run, task, traceEntries(run, sessions)) }
      if (!same(verified, run)) throw new Error(`Memory-Control evaluation run metrics do not match Host evidence: ${run.phase}/${run.taskId}/${run.runId}; expected=${canonicalMemoryControlEvaluationJson(verified.metrics)}; supplied=${canonicalMemoryControlEvaluationJson(run.metrics)}`)
      return verified
    })
    for (const phase of ['baseline', 'candidate'] as const) for (const task of corpus.tasks) {
      if (verifiedRuns.filter((run) => run.phase === phase && run.taskId === task.id).length !== 1) throw new Error('Memory-Control evaluation run pairing does not match the Host corpus')
    }
    const baseline = verifiedRuns.filter((run) => run.phase === 'baseline')
    const candidate = verifiedRuns.filter((run) => run.phase === 'candidate')
    const metrics = aggregate(candidate)
    const reasons = reasonsFor(baseline, candidate, tasks, report.tokenBudget.maxRegressionRatio)
    const decision = reasons.length ? 'rejected' as const : 'promoted' as const
    const body = { ...report, runs: verifiedRuns, metrics, reasons, decision } as MemoryControlEvaluationReport
    const { reportId: _reportId, ...withoutId } = body
    const reportId = sha256(canonicalMemoryControlEvaluationJson(withoutId))
    if (!same({ ...body, reportId }, report)) throw new Error('Memory-Control evaluation report does not match Host corpus and Turn Record evidence')
    return structuredClone(report)
  } }
}
