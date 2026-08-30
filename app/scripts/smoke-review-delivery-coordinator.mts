import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { ReviewDeliveryCoordinator, ReviewDeliveryError, classifyReviewDeliveryFailure } from '../electron/reviewDeliveryCoordinator.ts'
import { InMemoryReviewArtifactStore } from '../electron/reviewArtifactStore.ts'
import { captureReviewWorkspaceAdmission } from '../electron/reviewWorkspaceBinding.ts'

const exec = promisify(execFile)
const git = (cwd: string, args: string[]) => exec('git', ['-C', cwd, ...args])
const allow = () => ({ decision: 'allow', source: 'electron-main', decidedAt: new Date().toISOString() } as const)
const deny = () => ({ decision: 'deny', source: 'electron-main', decidedAt: new Date().toISOString() } as const)

async function binding(repo: string) {
  const admission = await captureReviewWorkspaceAdmission({ runId: 'delivery-smoke', projectRoot: repo, runnerKind: 'builtin' })
  assert.ok(admission.canonical && admission.baseline && admission.workspace)
  return { workspace: admission.workspace, baseline: admission.baseline }
}

const root = await mkdtemp(join(tmpdir(), 'agentstudio-review-delivery-'))
try {
  const repo = join(root, 'repo')
  const remote = join(root, 'remote.git')
  await mkdir(repo)
  await git(repo, ['init'])
  await git(repo, ['config', 'user.email', 'fixture@example.com'])
  await git(repo, ['config', 'user.name', 'Fixture'])
  await writeFile(join(repo, 'tracked.ts'), 'one\n')
  await writeFile(join(repo, 'unrelated.ts'), 'baseline\n')
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'baseline'])
  await exec('git', ['init', '--bare', remote])
  await git(repo, ['remote', 'add', 'origin', remote])
  await git(repo, ['branch', '-M', 'main'])

  let current = await binding(repo)
  let existingPr: { url: string; number?: number } | undefined
  let createCount = 0
  const coordinator = new ReviewDeliveryCoordinator({
    resolveWorkspace: () => current.workspace,
    pullRequests: {
      find: async () => existingPr,
      create: async () => {
        createCount += 1
        existingPr = { url: 'https://github.example/repo/pull/42', number: 42 }
        return existingPr
      },
    },
  })
  const artifacts = new InMemoryReviewArtifactStore()
  const historicalAdmission = {
    snapshotId: 'review_before_delivery', runId: 'run_before_delivery', status: 'pending' as const,
    canonical: true as const, runnerKind: 'builtin' as const, workspace: current.workspace, baseline: current.baseline,
  }
  await artifacts.beginRun({ admission: historicalAdmission, threadId: 'thread-delivery' })
  await artifacts.finalizeRun({
    snapshotId: historicalAdmission.snapshotId, status: 'ready', attributionFidelity: 'exact', settlement: current.baseline,
    manifest: [{ path: 'tracked.ts', status: 'modified', binary: false, payloadRef: 'before_payload' }],
    payloads: [{ payloadId: 'before_payload', content: 'historical diff' }],
  })
  await writeFile(join(repo, 'tracked.ts'), 'two\n')
  await git(repo, ['add', 'tracked.ts'])
  await writeFile(join(repo, 'unrelated.ts'), 'unstaged user change\n')
  current = await binding(repo)
  const stale = await coordinator.preview({ kind: 'commit', workspaceId: current.workspace.workspaceId, expectedIndexRevision: current.baseline.indexRevision, message: 'stale preview' })
  await writeFile(join(repo, 'later.ts'), 'later\n')
  await git(repo, ['add', 'later.ts'])
  const staleReceipt = await coordinator.apply(stale.id, allow())
  assert.equal(staleReceipt.code, 'stale')
  assert.equal((await git(repo, ['rev-list', '--count', 'HEAD'])).stdout.trim(), '1')

  current = await binding(repo)
  const deniedPreview = await coordinator.preview({ kind: 'commit', workspaceId: current.workspace.workspaceId, expectedIndexRevision: current.baseline.indexRevision, message: 'denied commit' })
  assert.equal((await coordinator.apply(deniedPreview.id, deny())).status, 'denied')
  assert.equal((await git(repo, ['rev-list', '--count', 'HEAD'])).stdout.trim(), '1')

  const commitPreview = await coordinator.preview({ kind: 'commit', workspaceId: current.workspace.workspaceId, expectedIndexRevision: current.baseline.indexRevision, message: 'review delivery commit' })
  const committed = await coordinator.apply(commitPreview.id, allow())
  assert.equal(committed.status, 'applied')
  assert.match(committed.commitId || '', /^commit_/)
  assert.match(committed.commitOid || '', /^[0-9a-f]{40}$/)
  assert.match(committed.treeOid || '', /^[0-9a-f]{40}$/)
  assert.equal(committed.committedIndexRevision, current.baseline.indexRevision)
  assert.equal((await git(repo, ['diff', '--cached'])).stdout, '', 'successful commit consumes the confirmed staged revision')
  assert.match((await git(repo, ['diff', '--', 'unrelated.ts'])).stdout, /unstaged user change/, 'commit consumes only the confirmed index revision')
  assert.equal(Buffer.from(await artifacts.readPayload(historicalAdmission.snapshotId, 'before_payload')).toString(), 'historical diff', 'historical Review Snapshot remains readable after commit')
  current = await binding(repo)
  await assert.rejects(() => coordinator.preview({ kind: 'commit', workspaceId: current.workspace.workspaceId, expectedIndexRevision: current.baseline.indexRevision, message: 'empty commit' }), (error) => error instanceof ReviewDeliveryError && error.code === 'empty_commit')

  await writeFile(join(repo, 'tracked.ts'), 'hook failure\n')
  await git(repo, ['add', 'tracked.ts'])
  await writeFile(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho lint blocked >&2\nexit 1\n')
  await chmod(join(repo, '.git', 'hooks', 'pre-commit'), 0o755)
  current = await binding(repo)
  const hookPreview = await coordinator.preview({ kind: 'commit', workspaceId: current.workspace.workspaceId, expectedIndexRevision: current.baseline.indexRevision, message: 'hook should fail' })
  const hookFailure = await coordinator.apply(hookPreview.id, allow())
  assert.equal(hookFailure.code, 'hooks_failed')
  await rm(join(repo, '.git', 'hooks', 'pre-commit'))
  await git(repo, ['restore', '--staged', 'tracked.ts'])
  await git(repo, ['restore', 'tracked.ts'])

  await assert.rejects(() => coordinator.preview({ kind: 'push', workspaceId: current.workspace.workspaceId, commitId: committed.commitId!, remote: 'origin' }), (error) => error instanceof ReviewDeliveryError && error.code === 'upstream_missing')
  const pushPreview = await coordinator.preview({ kind: 'push', workspaceId: current.workspace.workspaceId, commitId: committed.commitId!, remote: 'origin', setUpstream: true })
  const pushed = await coordinator.apply(pushPreview.id, allow())
  assert.equal(pushed.status, 'applied')
  assert.ok(pushed.pushId)
  assert.equal((await git(remote, ['rev-parse', 'refs/heads/main'])).stdout.trim(), committed.commitOid)
  assert.equal(Buffer.from(await artifacts.readPayload(historicalAdmission.snapshotId, 'before_payload')).toString(), 'historical diff', 'historical Review Snapshot remains readable after push')
  await assert.rejects(() => coordinator.preview({ kind: 'push', workspaceId: current.workspace.workspaceId, commitId: committed.commitId!, remote: 'missing' }), (error) => error instanceof ReviewDeliveryError && error.code === 'remote_missing')
  await assert.rejects(() => coordinator.preview({ kind: 'push', workspaceId: current.workspace.workspaceId, commitId: committed.commitId!, force: true }), (error) => error instanceof ReviewDeliveryError && error.code === 'force_forbidden')
  await assert.rejects(() => coordinator.preview({ kind: 'push', workspaceId: current.workspace.workspaceId, commitId: 'forged', remote: 'origin' }), (error) => error instanceof ReviewDeliveryError && error.code === 'push_unverified')
  await assert.rejects(() => coordinator.preview({ kind: 'pr', workspaceId: current.workspace.workspaceId, pushId: 'forged', title: 'PR', body: 'Body' }), (error) => error instanceof ReviewDeliveryError && error.code === 'push_unverified')

  const prPreview = await coordinator.preview({ kind: 'pr', workspaceId: current.workspace.workspaceId, pushId: pushed.pushId!, title: 'Review delivery', body: 'Verified push', base: 'main', draft: true })
  const pr = await coordinator.apply(prPreview.id, allow())
  assert.equal(pr.status, 'applied')
  assert.equal(pr.prNumber, 42)
  assert.equal(createCount, 1)
  await assert.rejects(() => coordinator.preview({ kind: 'pr', workspaceId: current.workspace.workspaceId, pushId: pushed.pushId!, title: 'Duplicate', body: 'Duplicate' }), (error) => error instanceof ReviewDeliveryError && error.code === 'duplicate_pr')
  assert.equal(createCount, 1, 'duplicate protection never calls create again')

  assert.equal(classifyReviewDeliveryFailure('commit', 'Author identity unknown'), 'identity_missing')
  assert.equal(classifyReviewDeliveryFailure('commit', 'gpg failed to sign the data'), 'signing_failed')
  assert.equal(classifyReviewDeliveryFailure('push', 'remote: GH006: Protected branch update failed'), 'protected_branch')
  assert.equal(classifyReviewDeliveryFailure('push', 'rejected (non-fast-forward)'), 'non_fast_forward')
  assert.equal(classifyReviewDeliveryFailure('push', 'Authentication failed'), 'auth_failed')
  assert.equal(classifyReviewDeliveryFailure('pr', 'spawn gh ENOENT'), 'gh_unavailable')
  const protocol = await readFile(new URL('../electron/piHostProtocol.ts', import.meta.url), 'utf8')
  const panel = await readFile(new URL('../src/components/ReviewDeliveryPanel.tsx', import.meta.url), 'utf8')
  assert.match(protocol, /review_delivery_\$\{preview\.kind\}[\s\S]*requestPiToolApproval|requestPiToolApproval[\s\S]*review delivery/i, 'each delivery step enters central Approval Decision')
  assert.match(panel, /Commit → Push → PR/)
  assert.match(panel, /commitId:\s*(?:props\.)?commit!?\.commitId!?/, 'Push UI requires the Host-issued commit receipt')
  assert.match(panel, /pushId:\s*(?:props\.)?push!?\.pushId!?/, 'PR UI requires the verified push receipt')
  assert.doesNotMatch(panel, /force:\s*true/, 'UI does not offer force push')
  console.log('smoke-review-delivery-coordinator passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
