import assert from 'node:assert/strict'
import { runPiOrchestration } from '../electron/piOrchestrationExtension.ts'

for (const pattern of ['Turn-based', 'Goal-based', 'Time-based', 'Proactive'] as const) {
  const calls: number[] = []
  const result = await runPiOrchestration({
    pattern,
    prompt: pattern,
    maxIterations: 3,
    turn: async (_prompt, iteration) => {
      calls.push(iteration)
      return { settlement: 'answered', result: `${pattern}-${iteration}` }
    },
  })
  assert.equal(result.pattern, pattern)
  const expectedIterations = pattern === 'Goal-based' ? 3 : 1
  assert.equal(result.iterations, expectedIterations)
  assert.deepEqual(calls, Array.from({ length: expectedIterations }, (_, index) => index + 1))
}

console.log('one Pi Orchestration Extension owns all four loop patterns')

for (const requested of [1, 8, 16, 32]) {
  const calls: number[] = []
  const bounded = await runPiOrchestration({
    pattern: 'Goal-based',
    prompt: `run ${requested} iterations`,
    maxIterations: requested,
    turn: async (_prompt, iteration) => {
      calls.push(iteration)
      return { settlement: 'answered', result: `iteration-${iteration}`, done: false }
    },
  })
  assert.equal(bounded.iterations, requested)
  assert.deepEqual(calls, Array.from({ length: requested }, (_, index) => index + 1))
}
console.log('Goal-based orchestration honors shared 1/8/16/32 iteration bounds')

const unmet = await runPiOrchestration({
  pattern: 'Goal-based',
  prompt: 'unmet',
  maxIterations: 2,
  turn: async () => ({ settlement: 'answered', result: '', done: false }),
})
assert.equal(unmet.settlement, 'failed')
assert.equal(unmet.iterations, 2)
assert.equal(unmet.dodMet, false)
console.log('Goal-based orchestration reports an unmet DoD after the iteration cap')
