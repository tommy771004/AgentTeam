import assert from 'node:assert/strict'
import {
  buildPiHostRunConfig,
  isPiHostDefinitionOfDoneMet,
  PI_CORE_SETTLEMENT_DEFINITION_OF_DONE,
} from '../src/agent/piHostRun.ts'
import { runPiOrchestration } from '../electron/piOrchestrationExtension.ts'
import { DEFAULT_LLM_SETTINGS } from '../src/agent/llm.ts'
import { buildRunContextPolicy, resolveRunSettingsOverrides, snapshotRunSettings } from '../src/agent/runSettingsSnapshot.ts'

const mutableSettings = {
  ...DEFAULT_LLM_SETTINGS,
  model: 'large-model',
  referenceChatHistory: false,
  modelProfiles: { 'large-model': { contextWindow: 128_000 } },
}
const frozenSettings = snapshotRunSettings(mutableSettings)
mutableSettings.modelProfiles['large-model'].contextWindow = 4_096
assert.equal(frozenSettings.modelProfiles['large-model']?.contextWindow, 128_000)
assert.deepEqual(buildRunContextPolicy(frozenSettings, {
  model: 'large-model',
  project: '/project',
}), {
  memoryEnabled: true,
  memoryWriteEnabled: true,
  referenceChatHistory: false,
  temporary: false,
  project: '/project',
  contextWindowTokens: 128_000,
  // The frozen policy carries the run's tool restrictions too; empty lists are
  // still a decision ("nothing restricted"), not an absent field.
  approvalTools: [],
  deniedTools: [],
  // Git preferences are frozen with the run too (issue 18), so a mid-run
  // Settings change cannot alter what an in-flight command may do.
  gitPolicy: { branchPrefix: 'agent/', allowForcePush: false, draftPr: true },
})
assert.equal(buildRunContextPolicy(frozenSettings, { temporary: true }).memoryEnabled, false)
const admitted = resolveRunSettingsOverrides(frozenSettings, {
  model: 'conversation-model',
  approvalMode: 'full',
  temporary: false,
  project: '/conversation-project',
})
assert.equal(admitted.model, 'conversation-model')
assert.equal(admitted.approvalMode, 'full')
assert.equal(admitted.contextPolicySnapshot?.referenceChatHistory, false)

const goal = buildPiHostRunConfig({})
assert.equal(goal.loopType, 'Goal-based')
assert.equal(goal.maxIterations, 5)
assert.equal(goal.definitionOfDone, PI_CORE_SETTLEMENT_DEFINITION_OF_DONE)

// The renderer's default DoD is the Host settlement, not the presence of a
// text bubble — but only an ANSWERED turn settled it. A turn that ran tools and
// said nothing settles `empty` and satisfies nothing.
assert.equal(isPiHostDefinitionOfDoneMet(PI_CORE_SETTLEMENT_DEFINITION_OF_DONE, 'answered', ''), true)
assert.equal(isPiHostDefinitionOfDoneMet(PI_CORE_SETTLEMENT_DEFINITION_OF_DONE, 'empty', ''), false)
assert.equal(isPiHostDefinitionOfDoneMet(PI_CORE_SETTLEMENT_DEFINITION_OF_DONE, 'failed', ''), false)
assert.equal(isPiHostDefinitionOfDoneMet('non-empty assistant result', 'answered', ''), false)
assert.equal(isPiHostDefinitionOfDoneMet('non-empty assistant result', 'answered', 'done'), false, 'assistant prose cannot satisfy custom DoD')

// A turn that ran tools and said nothing settles `empty`, and an empty turn
// never satisfies a settlement-shaped DoD: it produced nothing to satisfy it
// with. Previously this same case settled `success` with `dodMet: true` after
// one iteration, which is how a run with no output reached the archive as a
// completed goal. Now the goal keeps iterating — an empty round is what another
// iteration exists to fix — and a goal that is still empty at the cap fails.
const emptyText = await runPiOrchestration({
  pattern: 'Goal-based',
  prompt: 'tool-only task',
  maxIterations: 5,
  turn: async () => {
    const settlement = 'empty' as const
    const result = ''
    return {
      settlement,
      result,
      done: isPiHostDefinitionOfDoneMet(PI_CORE_SETTLEMENT_DEFINITION_OF_DONE, settlement, result),
    }
  },
})
assert.equal(emptyText.settlement, 'failed')
assert.equal(emptyText.iterations, 5)
assert.equal(emptyText.dodMet, false)

// An answered turn still meets it and still stops the loop at one iteration.
const answeredText = await runPiOrchestration({
  pattern: 'Goal-based',
  prompt: 'answered task',
  maxIterations: 5,
  turn: async () => {
    const settlement = 'answered' as const
    const result = '結論'
    return {
      settlement,
      result,
      done: isPiHostDefinitionOfDoneMet(PI_CORE_SETTLEMENT_DEFINITION_OF_DONE, settlement, result),
    }
  },
})
assert.equal(answeredText.settlement, 'answered')
assert.equal(answeredText.iterations, 1)
assert.equal(answeredText.dodMet, true)

const turn = buildPiHostRunConfig({ forceLoopType: 'Turn-based' })
assert.equal(turn.loopType, 'Turn-based')
assert.equal(turn.maxIterations, 1)

const bounded = buildPiHostRunConfig({ forceLoopType: 'Goal-based', maxIterations: 99 })
assert.equal(bounded.maxIterations, 32)

// Renderer and Host must clamp with the same shared bounds — a divergence
// would let the UI promise a budget the Host silently shrinks.
const { PI_MAX_ITERATIONS, clampPiIterations } = await import('../src/agent/loopBounds.ts')
assert.equal(bounded.maxIterations, PI_MAX_ITERATIONS)
assert.equal(clampPiIterations('NaN'), 1)
assert.equal(clampPiIterations(0), 1)
assert.equal(clampPiIterations(8), 8)

console.log('Pi Host renderer run config preserves Goal-based retry budget')
