import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { InMemoryReviewArtifactStore, ReviewArtifactStoreError, SqliteReviewArtifactStore, type ReviewArtifactStore } from '../electron/reviewArtifactStore.ts'
import { InMemoryReviewStateStore } from '../electron/reviewStateStore.ts'
import { InMemoryReviewVerificationStore } from '../electron/reviewVerificationStore.ts'
import type { ReviewAdmissionSnapshot } from '../src/agent/reviewContract.ts'

function admission(snapshotId: string): Extract<ReviewAdmissionSnapshot, { canonical: true }> {
  return {
    snapshotId, runId: `run_${snapshotId}`, status: 'pending', canonical: true, runnerKind: 'builtin',
    workspace: { workspaceId: 'workspace_lifecycle', mode: 'git', projectRoot: '/old/project', repoRoot: '/old/project', worktreeRoot: '/old/project', gitDir: '/old/project/.git' },
    baseline: { capturedAt: '2026-08-01T00:00:00.000Z', head: 'a'.repeat(40), indexRevision: 'b'.repeat(64), workingRevision: 'c'.repeat(64) },
  }
}

async function ready(store: ReviewArtifactStore, snapshotId: string, withRefs = true) {
  const admitted = admission(snapshotId)
  await store.beginRun({ admission: admitted, threadId: 'thread_archive' })
  return store.finalizeRun({
    snapshotId, status: 'ready', settlement: admitted.baseline!, attributionFidelity: 'exact', diagnostics: [],
    manifest: [{ path: 'src/lifecycle.ts', status: 'modified', binary: false, payloadRef: 'payload_lifecycle' }],
    payloads: [{ payloadId: 'payload_lifecycle', content: 'immutable lifecycle payload' }],
    ...(withRefs ? { commentRefs: ['comment_archive'], reviewStateRefs: ['state_archive'] } : {}),
  })
}

async function lifecycle(source: ReviewArtifactStore, destination: ReviewArtifactStore) {
  const original = await ready(source, 'review_exported')
  const bundle = await source.exportArtifact(original.snapshotId)
  assert.match(bundle.bundleHash, /^[a-f0-9]{64}$/)
  assert.equal(bundle.totalBytes, Buffer.byteLength('immutable lifecycle payload'))
  assert.deepEqual(bundle.refs, { comments: ['comment_archive'], reviewState: ['state_archive'] })
  assert.equal((await destination.previewImport(bundle)).status, 'ready')
  const tampered = structuredClone(bundle); tampered.payloads[0]!.contentBase64 = Buffer.from('tampered').toString('base64')
  assert.equal((await destination.previewImport(tampered)).status, 'invalid')
  const unsupported = structuredClone(bundle) as unknown as { schemaVersion: number }
  unsupported.schemaVersion = 2
  assert.equal((await destination.previewImport(unsupported)).status, 'unsupported')
  const missing = structuredClone(bundle)
  delete missing.artifact.settlement
  delete missing.artifact.admission.baseline
  const { bundleHash: _oldHash, ...missingUnsigned } = missing
  missing.bundleHash = createHash('sha256').update(JSON.stringify(missingUnsigned)).digest('hex')
  assert.equal((await destination.previewImport(missing)).status, 'missing')
  const imported = await destination.importArtifact(bundle, bundle.bundleHash)
  assert.equal(imported.snapshotId, original.snapshotId)
  assert.equal(Buffer.from(await destination.readPayload(imported.snapshotId, 'payload_lifecycle')).toString(), 'immutable lifecycle payload')
  assert.equal((await destination.previewImport(bundle)).status, 'collision')
  await assert.rejects(() => destination.importArtifact(bundle, bundle.bundleHash), (error) => error instanceof ReviewArtifactStoreError && error.code === 'conflict')

  const rebound = await destination.rebindWorkspace(imported.snapshotId, '/moved/project', '2026-08-30T10:00:00.000Z')
  assert.equal(rebound.workspaceRebind?.projectRoot, '/moved/project')
  assert.equal(rebound.admission.workspace?.projectRoot, '/old/project', 'rebind hint never rewrites historical display provenance')
  await ready(destination, 'review_unreferenced', false)
  const retention = await destination.applyRetention({ retainedSnapshotIds: [imported.snapshotId], reason: 'retention fixture' })
  assert.deepEqual(retention.retained, [imported.snapshotId])
  assert.deepEqual(retention.tombstoned, ['review_unreferenced'])
  assert.equal((await destination.read('review_unreferenced')).tombstone?.reason, 'retention fixture')
  await destination.hardDeleteArtifact('review_unreferenced')
  await assert.rejects(() => destination.read('review_unreferenced'), (error) => error instanceof ReviewArtifactStoreError && error.code === 'not_found')
}

