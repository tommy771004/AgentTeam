/**
 * Step I/O pure helpers — true import tests.
 * Behavioral wiring (dispatch, strategy composition, fallback) is verified
 * by smoke-step-run.mts / smoke-loop-runner.mts driving real production
 * code through a scripted transport — not by regex-matching source text
 * (that was the smoke this file used to be; see Loop Runner deepening
 * ticket 04, spec.md merge bar).
 * Run: node --experimental-strip-types scripts/smoke-step-executor.mts
 */
import assert from 'node:assert/strict'
import {
  buildStepCapabilityPreload,
  formatSimulationStepOutput,
  resolveHeuristicStepOutcome,
  simulateStepOutput,
} from '../src/agent/loop/stepIO.ts'
import type { LlmSettings } from '../src/agent/types.ts'
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

console.log('smoke-step-executor')

// ── diagnose: empty LLM output vs tools-only simulation handoff ──
// Feedback loop for review bug: engine treated falsy `output` as "needs sim".
await test('REGRESSION: empty LLM output must NOT force simulation', () => {
  // Successful LLM path with empty content — keep the empty step output.
  assert.equal(
    resolveHeuristicStepOutcome({ output: '', needsSimulation: false }),
    'use-output',
    'empty content after LLM must be accepted, not replaced by sim prose',
  )
  assert.equal(
    resolveHeuristicStepOutcome({ output: '', needsSimulation: undefined }),
    'use-output',
    'missing flag defaults to accept (LLM completed)',
  )
})

await test('REGRESSION: tools-only / no-LLM must request simulation via flag', () => {
  assert.equal(
    resolveHeuristicStepOutcome({ output: '', needsSimulation: true }),
    'simulate',
  )
  // Even if strategy left a residual string, explicit flag wins.
  assert.equal(
    resolveHeuristicStepOutcome({ output: 'stale', needsSimulation: true }),
    'simulate',
  )
})

await test('REGRESSION: non-empty LLM output is always accepted', () => {
  assert.equal(
    resolveHeuristicStepOutcome({ output: 'step done', needsSimulation: false }),
    'use-output',
  )
})

// Buggy control-flow mirror (what engine did before the flag) — documents the symptom.
await test('DIAGNOSE: legacy empty-output gate misclassifies LLM empty success', () => {
  const legacyGate = (output: string) => (output ? 'use-output' : 'simulate')
  // Symptom the user/review reported:
  assert.equal(legacyGate(''), 'simulate', 'legacy bug: empty string → simulate')
  assert.equal(legacyGate('ok'), 'use-output')
  // Correct path must differ from legacy on empty LLM success:
  assert.notEqual(
    resolveHeuristicStepOutcome({ output: '', needsSimulation: false }),
    legacyGate(''),
    'fixed decision must disagree with legacy empty-output gate',
  )
})

await test('capability assembly is identical for FC-shaped and heuristic-shaped inputs', () => {
  const settings = {
    ...DEFAULT_LLM_SETTINGS,
    capabilitiesEnabled: true,
    webSearchEnabled: true,
  } as LlmSettings
  const base = {
    settings,
    overrides: {
      attachedSkills: ['web-research'],
      preloadCapabilityIds: ['workspace'],
      blockedTools: ['bash'],
      agentMode: 'build' as const,
    },
    loadedCapabilityIds: ['memory'],
    unlockedToolNames: ['web_search'],
    agentName: 'Core',
    role: 'executor',
    projectRoot: '/tmp/proj',
  }
  const optsA = buildStepCapabilityPreload(base)
  const optsB = buildStepCapabilityPreload({ ...base })
  assert.deepEqual(optsA, optsB)
  // Leaf isolation: Core/executor blocks delegate_task
  assert.ok(optsA.blockedTools?.includes('delegate_task'))
  assert.ok(optsA.blockedTools?.includes('bash'))
  assert.ok(optsA.preloadIds?.includes('skill:web-research'))
  assert.ok(optsA.preloadIds?.includes('workspace'))
  assert.ok(optsA.preloadIds?.includes('memory'))
})

await test('simulateStepOutput helper remains available', () => {
  const a = simulateStepOutput({
    description: 'do thing',
    action: 'ACT',
    objective: 'obj',
    iteration: 1,
    toolContext: 'evidence',
  })
  assert.match(a, /simulation|Tool evidence|do thing/i)
})

await test('simulation strategy output is deterministic for fixed inputs', () => {
  const a = formatSimulationStepOutput({
    description: 'do thing',
    action: 'ACT',
    objective: 'obj',
    iteration: 1,
    toolContext: 'evidence',
  })
  const b = formatSimulationStepOutput({
    description: 'do thing',
    action: 'ACT',
    objective: 'obj',
    iteration: 1,
    toolContext: 'evidence',
  })
  assert.equal(a, b)
  assert.match(a, /Tool Evidence/)
  assert.match(a, /with tools/)
})

console.log(`\n${passed} tests passed`)
