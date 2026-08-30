import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import type { ReviewAdmissionSnapshot, ReviewFileManifestEntry, ReviewWorkspaceBaseline } from '../src/agent/reviewContract.ts'
import type { ReviewArtifactFinalizeInput } from './reviewArtifactStore.ts'
import { captureReviewWorkspaceBaseline } from './reviewWorkspaceBinding.ts'
import { parseGitNameStatus, type GitNameStatusChange } from './gitNameStatus.ts'

const exec = promisify(execFile)
const MAX_REVIEW_PAYLOAD_BYTES = 8 * 1024 * 1024
const MAX_REVIEW_TOTAL_BYTES = 32 * 1024 * 1024

export type TrustedReviewMutation = {
  source: 'host'
  runId: string
  callId: string
  tool: 'write' | 'edit' | 'delete' | 'move'
  paths: string[]
  settlement: 'success'
}

export type ReviewSnapshotCaptureInput = {
  admission: Extract<ReviewAdmissionSnapshot, { canonical: true }>
  threadId: string
  trustedMutations?: TrustedReviewMutation[]
  activeWorkspaceRuns?: number
  contaminationReasons?: string[]
  settlementKind?: 'completed' | 'failed' | 'cancelled' | 'timeout' | 'crash'
  capturedAt?: string
  /** Deterministic qualification override; protocol callers never receive this field. */
  qualificationLimits?: { payloadBytes: number; totalBytes: number }
}

