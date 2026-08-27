import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { JsonMemoryControlPackageRepository } from '../electron/memoryControlPackageRepository.ts'
import {
  createMemoryControlMetaCandidate,
  diagnoseMemoryControlFailure,
} from '../src/agent/memoryControlMetaAgent.ts'
import { TURN_RECORD_FORMAT_VERSION, type TurnRecord, type TurnRecordAppend } from '../src/agent/turnRecord.ts'

const HASH = 'a'.repeat(64)
const packageIdentity = { id: 'agentteam-memory-control-baseline', revision: 1, digest: HASH }
const coordinates = { turn: 1, step: 1, at: 1 }
const pendingState = (revision = 1) => ({
  schemaVersion: 1 as const,
  runId: 'run-meta',
  revision,
  objective: 'repair the controlled failure',
  constraints: [],
  goals: [{ id: 'goal-1', description: 'write the verified file', status: 'pending' as const, evidence: [] }],
})
const evidence = {
  schemaVersion: 1 as const, evidenceId: 'evidence-1', runId: 'run-meta', tool: 'write', callId: 'call-1',
  contractDigest: HASH, schemaDigest: HASH, receiptDigest: HASH,
  resource: { kind: 'file-content' as const, path: '/workspace/result.txt', sha256: HASH },
  issuedBy: 'adapter' as const, attestation: 'non-model' as const,
}
const proposal = {
  schemaVersion: 1 as const, proposalId: 'proposal-1', source: 'host' as const, baseRevision: 1,
  runId: 'run-meta', goalId: 'goal-1', tool: 'write', callId: 'call-1', proposedStatus: 'done' as const,
  file: { path: '/workspace/result.txt', sha256: HASH },
}
const check = (verdict: 'accepted' | 'rejected') => ({
  schemaVersion: 1 as const, runId: 'run-meta', baseRevision: 1, currentRevision: 1,
  goalId: 'goal-1', proposalId: 'proposal-1', tool: 'write', callId: 'call-1', verdict,
  reason: verdict === 'accepted' ? 'verified receipt' : 'checker rejected verified receipt',
  ...(verdict === 'accepted' ? { committedRevision: 2, evidenceRef: {
    seq: 2, evidenceId: evidence.evidenceId, runId: evidence.runId, goalId: 'goal-1', tool: evidence.tool,
    callId: evidence.callId, contractDigest: evidence.contractDigest, schemaDigest: evidence.schemaDigest,
    receiptDigest: evidence.receiptDigest,
  } } : {}),
})
const invocation = (decision: 'pass-through' | 'redraft') => ({
  schemaVersion: 2 as const, invocationId: 'invocation-1', runId: 'run-meta', step: 1, callId: 'call-1',
  batchId: 'batch-1', identityDigest: HASH, trigger: 'state-changing-tool-call' as const,
  workingStateRevision: 1, goalIds: ['goal-1'], retrievalKeyDigest: HASH,
  matchCount: decision === 'redraft' ? 1 as const : 0 as const, decision,
  ...(decision === 'redraft' ? { selectedSkills: [{ id: 'writer', version: 1, digest: HASH, bodyBytes: 64 }] } : {}),
  packageIdentity,
  toolIdentity: { tool: 'write', contractRevision: 1, contractDigest: HASH, schemaDigest: HASH, toolSource: 'builtin' as const },
  draft: { keys: ['path'], serializedBytes: 64, sampleBytes: 32, digest: HASH },
})
const record = (entries: TurnRecordAppend[]): TurnRecord => ({
  version: TURN_RECORD_FORMAT_VERSION,
  entries: entries.map((entry, index) => ({ ...entry, seq: index + 1 })),
})
const prefix: TurnRecordAppend[] = [
  { ...coordinates, kind: 'memory-control-package', source: 'host', packageIdentity },
  { ...coordinates, kind: 'working-state', source: 'host', state: pendingState() },
]

