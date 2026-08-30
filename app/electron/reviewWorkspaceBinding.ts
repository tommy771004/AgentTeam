import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import type {
  ReviewAdmissionSnapshot,
  ReviewRunnerKind,
  ReviewWorkspaceBaseline,
  ReviewWorkspaceBinding,
} from '../src/agent/reviewContract.ts'

const exec = promisify(execFile)

export type ReviewWorkspaceAdmissionInput = {
  runId: string
  projectRoot: string
  runnerKind: ReviewRunnerKind
  capturedAt?: string
}

function sha256(...parts: string[]): string {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part).update('\0')
  return hash.digest('hex')
}

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await exec('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env,
  })
  return result.stdout.trim()
}

async function captureWorkingTree(cwd: string, head?: string): Promise<string> {
  const temporary = await mkdtemp(join(tmpdir(), 'agentstudio-review-index-'))
  const indexFile = join(temporary, 'index')
  const env = { GIT_INDEX_FILE: indexFile }
  try {
    if (head) await git(cwd, ['read-tree', head], env)
    else await git(cwd, ['read-tree', '--empty'], env)
    await git(cwd, ['add', '-A', '--', '.'], env)
    return await git(cwd, ['write-tree'], env)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function optionalGit(cwd: string, args: string[]): Promise<string> {
  try {
    return await git(cwd, args)
  } catch {
    return ''
  }
}

async function resolveGitBinding(projectRoot: string): Promise<ReviewWorkspaceBinding | undefined> {
  const worktreeRootRaw = await optionalGit(projectRoot, ['rev-parse', '--show-toplevel'])
  if (!worktreeRootRaw) return undefined
  const [worktreeRoot, gitDir, commonGitDir] = await Promise.all([
    realpath(worktreeRootRaw),
    git(projectRoot, ['rev-parse', '--absolute-git-dir']).then((path) => realpath(path)),
    git(projectRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']).then((path) => realpath(path)),
  ])
  const repoRoot = dirname(commonGitDir)
  return {
    workspaceId: sha256(repoRoot, worktreeRoot, gitDir),
    mode: 'git',
    projectRoot,
    repoRoot,
    worktreeRoot,
    gitDir,
  }
}

export async function captureReviewWorkspaceBaseline(
  binding: ReviewWorkspaceBinding,
  capturedAt: string,
): Promise<ReviewWorkspaceBaseline> {
  const cwd = binding.worktreeRoot || binding.projectRoot
  const [head, staged, indexTree] = await Promise.all([
    optionalGit(cwd, ['rev-parse', '--verify', 'HEAD']),
    optionalGit(cwd, ['diff', '--cached', '--binary', '--no-ext-diff']),
    optionalGit(cwd, ['write-tree']),
  ])
  const workingTree = await captureWorkingTree(cwd, head || undefined)
  const indexRevision = sha256('index', head, staged)
  return {
    capturedAt,
    head: head || undefined,
    indexTree: indexTree || undefined,
    workingTree,
    indexRevision,
    workingRevision: sha256('working', indexRevision, workingTree),
  }
}

/** Resolve and freeze one Host-owned workspace identity for Task run admission. */
export async function captureReviewWorkspaceAdmission(
  input: ReviewWorkspaceAdmissionInput,
): Promise<Extract<ReviewAdmissionSnapshot, { canonical: true }>> {
  const snapshotId = `review_${sha256(input.runId).slice(0, 24)}`
  try {
    const canonicalProjectRoot = await realpath(input.projectRoot)
    if (!(await stat(canonicalProjectRoot)).isDirectory()) throw new Error('projectRoot is not a directory')
    const gitBinding = await resolveGitBinding(canonicalProjectRoot)
    const workspace: ReviewWorkspaceBinding = gitBinding || {
      workspaceId: sha256('non-git', canonicalProjectRoot),
      mode: 'non-git',
      projectRoot: canonicalProjectRoot,
    }
    const capturedAt = input.capturedAt || new Date().toISOString()
    const baseline = gitBinding
      ? await captureReviewWorkspaceBaseline(workspace, capturedAt)
      : {
          capturedAt,
          indexRevision: sha256('non-git-index', canonicalProjectRoot),
          workingRevision: sha256('non-git-working', canonicalProjectRoot),
        }
    return {
      snapshotId,
      runId: input.runId,
      status: 'pending',
      canonical: true,
      runnerKind: input.runnerKind,
      workspace,
      baseline,
    }
  } catch (error) {
    return {
      snapshotId,
      runId: input.runId,
      status: 'failed',
      canonical: true,
      runnerKind: input.runnerKind,
      error: {
        code: 'unavailable',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      },
    }
  }
}
