import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { InMemoryReviewArtifactStore } from '../electron/reviewArtifactStore.ts'
import { captureRunReviewSnapshot } from '../electron/reviewSnapshotCapture.ts'
import { captureReviewWorkspaceAdmission } from '../electron/reviewWorkspaceBinding.ts'
import { WorkspaceReviewProjection, WorkspaceReviewProjectionError } from '../electron/workspaceReviewProjection.ts'

const exec = promisify(execFile)
const git = (cwd: string, args: string[]) => exec('git', ['-C', cwd, ...args])
const root = await mkdtemp(join(tmpdir(), 'agentstudio-review-projection-'))
try {
  const repo = join(root, 'repo 空白')
  await mkdir(repo)
  await git(repo, ['init'])
  await git(repo, ['config', 'user.email', 'fixture@example.com'])
  await git(repo, ['config', 'user.name', 'Fixture'])
  const lines = Array.from({ length: 80 }, (_, index) => `line ${index}`).join('\n') + '\n'
  await writeFile(join(repo, 'large file.ts'), lines)
  await writeFile(join(repo, '路徑.ts'), 'base\n')
  await writeFile(join(repo, 'win\\path.ts'), 'base\n')
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'baseline'])

  const store = new InMemoryReviewArtifactStore()
  const admissionA = await captureReviewWorkspaceAdmission({ runId: 'run_a', projectRoot: repo, runnerKind: 'builtin' })
  if (!admissionA.canonical || admissionA.status !== 'pending' || !admissionA.workspace) throw new Error('canonical admission A required')
  await store.beginRun({ admission: admissionA, threadId: 'thread' })
  const changedLines = lines.replace('line 2', 'line two').replace('line 70', 'line seventy')
  await writeFile(join(repo, 'large file.ts'), changedLines)
  await writeFile(join(repo, '路徑.ts'), 'snapshot A\n')
  await writeFile(join(repo, 'win\\path.ts'), 'snapshot A\n')
  await store.finalizeRun(await captureRunReviewSnapshot({ admission: admissionA, threadId: 'thread' }))

  const admissionB = await captureReviewWorkspaceAdmission({ runId: 'run_b', projectRoot: repo, runnerKind: 'builtin' })
  if (!admissionB.canonical || admissionB.status !== 'pending') throw new Error('canonical admission B required')
  await store.beginRun({ admission: admissionB, threadId: 'thread' })
  await writeFile(join(repo, '路徑.ts'), 'snapshot B\n')
  await store.finalizeRun(await captureRunReviewSnapshot({ admission: admissionB, threadId: 'thread' }))

  const binding = admissionA.workspace
  const projection = new WorkspaceReviewProjection({ store, resolveWorkspace: (workspaceId) => workspaceId === binding.workspaceId ? binding : undefined })
  const snapshotTarget = { kind: 'run-snapshot' as const, snapshotId: admissionA.snapshotId }
  const described = await projection.describeTarget(snapshotTarget)
  assert.equal(described.immutable, true)
  assert.ok(described.fileCount >= 2)
  const firstFiles = await projection.listFiles(snapshotTarget, { limit: 1 })
  assert.equal(firstFiles.complete, false)
  assert.ok(firstFiles.omitted.items >= 1)
  const search = await projection.listFiles(snapshotTarget, { query: '路徑' })
  assert.deepEqual(search.items.map((entry) => entry.path), ['路徑.ts'])
  assert.deepEqual((await projection.listFiles(snapshotTarget, { query: 'win\\path' })).items.map((entry) => entry.path), ['win\\path.ts'])
  const hunks = await projection.readFileDiff(snapshotTarget, 'large file.ts', { maxBytes: 1 })
  assert.equal(hunks.complete, false)
  assert.ok(hunks.omitted.bytes > 0)

  await assert.rejects(
    () => projection.describeTarget({ kind: 'run-snapshot', snapshotId: 'missing' }),
    (error: unknown) => error instanceof WorkspaceReviewProjectionError && error.code === 'missing',
  )
  await assert.rejects(
    () => projection.refresh(snapshotTarget),
    (error: unknown) => error instanceof WorkspaceReviewProjectionError && error.code === 'invalid',
  )

  const current = await captureReviewWorkspaceAdmission({ runId: 'live', projectRoot: repo, runnerKind: 'builtin' })
  if (!current.canonical || !current.baseline) throw new Error('live baseline required')
  const liveTarget = { kind: 'live-working-tree' as const, workspaceId: binding.workspaceId, revision: current.baseline.workingRevision }
  assert.equal((await projection.describeTarget(liveTarget)).refreshable, true)
  await writeFile(join(repo, 'win\\path.ts'), 'changed after target\n')
  const staleProjection = new WorkspaceReviewProjection({ store, resolveWorkspace: () => binding })
  await assert.rejects(
    () => staleProjection.describeTarget(liveTarget),
    (error: unknown) => error instanceof WorkspaceReviewProjectionError && error.code === 'stale',
  )

  await git(repo, ['add', '路徑.ts'])
  const stagedState = await captureReviewWorkspaceAdmission({ runId: 'staged', projectRoot: repo, runnerKind: 'builtin' })
  if (!stagedState.canonical || !stagedState.baseline) throw new Error('staged baseline required')
  const stagedTarget = { kind: 'staged' as const, workspaceId: binding.workspaceId, revision: stagedState.baseline.indexRevision }
  assert.equal((await projection.describeTarget(stagedTarget)).mutationCapable, true)

  const branchRepo = join(root, 'branch-repo')
  await mkdir(branchRepo)
  await git(branchRepo, ['init'])
  await git(branchRepo, ['config', 'user.email', 'fixture@example.com'])
  await git(branchRepo, ['config', 'user.name', 'Fixture'])
  await writeFile(join(branchRepo, 'a.ts'), 'main\n')
  await git(branchRepo, ['add', '.'])
  await git(branchRepo, ['commit', '-m', 'main'])
  const base = (await git(branchRepo, ['rev-parse', 'HEAD'])).stdout.trim()
  await git(branchRepo, ['checkout', '-b', 'feature'])
  await writeFile(join(branchRepo, 'a.ts'), 'feature\n')
  await git(branchRepo, ['add', '.'])
  await git(branchRepo, ['commit', '-m', 'feature'])
  const head = (await git(branchRepo, ['rev-parse', 'HEAD'])).stdout.trim()
  const branchAdmission = await captureReviewWorkspaceAdmission({ runId: 'branch', projectRoot: branchRepo, runnerKind: 'builtin' })
  if (!branchAdmission.canonical || !branchAdmission.workspace) throw new Error('branch binding required')
  const branchProjection = new WorkspaceReviewProjection({ store, resolveWorkspace: () => branchAdmission.workspace })
  const branchTarget = { kind: 'branch-range' as const, workspaceId: branchAdmission.workspace.workspaceId, baseRef: base, headRef: head }
  assert.deepEqual((await branchProjection.listFiles(branchTarget)).items.map((entry) => entry.path), ['a.ts'])

  const rangeTarget = { kind: 'snapshot-range' as const, beforeSnapshotId: admissionA.snapshotId, afterSnapshotId: admissionB.snapshotId }
  assert.equal((await projection.describeTarget(rangeTarget)).immutable, true)
  assert.deepEqual((await projection.listFiles(rangeTarget, { query: '路徑' })).items.map((entry) => entry.path), ['路徑.ts'])

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    () => projection.listFiles(snapshotTarget, { signal: controller.signal }),
    (error: unknown) => error instanceof WorkspaceReviewProjectionError && error.code === 'cancelled',
  )
  await store.close()
  console.log('smoke-workspace-review-projection passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
