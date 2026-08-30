import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readlink } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { ReviewAdmissionSnapshot, ReviewFileManifestEntry, ReviewWorkspaceBaseline } from '../src/agent/reviewContract.ts'
import type { ReviewArtifactFinalizeInput } from './reviewArtifactStore.ts'
import { captureReviewWorkspaceBaseline } from './reviewWorkspaceBinding.ts'

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
}

export type ReviewSnapshotCaptureResult = ReviewArtifactFinalizeInput & {
  diagnostics: string[]
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function git(cwd: string, args: string[], acceptOne = false): Promise<string> {
  try {
    return (await exec('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    if (acceptOne && failure.code === 1) return failure.stdout || ''
    throw new Error((failure.stderr || `git ${args[0]} failed`).trim())
  }
}

function splitZero(value: string): string[] {
  return value.split('\0').filter(Boolean)
}

type ChangedPath = { status: ReviewFileManifestEntry['status']; path: string; oldPath?: string }

function parseNameStatus(value: string): ChangedPath[] {
  const fields = splitZero(value)
  const changes: ChangedPath[] = []
  for (let index = 0; index < fields.length;) {
    const token = fields[index++] || ''
    const code = token[0]
    if (code === 'R' || code === 'C') {
      const oldPath = fields[index++] || ''
      const path = fields[index++] || ''
      changes.push({ status: code === 'R' ? 'renamed' : 'copied', path, oldPath })
      continue
    }
    const path = fields[index++] || ''
    const status: ReviewFileManifestEntry['status'] = code === 'A'
      ? 'added'
      : code === 'D'
        ? 'deleted'
        : code === 'T'
          ? 'type-changed'
          : 'modified'
    changes.push({ status, path })
  }
  return changes.filter((change) => change.path)
}

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

async function currentMode(cwd: string, path: string, untracked = false): Promise<string | undefined> {
  try {
    const info = await lstat(`${cwd}/${path}`)
    if (info.isSymbolicLink()) return '120000'
    if (info.isDirectory() && !untracked) {
      const line = (await git(cwd, ['ls-files', '-s', '--', path])).trim()
      if (line) return line.split(/\s+/, 1)[0]
    }
    return info.mode & 0o111 ? '100755' : '100644'
  } catch {
    return undefined
  }
}

async function filePatch(cwd: string, baseline: string, change: ChangedPath): Promise<string> {
  const paths = change.oldPath ? [change.oldPath, change.path] : [change.path]
  return git(cwd, ['diff', '--binary', '--no-ext-diff', '--find-renames', '--find-copies', baseline, '--', ...paths])
}

async function untrackedPatch(cwd: string, path: string): Promise<string> {
  const mode = await currentMode(cwd, path, true)
  if (mode === '120000') {
    const target = await readlink(`${cwd}/${path}`)
    return `diff --git a/${path} b/${path}\nnew file mode 120000\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+${target}\n\\ No newline at end of file\n`
  }
  return git(cwd, ['diff', '--no-index', '--binary', '--no-ext-diff', '--', '/dev/null', path], true)
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

  const cwd = workspace.worktreeRoot
  try {
    const [nameStatus, numstat, untrackedValue] = await Promise.all([
      git(cwd, ['diff', '--name-status', '-z', '--find-renames', '--find-copies', baseline.head, '--']),
      git(cwd, ['diff', '--numstat', '-z', '--find-renames', '--find-copies', baseline.head, '--']),
      git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
    ])
    const changes = parseNameStatus(nameStatus)
    for (const path of splitZero(untrackedValue)) changes.push({ status: 'untracked', path })
    const stats = parseNumstat(numstat)
    const manifest: ReviewFileManifestEntry[] = []
    const payloads: ReviewArtifactFinalizeInput['payloads'] = []
    let totalPayloadBytes = 0
    let capturePartial = false
    const captureDiagnostics: string[] = []
    for (const change of changes) {
      let patch = change.status === 'untracked'
        ? await untrackedPatch(cwd, change.path)
        : await filePatch(cwd, baseline.head, change)
      const patchBytes = Buffer.byteLength(patch, 'utf8')
      if (patchBytes > MAX_REVIEW_PAYLOAD_BYTES) {
        capturePartial = true
        patch = Buffer.from(patch, 'utf8').subarray(0, MAX_REVIEW_PAYLOAD_BYTES).toString('utf8')
      }
      const boundedBytes = Buffer.byteLength(patch, 'utf8')
      if (totalPayloadBytes + boundedBytes > MAX_REVIEW_TOTAL_BYTES) {
        capturePartial = true
        captureDiagnostics.push(`payload-omitted:${change.path}`)
        continue
      }
      totalPayloadBytes += boundedBytes
      if (patchBytes > MAX_REVIEW_PAYLOAD_BYTES) {
        // Keep the omission reason in the durable projection; a clipped patch
        // must never be presented as a complete historical file.
        captureDiagnostics.push(`payload-clipped:${change.path}`)
      }
      const payloadId = `patch_${hash(`${change.oldPath || ''}\0${change.path}\0${patch}`).slice(0, 32)}`
      payloads.push({ payloadId, content: patch })
      const stat = stats.get(change.path) || { binary: /GIT binary patch|Binary files/.test(patch) }
      manifest.push({
        path: change.path,
        ...(change.oldPath ? { oldPath: change.oldPath } : {}),
        status: change.status,
        oldMode: change.status === 'untracked' ? undefined : await treeMode(cwd, baseline.head, change.oldPath || change.path),
        newMode: change.status === 'deleted' ? undefined : await currentMode(cwd, change.path, change.status === 'untracked'),
        binary: stat.binary,
        ...(stat.additions === undefined ? {} : { additions: stat.additions }),
        ...(stat.removals === undefined ? {} : { removals: stat.removals }),
        payloadRef: payloadId,
      })
    }
    const changedPaths = manifest.flatMap((entry) => [entry.path, ...(entry.oldPath ? [entry.oldPath] : [])])
    const fidelity = decideFidelity({
      runnerKind: input.admission.runnerKind,
      isolatedWorktree: workspace.repoRoot !== undefined && workspace.worktreeRoot !== workspace.repoRoot,
      headChanged: settlement.head !== baseline.head,
      activeWorkspaceRuns: input.activeWorkspaceRuns || 1,
      contaminationReasons: [...new Set(input.contaminationReasons || [])],
      changedPaths,
      trustedPaths: normalizedPathSet(input.trustedMutations, input.admission.runId),
    })
    return {
      snapshotId: input.admission.snapshotId,
      status: capturePartial || fidelity.fidelity === 'partial' ? 'partial' : 'ready',
      attributionFidelity: capturePartial ? 'partial' : fidelity.fidelity,
      settlement,
      manifest,
      payloads,
      diagnostics: [...fidelity.diagnostics, ...captureDiagnostics, ...(capturePartial ? ['capture-incomplete'] : []), `settlement:${input.settlementKind || 'completed'}`],
    }
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
