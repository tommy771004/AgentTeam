import { parseReviewArtifactImportBundle, reviewArtifactBundleHash, ReviewArtifactStoreError, type ReviewArtifactExportBundle, type ReviewArtifactStore } from './reviewArtifactStore.ts'
import type { ReviewStateStore } from './reviewStateStore.ts'
import { parseReviewStateSnapshot } from './reviewStateSnapshot.ts'

const importTails = new WeakMap<ReviewArtifactStore, Promise<void>>()

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
  const operation = (importTails.get(artifacts) || Promise.resolve()).then(() => importExclusive(artifacts, states, frozen, expectedBundleHash))
  importTails.set(artifacts, operation.then(() => undefined, () => undefined))
  return operation
}

async function importExclusive(artifacts: ReviewArtifactStore, states: ReviewStateStore, value: unknown, expectedBundleHash: string) {
  const bundle = parseReviewArtifactImportBundle(value)
  if (bundle.bundleHash !== expectedBundleHash) throw new ReviewArtifactStoreError('conflict', 'Review import changed after preview')
  const preview = await previewReviewArtifactImport(artifacts, bundle)
  if (preview.status !== 'ready') throw new ReviewArtifactStoreError('conflict', `Review import is ${preview.status}`)
  if (bundle.schemaVersion === 2) {
    // Restore state atomically before publishing the artifact. An interruption
    // here leaves no readable artifact; exact state retries are idempotent.
    // Never roll back via hardDeleteSnapshot: that could erase existing state.
    await states.importSnapshot(parseReviewStateSnapshot(bundle.reviewState, bundle.artifact.snapshotId))
  }
  return artifacts.importArtifact(bundle, expectedBundleHash)
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
