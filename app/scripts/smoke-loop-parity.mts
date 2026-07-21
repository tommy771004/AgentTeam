/**
 * Loop Runner merge-bar parity — automated slice of ticket 05.
 * Covers what smokes can prove without a human driving the Electron UI.
 * Remaining human checklist lives in .scratch/loop-runner-deepening/issues/05-*.md
 *
 * Run: node --experimental-strip-types scripts/smoke-loop-parity.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unattendedInterventionTimeoutSec } from '../src/agent/hitlTimeout.ts'
import { snapshot } from '../src/agent/loop/state.ts'
import type { LoopRunState } from '../src/agent/loop/state.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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

console.log('smoke-loop-parity')

await test('merge bar smokes exist and claim four patterns + FC + seed + live settings', () => {
  const loop = fs.readFileSync(path.join(appRoot, 'scripts/smoke-loop-runner.mts'), 'utf8')
  for (const needle of [
    "pattern: 'turn'",
    "pattern: 'goal'",
    "pattern: 'time'",
    "pattern: 'proactive'",
    'continueGoal seed',
    'live getSettings',
    'Max Iterations Reached',
  ]) {
    assert.match(loop, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  const step = fs.readFileSync(path.join(appRoot, 'scripts/smoke-step-run.mts'), 'utf8')
  assert.match(step, /functionCalling true/)
  assert.match(step, /load_capability/)
  assert.match(step, /capability ids union/)
  assert.match(step, /safety gate/)
})

await test('engine adapter clones publish + final rebind via snapshot (UI isolation)', () => {
  const eng = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  assert.match(eng, /this\.state = snapshot\(s\)/)
  assert.match(eng, /this\.state = snapshot\(loopState\)/)
  assert.match(eng, /getSettings:\s*\(\)\s*=>\s*this\.settings/)
  assert.match(eng, /initialStepOutputs:\s*this\.stepOutputs\.slice\(\)/)
  // orphan lastDodMissing removed
  assert.doesNotMatch(eng, /lastDodMissing/)
})

await test('snapshot() returns a deep clone (mutation isolation)', () => {
  const state = {
    id: 'r1',
    status: 'running',
    steps: [{ step: 1, status: 'IN_PROGRESS' }],
    loadedCapabilityIds: ['shell'],
  } as unknown as LoopRunState
  const snap = snapshot(state)
  assert.notEqual(snap, state)
  assert.notEqual(snap.steps, state.steps)
  ;(snap.steps as { status: string }[])[0].status = 'COMPLETED'
  assert.equal((state.steps as { status: string }[])[0].status, 'IN_PROGRESS')
})

await test('unattended intervention timeout policy (pure)', () => {
  assert.equal(unattendedInterventionTimeoutSec(undefined), 45)
  assert.equal(unattendedInterventionTimeoutSec(45_000), 45)
  assert.equal(unattendedInterventionTimeoutSec(120_000), 120)
  assert.equal(unattendedInterventionTimeoutSec(200_000), 120) // cap
  assert.equal(unattendedInterventionTimeoutSec(500), 15) // hard floor 15s
  assert.equal(unattendedInterventionTimeoutSec(10_000), 15) // sub-floor still floored
})

await test('HITL ask port wires engine.waitForIntervention (static)', () => {
  const eng = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  assert.match(eng, /ask:\s*\(\)\s*=>\s*this\.waitForIntervention\(\)/)
  assert.match(eng, /unattendedInterventionTimeoutSec/)
  const step = fs.readFileSync(path.join(appRoot, 'src/agent/loop/stepRun.ts'), 'utf8')
  assert.match(step, /waitForIntervention|engine\.waitForIntervention|unattended 45s|safety 900s/)
})

await test('Time/Proactive fail-closed still in loopRunner entry', () => {
  const lr = fs.readFileSync(path.join(appRoot, 'src/agent/loop/loopRunner.ts'), 'utf8')
  assert.match(lr, /req\.pattern === 'time'/)
  assert.match(lr, /req\.pattern === 'proactive'/)
  assert.match(lr, /fail-closed|refused|missing/i)
})

await test('package.json smoke chain includes loop + step + transport + parity', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  const smoke = pkg.scripts.smoke || ''
  for (const s of [
    'smoke-loop-runner',
    'smoke-step-run',
    'smoke-llm-transport',
    'smoke-loop-parity',
  ]) {
    assert.match(smoke, new RegExp(s))
  }
})

console.log(`\n${passed} tests passed`)
console.log(`
Parity note:
  Automated (this smoke + smoke-loop-runner + smoke-step-run): four patterns,
  intervention approve/reject at step seam, FC multi-round, capability resume,
  continueGoal seed, live configure, publish clone, unattended timeout policy,
  Time/Proactive fail-closed.
  Still human (Electron UI): real ScheduledJob tick, real event matcher hit,
  composer-visible intervention panel, live subAgent/tool panes during a real run.
`)
