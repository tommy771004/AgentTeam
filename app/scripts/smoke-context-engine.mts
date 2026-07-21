/**
 * ContextEngine seam smoke.
 * Run: node --experimental-strip-types scripts/smoke-context-engine.mts
 */
import assert from 'node:assert/strict'
import {
  assertToolPairsAdjacent,
  toolPairsIntact,
  type ContextEngine,
} from '../src/agent/contextEngine.ts'
import { DEFAULT_LLM_SETTINGS } from '../src/agent/llm.ts'

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  }
}

console.log('smoke-context-engine')

await test('fake ContextEngine is injectable', async () => {
  const fake: ContextEngine = {
    prepareRound: async (input) => {
      return [...input.messages, { role: 'system', content: 'compressed' }]
    },
  }
  const out = await fake.prepareRound({
    messages: [{ role: 'user', content: 'hi' }],
    round: 0,
    toolsEstimateText: '[]',
    settings: DEFAULT_LLM_SETTINGS,
  })
  assert.equal(out.length, 2)
  assert.equal(out[1]?.content, 'compressed')
})

await test('toolPairsIntact accepts empty and paired shapes', () => {
  assert.equal(toolPairsIntact([]), true)
  assert.equal(
    toolPairsIntact([
      { role: 'assistant' },
      { role: 'tool' },
      { role: 'tool' },
    ]),
    true,
  )
  assert.equal(toolPairsIntact([{ role: 'tool' }]), false)
  assert.equal(
    assertToolPairsAdjacent([
      { role: 'user' },
      { role: 'assistant' },
      { role: 'tool' },
      { role: 'tool' },
    ]),
    true,
  )
  assert.equal(
    assertToolPairsAdjacent([{ role: 'user' }, { role: 'tool' }]),
    false,
  )
})

await test('createDefaultContextEngine is exportable', async () => {
  const { createDefaultContextEngine } = await import('../src/agent/contextEngine.ts')
  assert.equal(typeof createDefaultContextEngine, 'function')
})

console.log(`\n${passed} tests passed`)
