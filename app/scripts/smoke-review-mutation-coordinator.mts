import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { ReviewMutationCoordinator, ReviewMutationError } from '../electron/reviewMutationCoordinator.ts'
import { captureReviewWorkspaceAdmission } from '../electron/reviewWorkspaceBinding.ts'

const exec = promisify(execFile)
const git = (cwd: string, args: string[]) => exec('git', ['-C', cwd, ...args])
const allow = () => ({ decision: 'allow', source: 'electron-main', decidedAt: new Date().toISOString() } as const)
const deny = () => ({ decision: 'deny', source: 'electron-main', decidedAt: new Date().toISOString() } as const)
const cancel = () => ({ decision: 'cancel', source: 'electron-main', decidedAt: new Date().toISOString() } as const)
const baseline = Array.from({ length: 16 }, (_, index) => `line-${index + 1}`).join('\n') + '\n'
const changed = baseline.replace('line-1\n', 'LINE-1\n').replace('line-16\n', 'LINE-16\n')

async function revisions(repo: string) {
  const admission = await captureReviewWorkspaceAdmission({ runId: 'mutation-smoke', projectRoot: repo, runnerKind: 'builtin' })
  assert.ok(admission.canonical && admission.baseline && admission.workspace)
  return { binding: admission.workspace, working: admission.baseline.workingRevision, index: admission.baseline.indexRevision }
}

