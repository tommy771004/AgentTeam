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
      return { settlement: 'success', result: `${pattern}-${iteration}` }
    },
  })
  assert.equal(result.pattern, pattern)
  const expectedIterations = pattern === 'Goal-based' ? 3 : 1
  assert.equal(result.iterations, expectedIterations)
  assert.deepEqual(calls, Array.from({ length: expectedIterations }, (_, index) => index + 1))
}

console.log('one Pi Orchestration Extension owns all four loop patterns')
