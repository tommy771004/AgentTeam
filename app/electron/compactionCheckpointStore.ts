import fs from 'node:fs'
import path from 'node:path'
import type { CompactionCheckpoint, CompactionCheckpointSaveInput } from '../src/agent/compactionCheckpoint'
import { isGoalRuntimeCheckpoint } from '../src/agent/goalRuntimeCheckpoint.ts'

/**
 * Durable pre-compaction transcripts, one file per run.
 *
 * Sharding by run is what removes the old renderer limits: there is no shared
 * quota to exhaust and therefore no reason to degrade a checkpoint to a bare
 * summary. A run's checkpoints are removed only when that run's history is
 * explicitly dropped, so nothing evicts a record the resume path still needs.
 */
export class JsonCompactionCheckpointStore {
  private readonly rootDir: string

  constructor(rootDir: string) {
    this.rootDir = rootDir
  }

  save(input: CompactionCheckpointSaveInput): { ok: boolean; checkpoint?: CompactionCheckpoint; error?: string } {
    const runId = input.runId.trim()
    if (!runId) return { ok: false, error: 'runId is required' }
    if (input.goalRuntime && !isGoalRuntimeCheckpoint(input.goalRuntime)) {
      return { ok: false, error: 'goal runtime checkpoint is malformed' }
    }
    try {
      const existing = this.list(runId)
      const checkpoint: CompactionCheckpoint = {
        runId,
        threadId: input.threadId,
        at: new Date().toISOString(),
        summary: String(input.summary || '').slice(0, 32_000),
        messageCount: Array.isArray(input.messages) ? input.messages.length : 0,
        messages: Array.isArray(input.messages) ? input.messages : [],
        // Durable storage keeps the whole transcript; nothing is dropped here.
        truncated: false,
        sequence: existing.length + 1,
        objective: input.objective?.slice(0, 400),
        parkedAtToolBoundary: input.parkedAtToolBoundary === true,
        // Replay safety is asserted by the writer, never inferred here: only a
        // checkpoint taken at a clean tool boundary can support the claim.
        replaySafe: input.replaySafe === true && input.parkedAtToolBoundary === true,
        effects: Array.isArray(input.effects) ? input.effects.slice(0, 500).map(String) : [],
        reason: input.reason,
        sourceHash: input.sourceHash,
        estimatedTokens: Number.isFinite(input.estimatedTokens) ? Math.max(0, Math.floor(input.estimatedTokens!)) : undefined,
        contextWindow: Number.isFinite(input.contextWindow) ? Math.max(0, Math.floor(input.contextWindow!)) : undefined,
        manifest: input.manifest ? structuredClone(input.manifest) : undefined,
        workingStateRevision: input.workingStateRevision,
        workingState: input.workingState ? structuredClone(input.workingState) : undefined,
        governingPackage: input.governingPackage ? structuredClone(input.governingPackage) : undefined,
        continuationItems: input.continuationItems ? structuredClone(input.continuationItems) : undefined,
        goalRuntime: input.goalRuntime ? structuredClone(input.goalRuntime) : undefined,
      }
      const file = this.fileFor(runId, checkpoint.sequence || existing.length + 1)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const tempPath = `${file}.${process.pid}.tmp`
      fs.writeFileSync(tempPath, JSON.stringify(checkpoint), { mode: 0o600 })
      fs.renameSync(tempPath, file)
      return { ok: true, checkpoint }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'checkpoint write failed' }
    }
  }

  /** The most recent checkpoint for a run — what a resume continues from. */
  load(runId: string): CompactionCheckpoint | null {
    const all = this.list(runId)
    return all.length ? all[all.length - 1] : null
  }

  /** Oldest first. Without a runId, every run's checkpoints. */
  list(runId?: string): CompactionCheckpoint[] {
    const target = runId?.trim()
    const dirs = target ? [this.dirFor(target)] : this.allRunDirs()
    const records: CompactionCheckpoint[] = []
    for (const dir of dirs) {
      let names: string[]
      try {
        names = fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
      } catch {
        continue
      }
      for (const name of names.sort()) {
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as CompactionCheckpoint
          if (parsed && typeof parsed.runId === 'string') records.push(parsed)
        } catch {
          /* A single unreadable checkpoint must not hide the rest. */
        }
      }
    }
    return records.sort((left, right) => (left.sequence || 0) - (right.sequence || 0))
  }

  /**
   * Claim the newest checkpoint of a run for exactly one resume.
   *
   * The claim marker is written to disk before the caller is told it may
   * proceed, so a crash between claim and resume loses the resume rather than
   * duplicating it — the safe direction when side effects are at stake.
   */
  claimResume(runId: string): { ok: boolean; checkpoint?: CompactionCheckpoint; reason?: string } {
    const latest = this.load(runId)
    if (!latest) return { ok: false, reason: 'no-checkpoint' }
    if (latest.resumeClaimedAt) return { ok: false, reason: 'already-claimed', checkpoint: latest }
    if (latest.replaySafe !== true) return { ok: false, reason: 'not-replay-safe', checkpoint: latest }
    const claimed: CompactionCheckpoint = { ...latest, resumeClaimedAt: new Date().toISOString() }
    const file = this.fileFor(runId, claimed.sequence || 1)
    const claimPath = `${file}.resume-claim`
    let claimHandle: number | undefined
    try {
      claimHandle = fs.openSync(claimPath, 'wx', 0o600)
      fs.closeSync(claimHandle)
      claimHandle = undefined
      const tempPath = `${file}.${process.pid}.tmp`
      fs.writeFileSync(tempPath, JSON.stringify(claimed), { mode: 0o600 })
      fs.renameSync(tempPath, file)
      return { ok: true, checkpoint: claimed }
    } catch (error) {
      if (claimHandle !== undefined) fs.closeSync(claimHandle)
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { ok: false, reason: 'already-claimed', checkpoint: latest }
      try { fs.rmSync(claimPath, { force: true }) } catch { /* retry remains fail-closed */ }
      return { ok: false, reason: error instanceof Error ? error.message : 'claim write failed' }
    }
  }

  remove(runId: string): { ok: boolean } {
    try {
      fs.rmSync(this.dirFor(runId), { recursive: true, force: true })
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }

  private allRunDirs(): string[] {
    try {
      return fs
        .readdirSync(this.rootDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(this.rootDir, entry.name))
    } catch {
      return []
    }
  }

  private dirFor(runId: string): string {
    return path.join(this.rootDir, safeSegment(runId))
  }

  private fileFor(runId: string, sequence: number): string {
    return path.join(this.dirFor(runId), `${String(sequence).padStart(4, '0')}.json`)
  }
}

/** Run ids come from the coordinator, but a path segment is never trusted. */
function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'unknown-run'
}
