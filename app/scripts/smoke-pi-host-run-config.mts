import assert from 'node:assert/strict'
import {
  buildPiHostRunConfig,
  isPiHostDefinitionOfDoneMet,
  PI_CORE_SETTLEMENT_DEFINITION_OF_DONE,
} from '../src/agent/piHostRun.ts'
import { runPiOrchestration } from '../electron/piOrchestrationExtension.ts'

const goal = buildPiHostRunConfig({})
assert.equal(goal.loopType, 'Goal-based')
assert.equal(goal.maxIterations, 5)
assert.equal(goal.definitionOfDone, PI_CORE_SETTLEMENT_DEFINITION_OF_DONE)

// A successful Pi turn may legitimately have no assistant text (for example,
// a tool-only turn). The renderer's default DoD is the Host settlement, not
// the presence of a text bubble.
assert.equal(isPiHostDefinitionOfDoneMet(PI_CORE_SETTLEMENT_DEFINITION_OF_DONE, 'success', ''), true)
assert.equal(isPiHostDefinitionOfDoneMet(PI_CORE_SETTLEMENT_DEFINITION_OF_DONE, 'failed', ''), false)
assert.equal(isPiHostDefinitionOfDoneMet('non-empty assistant result', 'success', ''), false)
assert.equal(isPiHostDefinitionOfDoneMet('non-empty assistant result', 'success', 'done'), true)

const emptyTextSuccess = await runPiOrchestration({
  pattern: 'Goal-based',
  prompt: 'tool-only task',
  maxIterations: 5,
  turn: async () => {
    const settlement = 'success' as const
    const result = ''
    return {
      settlement,
      result,
      done: isPiHostDefinitionOfDoneMet(PI_CORE_SETTLEMENT_DEFINITION_OF_DONE, settlement, result),
    }
  },
})
assert.equal(emptyTextSuccess.settlement, 'success')
assert.equal(emptyTextSuccess.iterations, 1)
assert.equal(emptyTextSuccess.dodMet, true)

const turn = buildPiHostRunConfig({ forceLoopType: 'Turn-based' })
assert.equal(turn.loopType, 'Turn-based')
assert.equal(turn.maxIterations, 1)

const bounded = buildPiHostRunConfig({ forceLoopType: 'Goal-based', maxIterations: 99 })
assert.equal(bounded.maxIterations, 8)

console.log('Pi Host renderer run config preserves Goal-based retry budget')
