/**
 * Runner contract + trigger admission smoke.
 *
 * Successor to the loop-era smokes (`smoke-loop-parity`, `smoke-loop-runner`)
 * that were deleted with `agent/engine.ts` and `agent/loop/`. Every assertion
 * here previously lived in one of those files and is repointed at the module
 * that owns the behaviour now — the runner capability matrix, the HITL timeout
 * policy, and the coordinator's trigger admission in `taskRunPolicy`. None of
 * them is weakened; the fail-closed cases in particular are still driven as
 * behaviour, not as source text.
 *
 * Run: node --experimental-strip-types scripts/smoke-runner-contract.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUILTIN_RUNNER_CAPABILITIES,
  EXTERNAL_CLI_RUNNER_CAPABILITIES,
  capabilitiesForRunner,
  buildCliContinueGoalContract,
  formatCliContinueGoalPrompt,
  isCompleteCliContinueGoalContract,
  projectRunnerCapabilitySnapshot,
} from '../src/agent/runners/types.ts'

import {
  explicitLoopTypeForConversation,
  isAutomationSource,
  resolveProactiveTrigger,
  resolveScheduleTrigger,
} from '../src/agent/taskRunPolicy.ts'
import type { ExternalRunOpts } from '../src/agent/runExternalTypes.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function test(name: string, fn: () => void) {
  fn()
  console.log(`  ✓ ${name}`)
}

console.log('smoke-runner-contract')

// ── Runner capability matrix: an external CLI never claims builtin powers ──
test('builtin declares the full loop; external CLI declares none of it', () => {
  assert.equal(BUILTIN_RUNNER_CAPABILITIES.validateDoD, true)
  assert.equal(BUILTIN_RUNNER_CAPABILITIES.iterate, true)
  assert.equal(EXTERNAL_CLI_RUNNER_CAPABILITIES.validateDoD, false)
  assert.equal(EXTERNAL_CLI_RUNNER_CAPABILITIES.iterate, false)
  assert.equal(EXTERNAL_CLI_RUNNER_CAPABILITIES.parse, false)
  assert.deepEqual({
    workingState: BUILTIN_RUNNER_CAPABILITIES.workingState,
    skillPreflight: BUILTIN_RUNNER_CAPABILITIES.skillPreflight,
    checkers: BUILTIN_RUNNER_CAPABILITIES.checkers,
  }, { workingState: true, skillPreflight: true, checkers: true })
  assert.deepEqual({
    workingState: EXTERNAL_CLI_RUNNER_CAPABILITIES.workingState,
    skillPreflight: EXTERNAL_CLI_RUNNER_CAPABILITIES.skillPreflight,
    checkers: EXTERNAL_CLI_RUNNER_CAPABILITIES.checkers,
  }, { workingState: false, skillPreflight: false, checkers: false })
  assert.deepEqual(capabilitiesForRunner('builtin'), BUILTIN_RUNNER_CAPABILITIES)
  assert.notEqual(capabilitiesForRunner('codex').validateDoD, true)
})

test('presentation uses only a declared or run-frozen capability snapshot', () => {
  const unavailable = projectRunnerCapabilitySnapshot(undefined, undefined)
  assert.equal(unavailable.guarantee, 'unavailable')
  assert.deepEqual(unavailable.capabilities, {
    parse: false, validateDoD: false, iterate: false, continueGoal: false,
    progressiveCapabilities: false, runScopedProgress: false,
    workingState: false, skillPreflight: false, checkers: false,
    sessionReuse: false, mailbox: false, followUp: false,
    interrupt: false, completion: false,
  })
  const external = projectRunnerCapabilitySnapshot(
    { runner: 'codex', capabilities: EXTERNAL_CLI_RUNNER_CAPABILITIES },
    BUILTIN_RUNNER_CAPABILITIES,
  )
  assert.equal(external.guarantee, 'reduced')
  assert.equal(external.capabilities.checkers, false)
  assert.equal(Object.isFrozen(external.capabilities), true)
})

test('legacy archive absence is historical missing evidence, not current Host degradation', () => {
  const legacy = projectRunnerCapabilitySnapshot(undefined, undefined, {
    missingEvidence: 'legacy-unrecorded',
  })
  assert.equal(legacy.guarantee, 'legacy-unrecorded')
  assert.equal(legacy.capabilities.checkers, false)
})

// ── continueGoal contract: one builder, no per-runner prompt invention ──
test('builtin/external continueGoal derive one contract from the same override', () => {
  // The Goal resume state a builtin run restored from. The external CLI path
  // must reach the same DoD / missing / digest, not a separately shaped copy.
  const overrides = {
    continueGoal: {
      objective: '補齊報表',
      definitionOfDone: '價格欄存在且有驗證輸出',
      missing: ['缺少價格欄', '缺少驗證輸出'],
      priorDigest: '上一輪只完成欄位盤點',
      userHint: '先補價格欄',
    },
  }
  const context = { projectRoot: '/tmp/parity-project', approvalMode: 'auto' }

  const derived = buildCliContinueGoalContract(overrides as never, context as never)
  assert.ok(derived, 'external CLI must derive a contract from the resume override')
  assert.equal(isCompleteCliContinueGoalContract(derived), true)

  assert.equal(derived.objective, overrides.continueGoal.objective)
  assert.equal(derived.definitionOfDone, overrides.continueGoal.definitionOfDone)
  assert.deepEqual(derived.missing, overrides.continueGoal.missing)
  assert.equal(derived.priorDigest, overrides.continueGoal.priorDigest)
  assert.equal(derived.userHint, overrides.continueGoal.userHint)
  assert.equal(derived.projectRoot, context.projectRoot)
  assert.equal(derived.approvalMode, context.approvalMode)

  // Every missing gap the old builtin loop would replan against reaches the prompt.
  const prompt = formatCliContinueGoalPrompt(derived)
  for (const gap of overrides.continueGoal.missing) assert.match(prompt, new RegExp(gap))
  assert.match(prompt, /Definition of Done/)
  assert.match(prompt, new RegExp(overrides.continueGoal.definitionOfDone))
  assert.match(prompt, new RegExp(overrides.continueGoal.priorDigest))
  assert.match(prompt, /Do not invent prior tool evidence/)

  for (const runner of ['builtin', 'codex']) {
    assert.equal(capabilitiesForRunner(runner).continueGoal, true)
  }
  assert.equal(capabilitiesForRunner('codex').validateDoD, false)
  assert.equal(capabilitiesForRunner('codex').iterate, false)
  assert.equal(capabilitiesForRunner('builtin').iterate, true)
})

test('an explicit externalCliContract.continueGoal wins over the resume override', () => {
  const explicit = {
    objective: 'explicit objective',
    definitionOfDone: 'explicit DoD',
    missing: ['explicit gap'],
  }
  const derived = buildCliContinueGoalContract({
    continueGoal: { objective: 'resume', definitionOfDone: 'resume DoD', missing: ['resume gap'] },
    externalCliContract: { continueGoal: explicit },
  } as never)
  assert.deepEqual(derived, explicit)
})

test('no resume override yields no contract, so no continueGoal prompt is built', () => {
  assert.equal(buildCliContinueGoalContract({} as never), undefined)
  assert.equal(isCompleteCliContinueGoalContract(undefined), false)
  assert.equal(isCompleteCliContinueGoalContract({ objective: '', definitionOfDone: 'x', missing: [] } as never), false)
})

test('runDispatch drives the CLI prompt through the shared contract builder', () => {
  const dispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')
  assert.match(dispatch, /buildCliContinueGoalContract\(snapshot\.overrides/)
  assert.match(dispatch, /isCompleteCliContinueGoalContract\(continueContract\)/)
  assert.match(dispatch, /formatCliContinueGoalPrompt\(continueContract\)/)
})

test('plain-browser and historical UI never infer Host guarantees from current settings', () => {
  const dispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')
  const agentStore = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  const panel = fs.readFileSync(path.join(appRoot, 'src/components/InlineRunPanel.tsx'), 'utf8')
  const continuation = fs.readFileSync(path.join(appRoot, 'src/components/RunContinuationActions.tsx'), 'utf8')
  const records = fs.readFileSync(path.join(appRoot, 'src/pages/RecordsPage.tsx'), 'utf8')
  assert.match(dispatch, /Plain-browser mode: Pi Core Host capabilities are unavailable\/degraded/)
  assert.doesNotMatch(dispatch, /agent\/loop\//)
  assert.doesNotMatch(panel, /capabilitiesForRunner/)
  assert.doesNotMatch(continuation, /capabilitiesForRunner/)
  assert.match(records, /projectRunnerCapabilitySnapshot/)
  assert.match(agentStore, /failedPiHostRunSnapshot/,
    'a failed Pi RPC must preserve the Host record already observed before settlement')
  assert.match(agentStore, /runnerCapabilities: previous\?\.runnerCapabilities \|\| \{ \.\.\.BUILTIN_RUNNER_CAPABILITIES \}/,
    'a failed builtin RPC keeps its frozen runner contract instead of presenting Unavailable / degraded')
})

// ── Trigger admission: fail-closed, now at the coordinator's policy seam ──
const base = (patch: Partial<ExternalRunOpts>): ExternalRunOpts =>
  ({ objective: 'do the thing', ...patch }) as ExternalRunOpts

test('Time-based outside a schedule source is refused', () => {
  const refused = resolveScheduleTrigger(base({ loopType: 'Time-based', sourceKind: 'composer' }))
  assert.ok(refused && 'error' in refused, 'a conversation cannot declare itself Time-based')
  assert.match(refused.error, /ScheduledJob/)
})

test('Time-based with a missing claim is refused fail-closed', () => {
  const refused = resolveScheduleTrigger(base({ loopType: 'Time-based', sourceKind: 'schedule' }))
  assert.ok(refused && 'error' in refused, 'no claim means no Time-based run')
  assert.match(refused.error, /trigger 無效/)
})

test('Time-based with a valid claim is admitted with its snapshot', () => {
  const admitted = resolveScheduleTrigger(base({
    loopType: 'Time-based',
    sourceKind: 'schedule',
    meta: { scheduleJobId: 'job-1', scheduleKind: 'interval', scheduleTriggeredAt: new Date().toISOString() },
  }))
  assert.ok(admitted && 'snapshot' in admitted, 'a proven trigger is admitted')
  assert.equal(admitted.snapshot.jobId, 'job-1')
})

test('Proactive without matcher evidence is refused fail-closed', () => {
  const refused = resolveProactiveTrigger(base({ loopType: 'Proactive', sourceKind: 'event' }))
  assert.ok(refused && 'error' in refused, 'no evidence means no Proactive run')
  assert.match(refused.error, /trigger 無效/)
})

test('a run that names no pattern is not pushed through either gate', () => {
  assert.equal(resolveScheduleTrigger(base({ sourceKind: 'composer' })), null)
  assert.equal(resolveProactiveTrigger(base({ sourceKind: 'composer' })), null)
})

test('automation sources are classified as automation', () => {
  assert.equal(isAutomationSource(base({ sourceKind: 'schedule' })), true)
  assert.equal(isAutomationSource(base({ sourceKind: 'composer' })), false)
  assert.equal(explicitLoopTypeForConversation(base({ loopType: 'Goal-based' })), 'Goal-based')
})

console.log('runner contract and fail-closed trigger admission are intact after the legacy loop removal')
