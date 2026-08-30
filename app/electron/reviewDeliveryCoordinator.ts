import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { ReviewWorkspaceBinding } from '../src/agent/reviewContract.ts'
import type {
  ReviewDeliveryApproval,
  ReviewDeliveryFailureCode,
  ReviewDeliveryIntent,
  ReviewDeliveryPreview,
  ReviewDeliveryReceipt,
} from '../src/agent/reviewDeliveryContract.ts'
import { captureReviewWorkspaceAdmission } from './reviewWorkspaceBinding.ts'

const PREVIEW_TTL_MS = 5 * 60 * 1000
const MAX_TEXT_BYTES = 16 * 1024
const MAX_DIAGNOSTIC_BYTES = 8 * 1024

type CommandResult = { exitCode: number; stdout: string; stderr: string }
type StoredPreview = ReviewDeliveryPreview & { intent: ReviewDeliveryIntent; cwd: string }
type GitWorkspace = ReviewWorkspaceBinding & { worktreeRoot: string }
type PreviewProjection = Omit<ReviewDeliveryPreview, 'id' | 'expiresAt'>
type PreparedPreview = { intent: ReviewDeliveryIntent; projection: PreviewProjection }
type CommitIdentity = {
  id: string
  workspaceId: string
  commitOid: string
  treeOid: string
  branch: string
  committedIndexRevision: string
}
type PushIdentity = CommitIdentity & { pushId: string; remote: string }
export type ReviewPullRequestAdapter = {
  find(input: { cwd: string; branch: string; commitOid: string }): Promise<{ url: string; number?: number } | undefined>
  create(input: { cwd: string; branch: string; title: string; body: string; base?: string; draft?: boolean }): Promise<{ url: string; number?: number }>
}

export class ReviewDeliveryError extends Error {
  readonly code: ReviewDeliveryFailureCode

  constructor(code: ReviewDeliveryFailureCode, message: string) {
    super(message)
    this.name = 'ReviewDeliveryError'
    this.code = code
  }
}

function run(cwd: string, command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' },
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
    child.on('error', (error) => resolveRun({ exitCode: 127, stdout: '', stderr: error.message }))
    child.on('close', (code) => resolveRun({
      exitCode: code ?? 1,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }))
  })
}

export function classifyReviewDeliveryFailure(kind: ReviewDeliveryIntent['kind'], output: string): ReviewDeliveryFailureCode {
  const text = output.toLocaleLowerCase()
  if (/nothing to commit|no changes added|empty commit/.test(text)) return 'empty_commit'
  if (/author identity unknown|please tell me who you are|unable to auto-detect email/.test(text)) return 'identity_missing'
  if (/gpg failed|failed to sign|signing failed|ssh-keygen.*failed|no secret key/.test(text)) return 'signing_failed'
  if (kind === 'commit' && /hook|pre-commit|prepare-commit-msg|commit-msg/.test(text)) return 'hooks_failed'
  if (/authentication failed|permission denied|could not read username|repository not found|http 401|http 403|not logged into/.test(text)) return 'auth_failed'
  if (/protected branch|branch is protected|gh006|gh013|protected branch hook declined/.test(text)) return 'protected_branch'
  if (/non-fast-forward|fetch first|rejected.*behind/.test(text)) return 'non_fast_forward'
  if (/no such remote|does not appear to be a git repository/.test(text)) return 'remote_missing'
  if (/no upstream branch|has no upstream/.test(text)) return 'upstream_missing'
  if (kind === 'pr' && /enoent|not found|command not found/.test(text)) return 'gh_unavailable'
  return 'unknown'
}

