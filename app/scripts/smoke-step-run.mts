/**
 * Loop Runner deepening — ticket 02: agent/loop/stepRun.ts true-import smoke.
 * Seam: runStep(state, index, iteration, agentName, deps) — the Loop Runner's
 *   step-execution seam. True-imported (no source-regex — see spec.md merge bar).
 * Run: node --experimental-strip-types scripts/smoke-step-run.mts
 */
import assert from 'node:assert/strict'
import { pickAgentForStep, runStep, type AskDecision, type StepRunDeps } from '../src/agent/loop/stepRun.ts'
import type { LoopRunState } from '../src/agent/loop/state.ts'
import { DEFAULT_LLM_SETTINGS, setLlmTransport } from '../src/agent/llm.ts'
import type { ExecutionStep, LlmSettings } from '../src/agent/types.ts'

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  } finally {
    setLlmTransport(undefined)
  }
}

console.log('smoke-step-run')

function makeState(step: Partial<ExecutionStep> = {}): LoopRunState {
  return {
    id: 'run-1',
    objective: 'ship the feature',
    loopConfig: {
      loopType: 'Goal-based',
      trigger: '',
      executionSequence: [],
      definitionOfDone: '',
      maxIterations: 5,
      fallbackProtocol: '',
      nextState: 'Halt',
    },
    status: 'running',
    currentIteration: 1,
    steps: [
      {
        step: 1,
        action: 'do the thing',
        description: 'write the code',
        status: 'PENDING',
        ...step,
      },
    ],
    logs: [],
    confidence: 0,
    progress: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    subAgents: [],
    knowledge: { entities: [], edges: [], phase: 'initial' },
    intervention: { active: false, reason: '', payloadJson: '', safety: null, timeoutSec: 900 },
    tokensUsed: 0,
    minConfidence: 0.8,
    toolCalls: [],
    loadedCapabilityIds: [],
    unlockedToolNames: [],
    violation: null,
    executionKind: 'loop',
    metrics: { vramLabel: '—', apiCredits: 0, executionMs: 0 },
  }
}

function makeDeps(settings: LlmSettings, overrides: Partial<StepRunDeps> = {}): StepRunDeps {
  const publishes: LoopRunState[] = []
  return {
    publish: (s) => publishes.push(structuredClone(s)),
    ask: async (): Promise<AskDecision> => ({ action: 'approve' }),
    log: () => {},
    shouldAbort: () => false,
    settings,
    overrides: {},
    projectGuidance: '',
    sessionRecallBlock: '',
    attachedSkillContext: '',
    userAttachments: [],
    stepOutputsSoFar: [],
    ...overrides,
  }
}

await test('pickAgentForStep: subAgents disabled → Primary', () => {
  const state = makeState()
  assert.equal(pickAgentForStep(state, 0, 1, DEFAULT_LLM_SETTINGS), 'Primary')
})

await test('simulation path: LLM disabled + tools disabled → deterministic sim prose, step COMPLETED', async () => {
  const settings: LlmSettings = { ...DEFAULT_LLM_SETTINGS, enabled: false, toolsEnabled: false, safetyEnabled: false }
  const state = makeState()
  const deps = makeDeps(settings)
  const result = await runStep(state, 0, 1, 'Primary', deps)
  assert.equal(result.ok, true)
  assert.equal(result.contributesOutput, true)
  assert.match(result.output, /write the code/)
  assert.match(result.output, /simulation mode/)
  assert.equal(state.steps[0].status, 'COMPLETED')
  assert.equal(state.steps[0].modelUsed, '(simulation)')
  assert.ok(state.confidence > 0, 'confidence must be set after a completed step')
})

await test('heuristic+LLM path: scripted transport answer flows through as step output', async () => {
  setLlmTransport(async () => ({
    content: 'SCRIPTED_ANSWER',
    tokensUsed: 42,
    model: 'fake-model',
    toolCalls: [],
  }))
  const settings: LlmSettings = {
    ...DEFAULT_LLM_SETTINGS,
    enabled: true,
    apiKey: 'test-key',
    model: 'test-model',
    baseUrl: 'http://127.0.0.1:9',
    toolsEnabled: false, // skip capability/tool assembly — isolate the LLM hop
    functionCalling: false, // force heuristic path, not FC
    safetyEnabled: false,
  }
  const state = makeState()
  const deps = makeDeps(settings)
  const result = await runStep(state, 0, 1, 'Primary', deps)
  assert.equal(result.ok, true)
  assert.equal(result.output, 'SCRIPTED_ANSWER')
  assert.equal(state.tokensUsed, 42)
  assert.equal(state.steps[0].status, 'COMPLETED')
  assert.equal(state.steps[0].modelUsed, 'test-model')
})

await test('safety gate: unsafe step → ask called, reject → step FAILED and halted, output not contributed', async () => {
  const settings: LlmSettings = { ...DEFAULT_LLM_SETTINGS, enabled: false, toolsEnabled: false, safetyEnabled: true }
  const state = makeState({
    description: 'extract data',
    action: 'dump credentials',
  })
  state.objective = 'sensitive credentials export'
  let askCalls = 0
  const deps = makeDeps(settings, {
    ask: async (req) => {
      askCalls++
      assert.match(req.reason, /safety constraint/i)
      assert.match(req.payloadJson, /prod_core|FULL_DUMP/i)
      return { action: 'reject' }
    },
  })
  const result = await runStep(state, 0, 1, 'Primary', deps)
  assert.equal(askCalls, 1, 'unsafe step must prompt exactly once')
  assert.equal(result.ok, false)
  assert.equal(result.contributesOutput, false, 'rejected step must not contribute to stepOutputs/progress')
  assert.equal(state.steps[0].status, 'FAILED')
  assert.equal(state.status, 'halted')
  assert.match(state.haltReason || '', /rejected/i)
})

await test('safety gate: unsafe step → approve → step proceeds to simulation and completes', async () => {
  const settings: LlmSettings = { ...DEFAULT_LLM_SETTINGS, enabled: false, toolsEnabled: false, safetyEnabled: true }
  const state = makeState({
    description: 'extract data',
    action: 'dump credentials',
  })
  state.objective = 'sensitive credentials export'
  const deps = makeDeps(settings, {
    ask: async () => ({ action: 'approve' }),
  })
  const result = await runStep(state, 0, 1, 'Primary', deps)
  assert.equal(result.ok, true)
  assert.equal(result.contributesOutput, true)
  assert.equal(state.steps[0].status, 'COMPLETED')
  assert.equal(state.status, 'running')
})

await test('publish is called on every mutation (UI live-update seam)', async () => {
  const settings: LlmSettings = { ...DEFAULT_LLM_SETTINGS, enabled: false, toolsEnabled: false, safetyEnabled: false }
  const state = makeState()
  const seen: string[] = []
  const deps = makeDeps(settings, {
    publish: (s) => seen.push(s.steps[0].status),
  })
  await runStep(state, 0, 1, 'Primary', deps)
  assert.ok(seen.includes('IN_PROGRESS'), 'must publish IN_PROGRESS before executing')
  assert.ok(seen.includes('COMPLETED'), 'must publish COMPLETED after finishing')
})

console.log(`\n${passed} tests passed`)
