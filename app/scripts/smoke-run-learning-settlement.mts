import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { InMemoryDurableMemoryStore } from '../electron/durableMemoryStore.ts'
import { PiHostAttachmentJournal, type PiHostRunLearningCandidate } from '../electron/piHostAttachment.ts'
import { settlePiRunLearning } from '../electron/piRunLearningSettlement.ts'
import { decideRunLearningSettlement } from '../src/agent/runLearningSettlement.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const project = appRoot
const candidate = (mode: 'explicit' | 'automatic', suffix = mode): PiHostRunLearningCandidate => ({
  mode,
  memory: {
    id: `${mode}-session-${suffix}`,
    project,
    text: `remember ${suffix}`,
    tags: ['turn-memory', mode === 'explicit' ? 'explicit' : 'auto-learned'],
    createdAt: '2026-08-27T02:00:00.000Z',
  },
  access: {
    runId: `run-${suffix}`,
    sessionId: 'session-learning',
    memoryReadEnabled: true,
    memoryWriteEnabled: true,
    temporary: false,
    canonicalProject: project,
  },
})

assert.deepEqual(
  decideRunLearningSettlement('explicit', { status: 'success', executionKind: 'loop' }),
  { commit: true, reason: 'eligible-explicit' },
)
assert.deepEqual(
  decideRunLearningSettlement('automatic', { status: 'success', executionKind: 'loop', dodMet: true }),
  { commit: true, reason: 'eligible-automatic' },
)
for (const dodMet of [false, undefined]) {
  assert.equal(decideRunLearningSettlement('automatic', {
    status: 'success', executionKind: 'loop', ...(dodMet === undefined ? {} : { dodMet }),
  }).commit, false)
}
for (const status of ['failed', 'halted', 'cancelled', 'denied', 'interrupted', 'recovery-failed']) {
  assert.equal(decideRunLearningSettlement('explicit', { status, executionKind: 'loop' }).commit, false, status)
  assert.equal(decideRunLearningSettlement('automatic', { status, executionKind: 'loop', dodMet: true }).commit, false, status)
}
for (const mode of ['explicit', 'automatic'] as const) {
  assert.deepEqual(
    decideRunLearningSettlement(mode, { status: 'success', executionKind: 'external', dodMet: true }),
    { commit: false, reason: 'external-runner' },
  )
}

const explicitStore = new InMemoryDurableMemoryStore()
const explicit = candidate('explicit')
assert.equal((await settlePiRunLearning({
  store: explicitStore,
  candidate: explicit,
  outcome: { status: 'success', executionKind: 'loop' },
})).committed, true)
assert.equal(await explicitStore.revision(), 1)
assert.deepEqual(await settlePiRunLearning({
  store: explicitStore,
  candidate: explicit,
  outcome: { status: 'success', executionKind: 'loop' },
}), { committed: false, mode: 'explicit', reason: 'already-committed' })
assert.equal(await explicitStore.revision(), 1, 'finalization retry must not duplicate memory')

const autoStore = new InMemoryDurableMemoryStore()
const automatic = candidate('automatic')
assert.equal((await settlePiRunLearning({
  store: autoStore,
  candidate: automatic,
  outcome: { status: 'success', executionKind: 'loop', dodMet: false },
})).reason, 'dod-unmet')
assert.equal(await autoStore.revision(), 0)
assert.equal((await settlePiRunLearning({
  store: autoStore,
  candidate: automatic,
  outcome: { status: 'success', executionKind: 'loop', dodMet: true },
})).committed, true)

for (const blocked of [
  { ...candidate('explicit', 'write-off'), access: { ...candidate('explicit', 'write-off').access, memoryWriteEnabled: false } },
  { ...candidate('explicit', 'temporary'), access: { ...candidate('explicit', 'temporary').access, temporary: true } },
]) {
  const store = new InMemoryDurableMemoryStore()
  assert.equal((await settlePiRunLearning({
    store,
    candidate: blocked,
    outcome: { status: 'success', executionKind: 'loop' },
  })).committed, false)
  assert.equal(await store.revision(), 0)
}

const attachmentInput = candidate('automatic', 'frozen')
const journal = new PiHostAttachmentJournal()
journal.begin({ runId: 'run-frozen', sessionId: 'session-learning', learning: attachmentInput })
attachmentInput.access.memoryWriteEnabled = false
attachmentInput.memory.text = 'mutated after admission'
const frozen = journal.learningCandidate('run-frozen')
assert.equal(frozen?.access.memoryWriteEnabled, true)
assert.equal(frozen?.memory.text, 'remember frozen')
journal.settle('run-frozen', 'answered', 'done')
const reattached = new PiHostAttachmentJournal(journal.snapshot())
const claim = reattached.claimFinalization('run-frozen', 'renderer-after-reload')
assert.equal(claim.claimed && claim.owner, true)
assert.equal(reattached.learningCandidate('run-frozen')?.access.memoryWriteEnabled, true)
assert.equal(reattached.get('run-frozen')?.learning, undefined, 'renderer attachment omits pending memory text')
assert.equal(
  reattached.completeFinalization('run-frozen', 'renderer-after-reload', claim.claimEpoch).completed,
  true,
)
assert.equal(reattached.claimFinalization('run-frozen', 'renderer-after-reload').state, 'completed')

const externalStore = new InMemoryDurableMemoryStore()
assert.equal((await settlePiRunLearning({
  store: externalStore,
  candidate: candidate('automatic', 'external'),
  outcome: { status: 'success', executionKind: 'external', dodMet: true },
})).reason, 'external-runner')
assert.equal(await externalStore.revision(), 0)
await externalStore.upsert({
  access: { origin: 'admin', memoryReadEnabled: false, memoryWriteEnabled: false, temporary: true },
  scope: { kind: 'global' },
  logicalKey: 'manual-admin',
  kind: 'memory',
  text: 'manual write remains available',
  tags: ['manual'],
  createdAt: '2026-08-27T02:00:01.000Z',
})
assert.equal(await externalStore.revision(), 1, 'manual admin memory is outside automatic run policy')

const protocolSource = fs.readFileSync(path.join(appRoot, 'electron/piHostProtocol.ts'), 'utf8')
const oldIterationWrite = "callId: 'turn-memory'"
assert.equal(protocolSource.includes(oldIterationWrite), false, 'iteration loop must not own learning writes')
assert.match(protocolSource, /completeRunFinalization[\s\S]*settlePiRunLearning[\s\S]*completeFinalization/)

console.log('Run learning settlement matrix passed: terminal/DoD/policy/retry/external lifecycle is finalization-owned')
