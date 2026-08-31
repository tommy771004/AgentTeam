import { parseReviewArtifactImportBundle, reviewArtifactBundleHash, ReviewArtifactStoreError, type ReviewArtifactExportBundle, type ReviewArtifactStore } from './reviewArtifactStore.ts'
import type { ReviewStateStore } from './reviewStateStore.ts'
import type { ReviewVerificationStore } from './reviewVerificationStore.ts'
import { parseReviewStateSnapshot } from './reviewStateSnapshot.ts'

const lifecycleTails = new WeakMap<ReviewArtifactStore, Promise<void>>()

function serializeReviewArtifactLifecycle<T>(artifacts: ReviewArtifactStore, operation: () => Promise<T>): Promise<T> {
  const queued = (lifecycleTails.get(artifacts) || Promise.resolve()).then(operation)
  lifecycleTails.set(artifacts, queued.then(() => undefined, () => undefined))
  return queued
}

export async function exportReviewArtifact(artifacts: ReviewArtifactStore, states: ReviewStateStore, snapshotId: string): Promise<ReviewArtifactExportBundle> {
  const { bundleHash: _hash, ...artifactBundle } = await artifacts.exportArtifact(snapshotId)
  const reviewState = parseReviewStateSnapshot({ snapshotId, comments: await states.listComments(snapshotId), fileStates: await states.listFileStates(snapshotId) }, snapshotId)
  const unsigned = {
    ...artifactBundle, schemaVersion: 2 as const, reviewState,
    refs: { comments: reviewState.comments.map((item) => item.id), reviewState: reviewState.fileStates.map((item) => item.path) },
  }
  return { ...unsigned, bundleHash: reviewArtifactBundleHash(unsigned) }
}

export function importReviewArtifact(artifacts: ReviewArtifactStore, states: ReviewStateStore, value: unknown, expectedBundleHash: string) {
  const frozen = structuredClone(value)
  return serializeReviewArtifactLifecycle(artifacts, () => importExclusive(artifacts, states, frozen, expectedBundleHash))
}

async function importExclusive(artifacts: ReviewArtifactStore, states: ReviewStateStore, value: unknown, expectedBundleHash: string) {
  const bundle = parseReviewArtifactImportBundle(value)
  if (bundle.bundleHash !== expectedBundleHash) throw new ReviewArtifactStoreError('conflict', 'Review import changed after preview')
  const preview = await previewReviewArtifactImport(artifacts, bundle)
  if (preview.status !== 'ready') throw new ReviewArtifactStoreError('conflict', `Review import is ${preview.status}`)
  const snapshotId = bundle.artifact.snapshotId
  let stateRestored = false
  try {
    if (bundle.schemaVersion === 2) {
      // State stays unpublished until the artifact commit. If the artifact
      // commit fails, remove only this still-unpublished snapshot's state.
      await states.importSnapshot(parseReviewStateSnapshot(bundle.reviewState, snapshotId))
      stateRestored = true
    }
    return await artifacts.importArtifact(bundle, expectedBundleHash)
  } catch (error) {
    const published = await artifacts.findByRunId(bundle.artifact.runId).catch(() => undefined)
    if (stateRestored && published?.snapshotId !== snapshotId) await states.hardDeleteSnapshot(snapshotId)
    throw error
  }
}

/** Logical hard delete: hide the artifact first, then remove dependent owners. */
export async function hardDeleteReviewArtifact(
  artifacts: ReviewArtifactStore,
  states: ReviewStateStore,
  verification: ReviewVerificationStore,
  snapshotId: string,
  reason: string,
): Promise<void> {
  await serializeReviewArtifactLifecycle(artifacts, async () => {
    await artifacts.deleteArtifact(snapshotId, reason)
    await states.hardDeleteSnapshot(snapshotId)
    await verification.hardDeleteSnapshot(snapshotId)
    await artifacts.hardDeleteArtifact(snapshotId)
  })
}

export function applyReviewArtifactRetention(
  artifacts: ReviewArtifactStore,
  input: Parameters<ReviewArtifactStore['applyRetention']>[0],
) {
  return serializeReviewArtifactLifecycle(artifacts, () => artifacts.applyRetention(input))
}

export async function previewReviewArtifactImport(artifacts: ReviewArtifactStore, value: unknown) {
  const preview = await artifacts.previewImport(value)
  if (preview.status !== 'ready') return preview
  const bundle = parseReviewArtifactImportBundle(value)
  if (bundle.schemaVersion === 1 && (bundle.refs.comments.length || bundle.refs.reviewState.length)) {
    return { ...preview, status: 'missing' as const, diagnostics: ['Legacy export contains state references without comment/file-state data; re-export from the original Host.'] }
  }
  if (bundle.schemaVersion === 1) return { ...preview, diagnostics: ['Legacy export has no review-state payload; only the snapshot diff can be restored.'] }
  return preview
}
