import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { InMemoryReviewArtifactStore } from '../electron/reviewArtifactStore.ts'
import { createPiHostServer, type PiHostMessage, type PiHostResponse } from '../electron/piHostProtocol.ts'

const exec = promisify(execFile)
const git = (cwd: string, args: string[]) => exec('git', ['-C', cwd, ...args])
async function request(host: { handle(input: unknown): Promise<void> }, messages: PiHostMessage[], id: number, method: string, params: Record<string, unknown>) {
  await host.handle({ id, method, params })
  const response = messages.find((message): message is PiHostResponse => 'id' in message && message.id === id)
  if (!response) throw new Error(`missing response ${id}`)
  return response
}

const root = await mkdtemp(join(tmpdir(), 'agentstudio-review-settlement-'))
try {
  const repo = join(root, 'repo')
  await mkdir(repo)
  await git(repo, ['init'])
  await git(repo, ['config', 'user.email', 'fixture@example.com'])
  await git(repo, ['config', 'user.name', 'Fixture'])
  await writeFile(join(repo, 'a.ts'), 'before\n')
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'baseline'])

  const store = new InMemoryReviewArtifactStore()
  const messages: PiHostMessage[] = []
  const host = createPiHostServer((message) => messages.push(message), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, store)
  await request(host, messages, 1, 'initialize', { protocolVersion: 5, capabilities: ['review-v1'] })
  const admitted = await request(host, messages, 2, 'review/v1/admit', { runId: 'run_1', threadId: 'thread_1', projectRoot: repo, runnerKind: 'builtin' })
  const snapshotId = admitted.result?.reviewAdmission?.snapshotId
  assert.ok(snapshotId)
  await writeFile(join(repo, 'a.ts'), 'after\n')
  const finalized = await request(host, messages, 3, 'review/v1/finalize', { snapshotId, settlementKind: 'completed' })
  assert.equal(finalized.result?.reviewSnapshotRef?.status, 'ready', JSON.stringify(finalized))
  const artifact = await store.read(snapshotId!)
  const payloadRef = artifact.manifest[0]?.payloadRef
  assert.ok(payloadRef)
  const target = { kind: 'run-snapshot', snapshotId }
  const description = await request(host, messages, 31, 'review/v1/describe', { target })
  assert.equal(description.result?.reviewTargetDescription?.immutable, true)
  const files = await request(host, messages, 32, 'review/v1/files', { target, limit: 1 })
  assert.equal(files.result?.reviewFiles?.items[0]?.path, 'a.ts')
  const diff = await request(host, messages, 33, 'review/v1/file-diff', { target, path: 'a.ts', maxBytes: 64 * 1024 })
  assert.match(diff.result?.reviewDiff?.items.map((hunk) => hunk.content).join('') || '', /after/)
  const draft = await request(host, messages, 34, 'review/v1/draft/save', { snapshotId, path: 'a.ts', side: 'new', line: 1, body: 'Please keep this behavior' })
  assert.equal(draft.result?.reviewComment?.status, 'draft', JSON.stringify(draft))
  const commentId = draft.result?.reviewComment?.id
  await request(host, messages, 341, 'review/v1/comment/transition', { id: commentId, status: 'submitted' })
  const prepared = await request(host, messages, 342, 'review/v1/feedback/prepare', { snapshotId })
  const bundleId = prepared.result?.reviewFeedbackBundle?.id
  assert.ok(bundleId, JSON.stringify(prepared))
  const claimed = await request(host, messages, 343, 'review/v1/feedback/claim', { id: bundleId, runId: 'run_feedback' })
  assert.equal(claimed.result?.reviewFeedbackClaimed, true)
  const duplicate = await request(host, messages, 344, 'review/v1/feedback/claim', { id: bundleId, runId: 'run_feedback' })
  assert.equal(duplicate.result?.reviewFeedbackClaimed, false)
  const comments = await request(host, messages, 35, 'review/v1/comments/list', { snapshotId })
  assert.equal(comments.result?.reviewComments?.length, 1)
  const fileState = await request(host, messages, 36, 'review/v1/file-state/mark', { snapshotId, path: 'a.ts', contentHash: artifact.manifest[0]?.contentHash })
  assert.equal(fileState.result?.reviewFileState?.state, 'reviewed')
  const originalPatch = Buffer.from(await store.readPayload(snapshotId!, payloadRef!)).toString('utf8')
  await writeFile(join(repo, 'a.ts'), 'later mutation\n')
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'later'])
  const replayPatch = Buffer.from(await store.readPayload(snapshotId!, payloadRef!)).toString('utf8')
  assert.equal(replayPatch, originalPatch, 'historical snapshot never rereads the current workspace')
  const retried = await request(host, messages, 4, 'review/v1/finalize', { snapshotId, settlementKind: 'completed' })
  assert.deepEqual(retried.result?.reviewSnapshotRef, finalized.result?.reviewSnapshotRef, 'finalization retry is idempotent')
  const recovered = await request(host, messages, 40, 'review/v1/finalize', { runId: 'run_1', settlementKind: 'completed' })
  assert.deepEqual(recovered.result?.reviewSnapshotRef, finalized.result?.reviewSnapshotRef, 'recovery resolves the persisted snapshot identity by runId')

  const followUpAdmission = await request(host, messages, 41, 'review/v1/admit', { runId: 'run_feedback', threadId: 'thread_1', projectRoot: repo, runnerKind: 'builtin' })
  const followUpSnapshotId = followUpAdmission.result?.reviewAdmission?.snapshotId
  assert.ok(followUpSnapshotId)
  await writeFile(join(repo, 'a.ts'), 'feedback revision\n')
  await request(host, messages, 42, 'review/v1/finalize', { snapshotId: followUpSnapshotId, settlementKind: 'completed' })
  const inherited = await request(host, messages, 43, 'review/v1/state/inherit', { fromSnapshotId: snapshotId, toSnapshotId: followUpSnapshotId })
  assert.equal(inherited.result?.reviewComments?.[0]?.status, 'outdated', 'unsafe anchor relocation fails closed on the A→B link')
  assert.equal((await store.read(snapshotId!)).manifestHash, artifact.manifestHash, 'A remains immutable after B and state inheritance')

  const failedAdmission = await request(host, messages, 5, 'review/v1/admit', { runId: 'run_failed', threadId: 'thread_failed', projectRoot: repo, runnerKind: 'external' })
  const failedId = failedAdmission.result?.reviewAdmission?.snapshotId
  await rm(repo, { recursive: true, force: true })
  const failedReview = await request(host, messages, 6, 'review/v1/finalize', { snapshotId: failedId, settlementKind: 'crash' })
  assert.equal(failedReview.error, undefined, 'review capture failure does not fail task settlement protocol')
  assert.equal(failedReview.result?.reviewSnapshotRef?.status, 'failed')

  const coordinator = await readFile(new URL('../src/agent/taskRunCoordinator.ts', import.meta.url), 'utf8')
  const finalization = coordinator.slice(coordinator.indexOf('async function runFinalizationSequence'), coordinator.indexOf('function buildResumeSummary'))
  assert.match(finalization, /finalizeRunReviewSnapshot[\s\S]*pushRunProcessSummary/, 'Host snapshot finalizes before summary projection')
  assert.match(coordinator, /async function legacySummaryDiff[\s\S]*input\.reviewSnapshotRef \|\| input\.producedFiles\.length === 0/, 'legacy workspaceDiff is only a no-snapshot fallback')
  assert.doesNotMatch(finalization, /workspaceDiff/, 'canonical finalization does not reread workspace diff in the lifecycle owner')
  const threadStore = await readFile(new URL('../src/store/threadStore.ts', import.meta.url), 'utf8')
  assert.match(threadStore, /reviewSnapshotRef\?: ReviewSnapshotRef/, 'summary/archive persistence carries the bounded snapshot identity')
  await store.close()
  console.log('smoke-review-settlement-integration passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
