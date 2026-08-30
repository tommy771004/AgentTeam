import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { InMemoryReviewArtifactStore } from '../electron/reviewArtifactStore.ts'
import { captureRunReviewSnapshot } from '../electron/reviewSnapshotCapture.ts'
import { captureReviewWorkspaceAdmission } from '../electron/reviewWorkspaceBinding.ts'

const exec = promisify(execFile)
const git = (cwd: string, args: string[]) => exec('git', ['-C', cwd, ...args])

async function initRepo(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
  await git(path, ['init'])
  await git(path, ['config', 'user.email', 'fixture@example.com'])
  await git(path, ['config', 'user.name', 'Fixture'])
}

const root = await mkdtemp(join(tmpdir(), 'agentstudio-review-capture-'))
try {
  const subSource = join(root, 'sub-source')
  await initRepo(subSource)
  await writeFile(join(subSource, 'sub.txt'), 'one\n')
  await git(subSource, ['add', '.'])
  await git(subSource, ['commit', '-m', 'sub baseline'])

  const repo = join(root, 'shared repo')
  await initRepo(repo)
  await writeFile(join(repo, 'rename.ts'), 'rename\n')
  await writeFile(join(repo, 'delete.ts'), 'delete\n')
  await writeFile(join(repo, 'mode.sh'), '#!/bin/sh\n')
  await writeFile(join(repo, 'binary.bin'), Buffer.from([0, 1, 2, 3]))
  await symlink('rename.ts', join(repo, 'type-link'))
  await git(repo, ['-c', 'protocol.file.allow=always', 'submodule', 'add', subSource, 'vendor/sub'])
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'baseline'])

  const admission = await captureReviewWorkspaceAdmission({ runId: 'run_shared', projectRoot: repo, runnerKind: 'builtin', capturedAt: '2026-08-30T00:00:00.000Z' })
  assert.equal(admission.status, 'pending')
  if (!admission.canonical) throw new Error('expected canonical admission')
  await git(repo, ['mv', 'rename.ts', 'renamed.ts'])
  await rm(join(repo, 'delete.ts'))
  await chmod(join(repo, 'mode.sh'), 0o755)
  await writeFile(join(repo, 'binary.bin'), Buffer.from([0, 9, 8, 7, 0]))
  await unlink(join(repo, 'type-link'))
  await writeFile(join(repo, 'type-link'), 'now a file\n')
  await writeFile(join(repo, 'untracked.txt'), 'new\n')
  await writeFile(join(subSource, 'sub.txt'), 'two\n')
  await git(subSource, ['add', '.'])
  await git(subSource, ['commit', '-m', 'sub update'])
  const nextSub = (await git(subSource, ['rev-parse', 'HEAD'])).stdout.trim()
  await git(join(repo, 'vendor/sub'), ['fetch'])
  await git(join(repo, 'vendor/sub'), ['checkout', nextSub])

  const captured = await captureRunReviewSnapshot({ admission, threadId: 'thread_shared', settlementKind: 'cancelled' })
  assert.equal(captured.status, 'ready', 'cancel still best-effort captures a coherent snapshot')
  assert.equal(captured.attributionFidelity, 'shared', 'a normal shared checkout never claims exact')
  const statuses = new Map(captured.manifest.map((entry) => [entry.path, entry]))
  assert.equal(statuses.get('renamed.ts')?.status, 'renamed')
  assert.equal(statuses.get('delete.ts')?.status, 'deleted')
  assert.equal(statuses.get('untracked.txt')?.status, 'untracked')
  assert.equal(statuses.get('binary.bin')?.binary, true)
  assert.equal(statuses.get('mode.sh')?.oldMode, '100644')
  assert.equal(statuses.get('mode.sh')?.newMode, '100755')
  assert.equal(statuses.get('type-link')?.status, 'type-changed')
  assert.equal(statuses.get('vendor/sub')?.oldMode, '160000')
  assert.equal(statuses.get('vendor/sub')?.newMode, '160000')
  const store = new InMemoryReviewArtifactStore()
  await store.beginRun({ admission, threadId: 'thread_shared' })
  await store.finalizeRun(captured)
  assert.equal((await store.read(admission.snapshotId)).manifest.length, captured.manifest.length)
  await store.close()

  const trustedRepo = join(root, 'trusted repo')
  await initRepo(trustedRepo)
  await writeFile(join(trustedRepo, 'a.ts'), 'before\n')
  await git(trustedRepo, ['add', '.'])
  await git(trustedRepo, ['commit', '-m', 'baseline'])
  const trustedAdmission = await captureReviewWorkspaceAdmission({ runId: 'run_trusted', projectRoot: trustedRepo, runnerKind: 'builtin' })
  if (!trustedAdmission.canonical) throw new Error('expected canonical trusted admission')
  await writeFile(join(trustedRepo, 'a.ts'), 'after\n')
  const attributed = await captureRunReviewSnapshot({
    admission: trustedAdmission,
    threadId: 'thread_trusted',
    trustedMutations: [{ source: 'host', runId: 'run_trusted', callId: 'call_1', tool: 'write', paths: ['a.ts'], settlement: 'success' }],
  })
  assert.equal(attributed.attributionFidelity, 'attributed')
  const parallel = await captureRunReviewSnapshot({ admission: trustedAdmission, threadId: 'thread_trusted', activeWorkspaceRuns: 2 })
  assert.equal(parallel.attributionFidelity, 'shared')

  const externalAdmission = await captureReviewWorkspaceAdmission({ runId: 'run_external', projectRoot: trustedRepo, runnerKind: 'external' })
  if (!externalAdmission.canonical) throw new Error('expected canonical external admission')
  await writeFile(join(trustedRepo, 'external.txt'), 'cli\n')
  const external = await captureRunReviewSnapshot({ admission: externalAdmission, threadId: 'thread_external', settlementKind: 'timeout' })
  assert.equal(external.attributionFidelity, 'partial', 'CLI exit or model claims cannot upgrade fidelity')

  const dirtyRepo = join(root, 'dirty before admission')
  await initRepo(dirtyRepo)
  await writeFile(join(dirtyRepo, 'preexisting.ts'), 'clean\n')
  await writeFile(join(dirtyRepo, 'run.ts'), 'before\n')
  await git(dirtyRepo, ['add', '.'])
  await git(dirtyRepo, ['commit', '-m', 'baseline'])
  await writeFile(join(dirtyRepo, 'preexisting.ts'), 'dirty before run\n')
  const dirtyAdmission = await captureReviewWorkspaceAdmission({ runId: 'run_dirty_baseline', projectRoot: dirtyRepo, runnerKind: 'builtin' })
  if (!dirtyAdmission.canonical) throw new Error('expected canonical dirty admission')
  await writeFile(join(dirtyRepo, 'run.ts'), 'changed by run\n')
  const dirtyCaptured = await captureRunReviewSnapshot({ admission: dirtyAdmission, threadId: 'thread_dirty' })
  assert.deepEqual(dirtyCaptured.manifest.map((entry) => entry.path), ['run.ts'], 'snapshot must exclude changes already present at admission')

  const boundedRepo = join(root, 'bounded payload')
  await initRepo(boundedRepo)
  await writeFile(join(boundedRepo, 'one.ts'), 'before one\n')
  await writeFile(join(boundedRepo, 'two.ts'), 'before two\n')
  await git(boundedRepo, ['add', '.'])
  await git(boundedRepo, ['commit', '-m', 'baseline'])
  const boundedAdmission = await captureReviewWorkspaceAdmission({ runId: 'run_bounded', projectRoot: boundedRepo, runnerKind: 'builtin' })
  if (!boundedAdmission.canonical) throw new Error('expected canonical bounded admission')
  await writeFile(join(boundedRepo, 'one.ts'), 'after one with enough payload bytes\n')
  await writeFile(join(boundedRepo, 'two.ts'), 'after two with enough payload bytes\n')
  const bounded = await captureRunReviewSnapshot({ admission: boundedAdmission, threadId: 'thread_bounded', qualificationLimits: { payloadBytes: 1024, totalBytes: 160 } })
  assert.equal(bounded.status, 'partial')
  assert.equal(bounded.manifest.length, 2, 'omitted payloads must not remove files from the manifest')
  assert.ok(bounded.manifest.some((entry) => !entry.payloadRef), 'an omitted payload remains an explicit manifest entry')
  assert.ok(bounded.diagnostics.some((diagnostic) => /^payload-omitted:.*:\d+$/.test(diagnostic)), 'omission diagnostics disclose the path and byte count')

  const linked = join(root, 'isolated worktree')
  await git(trustedRepo, ['worktree', 'add', '-b', 'isolated-fixture', linked])
  const isolatedAdmission = await captureReviewWorkspaceAdmission({ runId: 'run_isolated', projectRoot: linked, runnerKind: 'builtin' })
  if (!isolatedAdmission.canonical) throw new Error('expected canonical isolated admission')
  await writeFile(join(linked, 'a.ts'), 'isolated\n')
  const exact = await captureRunReviewSnapshot({ admission: isolatedAdmission, threadId: 'thread_isolated' })
  assert.equal(exact.attributionFidelity, 'exact')
  await git(linked, ['add', '.'])
  await git(linked, ['commit', '-m', 'run commit'])
  const committed = await captureRunReviewSnapshot({ admission: isolatedAdmission, threadId: 'thread_isolated' })
  assert.notEqual(committed.attributionFidelity, 'exact', 'a HEAD change during the run cannot remain exact')

  console.log('smoke-review-snapshot-capture passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