export type ReviewSnapshotCaptureResult = ReviewArtifactFinalizeInput & {
  diagnostics: string[]
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    return (await exec('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    throw new Error((failure.stderr || `git ${args[0]} failed`).trim())
  }
}

function splitZero(value: string): string[] {
  return value.split('\0').filter(Boolean)
}

type FileStat = { additions?: number; removals?: number; binary: boolean }

function parseNumstat(value: string): Map<string, { additions?: number; removals?: number; binary: boolean }> {
  const result = new Map<string, { additions?: number; removals?: number; binary: boolean }>()
  const fields = splitZero(value)
  for (let index = 0; index < fields.length;) {
    const header = fields[index++] || ''
    const [added, removed, pathInHeader] = header.split('\t')
    let path = pathInHeader || ''
    if (!path) {
      // With -z, rename/copy numstat places old and new paths in the next fields.
      index += 1
      path = fields[index++] || ''
    }
    if (!path) continue
    const binary = added === '-' || removed === '-'
    result.set(path, {
      binary,
      ...(binary ? {} : { additions: Number(added), removals: Number(removed) }),
    })
  }
  return result
}

async function treeMode(cwd: string, ref: string, path: string): Promise<string | undefined> {
  const line = (await git(cwd, ['ls-tree', ref, '--', path])).trim()
  return line ? line.split(/\s+/, 1)[0] : undefined
}

async function filePatch(cwd: string, baseline: string, settlement: string, change: GitNameStatusChange): Promise<string> {
  const paths = change.oldPath ? [change.oldPath, change.path] : [change.path]
  return git(cwd, ['diff', '--binary', '--no-ext-diff', '--find-renames', '--find-copies', baseline, settlement, '--', ...paths])
}

function normalizedPathSet(mutations: TrustedReviewMutation[] | undefined, runId: string): Set<string> {
  const result = new Set<string>()
  for (const mutation of mutations || []) {
    if (mutation.source !== 'host' || mutation.runId !== runId || mutation.settlement !== 'success') continue
    for (const path of mutation.paths) result.add(path.replaceAll('\\', '/').replace(/^\.\//, ''))
  }
  return result
}

function decideFidelity(input: {
  runnerKind: 'builtin' | 'external'
  isolatedWorktree: boolean
  headChanged: boolean
  activeWorkspaceRuns: number
  contaminationReasons: string[]
  changedPaths: string[]
  trustedPaths: Set<string>
}): { fidelity: ReviewSnapshotCaptureResult['attributionFidelity']; diagnostics: string[] } {
  const diagnostics = [...input.contaminationReasons]
  if (input.runnerKind === 'external') {
    diagnostics.push('external-cli-writes-are-not-covered-by-host-mutation-evidence')
    return { fidelity: 'partial', diagnostics }
  }
  if (input.headChanged) diagnostics.push('head-changed-during-run')
  if (input.activeWorkspaceRuns > 1) diagnostics.push('parallel-runs-share-workspace')
  const trustedCoverage = input.changedPaths.length > 0 && input.changedPaths.every((path) => input.trustedPaths.has(path))
  if (input.isolatedWorktree && !input.headChanged && input.activeWorkspaceRuns <= 1 && diagnostics.length === 0) {
    return { fidelity: 'exact', diagnostics }
  }
  if (trustedCoverage && !input.headChanged && input.activeWorkspaceRuns <= 1 && diagnostics.length === 0) {
    return { fidelity: 'attributed', diagnostics }
  }
  if (!trustedCoverage && input.changedPaths.length > 0) diagnostics.push('changes-not-fully-covered-by-host-mutation-evidence')
  return { fidelity: input.contaminationReasons.includes('capture-incomplete') ? 'partial' : 'shared', diagnostics }
}

async function captureChangedFiles(
  cwd: string,
  baselineTree: string,
  settlementTree: string,
  changes: GitNameStatusChange[],
  stats: Map<string, FileStat>,
  limits: { payloadBytes: number; totalBytes: number },
): Promise<{ manifest: ReviewFileManifestEntry[]; payloads: ReviewArtifactFinalizeInput['payloads']; partial: boolean; diagnostics: string[] }> {
  const manifest: ReviewFileManifestEntry[] = []
  const payloads: ReviewArtifactFinalizeInput['payloads'] = []
  const diagnostics: string[] = []
  let totalPayloadBytes = 0
  let partial = false
  for (const change of changes) {
    let patch = await filePatch(cwd, baselineTree, settlementTree, change)
    const stat = stats.get(change.path) || { binary: /GIT binary patch|Binary files/.test(patch) }
    const manifestEntry = {
      path: change.path,
      ...(change.oldPath ? { oldPath: change.oldPath } : {}),
      status: change.status,
      oldMode: change.status === 'untracked' ? undefined : await treeMode(cwd, baselineTree, change.oldPath || change.path),
      newMode: change.status === 'deleted' ? undefined : await treeMode(cwd, settlementTree, change.path),
      binary: stat.binary,
      ...(stat.additions === undefined ? {} : { additions: stat.additions }),
      ...(stat.removals === undefined ? {} : { removals: stat.removals }),
    }
    const patchBytes = Buffer.byteLength(patch, 'utf8')
    if (patchBytes > limits.payloadBytes) {
      partial = true
      patch = Buffer.from(patch, 'utf8').subarray(0, limits.payloadBytes).toString('utf8')
      diagnostics.push(`payload-clipped:${change.path}`)
    }
    const boundedBytes = Buffer.byteLength(patch, 'utf8')
    if (totalPayloadBytes + boundedBytes > limits.totalBytes) {
      partial = true
      diagnostics.push(`payload-omitted:${change.path}:${boundedBytes}`)
      manifest.push(manifestEntry)
      continue
    }
    totalPayloadBytes += boundedBytes
    const payloadId = `patch_${hash(`${change.oldPath || ''}\0${change.path}\0${patch}`).slice(0, 32)}`
    payloads.push({ payloadId, content: patch })
    manifest.push({ ...manifestEntry, payloadRef: payloadId })
  }
  return { manifest, payloads, partial, diagnostics }
}

async function captureGitReview(
  input: ReviewSnapshotCaptureInput,
  cwd: string,
  baseline: ReviewWorkspaceBaseline,
  settlement: ReviewWorkspaceBaseline,
): Promise<ReviewSnapshotCaptureResult> {
  if (!baseline.workingTree || !settlement.workingTree) throw new Error('Working-tree baseline is unavailable')
  const [nameStatus, numstat, untrackedValue] = await Promise.all([
    git(cwd, ['diff', '--name-status', '-z', '--find-renames', '--find-copies', baseline.workingTree, settlement.workingTree, '--']),
    git(cwd, ['diff', '--numstat', '-z', '--find-renames', '--find-copies', baseline.workingTree, settlement.workingTree, '--']),
    git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])
  const untracked = new Set(splitZero(untrackedValue))
  const changes = parseGitNameStatus(nameStatus)
    .map((change) => change.status === 'added' && untracked.has(change.path) ? { ...change, status: 'untracked' as const } : change)
  const limits = input.qualificationLimits || { payloadBytes: MAX_REVIEW_PAYLOAD_BYTES, totalBytes: MAX_REVIEW_TOTAL_BYTES }
  const captured = await captureChangedFiles(cwd, baseline.workingTree, settlement.workingTree, changes, parseNumstat(numstat), limits)
  const changedPaths = captured.manifest.flatMap((entry) => [entry.path, ...(entry.oldPath ? [entry.oldPath] : [])])
  const workspace = input.admission.workspace!
  const fidelity = decideFidelity({
    runnerKind: input.admission.runnerKind,
    isolatedWorktree: workspace.repoRoot !== undefined && workspace.worktreeRoot !== workspace.repoRoot,
    headChanged: settlement.head !== baseline.head,
    activeWorkspaceRuns: input.activeWorkspaceRuns || 1,
    contaminationReasons: [...new Set(input.contaminationReasons || [])],
    changedPaths,
    trustedPaths: normalizedPathSet(input.trustedMutations, input.admission.runId),
  })
  const partial = captured.partial || fidelity.fidelity === 'partial'
  return {
    snapshotId: input.admission.snapshotId,
    status: partial ? 'partial' : 'ready',
    attributionFidelity: captured.partial ? 'partial' : fidelity.fidelity,
    settlement,
    manifest: captured.manifest,
    payloads: captured.payloads,
    diagnostics: [...fidelity.diagnostics, ...captured.diagnostics, ...(captured.partial ? ['capture-incomplete'] : []), `settlement:${input.settlementKind || 'completed'}`],
  }
}

/** Capture an immutable, Host-authored settlement snapshot without consulting model claims. */
export async function captureRunReviewSnapshot(input: ReviewSnapshotCaptureInput): Promise<ReviewSnapshotCaptureResult> {
  const workspace = input.admission.workspace
  const baseline = input.admission.baseline
  const capturedAt = input.capturedAt || new Date().toISOString()
  if (!workspace || !baseline) {
    return {
      snapshotId: input.admission.snapshotId,
      status: 'failed',
      attributionFidelity: 'partial',
      settlement: baseline || {
        capturedAt,
        indexRevision: hash(`missing-index:${input.admission.runId}`),
        workingRevision: hash(`missing-working:${input.admission.runId}`),
      },
      manifest: [],
      payloads: [],
      diagnostics: ['review-admission-baseline-unavailable'],
    }
  }
  let settlement: ReviewWorkspaceBaseline
  try {
    // Reuse the immutable admission binding; settlement must not resolve a
    // second project/worktree identity while the run is being finalized.
    settlement = await captureReviewWorkspaceBaseline(workspace, capturedAt)
  } catch (error) {
    return {
      snapshotId: input.admission.snapshotId,
      status: 'failed',
      attributionFidelity: 'partial',
      settlement: { capturedAt, indexRevision: baseline.indexRevision, workingRevision: baseline.workingRevision },
      manifest: [],
      payloads: [],
      diagnostics: ['settlement-workspace-capture-failed', error instanceof Error ? error.message : String(error)],
    }
  }
  if (workspace.mode !== 'git' || !workspace.worktreeRoot || !baseline.head) {
    return {
      snapshotId: input.admission.snapshotId,
      status: 'partial',
      attributionFidelity: 'partial',
      settlement,
      manifest: [],
      payloads: [],
      diagnostics: ['git-history-baseline-unavailable'],
    }
  }

  try {
    return await captureGitReview(input, workspace.worktreeRoot, baseline, settlement)
  } catch (error) {
    return {
      snapshotId: input.admission.snapshotId,
      status: 'failed',
      attributionFidelity: 'partial',
      settlement,
      manifest: [],
      payloads: [],
      diagnostics: ['snapshot-capture-failed', error instanceof Error ? error.message : String(error)],
    }
  }
}
