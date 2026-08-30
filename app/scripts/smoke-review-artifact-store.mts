import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import {
  InMemoryReviewArtifactStore,
  ReviewArtifactStoreError,
  SqliteReviewArtifactStore,
  type ReviewArtifactStore,
} from '../electron/reviewArtifactStore.ts'
import type { ReviewAdmissionSnapshot } from '../src/agent/reviewContract.ts'

const admission: Extract<ReviewAdmissionSnapshot, { canonical: true }> = {
  snapshotId: 'review_fixture',
  runId: 'run_fixture',
  status: 'pending',
  canonical: true,
  runnerKind: 'builtin',
  workspace: { workspaceId: 'workspace_fixture', mode: 'git', projectRoot: '/fixture', repoRoot: '/fixture', worktreeRoot: '/fixture', gitDir: '/fixture/.git' },
  baseline: { capturedAt: '2026-08-30T00:00:00.000Z', head: 'a'.repeat(40), indexRevision: 'b'.repeat(64), workingRevision: 'c'.repeat(64) },
}

async function contract(store: ReviewArtifactStore): Promise<void> {
  const begun = await store.beginRun({ admission, threadId: 'thread_fixture' })
  assert.equal(begun.status, 'pending')
  assert.equal((await store.beginRun({ admission, threadId: 'thread_fixture' })).snapshotId, admission.snapshotId, 'begin is idempotent')
  await assert.rejects(
    () => store.finalizeRun({
      snapshotId: admission.snapshotId,
      status: 'ready',
      attributionFidelity: 'exact',
      settlement: admission.baseline!,
      manifest: [{ path: 'src/a.ts', status: 'modified', binary: false, payloadRef: 'payload_a' }],
      payloads: [{ payloadId: 'payload_a', content: 'tamper', sha256: '0'.repeat(64) }],
    }),
    (error: unknown) => error instanceof ReviewArtifactStoreError && error.code === 'corrupt',
  )
  assert.equal((await store.read(admission.snapshotId)).status, 'pending', 'failed finalize commits no metadata or payload')
  const payload = 'old\nnew\n'
  const ready = await store.finalizeRun({
    snapshotId: admission.snapshotId,
    status: 'ready',
    attributionFidelity: 'exact',
    settlement: { capturedAt: '2026-08-30T00:01:00.000Z', head: 'a'.repeat(40), indexRevision: 'd'.repeat(64), workingRevision: 'e'.repeat(64) },
    manifest: [{ path: 'src/a.ts', status: 'modified', binary: false, additions: 1, removals: 1, payloadRef: 'payload_a' }],
    payloads: [{ payloadId: 'payload_a', content: payload }],
  })
  assert.equal(ready.status, 'ready')
  assert.match(ready.manifestHash || '', /^[a-f0-9]{64}$/)
  assert.equal(ready.payloadCount, 1)
  assert.equal((await store.read(admission.snapshotId)).manifest[0]?.path, 'src/a.ts')
  assert.equal(Buffer.from(await store.readPayload(admission.snapshotId, 'payload_a')).toString('utf8'), payload)
  const page = await store.readPayloadPage({ snapshotId: admission.snapshotId, payloadId: 'payload_a', maxBytes: 3 })
  assert.equal(Buffer.from(page.content).toString('utf8'), 'old')
  assert.equal(page.nextOffset, 3)
  await assert.rejects(
    () => store.finalizeRun({
      snapshotId: admission.snapshotId,
      status: 'ready',
      attributionFidelity: 'exact',
      settlement: { capturedAt: '2026-08-30T00:03:00.000Z', head: 'a'.repeat(40), indexRevision: 'f'.repeat(64), workingRevision: '1'.repeat(64) },
      manifest: [{ path: 'src/a.ts', status: 'modified', binary: false, payloadRef: 'payload_a' }],
      payloads: [{ payloadId: 'payload_a', content: 'changed' }],
    }),
    (error: unknown) => error instanceof ReviewArtifactStoreError && error.code === 'conflict',
  )
  const deleted = await store.deleteArtifact(admission.snapshotId, 'fixture cleanup', '2026-08-30T00:02:00.000Z')
  assert.equal(deleted.status, 'deleted')
  assert.equal(deleted.manifest.length, 0)
  await store.close()
  await store.close()
}

await contract(new InMemoryReviewArtifactStore())

const root = await mkdtemp(join(tmpdir(), 'agentstudio-review-store-'))
try {
  const databasePath = join(root, 'review-artifacts.sqlite')
  const store = await SqliteReviewArtifactStore.open(databasePath)
  const journal = new DatabaseSync(databasePath, { readOnly: true })
  assert.equal((journal.prepare('PRAGMA journal_mode').get() as { journal_mode?: string }).journal_mode, 'wal')
  const tables = (journal.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'review_%' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name)
  assert.deepEqual(tables, ['review_manifest', 'review_payloads', 'review_schema_migrations', 'review_snapshots', 'review_tombstones'])
  journal.close()
  await contract(store)
  const reopened = await SqliteReviewArtifactStore.open(databasePath)
  const tombstone = await reopened.read(admission.snapshotId)
  assert.equal(tombstone.status, 'deleted')
  assert.equal(tombstone.tombstone?.reason, 'fixture cleanup')
  await assert.rejects(
    () => reopened.finalizeRun({
      snapshotId: 'missing', status: 'ready', attributionFidelity: 'partial',
      settlement: admission.baseline!, manifest: [{ path: 'x', status: 'modified', binary: false, payloadRef: 'missing' }], payloads: [],
    }),
    (error: unknown) => error instanceof ReviewArtifactStoreError && error.code === 'not_found',
  )
  const corruptAdmission = { ...admission, snapshotId: 'review_corrupt', runId: 'run_corrupt' }
  await reopened.beginRun({ admission: corruptAdmission, threadId: 'thread_corrupt' })
  await reopened.finalizeRun({
    snapshotId: corruptAdmission.snapshotId,
    status: 'ready',
    attributionFidelity: 'shared',
    settlement: admission.baseline!,
    manifest: [{ path: 'src/corrupt.ts', status: 'modified', binary: false, payloadRef: 'payload_corrupt' }],
    payloads: [{ payloadId: 'payload_corrupt', content: 'trusted' }],
  })
  await reopened.close()

  const tamper = new DatabaseSync(databasePath)
  tamper.prepare('UPDATE review_payloads SET content = ? WHERE snapshot_id = ?').run(Buffer.from('tampered'), corruptAdmission.snapshotId)
  tamper.close()
  const corruptStore = await SqliteReviewArtifactStore.open(databasePath)
  await assert.rejects(
    () => corruptStore.read(corruptAdmission.snapshotId),
    (error: unknown) => error instanceof ReviewArtifactStoreError && error.code === 'corrupt',
  )
  await corruptStore.close()

  const futurePath = join(root, 'future-review.sqlite')
  const future = new DatabaseSync(futurePath)
  future.exec('PRAGMA user_version = 2;')
  future.close()
  await assert.rejects(
    () => SqliteReviewArtifactStore.open(futurePath),
    (error: unknown) => error instanceof ReviewArtifactStoreError && error.code === 'unsupported_schema',
  )
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('smoke-review-artifact-store passed')
