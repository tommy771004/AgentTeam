/**
 * Auto-continue freshness window + shared loop bounds (items 2).
 *
 * A continueGoal snapshot older than the freshness window must never drive an
 * automatic continuation — replaying corrective work against a moved-on world
 * is how zombie resumes happen (hermes `auto_continue_freshness_window`).
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  DEFAULT_CONTINUE_FRESHNESS_MS,
  MAX_CONTINUE_FRESHNESS_MS,
  MIN_CONTINUE_FRESHNESS_MS,
  clampContinueFreshnessMs,
  isSnapshotFresh,
} from '../src/agent/autoContinueFreshness.ts'
import { buildContinueGoalSnapshot } from '../src/agent/continueGoal.ts'
import { PI_MAX_ITERATIONS, clampPiIterations } from '../src/agent/loopBounds.ts'

// ── Freshness window arithmetic ──
const NOW = Date.parse('2026-01-15T12:00:00.000Z')
assert.ok(isSnapshotFresh({ at: '2026-01-15T11:59:00.000Z' }, NOW), 'a minute-old snapshot is fresh')
assert.ok(isSnapshotFresh({ at: NOW - DEFAULT_CONTINUE_FRESHNESS_MS }, NOW), 'exactly at the window edge is still fresh')
assert.ok(!isSnapshotFresh({ at: NOW - DEFAULT_CONTINUE_FRESHNESS_MS - 1 }, NOW), 'one ms past the window is stale')
assert.ok(!isSnapshotFresh({ at: 'not-a-timestamp' }, NOW), 'unparseable timestamps fail closed')
assert.ok(!isSnapshotFresh({ at: undefined }, NOW), 'missing timestamps fail closed')
assert.ok(!isSnapshotFresh({ at: NOW + 60_001 }, NOW), 'future-dated snapshots beyond clock skew are not fresh')
assert.ok(isSnapshotFresh({ at: NOW + 30_000 }, NOW), 'small clock skew is tolerated')

// Window overrides clamp into the shared bounds.
assert.equal(clampContinueFreshnessMs(0), DEFAULT_CONTINUE_FRESHNESS_MS)
assert.equal(clampContinueFreshnessMs(1_000), MIN_CONTINUE_FRESHNESS_MS)
assert.equal(clampContinueFreshnessMs(99 * 60 * 60_000), MAX_CONTINUE_FRESHNESS_MS)

// ── Snapshots are stamped at build time, so freshly built ones are fresh ──
const snap = buildContinueGoalSnapshot({
  objective: '修好匯出流程',
  definitionOfDone: '匯出按鈕可用',
  loopType: 'Goal-based',
  steps: [{ description: '重現錯誤' }],
  missing: ['匯出仍失敗'],
  lastStatus: 'failed',
})
assert.ok(isSnapshotFresh({ at: snap.at }), 'a just-built snapshot must be fresh')

// ── Shared loop bounds: renderer config and Host admission clamp identically ──
assert.equal(PI_MAX_ITERATIONS, 32, 'the agreed long-run ceiling is 32 rounds')
assert.equal(clampPiIterations(99), PI_MAX_ITERATIONS)
assert.equal(clampPiIterations(0), 1)
assert.equal(clampPiIterations(undefined), 1)

// Drift guards: both clamp sites must use the shared module, not private literals.
const piHostRun = await readFile(resolve(import.meta.dirname, '../src/agent/piHostRun.ts'), 'utf8')
const hostProtocol = await readFile(resolve(import.meta.dirname, '../electron/piHostProtocol.ts'), 'utf8')
const orchestration = await readFile(resolve(import.meta.dirname, '../electron/piOrchestrationExtension.ts'), 'utf8')
assert.match(piHostRun, /clampPiIterations\(/, 'renderer run config must use the shared clamp')
assert.doesNotMatch(piHostRun, /Math\.min\(8/, 'the old 8-round ceiling must not come back renderer-side')
assert.match(hostProtocol, /clampPiIterations\(/, 'Host turn admission must use the shared clamp')
assert.doesNotMatch(hostProtocol, /Math\.min\(8/, 'the old 8-round ceiling must not come back host-side')
assert.match(orchestration, /clampPiIterations\(input\.maxIterations/, 'builtin orchestration must use the shared clamp')
assert.doesNotMatch(orchestration, /Math\.min\(8/, 'builtin orchestration must not define a private 8-round ceiling')

// Drift guard: continueGoal admission must consult the freshness window.
const coordinator = await readFile(resolve(import.meta.dirname, '../src/agent/taskRunCoordinator.ts'), 'utf8')
assert.match(coordinator, /isSnapshotFresh\(/, 'continueGoal admission must gate on snapshot freshness')
assert.match(coordinator, /殭屍續跑/, 'a stale snapshot must degrade with an explicit user-facing note')

console.log('smoke-auto-continue-freshness: all assertions passed')
