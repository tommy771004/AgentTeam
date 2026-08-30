import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { captureReviewWorkspaceAdmission } from '../electron/reviewWorkspaceBinding.ts'
import { nonCanonicalReviewAdmission } from '../src/agent/reviewContract.ts'
import { createPiHostServer, type PiHostMessage, type PiHostResponse } from '../electron/piHostProtocol.ts'

const exec = promisify(execFile)

async function hostRequest(
  host: { handle(request: unknown): Promise<void> },
  messages: PiHostMessage[],
  id: number,
  method: string,
  params: Record<string, unknown>,
): Promise<PiHostResponse> {
  await host.handle({ id, method, params })
  const response = messages.find((message): message is PiHostResponse => 'id' in message && message.id === id)
  if (!response) throw new Error(`Pi Host did not answer review request ${id}`)
  return response
}

const root = await mkdtemp(join(tmpdir(), 'agentstudio-review binding-測試-'))
try {
  const repo = join(root, 'repo with spaces-專案')
  const nested = join(repo, 'packages', 'app')
  await mkdir(nested, { recursive: true })
  await exec('git', ['init', repo])
  await exec('git', ['-C', repo, 'config', 'user.email', 'fixture@example.com'])
  await exec('git', ['-C', repo, 'config', 'user.name', 'Fixture'])
  await writeFile(join(repo, 'README.md'), 'baseline\n')
  await exec('git', ['-C', repo, 'add', 'README.md'])
  await exec('git', ['-C', repo, 'commit', '-m', 'baseline'])

  const nestedAdmission = await captureReviewWorkspaceAdmission({
    runId: 'run_nested', projectRoot: nested, runnerKind: 'builtin', capturedAt: '2026-08-30T00:00:00.000Z',
  })
  assert.equal(nestedAdmission.canonical, true)
  assert.equal(nestedAdmission.status, 'pending')
  assert.equal(nestedAdmission.workspace?.mode, 'git')
  assert.equal(nestedAdmission.workspace?.repoRoot, await realpath(repo))
  assert.equal(nestedAdmission.workspace?.worktreeRoot, await realpath(repo))
  assert.match(nestedAdmission.baseline?.head || '', /^[0-9a-f]{40}$/)
  assert.match(nestedAdmission.baseline?.indexTree || '', /^[0-9a-f]{40}$/)
  assert.match(nestedAdmission.baseline?.workingTree || '', /^[0-9a-f]{40}$/)
  assert.match(nestedAdmission.baseline?.indexRevision || '', /^[0-9a-f]{64}$/)
  assert.match(nestedAdmission.baseline?.workingRevision || '', /^[0-9a-f]{64}$/)

  const linked = join(root, 'linked worktree-分支')
  await exec('git', ['-C', repo, 'worktree', 'add', '-b', 'fixture-linked', linked])
  const linkedAdmission = await captureReviewWorkspaceAdmission({
    runId: 'run_linked', projectRoot: linked, runnerKind: 'external', capturedAt: '2026-08-30T00:00:01.000Z',
  })
  assert.equal(linkedAdmission.workspace?.worktreeRoot, await realpath(linked))
  assert.equal(linkedAdmission.workspace?.repoRoot, await realpath(repo))
  assert.notEqual(linkedAdmission.workspace?.gitDir, join(linked, '.git'), 'linked worktree resolves the .git file to its real git dir')

  await writeFile(join(linked, 'untracked-測試.bin'), Buffer.from([0, 1, 2, 3]))
  const changedAdmission = await captureReviewWorkspaceAdmission({
    runId: 'run_linked_changed', projectRoot: linked, runnerKind: 'external', capturedAt: '2026-08-30T00:00:01.500Z',
  })
  assert.notEqual(changedAdmission.baseline?.workingTree, linkedAdmission.baseline?.workingTree, 'untracked content changes the frozen working tree')

  const nonGit = join(root, 'plain project')
  await mkdir(nonGit)
  const nonGitAdmission = await captureReviewWorkspaceAdmission({
    runId: 'run_plain', projectRoot: nonGit, runnerKind: 'builtin', capturedAt: '2026-08-30T00:00:02.000Z',
  })
  assert.equal(nonGitAdmission.status, 'pending')
  assert.equal(nonGitAdmission.workspace?.mode, 'non-git')
  assert.equal(nonGitAdmission.workspace?.projectRoot, await realpath(nonGit))

  const failed = await captureReviewWorkspaceAdmission({
    runId: 'run_missing', projectRoot: join(root, 'missing'), runnerKind: 'builtin', capturedAt: '2026-08-30T00:00:03.000Z',
  })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.canonical, true)
  assert.equal(failed.error?.code, 'unavailable')

  const hostMessages: PiHostMessage[] = []
  const host = createPiHostServer((message) => hostMessages.push(message))
  await hostRequest(host, hostMessages, 1, 'initialize', {
    protocolVersion: 5,
    capabilities: ['review-v1'],
  })
  const hostAdmission = await hostRequest(host, hostMessages, 2, 'review/v1/admit', {
    runId: 'run_host', projectRoot: nested, runnerKind: 'builtin',
  })
  assert.equal(hostAdmission.error, undefined)
  assert.equal(hostAdmission.result?.reviewAdmission?.canonical, true)
  assert.equal(hostAdmission.result?.reviewAdmission?.workspace?.repoRoot, await realpath(repo))

  const browserOnly = nonCanonicalReviewAdmission('run_browser', 'builtin', 'bridge unavailable')
  assert.equal(browserOnly.canonical, false)
  assert.equal(browserOnly.status, 'failed')
  assert.equal(browserOnly.snapshotId, undefined, 'plain browser must not invent a canonical snapshot id')

  const coordinator = await readFile(new URL('../src/agent/taskRunCoordinator.ts', import.meta.url), 'utf8')
  assert.match(coordinator, /piHost\?\.review\?\.admit/, 'runTask admission feature-detects the Host review bridge')
  assert.doesNotMatch(coordinator, /rev-parse|--show-toplevel|--git-common-dir/, 'renderer must not derive Git identity')

  console.log('smoke-review-workspace-binding passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
