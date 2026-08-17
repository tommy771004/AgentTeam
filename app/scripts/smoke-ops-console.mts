/**
 * Ops console projection (ticket 12). The queue reason must come from the same
 * `resolveBusyPolicy` decision the coordinator made, not from a constant.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildOpsSnapshot, type OpsSnapshotInput } from '../src/agent/opsConsole.ts'
import { resolveBusyPolicy } from '../src/agent/taskRunTypes.ts'

let passed = 0
const check = (label: string, fn: () => void) => {
  try {
    fn()
  } catch (error) {
    console.error(`smoke-ops-console FAILED: ${label}`)
    throw error
  }
  passed += 1
}

const base = (over: Partial<OpsSnapshotInput> = {}): OpsSnapshotInput => ({
  jobs: [],
  events: [],
  activeRuns: [{ runId: 'run_1', status: 'running' }],
  capacity: { active: 1, limit: 4 },
  queuedRuns: [],
  journal: [],
  recoveryReports: [],
  ...over,
})

const queued = (over: Record<string, unknown> = {}) =>
  ({
    id: 'q_1',
    objective: 'queued work',
    runner: 'builtin',
    enqueuedAt: '2026-08-17T00:00:00.000Z',
    dedupeKey: 'same',
    ...over,
  }) as OpsSnapshotInput['queuedRuns'][number]

check('capacity headroom and dedupe projection', () => {
  const result = buildOpsSnapshot(
    base({
      queuedRuns: [queued({ sourceKind: 'schedule' })],
      dedupeEvents: [
        {
          at: '2026-08-17T00:00:00.000Z',
          dedupeKey: 'same',
          objective: 'duplicate work',
          sourceKind: 'schedule',
          reason: 'duplicate',
        },
      ],
    }),
  )
  assert.equal(result.capacity.remaining, 3)
  assert.equal(result.deduplicated[0]?.reason, 'duplicate')
  assert.equal(result.queue[0]?.position, 1)
})

check('automation sources are queued because of the source, not capacity', () => {
  for (const sourceKind of ['schedule', 'webhook', 'telegram', 'event', 'delegate'] as const) {
    const result = buildOpsSnapshot(base({ queuedRuns: [queued({ sourceKind })] }))
    const item = result.queue[0]
    assert.equal(item?.reason, 'automation-source', `${sourceKind} should queue on source`)
    assert.equal(item?.busyPolicy, 'queue')
    assert.equal(item?.busyPolicy, resolveBusyPolicy(sourceKind, undefined))
    assert.match(String(item?.reasonDetail), new RegExp(`sourceKind=${sourceKind}`))
    assert.match(String(item?.reasonDetail), /busyPolicy=queue/)
  }
})

check('interactive sources name followUpMode as the reason they queued', () => {
  const result = buildOpsSnapshot(
    base({ queuedRuns: [queued({ sourceKind: 'composer' })], followUpMode: 'queue' }),
  )
  assert.equal(result.queue[0]?.reason, 'follow-up-mode')
  assert.equal(result.queue[0]?.busyPolicy, 'queue')
  assert.equal(result.queue[0]?.busyPolicy, resolveBusyPolicy('composer', 'queue'))
})

check('an interactive source that would steer names its real blocker', () => {
  // followUpMode=steer -> policy is steer, so it is here for another reason
  const explicit = buildOpsSnapshot(
    base({
      queuedRuns: [queued({ sourceKind: 'composer', enqueueWhenBusy: true })],
      followUpMode: 'steer',
    }),
  )
  assert.equal(explicit.queue[0]?.busyPolicy, 'steer')
  assert.equal(explicit.queue[0]?.reason, 'explicit-enqueue')

  const capacity = buildOpsSnapshot(
    base({
      queuedRuns: [queued({ sourceKind: 'composer' })],
      followUpMode: 'steer',
      capacity: { active: 4, limit: 4 },
    }),
  )
  assert.equal(capacity.queue[0]?.reason, 'capacity')
  assert.equal(capacity.capacity.remaining, 0)
})

check('exhausted capacity is reported alongside the policy reason', () => {
  const result = buildOpsSnapshot(
    base({ queuedRuns: [queued({ sourceKind: 'schedule' })], capacity: { active: 4, limit: 4 } }),
  )
  assert.equal(result.queue[0]?.reason, 'automation-source')
  assert.match(String(result.queue[0]?.reasonDetail), /併發額度亦已滿/)
})

check('the reason is not a hardcoded constant', () => {
  const source = readFileSync(new URL('../src/agent/opsConsole.ts', import.meta.url), 'utf8')
  assert.match(source, /resolveBusyPolicy/)
  assert.doesNotMatch(source, /reason:\s*'capacity'/)
})

console.log(`smoke-ops-console: ${passed} groups passed`)