const traces = {
  experientialSkills: record([...prefix,
    { ...coordinates, kind: 'skill-invocation', source: 'host', invocation: invocation('redraft') },
    { ...coordinates, kind: 'skill-context', source: 'host', injection: { schemaVersion: 1, runId: 'run-meta', originalCallId: 'call-1', tool: 'write', skills: [{ id: 'writer', version: 1, digest: HASH, bodyBytes: 64 }], contextBytes: 64, contextDigest: HASH, freshCallRequired: true } },
    { ...coordinates, kind: 'tool-result', source: 'host', tool: 'write', callId: 'call-2', settlement: 'failed' },
  ]),
  workingMemorySpec: record([...prefix,
    { ...coordinates, kind: 'tool-evidence', source: 'host', tool: 'write', runId: 'run-meta', callId: 'call-1', phase: 'result', settlement: 'success' },
    { ...coordinates, kind: 'tool-result', source: 'host', tool: 'write', callId: 'call-1', settlement: 'success', executionEvidence: evidence },
    { ...coordinates, kind: 'state-proposal', source: 'host', proposal },
    { ...coordinates, kind: 'state-check', source: 'host', check: check('accepted'), packageIdentity },
    { ...coordinates, kind: 'working-state', source: 'host', state: pendingState(2) },
  ]),
  invocationPolicy: record([...prefix,
    { ...coordinates, kind: 'skill-invocation', source: 'host', invocation: invocation('pass-through') },
    { ...coordinates, kind: 'tool-result', source: 'host', tool: 'write', callId: 'call-1', settlement: 'failed' },
  ]),
  checkers: record([...prefix,
    { ...coordinates, kind: 'tool-evidence', source: 'host', tool: 'write', runId: 'run-meta', callId: 'call-1', phase: 'result', settlement: 'success' },
    { ...coordinates, kind: 'tool-result', source: 'host', tool: 'write', callId: 'call-1', settlement: 'success', executionEvidence: evidence },
    { ...coordinates, kind: 'state-proposal', source: 'host', proposal },
    { ...coordinates, kind: 'state-check', source: 'host', check: check('rejected'), packageIdentity },
  ]),
}

for (const [component, trace] of Object.entries(traces)) {
  const diagnosis = await diagnoseMemoryControlFailure(trace)
  assert.equal(diagnosis.status, 'localized')
  assert.equal(diagnosis.component, component)
  assert.ok(diagnosis.evidence.length > 0 && diagnosis.evidence.length <= 16)
  assert.equal('summary' in diagnosis, false, 'diagnosis never substitutes free-text summary for trace evidence')
}

const ambiguous = record([...traces.invocationPolicy.entries.map(({ seq: _seq, ...entry }) => entry),
  { ...coordinates, kind: 'tool-evidence', source: 'host', tool: 'write', runId: 'run-meta', callId: 'call-3', phase: 'result', settlement: 'success' },
  { ...coordinates, kind: 'tool-result', source: 'host', tool: 'write', callId: 'call-3', settlement: 'success', executionEvidence: { ...evidence, callId: 'call-3' } },
  { ...coordinates, kind: 'state-proposal', source: 'host', proposal: { ...proposal, callId: 'call-3', proposalId: 'proposal-3' } },
  { ...coordinates, kind: 'state-check', source: 'host', check: { ...check('rejected'), callId: 'call-3', proposalId: 'proposal-3' }, packageIdentity },
])
assert.equal((await diagnoseMemoryControlFailure(ambiguous)).status, 'insufficient')

