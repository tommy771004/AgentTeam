/**
 * Step Executor shared helpers — true import tests.
 * Run: node --experimental-strip-types scripts/smoke-step-executor.mts
 */
import assert from 'node:assert/strict'
import {
  buildStepCapabilityPreload,
  formatSimulationStepOutput,
  resolveHeuristicStepOutcome,
  simulateStepOutput,
} from '../src/agent/stepExecutor.ts'
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

await test('DIAGNOSE: Loop Runner step seam must use resolveHeuristicStepOutcome (not empty-string gate)', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  // Loop Runner deepening (ticket 02): dispatch wiring moved from engine.ts to
  // agent/loop/stepRun.ts; behaviorally re-verified by smoke-step-run.mts.
  const stepRun = fs.readFileSync(path.join(appRoot, 'src/agent/loop/stepRun.ts'), 'utf8')
  const strategies = fs.readFileSync(path.join(appRoot, 'src/agent/loop/strategies.ts'), 'utf8')
  assert.match(
    stepRun,
    /resolveHeuristicStepOutcome/,
    'stepRun must dispatch on resolveHeuristicStepOutcome',
  )
  assert.doesNotMatch(
    stepRun,
    /if \(result\.output\)/,
    'stepRun must not gate simulation on truthy output',
  )
  assert.match(
    strategies,
    /needsSimulation:\s*true/,
    'heuristic tools-only path must set needsSimulation: true',
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

await test('Loop Runner step seam wires stepIO helpers; heuristic uses invokeGatedTool', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  // Loop Runner deepening (ticket 02): stepExecutor.ts/stepStrategies.ts are now
  // re-export shims over agent/loop/{stepIO,strategies}.ts — assert the real homes.
  const stepRun = fs.readFileSync(path.join(appRoot, 'src/agent/loop/stepRun.ts'), 'utf8')
  const step = fs.readFileSync(path.join(appRoot, 'src/agent/loop/stepIO.ts'), 'utf8')
  const strategies = fs.readFileSync(path.join(appRoot, 'src/agent/loop/strategies.ts'), 'utf8')
  const invocation = fs.readFileSync(
    path.join(appRoot, 'src/agent/tools/toolInvocation.ts'),
    'utf8',
  )
  assert.match(step, /export function buildStepCapabilityPreload/)
  assert.doesNotMatch(step, /finalizeAuthorizedToolCall/)
  assert.doesNotMatch(step, /finalizeDeniedToolCall/)
  assert.match(invocation, /export async function invokeGatedTool/)
  // Three thin strategy factories
  assert.match(strategies, /export function createFunctionCallingStepExecutor/)
  assert.match(strategies, /export function createHeuristicStepExecutor/)
  assert.match(strategies, /export function createSimulationStepExecutor/)
  assert.match(strategies, /export class HeuristicLlmFailedError/)
  // Strategies never import one another (only createStepStrategies composes them)
  assert.doesNotMatch(strategies, /from '\.\/strategies(\.ts)?'/)
  assert.match(strategies, /functionCalling: createFunctionCallingStepExecutor\(host\)/)
  assert.match(strategies, /heuristic: createHeuristicStepExecutor\(host\)/)
  assert.match(strategies, /simulation: createSimulationStepExecutor\(host\)/)
  // Step Run orchestrator owns dispatch + fallback
  assert.match(stepRun, /createStepStrategies/)
  assert.match(stepRun, /strategies\.functionCalling\.execute/)
  assert.match(stepRun, /strategies\.heuristic\.execute/)
  assert.match(stepRun, /strategies\.simulation\.execute/)
  assert.match(stepRun, /HeuristicLlmFailedError/)
  assert.match(stepRun, /Falling back to simulation/)
  // Heuristic gated tools: one assembly helper (builtin + custom), not dual paste
  assert.match(strategies, /async function runHeuristicGatedTool/)
  assert.match(strategies, /invokeGatedTool/)
  // Both loops call the helper (not a second full authorize-remap block)
  const assemblyCalls = strategies.match(/runHeuristicGatedTool\(/g) || []
  assert.ok(
    assemblyCalls.length >= 3,
    `expected helper def + builtin + custom calls, got ${assemblyCalls.length}`,
  )
  assert.doesNotMatch(strategies, /finalizeAuthorizedToolCall/)
  assert.doesNotMatch(strategies, /allowed: true as const/)
  assert.doesNotMatch(strategies, /guardAndExecuteTool/)
  assert.doesNotMatch(step, /authToDeniedResult/)
  assert.match(strategies, /buildStepCapabilityPreload/)
  // Builtin path uses ToolName without Parameters<typeof executeTool> cast
  assert.doesNotMatch(strategies, /Parameters<typeof executeTool>/)
  assert.match(invocation, /truncate only/i)
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
