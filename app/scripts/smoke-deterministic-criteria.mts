import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluateAcceptanceGate } from '../electron/acceptanceGate.ts'
import { registeredArtifactSchemaIds } from '../electron/criterionCheckers/artifactSchema.ts'
import { registeredVerificationCommandIds } from '../electron/criterionCheckers/registeredCommand.ts'
import type { ReviewArtifactProjection } from '../electron/reviewArtifactStore.ts'
import { verifyAcceptanceEvidence } from '../src/agent/acceptanceContract.ts'
import { createGoalContractSnapshot, type GoalContractInput } from '../src/agent/goalContract.ts'
import type { ReviewVerificationRecord } from '../src/agent/reviewVerificationContract.ts'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const workspace = await mkdtemp(join(tmpdir(), 'deterministic-criteria-'))

const base = (id: string): Omit<GoalContractInput, 'criteria' | 'outputs'> => ({
  schemaVersion: 1,
  id,
  revision: 1,
  mode: 'goal',
  objective: 'verify deterministic outputs',
  constraints: [],
  budgets: { maxIterations: 2, maxWallClockMs: 60_000 },
  escalation: { onBlocked: 'fail', onUnverifiable: 'fail', onBudgetExceeded: 'fail', onNoProgress: 'fail' },
})

try {
  assert.deepEqual(registeredVerificationCommandIds(), ['project:build', 'project:lint', 'project:smoke', 'project:test'])
  assert.deepEqual(registeredArtifactSchemaIds(), ['agentteam:json-object-v1', 'agentteam:string-array-v1'])

  const artifact = '{"ok":true,"items":["a"]}\n'
  await writeFile(join(workspace, 'artifact.json'), artifact)
  const revision = sha256('immutable-review-revision')
  const snapshotId = 'review_immutable'
  const reviewArtifact = {
    schemaVersion: 1, snapshotId, runId: 'prior-run', threadId: 'thread', status: 'ready',
    admission: {
      snapshotId, runId: 'prior-run', status: 'pending', canonical: true, runnerKind: 'builtin',
      workspace: { workspaceId: 'workspace', mode: 'git', projectRoot: workspace },
      baseline: { capturedAt: new Date(0).toISOString(), indexRevision: revision, workingRevision: revision },
    },
    settlement: { capturedAt: new Date(1).toISOString(), indexRevision: revision, workingRevision: revision },
    attributionFidelity: 'exact', diagnostics: [], manifest: [], manifestHash: sha256('manifest'),
    payloadCount: 0, payloadBytes: 0, commentRefs: [], reviewStateRefs: [], finalizationDigest: sha256('finalized'),
  } as ReviewArtifactProjection
  const verification = {
    id: 'verification_1', snapshotId, runId: 'prior-run', workspaceId: 'workspace', verifiedRevision: revision,
    kind: 'build', command: 'npm', args: ['run', 'build'], cwd: workspace, runner: 'host',
    startedAt: new Date(2).toISOString(), durationMs: 10, exitCode: 0, outputAvailability: 'missing',
  } satisfies ReviewVerificationRecord
  const contract = await createGoalContractSnapshot({
    ...base('goal-contract:deterministic'),
    outputs: [
      { id: 'artifact-json', schemaId: 'agentteam:json-object-v1', required: true },
      { id: 'artifact-file', schemaId: 'binary', required: true },
    ],
    criteria: [
      { id: 'command', kind: 'registered-command', commandId: 'project:lint', expectedExitCode: 0 },
      { id: 'suite', kind: 'test-suite', suite: 'test' },
      { id: 'exists', kind: 'artifact-exists', artifactId: 'artifact-file', path: 'artifact.json', sha256: sha256(artifact) },
      { id: 'schema', kind: 'json-schema', artifactId: 'artifact-json', path: 'artifact.json', schemaId: 'agentteam:json-object-v1' },
      { id: 'review', kind: 'review-verification', snapshotId, verifiedRevision: revision, verification: 'build' },
    ],
  })
  const called: string[] = []
  const accepted = await evaluateAcceptanceGate({
    runId: 'deterministic-run', iteration: 1, goalContract: contract, workspaceRoot: workspace,
    settlement: 'answered', answer: 'done',
    runRegisteredCommand: async ({ registryId, workspaceRoot }) => {
      called.push(registryId)
      return {
        registryId, command: 'npm', args: ['run', registryId.split(':')[1]!], cwd: workspaceRoot,
        workspaceRevision: revision, finalWorkspaceRevision: revision, exitCode: 0, outputSha256: sha256(registryId),
      }
    },
    reviewBindings: { [snapshotId]: { artifact: reviewArtifact, verifications: [verification] } },
  })
  assert.equal(accepted.snapshot.overall, 'passed')
  assert.deepEqual(called, ['project:lint', 'project:test'])
  assert.equal(accepted.snapshot.verdicts.every((verdict) => verdict.evidenceRefs.length === 1 && verdict.reason.length > 0), true)
  assert.equal((await Promise.all(accepted.evidence.map(verifyAcceptanceEvidence))).every(Boolean), true)

  await writeFile(join(workspace, 'artifact.json'), '{"not":"an array"}\n')
  const failingContract = await createGoalContractSnapshot({
    ...base('goal-contract:failures'),
    outputs: [{ id: 'array', schemaId: 'agentteam:string-array-v1', required: true }],
    criteria: [
      { id: 'injection', kind: 'registered-command', commandId: 'sh -c rm -rf /', expectedExitCode: 0 },
      { id: 'schema-fail', kind: 'json-schema', artifactId: 'array', path: 'artifact.json', schemaId: 'agentteam:string-array-v1' },
      { id: 'review-drift', kind: 'review-verification', snapshotId, verifiedRevision: sha256('different'), verification: 'build' },
    ],
  })
  const failed = await evaluateAcceptanceGate({
    runId: 'deterministic-failed', iteration: 1, goalContract: failingContract, workspaceRoot: workspace,
    settlement: 'answered', answer: 'claimed done',
    reviewBindings: { [snapshotId]: { artifact: reviewArtifact, verifications: [verification] } },
  })
  assert.equal(failed.snapshot.overall, 'unmet')
  assert.equal(failed.snapshot.verdicts[0]?.retryable, false)
  assert.match(failed.snapshot.verdicts[0]?.reason || '', /Host registry/)
  assert.equal(failed.snapshot.verdicts[1]?.retryable, true)
  assert.equal(failed.snapshot.verdicts[2]?.retryable, false)
  assert.equal(failed.evidence[0]?.kind === 'registered-command' && failed.evidence[0].state, 'unknown-command')
  assert.equal(failed.evidence[1]?.kind === 'json-schema' && failed.evidence[1].state, 'schema-mismatch')
  assert.equal(failed.evidence[2]?.kind === 'review-verification' && failed.evidence[2].state, 'revision-mismatch')

  console.log('Deterministic criteria passed: fixed command registry, suite mapping, artifact schema, revision-bound historical review, retryability facts')
} finally {
  await rm(workspace, { recursive: true, force: true })
}
