import assert from 'node:assert/strict'
import { buildComposerRunInput } from '../src/agent/composerRunControls.ts'
import { evaluatePiInvocationPolicy, freezePiRunPolicy } from '../electron/piPolicyEvidence.ts'
import { runPiOrchestration } from '../electron/piOrchestrationExtension.ts'
import { ensurePiPacksRegistered } from '../electron/piExtensionPacks/index.ts'
import {
  bindPiSessionRun,
  findPiPackTool,
  piSessionRunBinding,
  transitionPiSessionAgentMode,
  unbindPiSessionRun,
} from '../electron/piToolHost.ts'
import { clearPiPlanGateCandidate, consumePiPlanGateCandidate } from '../electron/piPackBridges.ts'

const projectRoot = process.cwd()
const contract = {
  contractRevision: 1,
  contractDigest: 'contract',
  schemaDigest: 'a'.repeat(64),
  toolSource: 'builtin' as const,
}

function decision(tool: string, args: Record<string, unknown>, sideEffect: boolean, pathArguments: string[] = []) {
  return evaluatePiInvocationPolicy({
    coordinates: { sessionId: 'plan-session', runId: 'plan-run', callId: `call-${tool}` },
    origin: 'model',
    tool,
    contract,
    args,
    policy: freezePiRunPolicy({ agentMode: 'plan', planCompletionAction: 'auto_start_build', approvalMode: 'full', projectRoot }),
    requirements: { sideEffect, pathArguments },
  })
}

assert.equal(decision('write', { path: 'src/unsafe.ts' }, true, ['path']).verdict, 'deny')
assert.equal(decision('write', { path: '.scratch/plan.md' }, true, ['path']).verdict, 'allow')
assert.equal(decision('bash', { command: 'echo unsafe' }, true).verdict, 'deny')
assert.equal(decision('complete_plan', {}, false).verdict, 'allow')

const bindingPolicy = freezePiRunPolicy({
  agentMode: 'plan',
  planCompletionAction: 'auto_start_build',
  approvalMode: 'auto',
  projectRoot,
})
bindPiSessionRun('transition-session', { runId: 'transition-run', frozenPolicy: bindingPolicy })
assert.equal(transitionPiSessionAgentMode('transition-session', 'wrong-run', 'plan', 'build'), false)
assert.equal(transitionPiSessionAgentMode('transition-session', 'transition-run', 'plan', 'build'), true)
assert.equal(piSessionRunBinding('transition-session')?.frozenPolicy?.agentMode, 'build')
assert.equal(piSessionRunBinding('transition-session')?.frozenPolicy?.approvalMode, 'auto')
unbindPiSessionRun('transition-session')

ensurePiPacksRegistered()
const completePlan = findPiPackTool('complete_plan')?.tool
assert.ok(completePlan)
await completePlan!.execute({
  summary: 'Implement the admitted change',
  steps: ['Edit the implementation', 'Run verification'],
  acceptanceCriteria: ['Build passes'],
  unresolvedQuestions: [],
  requiresAdditionalAuthority: false,
}, { sessionId: 'gate-session', runId: 'gate-run', callId: 'gate-call', cwd: projectRoot })
const candidate = consumePiPlanGateCandidate('gate-session', 'gate-run')
assert.equal(candidate?.summary, 'Implement the admitted change')
assert.deepEqual(candidate?.unresolvedQuestions, [])
clearPiPlanGateCandidate('gate-session')

const prompts: string[] = []
const orchestration = await runPiOrchestration({
  pattern: 'Goal-based',
  prompt: 'plan first',
  maxIterations: 3,
  turn: async (prompt, iteration) => {
    prompts.push(prompt)
    return iteration === 1
      ? { settlement: 'answered', result: 'plan ready', done: false, nextPrompt: 'build now' }
      : { settlement: 'answered', result: 'built', done: true }
  },
})
assert.deepEqual(prompts, ['plan first', 'build now'])
assert.equal(orchestration.dodMet, true)

const composer = buildComposerRunInput({
  objective: 'plan and build',
  threadId: 'thread-plan',
  runner: 'builtin',
  loopType: 'Goal-based',
  settingsApprovalMode: 'auto',
  agentMode: 'plan',
  thinkingDepth: 'standard',
  speed: 'standard',
  temporary: false,
})
assert.equal(composer.overrides?.planCompletionAction, 'auto_start_build')

console.log('Pi Host Plan Gate smoke passed')
