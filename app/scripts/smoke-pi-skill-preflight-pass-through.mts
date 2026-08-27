import assert from 'node:assert/strict'
import {
  BASELINE_MEMORY_CONTROL_PACKAGE,
  createZeroHitSkillPreflight,
  MAX_SKILL_PREFLIGHT_DRAFT_BYTES,
  shouldRunSkillPreflight,
} from '../electron/piSkillPreflight.ts'
import { createInitialWorkingState } from '../src/agent/workingState.ts'
import { evaluatePiInvocationPolicy, freezePiRunPolicy } from '../electron/piPolicyEvidence.ts'
import { consumePiSkillPreflightDirective, setPiSkillPreflightBridge } from '../electron/piToolHost.ts'

const state = createInitialWorkingState({
  runId: 'preflight-run',
  objective: 'write the verified artifact',
  constraints: ['remain inside the project'],
  completionPredicate: { kind: 'file-content', path: 'result.txt', sha256: 'a'.repeat(64) },
})
const identity = {
  contractRevision: 7,
  contractDigest: 'b'.repeat(64),
  schemaDigest: 'c'.repeat(64),
  toolSource: 'builtin' as const,
}

assert.equal(shouldRunSkillPreflight({ sideEffect: true }), true)
assert.equal(shouldRunSkillPreflight({}), false, 'read-only calls skip preflight by default')
assert.equal(shouldRunSkillPreflight({ skillPreflight: true }), true, 'contract metadata may explicitly opt a read into preflight')

const policy = freezePiRunPolicy({ projectRoot: process.cwd(), approvalMode: 'full', outboundMode: 'off' })
const writeEvaluation = evaluatePiInvocationPolicy({
  coordinates: { sessionId: 'preflight-session', runId: state.runId, callId: 'missing-owner-write' },
  origin: 'model',
  tool: 'write',
  contract: identity,
  args: { path: 'result.txt' },
  policy,
  requirements: { sideEffect: true },
})
assert.deepEqual(writeEvaluation.skillPreflight, { required: true, trigger: 'state-changing-tool-call' })
setPiSkillPreflightBridge(undefined)
await assert.rejects(() => consumePiSkillPreflightDirective({
  evaluation: writeEvaluation,
  sessionId: 'preflight-session', runId: state.runId, callId: 'missing-owner-write', tool: 'write',
  args: { path: 'result.txt' }, identity,
}), /preflight owner is unavailable/, 'a state-changing draft cannot pass when the Host preflight owner is absent')

const observedDrafts: Array<{ tool: string }> = []
setPiSkillPreflightBridge({
  preflight: async (draft) => {
    observedDrafts.push({ tool: draft.tool })
    return { kind: 'pass-through' }
  },
  contextInjected: () => undefined,
})
for (const [tool, requirements] of [['read', {}], ['write', { sideEffect: true }]] as const) {
  const evaluation = evaluatePiInvocationPolicy({
    coordinates: { sessionId: 'preflight-session', runId: state.runId, callId: `${tool}-call` },
    origin: 'model',
    tool,
    contract: identity,
    args: { path: 'result.txt' },
    policy,
    requirements,
  })
  await consumePiSkillPreflightDirective({
    evaluation,
    sessionId: 'preflight-session', runId: state.runId, callId: `${tool}-call`, tool,
    args: { path: 'result.txt' }, identity,
  })
}
assert.deepEqual(observedDrafts, [{ tool: 'write' }], 'the common frozen-policy seam triggers mutations and skips ordinary reads')

const decision = createZeroHitSkillPreflight({
  state,
  step: 2,
  tool: 'write',
  callId: 'write-1',
  identity,
  args: { path: 'result.txt', content: 'x'.repeat(20_000) },
})
assert.equal(decision.decision, 'pass-through')
assert.equal(decision.matchCount, 0)
assert.deepEqual(decision.goalIds, [state.goals[0].id])
assert.equal(decision.workingStateRevision, 1)
assert.deepEqual(decision.packageIdentity, BASELINE_MEMORY_CONTROL_PACKAGE)
assert.equal(decision.toolIdentity.contractRevision, identity.contractRevision)
assert.equal(decision.toolIdentity.contractDigest, identity.contractDigest)
assert.equal(decision.toolIdentity.schemaDigest, identity.schemaDigest)
assert.equal(decision.draft.keys.includes('content'), true)
assert.equal(decision.draft.sampleBytes <= 4_096, true, 'draft material is bounded before hashing')
assert.match(decision.retrievalKeyDigest, /^[a-f0-9]{64}$/)
assert.equal('transcript' in decision, false)
assert.equal(JSON.stringify(decision).includes('x'.repeat(1_000)), false, 'record carries characteristics, not raw draft bodies')

const revised = createZeroHitSkillPreflight({ ...decision, state: { ...state, revision: 2 }, identity, args: {} })
assert.notEqual(revised.retrievalKeyDigest, decision.retrievalKeyDigest, 'Working State revision participates in retrieval identity')
const otherContract = createZeroHitSkillPreflight({ ...decision, state, identity: { ...identity, contractRevision: 8 }, args: {} })
assert.notEqual(otherContract.retrievalKeyDigest, decision.retrievalKeyDigest, 'immutable tool identity participates in retrieval identity')
const suffixA = createZeroHitSkillPreflight({ state, step: 2, tool: 'write', callId: 'suffix-a', identity, args: { content: `${'p'.repeat(8_000)}a` } })
const suffixB = createZeroHitSkillPreflight({ state, step: 2, tool: 'write', callId: 'suffix-b', identity, args: { content: `${'p'.repeat(8_000)}b` } })
assert.notEqual(suffixA.draft.digest, suffixB.draft.digest, 'full-draft identity distinguishes equal prefixes with different suffixes')
assert.notEqual(suffixA.retrievalKeyDigest, suffixB.retrievalKeyDigest)
assert.throws(() => createZeroHitSkillPreflight({
  state, step: 2, tool: 'write', callId: 'oversized', identity,
  args: { content: 'z'.repeat(MAX_SKILL_PREFLIGHT_DRAFT_BYTES) },
}), /draft exceeds 65536 bytes/, 'oversized drafts fail closed before execution')

console.log('Skill preflight zero-match decision is bounded, state-grounded, and pass-through')
