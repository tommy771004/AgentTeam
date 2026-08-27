/** Host-accountable qualification gate for immutable Memory-Control candidates. */
import type {
  MemoryControlPackage,
  MemoryControlPackageIdentity,
  MemoryControlPackageReader,
} from './memoryControlPackage.ts'
import { runEvaluationBatch } from './evaluationHarness.ts'
import { projectContextUsage } from './contextUsageProjection.ts'
import { turnRecordEntries } from './turnRecord.ts'
import type { HeadlessRunOptions } from './headlessRun.ts'
import type { WorkingGoalCompletionPredicate } from './workingState.ts'
import {
  canonicalMemoryControlEvaluationJson,
  type MemoryControlEvaluationMetrics,
  type MemoryControlEvaluationReport,
  type MemoryControlEvaluationRun,
  type MemoryControlEvaluationTraceRef,
  type MemoryControlRunMetrics,
} from './memoryControlEvaluationContract.ts'

export type { MemoryControlEvaluationReport } from './memoryControlEvaluationContract.ts'

export type MemoryControlEvaluationTask = {
  id: string
  objective: string
  loopType?: 'Turn-based' | 'Goal-based'
  runner?: 'builtin'
  workingGoal?: WorkingGoalCompletionPredicate
}

type MemoryControlExpectedOutcome = {
  requiredActions: readonly string[]
  requiredSkills: readonly string[]
  allowedSkills: readonly string[]
  maxPromptTokens: number
}

export type MemoryControlEvaluationCorpus = Readonly<{
  version: string
  tasks: ReadonlyArray<Readonly<MemoryControlEvaluationTask & { cohort: 'source-failure' | 'held-out-anchor' }>>
}>

export type MemoryControlEvaluationObservation = {
  taskId: string
  runId: string
  governingPackage: MemoryControlPackage | MemoryControlPackageIdentity
  taskSuccess: boolean
  definitionOfDoneMet: boolean
  successfulActions: readonly string[]
  invokedSkills: readonly string[]
  promptTokens: number
  traceRef: MemoryControlEvaluationTraceRef
}

export type MemoryControlEvaluationExecutor = (input: {
  tasks: ReadonlyArray<MemoryControlEvaluationTask>
  governingPackage: MemoryControlPackage
}) => Promise<ReadonlyArray<MemoryControlEvaluationObservation>>
const canonicalExecutors = new WeakSet<MemoryControlEvaluationExecutor>()

type SealedExpectedCorpus = ReadonlyMap<string, Readonly<MemoryControlExpectedOutcome>>
const sealedExpectations = new WeakMap<MemoryControlEvaluationCorpus, SealedExpectedCorpus>()
const SHA256 = /^[a-f0-9]{64}$/
const MAX_TASKS = 100
const MAX_TRACE_REFS = 64
const MAX_ID = 256

const frozen = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) frozen(child)
    Object.freeze(value)
  }
  return value
}

