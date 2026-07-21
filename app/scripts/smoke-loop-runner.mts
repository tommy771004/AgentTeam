/**
 * Loop Runner deepening — ticket 03: agent/loop/loopRunner.ts true-import smoke.
 * Seam: runLoop(req, state, deps) — the Loop Runner's product-facing entry.
 * Run: node --experimental-strip-types scripts/smoke-loop-runner.mts
 */
import assert from 'node:assert/strict'
import { runLoop, type LoopDeps, type LoopRequest } from '../src/agent/loop/index.ts'
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

console.log('smoke-loop-runner')

function makeState(steps: ExecutionStep[], maxIterations = 3): LoopRunState {
  return {
    id: 'run-1',
    objective: 'ship the feature',
    loopConfig: {
      loopType: 'Goal-based',
      trigger: '',
      executionSequence: steps.map((s) => s.description),
      definitionOfDone: 'feature ships with tests',
      maxIterations,
      fallbackProtocol: '啟動備援流程',
      nextState: 'Halt',
    },
    status: 'running',
    currentIteration: 0,
    steps,
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

type MakeDepsOpts = Partial<
  Omit<LoopDeps, 'getSettings' | 'getOverrides' | 'initialStepOutputs'>
> & {
  /** RuntimeOverrides bag (convenience for smokes). */
  overrides?: ReturnType<LoopDeps['getOverrides']>
  initialStepOutputs?: string[]
  /** Test helper: mutate live settings mid-run. */
  onBindLiveSettings?: (set: (s: LlmSettings) => void) => void
}

function makeDeps(settings: LlmSettings, opts: MakeDepsOpts = {}): LoopDeps {
  let liveSettings = settings
  let liveOverrides = opts.overrides || {}
  opts.onBindLiveSettings?.((s) => {
    liveSettings = s
  })
  const {
    overrides: _runtimeOverrides,
    initialStepOutputs,
    onBindLiveSettings: _bind,
    ...rest
  } = opts
  return {
    publish: () => {},
    ask: async () => ({ action: 'approve' }),
    waitForUserAck: async () => {},
    log: () => {},
    shouldAbort: () => false,
    getSettings: () => liveSettings,
    getOverrides: () => liveOverrides,
    initialStepOutputs,
    projectGuidance: '',
    sessionRecallBlock: '',
    attachedSkillContext: '',
    userAttachments: [],
    onGoalIncomplete: () => {},
    onGoalCleared: () => {},
    ...rest,
  }
}

await test('Turn-based: single step completes, chat-lite auto-ACK, no waitForUserAck call', async () => {
  const settings: LlmSettings = { ...DEFAULT_LLM_SETTINGS, enabled: false, toolsEnabled: false, safetyEnabled: false }
  const state = makeState([{ step: 1, action: 'do', description: 'write the code', status: 'PENDING' }])
  let waitCalls = 0
  const deps = makeDeps(settings, {
    overrides: { sourceKind: 'composer' },
    waitForUserAck: async () => {
      waitCalls++
    },
  })
  const { state: out } = await runLoop({ pattern: 'turn' }, state, deps)
  assert.equal(waitCalls, 0, 'chat-lite sources must not block on user ACK')
  assert.equal(out.status, 'success')
  assert.match(out.result || '', /simulation mode/)
})

await test('Goal-based: DoD fail → replan → met, second iteration succeeds', async () => {
  let dodCalls = 0
  const seenPrompts: string[] = []
  setLlmTransport(async (req) => {
    const text = JSON.stringify(req.body.messages)
    seenPrompts.push(text)
    if (text.includes('驗收代理')) {
      dodCalls++
      return dodCalls === 1
        ? { content: '{"met":false,"confidence":0.4,"missing":["need more detail"]}', tokensUsed: 10, model: 'fake', toolCalls: [] }
        : { content: '{"met":true,"confidence":0.9,"missing":[]}', tokensUsed: 10, model: 'fake', toolCalls: [] }
    }
    return { content: 'STEP_DONE', tokensUsed: 5, model: 'fake', toolCalls: [] }
  })
  const settings: LlmSettings = {
    ...DEFAULT_LLM_SETTINGS,
    enabled: true,
    apiKey: 'test-key',
    model: 'test-model',
    baseUrl: 'http://127.0.0.1:9',
    toolsEnabled: false,
    functionCalling: false,
    safetyEnabled: false,
  }
  const state = makeState([{ step: 1, action: 'do', description: 'write the code', status: 'PENDING' }], 3)
  const deps = makeDeps(settings)
  const { state: out } = await runLoop({ pattern: 'goal' }, state, deps)
  assert.equal(dodCalls, 2, 'DoD must be evaluated twice: fail then met')
  assert.equal(out.currentIteration, 2, 'must succeed on the second iteration after replan')
  assert.equal(out.status, 'success')
  assert.ok(out.result, 'finalizeSuccess must synthesize a result')
  assert.ok(out.steps.length >= 1, 'replan must have produced corrective steps')
})

await test('Goal-based: max iterations reached without DoD met → failed + continueGoal persisted', async () => {
  setLlmTransport(async (req) => {
    const text = JSON.stringify(req.body.messages)
    if (text.includes('驗收代理')) {
      return { content: '{"met":false,"confidence":0.3,"missing":["still missing"]}', tokensUsed: 5, model: 'fake', toolCalls: [] }
    }
    return { content: 'STEP_DONE', tokensUsed: 5, model: 'fake', toolCalls: [] }
  })
  const settings: LlmSettings = {
    ...DEFAULT_LLM_SETTINGS,
    enabled: true,
    apiKey: 'test-key',
    model: 'test-model',
    baseUrl: 'http://127.0.0.1:9',
    toolsEnabled: false,
    functionCalling: false,
    safetyEnabled: false,
  }
  const state = makeState([{ step: 1, action: 'do', description: 'write the code', status: 'PENDING' }], 2)
  let goalIncompleteCalls = 0
  const deps = makeDeps(settings, {
    onGoalIncomplete: () => {
      goalIncompleteCalls++
    },
  })
  const { state: out } = await runLoop({ pattern: 'goal' }, state, deps)
  assert.equal(out.status, 'failed')
  assert.equal(out.haltReason, 'Max Iterations Reached')
  assert.equal(goalIncompleteCalls, 1, 'continueGoal snapshot must be offered on max-iterations failure')
})

await test('Time-based: missing claim is refused fail-closed at runLoop entry (bypassing the type system)', async () => {
  const settings: LlmSettings = { ...DEFAULT_LLM_SETTINGS, enabled: false, toolsEnabled: false, safetyEnabled: false }
  const state = makeState([{ step: 1, action: 'do', description: 'scheduled work', status: 'PENDING' }])
  const deps = makeDeps(settings)
  const req = { pattern: 'time' } as unknown as LoopRequest
  const { state: out } = await runLoop(req, state, deps)
  assert.equal(out.status, 'failed')
  assert.match(out.haltReason || '', /refused|missing/i)
  assert.equal(out.steps[0].status, 'PENDING', 'no step must execute without claimed evidence')
})

await test('Proactive: missing evidence is refused fail-closed at runLoop entry', async () => {
  const settings: LlmSettings = { ...DEFAULT_LLM_SETTINGS, enabled: false, toolsEnabled: false, safetyEnabled: false }
  const state = makeState([{ step: 1, action: 'do', description: 'reactive work', status: 'PENDING' }])
  const deps = makeDeps(settings)
  const req = { pattern: 'proactive' } as unknown as LoopRequest
  const { state: out } = await runLoop(req, state, deps)
  assert.equal(out.status, 'failed')
  assert.match(out.haltReason || '', /refused|missing/i)
  assert.equal(out.steps[0].status, 'PENDING')
})

await test('Time-based: valid claim executes and finalizes via finalizePatternRun', async () => {
  const settings: LlmSettings = { ...DEFAULT_LLM_SETTINGS, enabled: false, toolsEnabled: false, safetyEnabled: false }
  const state = makeState([{ step: 1, action: 'do', description: 'scheduled work', status: 'PENDING' }])
  const deps = makeDeps(settings)
  const req: LoopRequest = {
    pattern: 'time',
    claim: { source: 'schedule', jobId: 'job-1', scheduleKind: 'daily', triggeredAt: new Date().toISOString() },
  }
  const { state: out } = await runLoop(req, state, deps)
  assert.equal(out.status, 'success')
  assert.equal(out.scheduleTrigger?.jobId, 'job-1')
  assert.equal(out.steps[0].status, 'COMPLETED')
  assert.equal(out.reportTitle, 'Scheduled Job Report')
})

await test('Proactive: valid evidence executes and finalizes via finalizePatternRun', async () => {
  const settings: LlmSettings = { ...DEFAULT_LLM_SETTINGS, enabled: false, toolsEnabled: false, safetyEnabled: false }
  const state = makeState([{ step: 1, action: 'do', description: 'reactive work', status: 'PENDING' }])
  const deps = makeDeps(settings)
  const req: LoopRequest = {
    pattern: 'proactive',
    evidence: {
      source: 'event',
      eventId: 'evt-1',
      eventName: 'file.created',
      matchedAt: new Date().toISOString(),
      predicates: { source: { expected: true, actual: true, matched: true } },
    },
  }
  const { state: out } = await runLoop(req, state, deps)
  assert.equal(out.status, 'success')
  assert.equal(out.eventTrigger?.eventId, 'evt-1')
  assert.equal(out.reportTitle, 'Proactive Event Report')
})

await test('abort during Goal iteration reconciles to halted status', async () => {
  const settings: LlmSettings = { ...DEFAULT_LLM_SETTINGS, enabled: false, toolsEnabled: false, safetyEnabled: false }
  const state = makeState(
    [
      { step: 1, action: 'do', description: 'step one', status: 'PENDING' },
      { step: 2, action: 'do', description: 'step two', status: 'PENDING' },
    ],
    3,
  )
  let aborted = false
  const deps = makeDeps(settings, { shouldAbort: () => aborted })
  const runPromise = runLoop({ pattern: 'goal' }, state, deps)
  aborted = true
  const { state: out } = await runPromise
  assert.equal(out.status, 'halted')
  assert.equal(out.haltReason, 'Stopped by user')
})

await test('publish is called across the loop (UI live-update seam)', async () => {
  const settings: LlmSettings = { ...DEFAULT_LLM_SETTINGS, enabled: false, toolsEnabled: false, safetyEnabled: false }
  const state = makeState([{ step: 1, action: 'do', description: 'write the code', status: 'PENDING' }])
  const seenStatuses: string[] = []
  const deps = makeDeps(settings, {
    overrides: { sourceKind: 'composer' },
    publish: (s) => seenStatuses.push(s.status),
  })
  await runLoop({ pattern: 'turn' }, state, deps)
  assert.ok(seenStatuses.includes('success'), 'must publish the final success status')
  assert.ok(seenStatuses.length >= 2, 'must publish more than once across a run')
})

await test('continueGoal seed: initialStepOutputs appear in first step context / result path', async () => {
  const settings: LlmSettings = {
    ...DEFAULT_LLM_SETTINGS,
    enabled: true,
    apiKey: 'test-key',
    model: 'test-model',
    baseUrl: 'http://127.0.0.1:9',
    toolsEnabled: false,
    functionCalling: false,
    safetyEnabled: false,
  }
  const seed = '### 先前執行摘要\nseeded-prior-digest-XYZ'
  let sawSeed = false
  setLlmTransport(async (req) => {
    const text = JSON.stringify(req.body.messages)
    if (text.includes('seeded-prior-digest-XYZ')) sawSeed = true
    if (text.includes('驗收代理')) {
      return { content: '{"met":true,"confidence":0.95,"missing":[]}', tokensUsed: 10, model: 'fake', toolCalls: [] }
    }
    return { content: 'STEP_DONE_WITH_SEED', tokensUsed: 5, model: 'fake', toolCalls: [] }
  })
  const state = makeState(
    [{ step: 1, action: 'do', description: 'complete remaining work', status: 'PENDING' }],
    1,
  )
  const deps = makeDeps(settings, { initialStepOutputs: [seed] })
  const { state: out } = await runLoop({ pattern: 'goal' }, state, deps)
  assert.equal(out.status, 'success')
  assert.ok(sawSeed, 'prior digest must reach LLM step/DoD prompts via stepOutputsSoFar')
})

await test('live getSettings: mid-run configure is visible on next settings read', async () => {
  const settings: LlmSettings = {
    ...DEFAULT_LLM_SETTINGS,
    enabled: false,
    toolsEnabled: false,
    safetyEnabled: false,
    subAgentsEnabled: false,
  }
  let setLive: ((s: LlmSettings) => void) | undefined
  const state = makeState(
    [
      { step: 1, action: 'do', description: 'first', status: 'PENDING' },
      { step: 2, action: 'do', description: 'second', status: 'PENDING' },
    ],
    1,
  )
  // Goal with maxIterations 1 and always-fail DoD not needed — turn pattern runs all steps.
  const turnState = makeState(
    [
      { step: 1, action: 'do', description: 'first', status: 'PENDING' },
      { step: 2, action: 'do', description: 'second', status: 'PENDING' },
    ],
  )
  const seenModels: string[] = []
  const deps = makeDeps(settings, {
    overrides: { sourceKind: 'composer' },
    onBindLiveSettings: (set) => {
      setLive = set
    },
    log: (_level, message) => {
      // Capture model labels if any; also use publish side-effect below.
      void message
    },
    publish: (s) => {
      // After first step completes, flip model via live configure simulation.
      const done = s.steps.filter((st) => st.status === 'COMPLETED').length
      if (done === 1 && setLive) {
        setLive({ ...settings, model: 'live-configured-model' })
      }
      seenModels.push(deps.getSettings().model || '')
    },
  })
  await runLoop({ pattern: 'turn' }, turnState, deps)
  assert.ok(
    seenModels.some((m) => m === 'live-configured-model'),
    'after configure mid-run, getSettings must return the new model',
  )
  void state
})

console.log(`\n${passed} tests passed`)
