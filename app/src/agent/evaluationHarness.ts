/** Fixed-task evaluation harness; development/evaluation seam only. */
import { loadArtifactIndexes, type ArtifactIndex } from './artifactIndex.ts'
import {
  listJournalEntries,
  listRecoveryReports,
  type JournalEntry,
  type RecoveryReport,
} from './runJournal.ts'
import { runHeadlessTask, type HeadlessRunOptions } from './headlessRun.ts'
import type { LoopType } from './types.ts'

export type EvaluationTask = {
  id: string
  objective: string
  loopType?: LoopType
  runner?: 'builtin' | 'codex' | 'claude' | 'grok' | 'opencode' | 'gemini' | 'cursor'
}

export type EvaluationTaskResult = {
  id: string
  objective: string
  runId?: string
  status: string
  output: string
  journal?: JournalEntry
  artifact?: ArtifactIndex
  score: number
}

export type EvaluationBatchResult = {
  generatedAt: string
  tasks: EvaluationTaskResult[]
  journal: JournalEntry[]
  artifacts: ArtifactIndex[]
  recoveryReports: RecoveryReport[]
  score: number
}

function evaluationStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  } as Storage
}

function scoreTask(status: string, artifact: ArtifactIndex | undefined): number {
  if (status !== 'success') return 0
  const evidence = artifact?.entries.filter((entry) => entry.status === 'complete').length || 0
  return evidence > 0 ? 1 : 0.5
}

/** Run fixed tasks sequentially through the canonical headless coordinator. */
export async function runEvaluationBatch(
  tasks: EvaluationTask[],
  opts: Pick<HeadlessRunOptions, 'transport' | 'settingsPatch'> = {},
): Promise<EvaluationBatchResult> {
  const results: EvaluationTaskResult[] = []
  const storage = evaluationStorage()
  for (const task of tasks) {
    const run = await runHeadlessTask({
      objective: task.objective,
      runner: task.runner || 'builtin',
      loopType: task.loopType,
      transport: opts.transport,
      settingsPatch: opts.settingsPatch,
      storage,
      overrides: { useLlm: false },
    })
    const journal = listJournalEntries(storage).find((entry) => entry.runId === run.runId)
    const artifact = loadArtifactIndexes(storage).find(
      (index) => index.runId === run.runId,
    )
    const score = scoreTask(run.status, artifact)
    results.push({
      id: task.id,
      objective: task.objective,
      runId: run.runId,
      status: run.status,
      output: String(run.result || run.error || ''),
      journal,
      artifact,
      score,
    })
  }
  const journal = listJournalEntries(storage)
  const artifacts = loadArtifactIndexes(storage)
  return {
    generatedAt: new Date().toISOString(),
    tasks: results,
    journal,
    artifacts,
    recoveryReports: listRecoveryReports(storage),
    score: results.length
      ? results.reduce((sum, result) => sum + result.score, 0) / results.length
      : 0,
  }
}
