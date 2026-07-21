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

function makeDeps(
  settings: LlmSettings,
  patch: Partial<StepRunDeps> & {
    /** Convenience: static overrides bag (tests that don't need live flip). */
    overrides?: import('../src/agent/types.ts').RuntimeOverrides
  } = {},
): StepRunDeps {
  const publishes: LoopRunState[] = []
  const { overrides: staticOverrides, ...rest } = patch
  let live = settings
  let ov = staticOverrides || {}
  return {
    publish: (s) => publishes.push(structuredClone(s)),
    ask: async (): Promise<AskDecision> => ({ action: 'approve' }),
    log: () => {},
    shouldAbort: () => false,
    // Default: stable getters (tests may replace getSettings to simulate
    // engine.configure replacing the whole settings object mid-step).
    getSettings: () => live,
    getOverrides: () => ov,
    projectGuidance: '',
    sessionRecallBlock: '',
    attachedSkillContext: '',
    userAttachments: [],
    stepOutputsSoFar: [],
    ...rest,
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

await test('FC path: tool_call round then final answer (functionCalling true)', async () => {
  let round = 0
  setLlmTransport(async () => {
    round++
    if (round === 1) {
      // load_capability is pure / Node-safe (unlike bash which needs window)
      return {
        content: '',
        tokensUsed: 8,
        model: 'fake-fc',
        toolCalls: [
          {
            id: 'call_cap_1',
            name: 'load_capability',
            arguments: JSON.stringify({ id: 'shell' }),
          },
        ],
      }
    }
    return {
      content: 'FC_FINAL_AFTER_TOOL',
      tokensUsed: 12,
      model: 'fake-fc',
      toolCalls: [],
    }
  })
  const settings: LlmSettings = {
    ...DEFAULT_LLM_SETTINGS,
    enabled: true,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    baseUrl: 'http://127.0.0.1:9',
    toolsEnabled: true,
    functionCalling: true,
    safetyEnabled: false,
    modelProfiles: {
      'gpt-4o-mini': {
        modelId: 'gpt-4o-mini',
        tools: true,
        source: 'assumed',
      },
    },
  }
  const state = makeState()
  const deps = makeDeps(settings, {
    overrides: { runId: 'run-fc-1', sourceKind: 'composer' },
  })
  const result = await runStep(state, 0, 1, 'Primary', deps)
  assert.equal(result.ok, true, 'FC step must complete')
  assert.match(result.output, /FC_FINAL_AFTER_TOOL/)
  assert.ok(round >= 2, `expected multi-round FC, got rounds=${round}`)
  assert.ok(
    state.toolCalls.some((t) => t.tool === 'load_capability' && t.ok),
    `expected successful load_capability record, got ${JSON.stringify(state.toolCalls)}`,
  )
  assert.ok(
    (state.loadedCapabilityIds || []).includes('shell'),
    `expected shell in loadedCapabilityIds, got ${JSON.stringify(state.loadedCapabilityIds)}`,
  )
  assert.equal(state.steps[0].status, 'COMPLETED')
})

await test('capability ids union across sequential steps (preload resume)', async () => {
  let round = 0
  setLlmTransport(async () => {
    round++
    if (round === 1) {
      return {
        content: '',
        tokensUsed: 5,
        model: 'fake-fc',
        toolCalls: [
          {
            id: 'call_cap_1',
            name: 'load_capability',
            arguments: JSON.stringify({ id: 'shell' }),
          },
        ],
      }
    }
    return {
      content: 'STEP1_DONE',
      tokensUsed: 5,
      model: 'fake-fc',
      toolCalls: [],
    }
  })
  const settings: LlmSettings = {
    ...DEFAULT_LLM_SETTINGS,
    enabled: true,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    baseUrl: 'http://127.0.0.1:9',
    toolsEnabled: true,
    functionCalling: true,
    safetyEnabled: false,
    modelProfiles: {
      'gpt-4o-mini': { modelId: 'gpt-4o-mini', tools: true, source: 'assumed' },
    },
  }
  const state = makeState()
  state.steps = [
    { step: 1, action: 'load', description: 'load tools', status: 'PENDING' },
    { step: 2, action: 'use', description: 'use tools', status: 'PENDING' },
  ]
  const deps1 = makeDeps(settings, {
    overrides: { runId: 'run-cap', sourceKind: 'composer' },
  })
  const r1 = await runStep(state, 0, 1, 'Primary', deps1)
  assert.equal(r1.ok, true)
  assert.ok(
    (state.loadedCapabilityIds || []).includes('shell'),
    `step1 must union shell capability, got ${JSON.stringify(state.loadedCapabilityIds)}`,
  )
  const capsAfter1 = [...state.loadedCapabilityIds]

  round = 0
  setLlmTransport(async () => ({
    content: 'STEP2_WITH_PRELOAD',
    tokensUsed: 4,
    model: 'fake-fc',
    toolCalls: [],
  }))
  const deps2 = makeDeps(settings, {
    overrides: { runId: 'run-cap', sourceKind: 'composer' },
    stepOutputsSoFar: [r1.output],
  })
  const r2 = await runStep(state, 1, 1, 'Primary', deps2)
  assert.equal(r2.ok, true)
  assert.match(r2.output, /STEP2_WITH_PRELOAD/)
  for (const id of capsAfter1) {
    assert.ok(
      (state.loadedCapabilityIds || []).includes(id),
      `step2 must retain capability ${id}, got ${JSON.stringify(state.loadedCapabilityIds)}`,
    )
  }
})

/**
 * Seam: runStep FC multi-round — mid-step configure() replaces the settings
 * object (as engine.configure does). The next LLM round must use the new model.
 * Inter-step live-apply is covered by smoke-loop-runner; this locks *within* a step.
 */
await test('FC multi-round: mid-step configure model is used on next LLM round', async () => {
  let live: LlmSettings = {
    ...DEFAULT_LLM_SETTINGS,
    enabled: true,
    apiKey: 'test-key',
    model: 'model-round-1',
    baseUrl: 'http://127.0.0.1:9',
    toolsEnabled: true,
    functionCalling: true,
    safetyEnabled: false,
    modelProfiles: {
      'model-round-1': { modelId: 'model-round-1', tools: true, source: 'assumed' },
      'model-round-2': { modelId: 'model-round-2', tools: true, source: 'assumed' },
    },
  }
  const modelsSeen: string[] = []
  let round = 0
  setLlmTransport(async (req) => {
    modelsSeen.push(String(req.body.model))
    round++
    if (round === 1) {
      // Simulate agentEngine.configure replacing the whole settings object
      // (not in-place mutation of the frozen step snapshot).
      live = { ...live, model: 'model-round-2' }
      return {
        content: '',
        tokensUsed: 8,
        model: 'model-round-1',
        toolCalls: [
          {
            id: 'call_cap_live',
            name: 'load_capability',
            arguments: JSON.stringify({ id: 'shell' }),
          },
        ],
      }
    }
    return {
      content: 'LIVE_SETTINGS_FINAL',
      tokensUsed: 10,
      model: 'model-round-2',
      toolCalls: [],
    }
  })
  const state = makeState()
  const deps = makeDeps(live, {
    getSettings: () => live,
    getOverrides: () => ({ runId: 'run-live-fc', sourceKind: 'composer' }),
  })
  const result = await runStep(state, 0, 1, 'Primary', deps)
  assert.equal(result.ok, true)
  assert.match(result.output, /LIVE_SETTINGS_FINAL/)
  assert.ok(round >= 2, `expected multi-round FC, got rounds=${round}`)
  assert.equal(
    modelsSeen[0],
    'model-round-1',
    `first FC round must use pre-configure model, saw ${JSON.stringify(modelsSeen)}`,
  )
  assert.ok(
    modelsSeen.slice(1).includes('model-round-2'),
    `later FC round must use post-configure model, saw ${JSON.stringify(modelsSeen)}`,
  )
})

console.log(`\n${passed} tests passed`)
