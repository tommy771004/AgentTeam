import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  REVIEW_ARTIFACT_ERROR_CODES,
  REVIEW_FILE_STATUSES,
  attributionFromHostEvidence,
  canTransitionReviewSnapshot,
  downgradeAttribution,
  projectRunReviewSource,
  reviewTargetCapabilities,
  type ReviewSnapshotStatus,
  type ReviewTarget,
} from '../src/agent/reviewContract.ts'

const cases: Array<{
  target: ReviewTarget
  expected: { immutable: boolean; refreshable: boolean; mutationCapable: boolean }
}> = [
  {
    target: { kind: 'run-snapshot', snapshotId: 'review_run_1' },
    expected: { immutable: true, refreshable: false, mutationCapable: false },
  },
  {
    target: { kind: 'live-working-tree', workspaceId: 'workspace_1', revision: 'work_7' },
    expected: { immutable: false, refreshable: true, mutationCapable: true },
  },
  {
    target: { kind: 'staged', workspaceId: 'workspace_1', revision: 'index_4' },
    expected: { immutable: false, refreshable: true, mutationCapable: true },
  },
  {
    target: { kind: 'branch-range', workspaceId: 'workspace_1', baseRef: 'main', headRef: 'feature' },
    expected: { immutable: true, refreshable: false, mutationCapable: false },
  },
  {
    target: { kind: 'snapshot-range', beforeSnapshotId: 'review_a', afterSnapshotId: 'review_b' },
    expected: { immutable: true, refreshable: false, mutationCapable: false },
  },
]

for (const fixture of cases) {
  assert.deepEqual(
    reviewTargetCapabilities(fixture.target),
    fixture.expected,
    `${fixture.target.kind} capabilities must come from the target kind`,
  )
}

const statuses: ReviewSnapshotStatus[] = [
  'pending',
  'capturing',
  'ready',
  'partial',
  'failed',
  'missing',
  'deleted',
]
const allowedTransitions: Record<ReviewSnapshotStatus, ReviewSnapshotStatus[]> = {
  pending: ['pending', 'capturing', 'failed', 'deleted'],
  capturing: ['capturing', 'ready', 'partial', 'failed', 'missing', 'deleted'],
  ready: ['ready', 'missing', 'deleted'],
  partial: ['partial', 'capturing', 'missing', 'deleted'],
  failed: ['failed', 'capturing', 'deleted'],
  missing: ['missing', 'capturing', 'deleted'],
  deleted: ['deleted'],
}

for (const from of statuses) {
  for (const to of statuses) {
    assert.equal(
      canTransitionReviewSnapshot(from, to),
      allowedTransitions[from].includes(to),
      `${from} → ${to} must follow the complete fail-closed transition table`,
    )
  }
}

assert.equal(
  attributionFromHostEvidence({
    source: 'host',
    claim: 'exact',
    isolatedWorktree: true,
    baselineCaptured: true,
    settlementCaptured: true,
    contaminationReasons: [],
  }),
  'exact',
  'only complete uncontaminated isolated-worktree Host evidence establishes exact attribution',
)
assert.equal(
  attributionFromHostEvidence({
    source: 'host',
    claim: 'exact',
    isolatedWorktree: false,
    baselineCaptured: true,
    settlementCaptured: true,
    contaminationReasons: ['shared checkout'],
  }),
  'shared',
  'a contaminated exact claim downgrades to shared',
)
assert.equal(
  attributionFromHostEvidence({
    source: 'host',
    claim: 'attributed',
    trustedMutationCount: 4,
    coverageComplete: false,
    contaminationReasons: [],
  }),
  'partial',
  'incomplete trusted mutation coverage cannot claim attributed',
)
assert.equal(
  attributionFromHostEvidence({ source: 'model', claim: 'exact', isolatedWorktree: true }),
  'partial',
  'model-authored claims cannot establish Host attribution',
)
assert.equal(
  attributionFromHostEvidence({
    source: 'host', claim: 'exact', isolatedWorktree: true,
    baselineCaptured: true, settlementCaptured: true,
  }),
  'partial',
  'a malformed Host envelope also fails closed instead of assuming no contamination',
)
assert.equal(downgradeAttribution('exact', 'shared'), 'shared')
assert.equal(downgradeAttribution('attributed', 'partial'), 'partial')
assert.equal(
  downgradeAttribution('partial', 'exact'),
  'partial',
  'the public fidelity operation can only retain or downgrade',
)

const missingCanonical = projectRunReviewSource({
  reviewSnapshotRef: {
    snapshotId: 'review_missing',
    runId: 'run_1',
    status: 'missing',
    attributionFidelity: 'partial',
  },
  diff: 'legacy text that must not mask a missing canonical artifact',
})
assert.equal(missingCanonical.kind, 'run-snapshot')
assert.equal(missingCanonical.canonical, true)
assert.equal(
  missingCanonical.kind === 'run-snapshot' ? missingCanonical.status : undefined,
  'missing',
  'a missing canonical snapshot never falls back to mutable legacy diff text',
)

assert.deepEqual(
  projectRunReviewSource({ diff: 'diff --git a/a.ts b/a.ts' }),
  { kind: 'legacy-ephemeral', canonical: false, diff: 'diff --git a/a.ts b/a.ts' },
  'an old archive with only diff text is labeled legacy and ephemeral',
)
assert.deepEqual(
  projectRunReviewSource({}),
  { kind: 'unavailable', canonical: false },
  'an old archive without snapshot or legacy diff is honestly unavailable',
)

assert.deepEqual(REVIEW_FILE_STATUSES, [
  'added', 'modified', 'deleted', 'renamed', 'copied', 'type-changed', 'untracked',
], 'the manifest vocabulary covers Git file lifecycle without free-form status strings')
assert.deepEqual(REVIEW_ARTIFACT_ERROR_CODES, [
  'invalid-target', 'snapshot-missing', 'snapshot-deleted', 'snapshot-corrupt',
  'target-stale', 'unsupported-file', 'cancelled', 'timeout', 'unavailable', 'partial',
], 'review failures use one bounded vocabulary')

const source = await readFile(new URL('../src/agent/reviewContract.ts', import.meta.url), 'utf8')
for (const forbidden of ['window.', 'Date.now', 'new Date', 'Math.random', 'zustand', 'localStorage', 'import(']) {
  assert.equal(source.includes(forbidden), false, `review contract must stay pure: ${forbidden}`)
}

console.log('smoke-review-contract passed')