const directory = await mkdtemp(join(tmpdir(), 'memory-control-meta-agent-'))
try {
  const repository = await JsonMemoryControlPackageRepository.open(join(directory, 'packages.json'))
  const active = repository.admitActive()
  const governedTrace = structuredClone(traces.invocationPolicy)
  for (const entry of governedTrace.entries) {
    if (entry.kind === 'memory-control-package') entry.packageIdentity = { id: active.id, revision: active.revision, digest: active.digest }
    if (entry.kind === 'skill-invocation') entry.invocation.packageIdentity = { id: active.id, revision: active.revision, digest: active.digest }
    if (entry.kind === 'state-check') entry.packageIdentity = { id: active.id, revision: active.revision, digest: active.digest }
  }
  const candidateResult = await createMemoryControlMetaCandidate({
    packages: repository,
    record: governedTrace,
    output: [{ op: 'replace', path: '/maxSkills', value: 1 }],
  })
  assert.equal(candidateResult.diagnosis.status, 'localized')
  assert.equal(candidateResult.candidate.status, 'candidate')
  assert.equal(repository.admitActive().revision, active.revision, 'Meta-Agent cannot activate its candidate')
  for (const [key, component] of Object.entries(active.components)) {
    if (key === 'invocationPolicy') continue
    assert.equal(candidateResult.candidate.components[key as keyof typeof active.components].digest, component.digest)
  }
  const event = repository.lineage().events.at(-1)!
  assert.equal(event.kind, 'candidate-created')
  assert.equal(event.diagnosisComponent, 'invocationPolicy')
  assert.match(event.reason, /meta-agent diagnosis [a-f0-9]{64}/)

  const beforeRefusals = repository.lineage().packages.length
  for (const output of [
    [{ op: 'add', path: '/settings', value: { theme: 'unsafe' } }],
    [{ op: 'replace', path: '/activeRevision', value: 99 }],
    [{ op: 'add', path: '/durableMemory/row', value: { secret: true } }],
    [{ op: 'replace', path: '/maxSkills', value: 'export const arbitrary = true' }],
    [{ op: 'add', path: '/../../tmp/owned', value: true }],
    { patch: [{ op: 'replace', path: '/maxSkills', value: 2 }], activeRevision: 99 },
  ]) {
    await assert.rejects(() => createMemoryControlMetaCandidate({ packages: repository, record: governedTrace, output }), /Meta-Agent|patch|schema|diagnosis/i)
  }
  await assert.rejects(() => createMemoryControlMetaCandidate({ packages: repository, record: ambiguous, output: [{ op: 'replace', path: '/maxSkills', value: 1 }] }), /insufficient|ambiguous/i)
  assert.equal(repository.lineage().packages.length, beforeRefusals, 'refused output creates no candidate or application mutation')
  assert.equal(repository.admitActive().revision, active.revision)
  await repository.rejectCandidate({ revision: candidateResult.candidate.revision, reason: `meta-agent diagnosis ${candidateResult.diagnosis.diagnosisId} rejected by maintainer` })
  const rejection = repository.lineage().events.at(-1)!
  assert.equal(rejection.kind, 'candidate-rejected')
  assert.equal(rejection.revision, candidateResult.candidate.revision)
  assert.equal(repository.admitActive().revision, active.revision)
} finally {
  await rm(directory, { recursive: true, force: true })
}

const metaSource = await readFile(new URL('../src/agent/memoryControlMetaAgent.ts', import.meta.url), 'utf8')
const hostSource = await readFile(new URL('../electron/piHostProtocol.ts', import.meta.url), 'utf8')
assert.doesNotMatch(metaSource, /\.activateCandidate\s*\(|durableMemory|settingsStore|node:fs|writeFile\s*\(/,
  'candidate-only code has no activation, arbitrary filesystem, Settings, or durable-memory mutation seam')
assert.match(hostSource, /operation === 'create-meta-candidate'/)
assert.match(hostSource, /source\?\.record/,
  'the Host diagnoses its persisted source Turn Record instead of caller-supplied prose')
assert.match(hostSource, /const candidateOnlyAuthority = \{/,
  'the Host passes a runtime facade without activation authority')

console.log('Meta-Agent localizes four structured failures and can only create inactive component-local candidates')