const boundedUniqueStrings = (values: readonly string[], label: string): readonly string[] => {
  if (!Array.isArray(values) || values.length > 100) throw new Error(`${label} exceeds bounds`)
  const normalized = values.map((value) => {
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_ID) throw new Error(`${label} is invalid`)
    return value.trim()
  })
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} contains duplicates`)
  return frozen(normalized)
}

function sealExpected(value: MemoryControlExpectedOutcome): Readonly<MemoryControlExpectedOutcome> {
  const requiredActions = boundedUniqueStrings(value.requiredActions, 'required actions')
  const requiredSkills = boundedUniqueStrings(value.requiredSkills, 'required Skills')
  const allowedSkills = boundedUniqueStrings(value.allowedSkills, 'allowed Skills')
  if (requiredSkills.some((skill) => !allowedSkills.includes(skill))) throw new Error('required Skills must be allowed')
  if (!Number.isSafeInteger(value.maxPromptTokens) || value.maxPromptTokens < 0 || value.maxPromptTokens > 100_000_000) {
    throw new Error('prompt token budget is invalid')
  }
  return frozen({ requiredActions, requiredSkills, allowedSkills, maxPromptTokens: value.maxPromptTokens })
}

/**
 * Clone and seal private expected outcomes. The returned corpus exposes only
 * runnable task inputs and cohort membership; neither package nor executor can
 * inspect or mutate the qualification answer key.
 */
export function sealMemoryControlEvaluationCorpus(input: {
  version: string
  sourceFailures: ReadonlyArray<{ task: MemoryControlEvaluationTask; expected: MemoryControlExpectedOutcome }>
  heldOutAnchors: ReadonlyArray<{ task: MemoryControlEvaluationTask; expected: MemoryControlExpectedOutcome }>
}): MemoryControlEvaluationCorpus {
  if (typeof input.version !== 'string' || !input.version.trim() || input.version.length > 128) throw new Error('evaluation corpus version is invalid')
  if (!input.sourceFailures.length || !input.heldOutAnchors.length
    || input.sourceFailures.length + input.heldOutAnchors.length > MAX_TASKS) {
    throw new Error('evaluation corpus requires bounded source failures and held-out anchors')
  }
  const expected = new Map<string, Readonly<MemoryControlExpectedOutcome>>()
  const tasks = [
    ...input.sourceFailures.map((entry) => ({ ...entry, cohort: 'source-failure' as const })),
    ...input.heldOutAnchors.map((entry) => ({ ...entry, cohort: 'held-out-anchor' as const })),
  ].map(({ task, expected: outcome, cohort }) => {
    if (typeof task.id !== 'string' || !task.id.trim() || task.id.length > MAX_ID
      || typeof task.objective !== 'string' || !task.objective.trim() || task.objective.length > 2_000
      || task.runner !== undefined && task.runner !== 'builtin') throw new Error('evaluation task is invalid')
    if (expected.has(task.id)) throw new Error(`evaluation task id is duplicated: ${task.id}`)
    expected.set(task.id, sealExpected(outcome))
    return frozen({ ...structuredClone(task), id: task.id.trim(), objective: task.objective.trim(), cohort })
  })
  const corpus = frozen({ version: input.version.trim(), tasks: frozen(tasks) })
  sealedExpectations.set(corpus, expected)
  return corpus
}

const identity = (value: MemoryControlPackage | MemoryControlPackageIdentity): MemoryControlPackageIdentity =>
  frozen({ id: value.id, revision: value.revision, digest: value.digest })

function assertObservation(
  observation: MemoryControlEvaluationObservation,
  taskId: string,
  governingPackage: MemoryControlPackage,
): void {
  if (observation.taskId !== taskId || !observation.runId || observation.runId.length > 512
    || observation.governingPackage.id !== governingPackage.id
    || observation.governingPackage.revision !== governingPackage.revision
    || observation.governingPackage.digest !== governingPackage.digest) {
    throw new Error(`evaluation observation does not belong to ${taskId} or its governing package`)
  }
  const trace = observation.traceRef
  if (trace.runId !== observation.runId || !Number.isSafeInteger(trace.firstSeq) || trace.firstSeq < 1
    || !Number.isSafeInteger(trace.lastSeq) || trace.lastSeq < trace.firstSeq
    || !Number.isSafeInteger(trace.entryCount) || trace.entryCount < 1 || trace.entryCount > 100_000
    || !SHA256.test(trace.digest)) throw new Error(`evaluation trace reference is invalid: ${taskId}`)
  if (!Number.isSafeInteger(observation.promptTokens) || observation.promptTokens < 0 || observation.promptTokens > 100_000_000) {
    throw new Error(`evaluation prompt token measurement is invalid: ${taskId}`)
  }
  boundedUniqueStrings(observation.successfulActions, 'observed successful actions')
  boundedUniqueStrings(observation.invokedSkills, 'observed invoked Skills')
}

function metricFor(
  observation: MemoryControlEvaluationObservation,
  expected: Readonly<MemoryControlExpectedOutcome>,
): MemoryControlRunMetrics {
  const actions = new Set(observation.successfulActions)
  const skills = new Set(observation.invokedSkills)
  const actionHits = expected.requiredActions.filter((action) => actions.has(action)).length
  const skillHits = expected.requiredSkills.filter((skill) => skills.has(skill)).length
  const justified = [...skills].filter((skill) => expected.allowedSkills.includes(skill)).length
  const requiredActionRecall = expected.requiredActions.length ? actionHits / expected.requiredActions.length : 1
  const skillInvocationReach = expected.requiredSkills.length ? skillHits / expected.requiredSkills.length : 1
  const skillInvocationPrecision = skills.size ? justified / skills.size : 1
  const evidenceComplete = requiredActionRecall === 1 && skillInvocationReach === 1
  return {
    taskSuccess: observation.taskSuccess && observation.definitionOfDoneMet && evidenceComplete,
    falseDone: observation.definitionOfDoneMet && (!observation.taskSuccess || !evidenceComplete),
    requiredActionRecall,
    skillInvocationPrecision,
    skillInvocationReach,
    promptTokens: observation.promptTokens,
  }
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

function reasonsFor(
  baseline: readonly MemoryControlEvaluationRun[],
  candidate: readonly MemoryControlEvaluationRun[],
  expected: SealedExpectedCorpus,
  maxRegressionRatio: number,
): string[] {
  const reasons: string[] = []
  for (const run of baseline) {
    if (run.cohort === 'held-out-anchor' && !run.metrics.taskSuccess) {
      reasons.push(`${run.taskId}: held-out baseline anchor is not successful`)
    }
  }
  const sourceImproved = candidate.some((run) => {
    if (run.cohort !== 'source-failure') return false
    const before = baseline.find((entry) => entry.taskId === run.taskId)!
    return Number(run.metrics.taskSuccess) > Number(before.metrics.taskSuccess)
      || run.metrics.requiredActionRecall > before.metrics.requiredActionRecall
      || run.metrics.skillInvocationReach > before.metrics.skillInvocationReach
  })
  if (!sourceImproved) reasons.push('candidate did not improve a source-failure task')
  for (const run of candidate) {
    const before = baseline.find((entry) => entry.taskId === run.taskId)!
    const outcome = expected.get(run.taskId)!
    if (run.metrics.falseDone) reasons.push(`${run.taskId}: false-done`)
    if (!run.metrics.taskSuccess) reasons.push(`${run.taskId}: task success requirement missed`)
    if (run.metrics.requiredActionRecall < 1 || run.metrics.requiredActionRecall < before.metrics.requiredActionRecall) {
      reasons.push(`${run.taskId}: required-action recall regression`)
    }
    if (run.metrics.skillInvocationReach < 1) reasons.push(`${run.taskId}: required Skill was missed`)
    if (run.metrics.skillInvocationPrecision < 1) reasons.push(`${run.taskId}: unjustified Skill invocation`)
    const comparativeLimit = Math.floor(before.metrics.promptTokens * (1 + maxRegressionRatio))
    if (run.metrics.promptTokens > outcome.maxPromptTokens || run.metrics.promptTokens > comparativeLimit) {
      reasons.push(`${run.taskId}: token regression exceeded explicit budget`)
    }
  }
  return [...new Set(reasons)]
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The only production executor constructor. It always enters through
 * runEvaluationBatch -> runHeadlessTask -> taskRunCoordinator.runTask. The
 * caller may select an isolated real Host bridge for a package, but cannot
 * replace the evaluator or receive the sealed expected outcomes.
 */
export function createCanonicalMemoryControlEvaluationExecutor(input: {
  runOptionsForPackage: (
    governingPackage: MemoryControlPackage,
  ) => Promise<Pick<HeadlessRunOptions, 'transport' | 'settingsPatch' | 'subagents'>>
}): MemoryControlEvaluationExecutor {
  const execute: MemoryControlEvaluationExecutor = async ({ tasks, governingPackage }) => {
    const options = await input.runOptionsForPackage(governingPackage)
    const batch = await runEvaluationBatch([...tasks], options)
    return Promise.all(batch.tasks.map(async (result): Promise<MemoryControlEvaluationObservation> => {
      const entries = turnRecordEntries(result.turnRecord)
      const packageEntry = entries.find((entry) => entry.kind === 'memory-control-package')
      if (!packageEntry || packageEntry.packageIdentity.id !== governingPackage.id
        || packageEntry.packageIdentity.revision !== governingPackage.revision
        || packageEntry.packageIdentity.digest !== governingPackage.digest) {
        throw new Error(`evaluation run ${result.id} did not use its governing Memory-Control Package ${governingPackage.revision}; observed ${packageEntry?.packageIdentity.revision ?? 'none'}; status=${result.status}; traceEntries=${entries.length}; output=${result.output.slice(0, 160)}`)
      }
      const successfulActions = [...new Set(entries.flatMap((entry) =>
        entry.kind === 'tool-result' && entry.settlement === 'success' ? [entry.tool] : []))]
      const invokedSkills = [...new Set(entries
        .filter((entry) => entry.kind === 'skill-invocation')
        .flatMap((entry) => entry.invocation.selectedSkills?.map((skill) => skill.id) || []))]
      const usage = projectContextUsage(result.turnRecord)
      const firstSeq = entries[0]?.seq
      const lastSeq = entries.at(-1)?.seq
      if (!result.runId || firstSeq === undefined || lastSeq === undefined || usage.measuredSteps < 1) {
        throw new Error(`evaluation run ${result.id} has no bounded Host trace or measured prompt tokens`)
      }
      return frozen({
        taskId: result.id,
        runId: result.runId,
        governingPackage: identity(governingPackage),
        taskSuccess: result.status === 'success',
        definitionOfDoneMet: result.journal?.dodMet === true,
        successfulActions,
        invokedSkills,
        promptTokens: usage.tokens.input,
        traceRef: {
          runId: result.runId,
          firstSeq,
          lastSeq,
          entryCount: entries.length,
          digest: await sha256(canonicalMemoryControlEvaluationJson(entries)),
        },
      })
    }))
  }
  canonicalExecutors.add(execute)
  return execute
}

/** Qualify through the canonical evaluator. Pi Host alone settles the report. */
export async function evaluateMemoryControlCandidate(input: {
  packages: MemoryControlPackageReader
  corpus: MemoryControlEvaluationCorpus
  candidateRevision: number
  tokenBudget: { maxRegressionRatio: number }
  execute: MemoryControlEvaluationExecutor
}): Promise<MemoryControlEvaluationReport> {
  if (!canonicalExecutors.has(input.execute)) throw new Error('Memory-Control evaluation requires the canonical headless executor')
  const expected = sealedExpectations.get(input.corpus)
  if (!expected) throw new Error('evaluation corpus was not sealed by this gate')
  const ratio = input.tokenBudget.maxRegressionRatio
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new Error('token regression budget is invalid')
  const candidatePackage = input.packages.read({ schemaVersion: 1, revision: input.candidateRevision })
  if (candidatePackage.status !== 'candidate' || candidatePackage.parentRevision === undefined) throw new Error('Memory-Control Package revision is not an inactive candidate')
  const baselinePackage = input.packages.read({ schemaVersion: 1, revision: candidatePackage.parentRevision })
  if (input.packages.lineage().activeRevision !== baselinePackage.revision) throw new Error('Memory-Control Package active revision changed before evaluation')
  const publicTasks = input.corpus.tasks.map(({ cohort: _cohort, ...task }) => frozen({ ...task }))
  const rejectedFailureReport = async (reason: string): Promise<MemoryControlEvaluationReport> => {
    const reportBody: Omit<MemoryControlEvaluationReport, 'reportId'> = {
      schemaVersion: 1,
      corpusVersion: input.corpus.version,
      baselinePackage: identity(baselinePackage),
      candidatePackage: identity(candidatePackage),
      decision: 'rejected',
      reasons: [reason.slice(0, 2_000)],
      tokenBudget: { maxRegressionRatio: ratio },
      runs: [],
      metrics: aggregate([]),
    }
    return frozen({ ...reportBody, reportId: await sha256(canonicalMemoryControlEvaluationJson(reportBody)) })
  }
  // Sequential by design: headless coordinator stores are process-global and
  // one phase must fully settle before the next Host lifecycle is admitted.
  let phases: readonly [ReadonlyArray<MemoryControlEvaluationObservation>, ReadonlyArray<MemoryControlEvaluationObservation>]
  try {
    phases = [
      await input.execute({ tasks: publicTasks, governingPackage: baselinePackage }),
      await input.execute({ tasks: publicTasks, governingPackage: candidatePackage }),
    ] as const
  } catch (error) {
    return rejectedFailureReport(`evaluation execution failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const project = (phase: 'baseline' | 'candidate', observations: ReadonlyArray<MemoryControlEvaluationObservation>, pkg: MemoryControlPackage) => {
    if (observations.length !== publicTasks.length) throw new Error(`${phase} evaluation result count is incomplete`)
    const byTask = new Map(observations.map((entry) => [entry.taskId, entry]))
    if (byTask.size !== observations.length) throw new Error(`${phase} evaluation task result is duplicated`)
    return input.corpus.tasks.map((task): MemoryControlEvaluationRun => {
      const observation = byTask.get(task.id)
      if (!observation) throw new Error(`${phase} evaluation task result is missing: ${task.id}`)
      assertObservation(observation, task.id, pkg)
      return frozen({
        phase,
        cohort: task.cohort,
        taskId: task.id,
        runId: observation.runId,
        governingPackage: identity(pkg),
        metrics: frozen(metricFor(observation, expected.get(task.id)!)),
        traceRef: frozen({ ...observation.traceRef }),
      })
    })
  }
  let baselineRuns: MemoryControlEvaluationRun[]
  let candidateRuns: MemoryControlEvaluationRun[]
  try {
    baselineRuns = project('baseline', phases[0], baselinePackage)
    candidateRuns = project('candidate', phases[1], candidatePackage)
  } catch (error) {
    return rejectedFailureReport(`evaluation projection failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const reasons = reasonsFor(baselineRuns, candidateRuns, expected, ratio)
  const decision = reasons.length ? 'rejected' as const : 'promoted' as const
  const candidateMetrics = aggregate(candidateRuns)
  const reportBody: Omit<MemoryControlEvaluationReport, 'reportId'> = {
    schemaVersion: 1,
    corpusVersion: input.corpus.version,
    baselinePackage: identity(baselinePackage),
    candidatePackage: identity(candidatePackage),
    decision,
    reasons,
    tokenBudget: { maxRegressionRatio: ratio },
    runs: [...baselineRuns, ...candidateRuns].slice(0, MAX_TRACE_REFS),
    metrics: candidateMetrics,
  }
  return frozen({ ...reportBody, reportId: await sha256(canonicalMemoryControlEvaluationJson(reportBody)) })
}