const root = await mkdtemp(join(tmpdir(), 'agentstudio-review-mutation-'))
try {
  const repo = join(root, 'repo with spaces-專案')
  await mkdir(repo)
  await git(repo, ['init'])
  await git(repo, ['config', 'user.email', 'fixture@example.com'])
  await git(repo, ['config', 'user.name', 'Fixture'])
  await writeFile(join(repo, 'a.ts'), baseline)
  await writeFile(join(repo, 'unrelated.ts'), 'keep\n')
  await writeFile(join(repo, 'rename-me.ts'), 'rename\n')
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'baseline'])
  let current = await revisions(repo)
  const coordinator = new ReviewMutationCoordinator({ resolveWorkspace: () => current.binding, recoveryDir: join(root, 'recovery') })

  await writeFile(join(repo, 'a.ts'), changed)
  current = await revisions(repo)
  const stagePreview = await coordinator.preview({
    operation: 'stage', target: { kind: 'live-working-tree', workspaceId: current.binding.workspaceId, revision: current.working },
    expectedRevision: current.working, selection: { kind: 'hunk', path: 'a.ts', hunkIndex: 0 },
  })
  assert.ok(stagePreview.additions > 0 && stagePreview.removals > 0)
  assert.match(stagePreview.patch, /^diff --git/m, 'preview exposes the exact bounded patch')
  const staged = await coordinator.apply(stagePreview.id, allow())
  assert.equal(staged.status, 'applied')
  assert.equal((await git(repo, ['diff', '--cached', '--', 'unrelated.ts'])).stdout, '', 'unrelated user files are untouched')

  current = await revisions(repo)
  const unstagePreview = await coordinator.preview({
    operation: 'unstage', target: { kind: 'staged', workspaceId: current.binding.workspaceId, revision: current.index },
    expectedRevision: current.index, selection: { kind: 'hunk', path: 'a.ts', hunkIndex: 0 },
  })
  const denied = await coordinator.apply(unstagePreview.id, deny())
  assert.equal(denied.status, 'denied')
  assert.equal(denied.audit.source, 'electron-main')
  assert.notEqual((await git(repo, ['diff', '--cached', '--', 'a.ts'])).stdout, '', 'denied approval has no side effect')

  const cancelledUnstage = await coordinator.preview({
    operation: 'unstage', target: { kind: 'staged', workspaceId: current.binding.workspaceId, revision: current.index },
    expectedRevision: current.index, selection: { kind: 'hunk', path: 'a.ts', hunkIndex: 0 },
  })
  assert.equal((await coordinator.apply(cancelledUnstage.id, cancel())).status, 'cancelled')
  const approvedUnstage = await coordinator.preview({
    operation: 'unstage', target: { kind: 'staged', workspaceId: current.binding.workspaceId, revision: current.index },
    expectedRevision: current.index, selection: { kind: 'hunk', path: 'a.ts', hunkIndex: 0 },
  })
  await coordinator.apply(approvedUnstage.id, allow())
  assert.equal((await git(repo, ['diff', '--cached', '--', 'a.ts'])).stdout, '')

  current = await revisions(repo)
  const stageFile = await coordinator.preview({ operation: 'stage', target: { kind: 'live-working-tree', workspaceId: current.binding.workspaceId, revision: current.working }, expectedRevision: current.working, selection: { kind: 'file', path: 'a.ts' } })
  await coordinator.apply(stageFile.id, allow())
  current = await revisions(repo)
  const unstageFile = await coordinator.preview({ operation: 'unstage', target: { kind: 'staged', workspaceId: current.binding.workspaceId, revision: current.index }, expectedRevision: current.index, selection: { kind: 'file', path: 'a.ts' } })
  await coordinator.apply(unstageFile.id, allow())

  current = await revisions(repo)
  const overlapPreview = await coordinator.preview({
    operation: 'revert', target: { kind: 'live-working-tree', workspaceId: current.binding.workspaceId, revision: current.working },
    expectedRevision: current.working, selection: { kind: 'hunk', path: 'a.ts', hunkIndex: 0 },
  })
  await writeFile(join(repo, 'a.ts'), `${changed}// overlapping edit\n`)
  await assert.rejects(() => coordinator.apply(overlapPreview.id, allow()), (error) => error instanceof ReviewMutationError && error.code === 'stale')
  await writeFile(join(repo, 'a.ts'), changed)
  current = await revisions(repo)
  const stalePreview = await coordinator.preview({
    operation: 'revert', target: { kind: 'live-working-tree', workspaceId: current.binding.workspaceId, revision: current.working },
    expectedRevision: current.working, selection: { kind: 'file', path: 'a.ts' },
  })
  await writeFile(join(repo, 'unrelated.ts'), 'newer user change\n')
  await assert.rejects(() => coordinator.apply(stalePreview.id, allow()), (error) => error instanceof ReviewMutationError && error.code === 'stale')
  assert.match(await readFile(join(repo, 'a.ts'), 'utf8'), /LINE-1/, 'stale CAS leaves selected file unchanged')

  current = await revisions(repo)
  const revertHunk = await coordinator.preview({ operation: 'revert', target: { kind: 'live-working-tree', workspaceId: current.binding.workspaceId, revision: current.working }, expectedRevision: current.working, selection: { kind: 'hunk', path: 'a.ts', hunkIndex: 0 } })
  await coordinator.apply(revertHunk.id, allow())
  assert.match(await readFile(join(repo, 'a.ts'), 'utf8'), /^line-1/m)
  assert.match(await readFile(join(repo, 'a.ts'), 'utf8'), /LINE-16/, 'hunk revert preserves another hunk in the same file')
  current = await revisions(repo)
  const revertPreview = await coordinator.preview({
    operation: 'revert', target: { kind: 'live-working-tree', workspaceId: current.binding.workspaceId, revision: current.working },
    expectedRevision: current.working, selection: { kind: 'file', path: 'a.ts' },
  })
  const reverted = await coordinator.apply(revertPreview.id, allow())
  assert.equal(await readFile(join(repo, 'a.ts'), 'utf8'), baseline)
  assert.equal(await readFile(join(repo, 'unrelated.ts'), 'utf8'), 'newer user change\n', 'revert does not touch unrelated user changes')
  assert.ok(reverted.recoveryRef)
  assert.match(await readFile(reverted.recoveryRef!, 'utf8'), /^diff --git/m)

  current = await revisions(repo)
  await assert.rejects(() => coordinator.preview({
    operation: 'stage', target: { kind: 'live-working-tree', workspaceId: current.binding.workspaceId, revision: current.working },
    expectedRevision: current.working, selection: { kind: 'file', path: '../escape' },
  }), (error) => error instanceof ReviewMutationError && error.code === 'invalid')
  await assert.rejects(() => coordinator.preview({
    operation: 'stage', target: { kind: 'live-working-tree', workspaceId: current.binding.workspaceId, revision: current.working },
    expectedRevision: current.working, selection: { kind: 'file', path: 'a.ts;touch injected' },
  }))
  await assert.rejects(() => access(join(repo, 'injected')), 'argv path cannot execute shell metacharacters')
  await symlink(join(root, 'outside'), join(repo, 'escape-link'))
  current = await revisions(repo)
  await assert.rejects(() => coordinator.preview({
    operation: 'stage', target: { kind: 'live-working-tree', workspaceId: current.binding.workspaceId, revision: current.working },
    expectedRevision: current.working, selection: { kind: 'file', path: 'escape-link' },
  }), (error) => error instanceof ReviewMutationError && error.code === 'unsupported')

  await assert.rejects(() => coordinator.preview({
    operation: 'stage', target: { kind: 'run-snapshot', snapshotId: 'historical' } as never,
    expectedRevision: current.working, selection: { kind: 'file', path: 'a.ts' },
  }), (error) => error instanceof ReviewMutationError && error.code === 'invalid')

  await rename(join(repo, 'rename-me.ts'), join(repo, 'renamed.ts'))
  current = await revisions(repo)
  const renamed = await coordinator.preview({
    operation: 'stage', target: { kind: 'live-working-tree', workspaceId: current.binding.workspaceId, revision: current.working },
    expectedRevision: current.working, selection: { kind: 'file', path: 'renamed.ts' },
  })
  await coordinator.apply(renamed.id, allow())

  await writeFile(join(repo, 'binary.bin'), Buffer.from([0, 1, 2, 3]))
  current = await revisions(repo)
  const binary = await coordinator.preview({
    operation: 'stage', target: { kind: 'live-working-tree', workspaceId: current.binding.workspaceId, revision: current.working },
    expectedRevision: current.working, selection: { kind: 'file', path: 'binary.bin' },
  })
  assert.equal(binary.binary, true)
  await coordinator.apply(binary.id, allow())

  const linked = join(root, 'linked-worktree')
  await git(repo, ['worktree', 'add', '-b', 'mutation-linked', linked])
  let linkedCurrent = await revisions(linked)
  const linkedCoordinator = new ReviewMutationCoordinator({ resolveWorkspace: () => linkedCurrent.binding, recoveryDir: join(root, 'linked-recovery') })
  await writeFile(join(linked, 'a.ts'), 'linked change\n')
  linkedCurrent = await revisions(linked)
  const linkedPreview = await linkedCoordinator.preview({
    operation: 'stage', target: { kind: 'live-working-tree', workspaceId: linkedCurrent.binding.workspaceId, revision: linkedCurrent.working },
    expectedRevision: linkedCurrent.working, selection: { kind: 'file', path: 'a.ts' },
  })
  await linkedCoordinator.apply(linkedPreview.id, allow())
  assert.match((await git(linked, ['diff', '--cached', '--', 'a.ts'])).stdout, /linked change/)

  const protocol = await readFile(new URL('../electron/piHostProtocol.ts', import.meta.url), 'utf8')
  const renderer = await readFile(new URL('../src/components/ReviewExplorer.tsx', import.meta.url), 'utf8')
  assert.match(protocol, /requestPiToolApproval[\s\S]*review_mutation/, 'apply enters the central Approval Decision workflow')
  assert.doesNotMatch(protocol, /apply\(previewId, params\.approval/, 'renderer cannot forge the approval object')
  assert.doesNotMatch(renderer, /\bgit\s+(?:add|apply|checkout|restore|reset)\b/, 'renderer never authors Git commands')

  console.log('smoke-review-mutation-coordinator passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
