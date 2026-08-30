import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { ReviewWorkspaceBinding } from '../src/agent/reviewContract.ts'
import type {
  ReviewMutationApproval,
  ReviewMutationIntent,
  ReviewMutationPreview,
  ReviewMutationReceipt,
} from '../src/agent/reviewMutationContract.ts'
import { captureReviewWorkspaceAdmission } from './reviewWorkspaceBinding.ts'

const PREVIEW_TTL_MS = 5 * 60 * 1000
const MAX_PATCH_BYTES = 512 * 1024

type StoredPreview = ReviewMutationPreview & { cwd: string }

export class ReviewMutationError extends Error {
  readonly code: 'invalid' | 'stale' | 'missing' | 'unsupported' | 'approval_required' | 'apply_failed'

  constructor(code: ReviewMutationError['code'], message: string) {
    super(message)
    this.name = 'ReviewMutationError'
    this.code = code
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function validatePath(path: string): void {
  const normalized = path.replaceAll('\\', '/')
  if (!normalized || isAbsolute(path) || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../') || normalized.includes('\0')) {
    throw new ReviewMutationError('invalid', 'Review mutation path must be project-relative and cannot traverse the workspace')
  }
}

async function assertSafePath(cwd: string, path: string): Promise<void> {
  validatePath(path)
  const absolute = resolve(cwd, path)
  const parent = await realpath(dirname(absolute))
  if (relative(cwd, parent).startsWith('..')) throw new ReviewMutationError('invalid', 'Review mutation path escapes the worktree')
  try {
    if ((await lstat(absolute)).isSymbolicLink()) throw new ReviewMutationError('unsupported', 'Symlink mutations require an explicit non-review workflow')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function runGit(cwd: string, args: string[], stdin?: string, accepted = new Set([0])): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn('git', ['-C', cwd, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
    child.on('error', reject)
    child.on('close', (code) => {
      const exitCode = code ?? 1
      const result = { stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode }
      if (accepted.has(exitCode)) resolveRun(result)
      else reject(new ReviewMutationError('apply_failed', result.stderr.trim() || `git ${args[0]} failed (${exitCode})`))
    })
    child.stdin.end(stdin)
  })
}

function selectHunk(patch: string, hunkIndex: number): string {
  if (!Number.isInteger(hunkIndex) || hunkIndex < 0) throw new ReviewMutationError('invalid', 'Invalid hunk index')
  const firstHunk = patch.search(/^@@ /m)
  if (firstHunk < 0) throw new ReviewMutationError('unsupported', 'Binary, rename-only, and mode-only changes support file actions only')
  const header = patch.slice(0, firstHunk)
  const hunks = patch.slice(firstHunk).split(/(?=^@@ )/m).filter(Boolean)
  const hunk = hunks[hunkIndex]
  if (!hunk) throw new ReviewMutationError('missing', 'Selected hunk is no longer available')
  return `${header}${hunk}`
}

function patchStats(patch: string): { additions: number; removals: number; binary: boolean } {
  let additions = 0
  let removals = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
    if (line.startsWith('-') && !line.startsWith('---')) removals += 1
  }
  return { additions, removals, binary: /GIT binary patch|Binary files/.test(patch) }
}

export class ReviewMutationCoordinator {
  private readonly previews = new Map<string, StoredPreview>()
  private mutationTail: Promise<void> = Promise.resolve()
  private readonly options: {
    resolveWorkspace: (workspaceId: string) => ReviewWorkspaceBinding | undefined
    recoveryDir: string
  }

  constructor(options: {
    resolveWorkspace: (workspaceId: string) => ReviewWorkspaceBinding | undefined
    recoveryDir: string
  }) { this.options = options }

  private async baseline(workspace: ReviewWorkspaceBinding) {
    const admission = await captureReviewWorkspaceAdmission({ runId: `review-mutation:${workspace.workspaceId}`, projectRoot: workspace.projectRoot, runnerKind: 'builtin' })
    if (!admission.canonical || !admission.baseline) throw new ReviewMutationError('missing', 'Workspace revision is unavailable')
    return admission.baseline
  }

  private async revision(workspace: ReviewWorkspaceBinding, operation: ReviewMutationIntent['operation']): Promise<string> {
    const baseline = await this.baseline(workspace)
    return operation === 'unstage' ? baseline.indexRevision : baseline.workingRevision
  }

  async preview(intent: ReviewMutationIntent): Promise<ReviewMutationPreview> {
    const allowedTarget = intent.operation === 'unstage' ? 'staged' : 'live-working-tree'
    if (intent.target.kind !== allowedTarget) throw new ReviewMutationError('invalid', `${intent.operation} does not accept ${intent.target.kind}`)
    if (intent.expectedRevision !== intent.target.revision) throw new ReviewMutationError('stale', 'Expected revision does not match the selected review target')
    const workspace = this.options.resolveWorkspace(intent.target.workspaceId)
    if (!workspace || workspace.mode !== 'git' || !workspace.worktreeRoot) throw new ReviewMutationError('unsupported', 'Git mutation requires a bound worktree')
    await assertSafePath(workspace.worktreeRoot, intent.selection.path)
    if (await this.revision(workspace, intent.operation) !== intent.expectedRevision) throw new ReviewMutationError('stale', 'Workspace changed before mutation preview')
    const scope = intent.operation === 'unstage' ? ['--cached'] : []
    let patch = (await runGit(workspace.worktreeRoot, ['diff', '--binary', '--no-ext-diff', ...scope, '--', intent.selection.path])).stdout
    if (!patch && intent.operation === 'stage') {
      patch = (await runGit(workspace.worktreeRoot, ['diff', '--no-index', '--binary', '--', '/dev/null', intent.selection.path], undefined, new Set([0, 1]))).stdout
    }
    if (!patch) throw new ReviewMutationError('missing', 'Selected file has no change in this review target')
    if (intent.selection.kind === 'hunk') patch = selectHunk(patch, intent.selection.hunkIndex)
    if (Buffer.byteLength(patch, 'utf8') > MAX_PATCH_BYTES) throw new ReviewMutationError('unsupported', 'Selected patch exceeds the mutation safety limit')
    const stats = patchStats(patch)
    const id = `review_mutation_${randomUUID().replaceAll('-', '')}`
    const preview: StoredPreview = {
      id, operation: intent.operation, workspaceId: workspace.workspaceId, expectedRevision: intent.expectedRevision,
      selection: structuredClone(intent.selection), patchHash: sha256(patch), patchBytes: Buffer.byteLength(patch, 'utf8'),
      ...stats, expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(), patch, cwd: workspace.worktreeRoot,
    }
    this.previews.set(id, preview)
    const { cwd: _cwd, ...projection } = preview
    return projection
  }

  describePreview(previewId: string): ReviewMutationPreview {
    const preview = this.previews.get(previewId)
    if (!preview) throw new ReviewMutationError('missing', 'Mutation preview is missing or already consumed')
    const { cwd: _cwd, ...projection } = preview
    return structuredClone(projection)
  }

  async apply(previewId: string, approval: ReviewMutationApproval): Promise<ReviewMutationReceipt> {
    const operation = this.mutationTail.then(() => this.applyExclusive(previewId, approval))
    this.mutationTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async applyExclusive(previewId: string, approval: ReviewMutationApproval): Promise<ReviewMutationReceipt> {
    const preview = this.previews.get(previewId)
    if (!preview) throw new ReviewMutationError('missing', 'Mutation preview is missing or already consumed')
    if (Date.parse(preview.expiresAt) <= Date.now()) { this.previews.delete(previewId); throw new ReviewMutationError('stale', 'Mutation preview expired') }
    if (approval.source !== 'electron-main') throw new ReviewMutationError('approval_required', 'Host mutation requires Electron main approval')
    if (approval.decision !== 'allow') {
      this.previews.delete(previewId)
      return { previewId, operation: preview.operation, status: approval.decision === 'deny' ? 'denied' : 'cancelled', previousRevision: preview.expectedRevision, revision: preview.expectedRevision, patchHash: preview.patchHash, audit: approval }
    }
    const workspace = this.options.resolveWorkspace(preview.workspaceId)
    if (!workspace) throw new ReviewMutationError('missing', 'Workspace binding is missing')
    if (await this.revision(workspace, preview.operation) !== preview.expectedRevision) throw new ReviewMutationError('stale', 'Workspace changed after preview; no mutation was applied')
    const reverse = preview.operation === 'stage' ? [] : ['-R']
    const cached = preview.operation === 'stage' || preview.operation === 'unstage' ? ['--cached'] : []
    const args = ['apply', ...cached, ...reverse, '--whitespace=nowarn', '-']
    await runGit(preview.cwd, [...args.slice(0, -1), '--check', '-'], preview.patch)
    let recoveryRef: string | undefined
    if (preview.operation === 'revert') {
      await mkdir(this.options.recoveryDir, { recursive: true, mode: 0o700 })
      recoveryRef = resolve(this.options.recoveryDir, `${preview.id}.patch`)
      await writeFile(recoveryRef, preview.patch, { flag: 'wx', mode: 0o600 })
    }
    await runGit(preview.cwd, args, preview.patch)
    const baseline = await this.baseline(workspace)
    const revision = preview.operation === 'stage' ? baseline.indexRevision : baseline.workingRevision
    this.previews.delete(previewId)
    return { previewId, operation: preview.operation, status: 'applied', previousRevision: preview.expectedRevision, revision, workingRevision: baseline.workingRevision, indexRevision: baseline.indexRevision, patchHash: preview.patchHash, ...(recoveryRef ? { recoveryRef } : {}), audit: approval }
  }
}