const root = await mkdtemp(join(tmpdir(), 'agentstudio-review-lifecycle-'))
try {
  await lifecycle(new InMemoryReviewArtifactStore(), new InMemoryReviewArtifactStore())

  const archivedArtifacts = new InMemoryReviewArtifactStore()
  const archivedState = new InMemoryReviewStateStore()
  const archivedVerification = new InMemoryReviewVerificationStore()
  await ready(archivedArtifacts, 'review_archived', false)
  await archivedState.saveDraft({ anchor: { snapshotId: 'review_archived', path: 'src/lifecycle.ts', side: 'new', line: 1, hunkFingerprint: 'hunk', contextHash: 'context', originalContext: 'line' }, body: 'archive comment' })
  await archivedState.markReviewed({ snapshotId: 'review_archived', path: 'src/lifecycle.ts', contentHash: 'f'.repeat(64) })
  await archivedVerification.record({ snapshotId: 'review_archived', runId: 'run_review_archived', workspaceId: 'workspace_lifecycle', verifiedRevision: 'a'.repeat(64), kind: 'build', command: 'npm', args: ['run', 'build'], cwd: '/old/project', runner: 'host', startedAt: '2026-08-30T00:00:00.000Z', durationMs: 1, exitCode: 0, output: 'passed' })
  assert.deepEqual(await archivedState.referencedSnapshotIds(), ['review_archived'])
  assert.deepEqual((await archivedArtifacts.applyRetention({ retainedSnapshotIds: ['review_archived'], reason: 'archive retention' })).retained, ['review_archived'])
  assert.equal((await archivedState.listComments('review_archived')).length, 1, 'archive retains comments and review state')
  assert.equal((await archivedVerification.list('review_archived')).length, 1, 'archive retains verification records')
  await archivedState.hardDeleteSnapshot('review_archived')
  await archivedVerification.hardDeleteSnapshot('review_archived')
  await archivedArtifacts.hardDeleteArtifact('review_archived')
  assert.equal((await archivedState.listComments('review_archived')).length, 0)
  assert.equal((await archivedState.listFileStates('review_archived')).length, 0)
  assert.equal((await archivedVerification.list('review_archived')).length, 0)
  await assert.rejects(() => archivedArtifacts.read('review_archived'), (error) => error instanceof ReviewArtifactStoreError && error.code === 'not_found')

  const sqliteSource = await SqliteReviewArtifactStore.open(join(root, 'source.sqlite'))
  const sqliteDestination = await SqliteReviewArtifactStore.open(join(root, 'destination.sqlite'))
  await lifecycle(sqliteSource, sqliteDestination)
  await sqliteSource.close(); await sqliteDestination.close()

  const recoveryPath = join(root, 'recovery.sqlite')
  const recovery = await SqliteReviewArtifactStore.open(recoveryPath)
  await recovery.beginRun({ admission: admission('crash_begin'), threadId: 'thread_crash' })
  await recovery.close()
  const raw = new DatabaseSync(recoveryPath)
  const metadata = JSON.stringify({ schemaVersion: 1, snapshotId: 'crash_capture', runId: 'run_crash_capture', threadId: 'thread_crash', status: 'capturing', admission: admission('crash_capture'), attributionFidelity: 'partial', diagnostics: [], manifest: [], payloadCount: 0, payloadBytes: 0, commentRefs: [], reviewStateRefs: [] })
  for (const id of ['crash_manifest', 'crash_payload', 'crash_commit']) raw.prepare('INSERT INTO review_snapshots(snapshot_id,run_id,thread_id,status,metadata_json) VALUES(?,?,?,?,?)').run(id, `run_${id}`, 'thread_crash', 'capturing', metadata.replaceAll('crash_capture', id))
  raw.prepare('INSERT INTO review_manifest(snapshot_id,position,entry_json) VALUES(?,?,?)').run('crash_manifest', 0, JSON.stringify({ path: 'partial.ts', status: 'modified', binary: false }))
  raw.prepare('INSERT INTO review_payloads(snapshot_id,payload_id,content,sha256) VALUES(?,?,?,?)').run('crash_payload', 'orphan', Buffer.from('orphan'), '0'.repeat(64))
  raw.prepare('INSERT INTO review_manifest(snapshot_id,position,entry_json) VALUES(?,?,?)').run('crash_commit', 0, JSON.stringify({ path: 'partial.ts', status: 'modified', binary: false, payloadRef: 'orphan' }))
  raw.prepare('INSERT INTO review_payloads(snapshot_id,payload_id,content,sha256) VALUES(?,?,?,?)').run('crash_commit', 'orphan', Buffer.from('orphan'), '0'.repeat(64))
  raw.close()
  const reopened = await SqliteReviewArtifactStore.open(recoveryPath)
  for (const id of ['crash_begin', 'crash_manifest', 'crash_payload', 'crash_commit']) {
    const recovered = await reopened.read(id)
    assert.equal(recovered.status, 'failed')
    assert.equal(recovered.payloadCount, 0)
    assert.equal(recovered.manifest.length, 0)
  }
  await reopened.close()
  const protocol = await readFile(new URL('../electron/piHostProtocol.ts', import.meta.url), 'utf8')
  const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8')
  assert.match(protocol, /reviewImportPreviews\.add[\s\S]*reviewImportPreviews\.has[\s\S]*reviewImportPreviews\.delete/, 'import apply consumes a Host-issued preview identity')
  assert.match(protocol, /approveReviewLifecycle[\s\S]*action: 'import'/, 'import is approval-controlled after preview')
  assert.match(protocol, /action: 'retention'/, 'retention cannot silently collect payloads')
  assert.match(protocol, /action: 'hard-delete'[\s\S]*hardDeleteSnapshot[\s\S]*hardDeleteArtifact/, 'hard delete removes state, verification, and artifact canonical records')
  assert.match(protocol, /captureReviewWorkspaceAdmission[\s\S]*reviewWorkspaces\.set\(originalWorkspace\.workspaceId[\s\S]*rebindWorkspace/, 'rebind validates the new path while preserving the historical workspace identity')
  const lifecycleProtocol = protocol.slice(protocol.indexOf('async function approveReviewLifecycle'), protocol.indexOf('async function handleReviewRequest'))
  assert.doesNotMatch(lifecycleProtocol, /params\.approval/, 'renderer cannot forge lifecycle approval')
  for (const bridge of ['exportArtifact', 'previewArtifactImport', 'applyArtifactImport', 'rebindArtifact', 'applyArtifactRetention', 'hardDeleteArtifact']) assert.match(preload, new RegExp(`${bridge}:`), `${bridge} is reachable only through the typed Electron bridge`)
  console.log('smoke-review-artifact-lifecycle passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
