import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { canTransitionReviewComment, fileReviewState, inheritReviewedFiles, rebaseReviewComment, type ReviewCommentAnchor } from '../src/agent/reviewStateContract.ts'
import { InMemoryReviewStateStore, SqliteReviewStateStore, type ReviewStateStore } from '../electron/reviewStateStore.ts'

const root = await mkdtemp(join(tmpdir(), 'agentstudio-review-state-'))
const dbPath = join(root, 'review-state.sqlite')
const anchor = (snapshotId: string, line: number): ReviewCommentAnchor => ({ snapshotId, path: 'src/a.ts', side: 'new', line, hunkFingerprint: 'hunk-1', contextHash: 'context-1', originalContext: 'const answer = 41' })

async function exercise(name: string, store: ReviewStateStore) {
  const draft = await store.saveDraft({ id: `${name}-comment`, anchor: anchor('snapshot-a', 10), body: 'Expected 42', now: '2026-01-01T00:00:00.000Z' })
  assert.equal(draft.status, 'draft')
  assert.equal((await store.saveDraft({ id: draft.id, anchor: draft.anchor, body: 'Expected exactly 42', now: '2026-01-01T00:01:00.000Z' })).body, 'Expected exactly 42')
  await store.transitionComment(draft.id, 'submitted')
  await assert.rejects(() => store.saveDraft({ id: draft.id, anchor: draft.anchor, body: 'illegal edit' }), /Only draft/)
  await assert.rejects(() => store.transitionComment(draft.id, 'resolved'), /Illegal review comment transition/)
  await store.transitionComment(draft.id, 'acknowledged')
  const bundle = await store.prepareFeedback({ snapshotId: 'snapshot-a', threadId: 'thread-a', workspace: { workspaceId: 'workspace-a', mode: 'non-git', projectRoot: '/fixture' }, now: '2026-01-01T00:02:00.000Z' })
  const claim = await store.claimFeedback(bundle.id, `run-${name}`)
  assert.equal(claim.claimed, true)
  assert.equal(claim.bundle.comments[0]?.body, 'Expected exactly 42', 'bundle freezes comment body and anchor before run admission')
  assert.equal((await store.claimFeedback(bundle.id, `run-${name}`)).claimed, false, 'retry/reload cannot dispatch the same bundle twice')
  const reviewed = await store.markReviewed({ snapshotId: 'snapshot-a', path: 'src/a.ts', contentHash: 'same', now: '2026-01-01T00:00:00.000Z' })
  assert.equal(reviewed.state, 'reviewed')
  const rebased = await store.inheritSnapshot({ fromSnapshotId: 'snapshot-a', toSnapshotId: 'snapshot-b', nextManifest: [{ path: 'src/a.ts', status: 'modified', binary: false, contentHash: 'same' }], anchorCandidates: [anchor('snapshot-b', 14)], now: '2026-01-02T00:00:00.000Z' })
  assert.equal(rebased.comments[0]?.anchor.line, 14)
  assert.equal(rebased.comments[0]?.rebasedFrom?.line, 10)
  assert.equal((await store.listComments('snapshot-a')).length, 1, 'A remains immutable after A→B inheritance')
  assert.equal((await store.listComments('snapshot-b')).length, 1, 'B receives a lineage comment instead of moving A')
  assert.equal((await store.listComments('snapshot-b'))[0]?.sourceCommentId, draft.id)
  assert.equal(rebased.fileStates[0]?.state, 'reviewed')
  await store.hardDeleteSnapshot('snapshot-b')
  assert.equal((await store.listComments('snapshot-b')).length, 0)
  assert.equal((await store.listFileStates('snapshot-b')).length, 0)
  return { bundleId: bundle.id, runId: `run-${name}` }
}

assert.equal(canTransitionReviewComment('draft', 'submitted'), true)
assert.equal(canTransitionReviewComment('draft', 'resolved'), false)
const acknowledged = { id: 'c', anchor: anchor('snapshot-a', 10), body: 'x', status: 'acknowledged' as const, createdAt: 'now', updatedAt: 'now' }
assert.equal(rebaseReviewComment(acknowledged, 'snapshot-b', [], 'later').status, 'outdated')
assert.equal(rebaseReviewComment(acknowledged, 'snapshot-b', [anchor('snapshot-b', 11), anchor('snapshot-b', 12)], 'later').status, 'outdated', 'ambiguous anchors never move silently')
assert.deepEqual(inheritReviewedFiles({ fromSnapshotId: 'a', toSnapshotId: 'b', reviewed: [{ snapshotId: 'a', path: 'src/a.ts', contentHash: 'old', state: 'reviewed', reviewedAt: 'now' }], nextManifest: [{ path: 'src/a.ts', status: 'modified', binary: false, contentHash: 'new' }], now: 'later' }).map((item) => item.state), ['changed-after-review'])
assert.equal(fileReviewState({ path: 'src/a.ts', status: 'modified', binary: false, contentHash: 'same' }, { snapshotId: 'a', path: 'src/a.ts', contentHash: 'same', state: 'reviewed', reviewedAt: 'now' }, [acknowledged]), 'has-open-comments')

await exercise('memory', new InMemoryReviewStateStore())
const sqlite = await SqliteReviewStateStore.open(dbPath)
const sqliteDispatch = await exercise('sqlite', sqlite)
const persisted = await sqlite.saveDraft({ id: 'restart-draft', anchor: anchor('restart', 3), body: 'survive restart' })
await sqlite.close()
const reopened = await SqliteReviewStateStore.open(dbPath)
assert.equal((await reopened.listComments('restart'))[0]?.id, persisted.id, 'drafts survive Host restart/archive projection')
assert.equal((await reopened.claimFeedback(sqliteDispatch.bundleId, sqliteDispatch.runId)).claimed, false, 'reload cannot dispatch an already claimed bundle')
await reopened.hardDeleteSnapshot('restart')
assert.equal((await reopened.listComments('restart')).length, 0, 'only hard delete removes canonical records')
await reopened.close()
await rm(root, { recursive: true, force: true })
console.log('smoke-review-state-store passed')