function cleanText(value: string, label: string, allowEmpty = false): string {
  const text = value.trim()
  if ((!text && !allowEmpty) || Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES || text.includes('\0')) {
    throw new ReviewDeliveryError('invalid', `${label} is invalid`)
  }
  return text
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function outputOf(result: CommandResult): string {
  return `${result.stderr}\n${result.stdout}`.trim().slice(0, MAX_DIAGNOSTIC_BYTES)
}

async function hasCommitHook(cwd: string): Promise<boolean> {
  for (const name of ['pre-commit', 'prepare-commit-msg', 'commit-msg']) {
    const resolved = await run(cwd, 'git', ['rev-parse', '--git-path', `hooks/${name}`])
    if (resolved.exitCode !== 0 || !resolved.stdout.trim()) continue
    try {
      const hookPath = resolved.stdout.trim()
      if (((await stat(isAbsolute(hookPath) ? hookPath : resolve(cwd, hookPath))).mode & 0o111) !== 0) return true
    } catch {
      // Missing hooks are the ordinary case.
    }
  }
  return false
}

function defaultPullRequests(): ReviewPullRequestAdapter {
  return {
    async find(input) {
      const result = await run(input.cwd, 'gh', ['pr', 'list', '--state', 'open', '--head', input.branch, '--json', 'number,url,headRefOid', '--limit', '20'])
      if (result.exitCode !== 0) throw new ReviewDeliveryError(classifyReviewDeliveryFailure('pr', outputOf(result)), outputOf(result) || 'Unable to query pull requests')
      const rows = JSON.parse(result.stdout || '[]') as Array<{ number?: number; url?: string; headRefOid?: string }>
      const row = rows.find((item) => item.headRefOid === input.commitOid) || rows[0]
      return row?.url ? { url: row.url, ...(row.number ? { number: row.number } : {}) } : undefined
    },
    async create(input) {
      const args = ['pr', 'create', '--head', input.branch, '--title', input.title, '--body', input.body,
        ...(input.base ? ['--base', input.base] : []), ...(input.draft ? ['--draft'] : [])]
      const result = await run(input.cwd, 'gh', args)
      if (result.exitCode !== 0) throw new ReviewDeliveryError(classifyReviewDeliveryFailure('pr', outputOf(result)), outputOf(result) || 'Pull request creation failed')
      const url = result.stdout.trim().split('\n').find((line) => /^https?:\/\//.test(line.trim()))?.trim()
      if (!url) throw new ReviewDeliveryError('unknown', 'gh did not return a pull request URL')
      const number = Number(url.match(/\/pull\/(\d+)/)?.[1]) || undefined
      return { url, ...(number ? { number } : {}) }
    },
  }
}

export class ReviewDeliveryCoordinator {
  private readonly previews = new Map<string, StoredPreview>()
  private readonly commits = new Map<string, CommitIdentity>()
  private readonly pushes = new Map<string, PushIdentity>()
  private readonly prs = new Map<string, { url: string; number?: number }>()
  private readonly pullRequests: ReviewPullRequestAdapter
  private readonly options: {
    resolveWorkspace: (workspaceId: string) => ReviewWorkspaceBinding | undefined
    pullRequests?: ReviewPullRequestAdapter
  }
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(options: {
    resolveWorkspace: (workspaceId: string) => ReviewWorkspaceBinding | undefined
    pullRequests?: ReviewPullRequestAdapter
  }) {
    this.options = options
    this.pullRequests = options.pullRequests || defaultPullRequests()
  }

  private workspace(workspaceId: string): GitWorkspace {
    const workspace = this.options.resolveWorkspace(workspaceId)
    if (!workspace || workspace.mode !== 'git' || !workspace.worktreeRoot) {
      throw new ReviewDeliveryError('invalid', 'Git delivery requires a bound worktree')
    }
    return workspace as GitWorkspace
  }

  private async baseline(workspace: ReviewWorkspaceBinding) {
    const admission = await captureReviewWorkspaceAdmission({
      runId: `review-delivery:${workspace.workspaceId}`,
      projectRoot: workspace.projectRoot,
      runnerKind: 'builtin',
    })
    if (!admission.canonical || !admission.baseline) throw new ReviewDeliveryError('invalid', 'Workspace revision is unavailable')
    return admission.baseline
  }

  private async branch(cwd: string): Promise<string> {
    const result = await run(cwd, 'git', ['branch', '--show-current'])
    const branch = result.stdout.trim()
    if (result.exitCode !== 0 || !branch) throw new ReviewDeliveryError('invalid', 'Delivery requires a checked-out branch; detached HEAD is unsupported')
    return branch
  }

  private async configuredRemote(cwd: string, requested: string): Promise<string> {
    const remote = cleanText(requested, 'Remote')
    if (remote.startsWith('-') || /\s/.test(remote)) throw new ReviewDeliveryError('invalid', 'Remote must be an existing Git remote name')
    const remotes = (await run(cwd, 'git', ['remote'])).stdout.split(/\r?\n/).filter(Boolean)
    if (!remotes.includes(remote)) throw new ReviewDeliveryError('remote_missing', `Git remote ${remote} is not configured`)
    return remote
  }

  private async upstream(cwd: string): Promise<{ remote: string; branch: string } | undefined> {
    const result = await run(cwd, 'git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
    if (result.exitCode !== 0) return undefined
    const value = result.stdout.trim()
    const split = value.indexOf('/')
    if (split < 1 || split === value.length - 1) return undefined
    return { remote: value.slice(0, split), branch: value.slice(split + 1) }
  }

  private async prepareCommitPreview(intent: Extract<ReviewDeliveryIntent, { kind: 'commit' }>, workspace: GitWorkspace): Promise<PreparedPreview> {
    const message = cleanText(intent.message, 'Commit message')
    const baseline = await this.baseline(workspace)
    if (baseline.indexRevision !== intent.expectedIndexRevision) throw new ReviewDeliveryError('stale', 'Staged revision changed before commit preview')
    const patch = await run(workspace.worktreeRoot, 'git', ['diff', '--cached', '--binary', '--no-ext-diff', '--'])
    if (patch.exitCode !== 0 || !patch.stdout.trim()) throw new ReviewDeliveryError('empty_commit', 'Nothing is staged for commit')
    const configured = (await run(workspace.worktreeRoot, 'git', ['config', '--bool', 'commit.gpgsign'])).stdout.trim() === 'true'
    const normalized = { ...intent, message }
    return { intent: normalized, projection: {
      kind: 'commit', workspaceId: intent.workspaceId, title: 'Commit staged revision',
      detail: `${message}\nindex ${intent.expectedIndexRevision.slice(0, 12)}\n${configured ? 'Repository signing configured' : intent.sign ? 'Signing requested' : 'Signing not configured'}`,
      expectedIndexRevision: intent.expectedIndexRevision, stagedPatchHash: sha256(patch.stdout),
      stagedBytes: Buffer.byteLength(patch.stdout), signing: configured ? 'configured' : intent.sign ? 'requested' : 'off',
    } }
  }

  private async preparePushPreview(intent: Extract<ReviewDeliveryIntent, { kind: 'push' }>, workspace: GitWorkspace): Promise<PreparedPreview> {
    if (intent.force) throw new ReviewDeliveryError('force_forbidden', 'Force push is forbidden by the review delivery workflow')
    const commit = this.commits.get(intent.commitId)
    if (!commit || commit.workspaceId !== intent.workspaceId) throw new ReviewDeliveryError('push_unverified', 'Push requires a Host-issued commit identity')
    const head = (await run(workspace.worktreeRoot, 'git', ['rev-parse', 'HEAD'])).stdout.trim()
    const branch = await this.branch(workspace.worktreeRoot)
    if (head !== commit.commitOid || branch !== commit.branch) throw new ReviewDeliveryError('stale', 'HEAD or branch changed after commit')
    const upstream = await this.upstream(workspace.worktreeRoot)
    if (!upstream && !intent.setUpstream) throw new ReviewDeliveryError('upstream_missing', 'Branch has no upstream; explicitly select a remote and set upstream')
    const remote = await this.configuredRemote(workspace.worktreeRoot, intent.remote || upstream?.remote || '')
    if (upstream && (remote !== upstream.remote || upstream.branch !== branch)) throw new ReviewDeliveryError('invalid', `Push must preserve configured upstream ${upstream.remote}/${upstream.branch}`)
    const normalized = { ...intent, remote, setUpstream: !upstream, force: false as const }
    return { intent: normalized, projection: {
      kind: 'push', workspaceId: intent.workspaceId, title: `Push ${branch} → ${remote}`,
      detail: `${commit.commitOid}\n${upstream ? `upstream ${upstream.remote}/${upstream.branch}` : 'set upstream explicitly'}\nForce disabled`,
      commitId: commit.id, commitOid: commit.commitOid, branch, remote,
      ...(upstream ? { upstream: `${upstream.remote}/${upstream.branch}` } : {}),
    } }
  }

  private async preparePullRequestPreview(intent: Extract<ReviewDeliveryIntent, { kind: 'pr' }>, workspace: GitWorkspace): Promise<PreparedPreview> {
    const push = this.pushes.get(intent.pushId)
    if (!push || push.workspaceId !== intent.workspaceId) throw new ReviewDeliveryError('push_unverified', 'PR requires a remotely verified push identity')
    const title = cleanText(intent.title, 'PR title')
    const body = cleanText(intent.body, 'PR body', true)
    const base = intent.base ? cleanText(intent.base, 'PR base') : undefined
    const key = `${push.remote}\0${push.branch}\0${push.commitOid}`
    const existing = this.prs.get(key) || await this.pullRequests.find({ cwd: workspace.worktreeRoot, branch: push.branch, commitOid: push.commitOid })
    if (existing) throw new ReviewDeliveryError('duplicate_pr', `Pull request already exists: ${existing.url}`)
    const normalized = { ...intent, title, body, ...(base ? { base } : {}) }
    return { intent: normalized, projection: {
      kind: 'pr', workspaceId: intent.workspaceId, title: `Create${intent.draft ? ' draft' : ''} PR for ${push.branch}`,
      detail: `${title}\n${base ? `base ${base}` : 'default base'}\npush ${push.pushId}`,
      commitId: push.id, commitOid: push.commitOid, branch: push.branch, remote: push.remote, pushId: push.pushId,
    } }
  }

  async preview(rawIntent: ReviewDeliveryIntent): Promise<ReviewDeliveryPreview> {
    const workspace = this.workspace(rawIntent.workspaceId)
    const prepared = rawIntent.kind === 'commit'
      ? await this.prepareCommitPreview(structuredClone(rawIntent), workspace)
      : rawIntent.kind === 'push'
        ? await this.preparePushPreview(structuredClone(rawIntent), workspace)
        : await this.preparePullRequestPreview(structuredClone(rawIntent), workspace)
    const { intent, projection } = prepared
    const id = `review_delivery_${randomUUID().replaceAll('-', '')}`
    const stored = { ...projection, id, expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(), intent, cwd: workspace.worktreeRoot }
    this.previews.set(id, stored)
    return this.describePreview(id)
  }

  describePreview(id: string): ReviewDeliveryPreview {
    const preview = this.previews.get(id)
    if (!preview) throw new ReviewDeliveryError('invalid', 'Delivery preview is missing or already consumed')
    const { intent: _intent, cwd: _cwd, ...projection } = preview
    return structuredClone(projection)
  }

  async apply(id: string, approval: ReviewDeliveryApproval): Promise<ReviewDeliveryReceipt> {
    const operation = this.mutationTail.then(() => this.applyExclusive(id, approval))
    this.mutationTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async applyExclusive(id: string, approval: ReviewDeliveryApproval): Promise<ReviewDeliveryReceipt> {
    const preview = this.previews.get(id)
    if (!preview) throw new ReviewDeliveryError('invalid', 'Delivery preview is missing or already consumed')
    if (approval.source !== 'electron-main') throw new ReviewDeliveryError('invalid', 'Host delivery requires Electron main approval')
    if (Date.parse(preview.expiresAt) <= Date.now()) {
      this.previews.delete(id)
      return this.failure(preview, approval, 'stale', 'Delivery preview expired')
    }
    if (approval.decision !== 'allow') {
      this.previews.delete(id)
      return { previewId: id, kind: preview.kind, status: approval.decision === 'deny' ? 'denied' : 'cancelled', audit: approval }
    }
    const receipt = preview.intent.kind === 'commit'
      ? await this.commit(preview, approval)
      : preview.intent.kind === 'push'
        ? await this.push(preview, approval)
        : await this.pr(preview, approval)
    this.previews.delete(id)
    return receipt
  }

  private failure(preview: StoredPreview, approval: ReviewDeliveryApproval, code: ReviewDeliveryFailureCode, detail: string): ReviewDeliveryReceipt {
    return { previewId: preview.id, kind: preview.kind, status: 'failed', code, detail: detail.slice(0, MAX_DIAGNOSTIC_BYTES), audit: approval }
  }

  private async commit(preview: StoredPreview, approval: ReviewDeliveryApproval): Promise<ReviewDeliveryReceipt> {
    const intent = preview.intent as Extract<ReviewDeliveryIntent, { kind: 'commit' }>
    const workspace = this.workspace(intent.workspaceId)
    if ((await this.baseline(workspace)).indexRevision !== intent.expectedIndexRevision) {
      return this.failure(preview, approval, 'stale', 'Staged revision changed; commit was not started')
    }
    const result = await run(preview.cwd, 'git', ['commit', ...(intent.sign ? ['-S'] : []), '-m', intent.message])
    if (result.exitCode !== 0) {
      const classified = classifyReviewDeliveryFailure('commit', outputOf(result))
      const code = classified === 'unknown' && await hasCommitHook(preview.cwd) ? 'hooks_failed' : classified
      return this.failure(preview, approval, code, outputOf(result))
    }
    const [commitResult, treeResult, branch, baseline] = await Promise.all([
      run(preview.cwd, 'git', ['rev-parse', 'HEAD']),
      run(preview.cwd, 'git', ['rev-parse', 'HEAD^{tree}']),
      this.branch(preview.cwd),
      this.baseline(workspace),
    ])
    const identity: CommitIdentity = {
      id: `commit_${randomUUID().replaceAll('-', '')}`, workspaceId: intent.workspaceId,
      commitOid: commitResult.stdout.trim(), treeOid: treeResult.stdout.trim(), branch,
      committedIndexRevision: intent.expectedIndexRevision,
    }
    this.commits.set(identity.id, identity)
    return {
      previewId: preview.id, kind: 'commit', status: 'applied', commitId: identity.id,
      commitOid: identity.commitOid, treeOid: identity.treeOid, committedIndexRevision: identity.committedIndexRevision,
      branch, workingRevision: baseline.workingRevision, indexRevision: baseline.indexRevision, audit: approval,
    }
  }

  private async push(preview: StoredPreview, approval: ReviewDeliveryApproval): Promise<ReviewDeliveryReceipt> {
    const intent = preview.intent as Extract<ReviewDeliveryIntent, { kind: 'push' }> & { remote: string }
    const commit = this.commits.get(intent.commitId)
    if (!commit) return this.failure(preview, approval, 'push_unverified', 'Host commit identity is missing')
    const head = (await run(preview.cwd, 'git', ['rev-parse', 'HEAD'])).stdout.trim()
    const branch = await this.branch(preview.cwd)
    if (head !== commit.commitOid || branch !== commit.branch) return this.failure(preview, approval, 'stale', 'HEAD or branch changed after push preview')
    const args = ['push', ...(intent.setUpstream ? ['--set-upstream'] : []), intent.remote, `HEAD:refs/heads/${branch}`]
    const result = await run(preview.cwd, 'git', args)
    if (result.exitCode !== 0) return this.failure(preview, approval, classifyReviewDeliveryFailure('push', outputOf(result)), outputOf(result))
    const remote = await run(preview.cwd, 'git', ['ls-remote', '--exit-code', intent.remote, `refs/heads/${branch}`])
    const remoteOid = remote.stdout.trim().split(/\s+/)[0]
    if (remote.exitCode !== 0 || remoteOid !== commit.commitOid) return this.failure(preview, approval, 'push_unverified', outputOf(remote) || 'Remote identity did not match the committed revision')
    const push: PushIdentity = { ...commit, pushId: `push_${randomUUID().replaceAll('-', '')}`, remote: intent.remote }
    this.pushes.set(push.pushId, push)
    return {
      previewId: preview.id, kind: 'push', status: 'applied', commitId: commit.id,
      commitOid: commit.commitOid, treeOid: commit.treeOid, committedIndexRevision: commit.committedIndexRevision,
      remote: push.remote, branch: push.branch, pushId: push.pushId, audit: approval,
    }
  }

  private async pr(preview: StoredPreview, approval: ReviewDeliveryApproval): Promise<ReviewDeliveryReceipt> {
    const intent = preview.intent as Extract<ReviewDeliveryIntent, { kind: 'pr' }>
    const push = this.pushes.get(intent.pushId)
    if (!push) return this.failure(preview, approval, 'push_unverified', 'Verified push identity is missing')
    const key = `${push.remote}\0${push.branch}\0${push.commitOid}`
    try {
      const existing = this.prs.get(key) || await this.pullRequests.find({ cwd: preview.cwd, branch: push.branch, commitOid: push.commitOid })
      if (existing) return this.failure(preview, approval, 'duplicate_pr', `Pull request already exists: ${existing.url}`)
      const created = await this.pullRequests.create({ cwd: preview.cwd, branch: push.branch, title: intent.title, body: intent.body, base: intent.base, draft: intent.draft })
      this.prs.set(key, created)
      return {
        previewId: preview.id, kind: 'pr', status: 'applied', commitId: push.id, commitOid: push.commitOid,
        treeOid: push.treeOid, remote: push.remote, branch: push.branch, pushId: push.pushId,
        prUrl: created.url, ...(created.number ? { prNumber: created.number } : {}), audit: approval,
      }
    } catch (error) {
      const deliveryError = error instanceof ReviewDeliveryError ? error : new ReviewDeliveryError('unknown', error instanceof Error ? error.message : String(error))
      return this.failure(preview, approval, deliveryError.code, deliveryError.message)
    }
  }
}
