/**
 * Steer must never lose the user's new goal.
 *
 * A safe park stops at the next tool boundary, so the previous run routinely
 * outlives the coordinator's wait window. When that happens the new objective
 * takes the queue the busy policy already owns instead of being answered with
 * `busy`, and the thread bubble says which of the three things actually
 * happened. Only a steer with nothing abortable behind it may report busy.
 *
 * Real seam: this drives the shipped `runTask` admission path against the real
 * agent / thread / settings stores and the real run queue.
 *
 * Run: node --experimental-strip-types scripts/smoke-steer-enqueue-fallback.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.join(appRoot, rel), 'utf8')

class MemoryStorage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })
Object.defineProperty(globalThis, 'window', { value: { subagents: {} }, configurable: true })

const { formatSteerNotice, steerOutcomeSummary, buildSteerPartialDigest } = await import(
  '../src/agent/taskRunPolicy.ts',
)
const { runTask } = await import('../src/agent/taskRunCoordinator.ts')
const { useAgentStore } = await import('../src/store/agentStore.ts')
const { useThreadStore } = await import('../src/store/threadStore.ts')
const { useSettingsStore } = await import('../src/store/settingsStore.ts')
const { listQueuedRuns, clearRunQueue } = await import('../src/agent/runQueue.ts')

let passed = 0
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++
      console.log(`  ✓ ${name}`)
    })
    .catch((e) => {
      console.error(`  ✗ ${name}`)
      throw e
    })
}

function resetWorld(followUpMode: 'steer' | 'queue' = 'steer') {
  useAgentStore.getState().reset()
  clearRunQueue()
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      followUpMode,
      maxConcurrentRuns: 2,
    },
  })
}

function bubbles(threadId: string): string[] {
  return (useThreadStore.getState().threads.find((t) => t.id === threadId)?.bubbles || [])
    .filter((b) => b.role === 'system')
    .map((b) => b.content)
}

console.log('smoke-steer-enqueue-fallback')

await test('notice wording: every branch is honest, partial digest kept in all of them', () => {
  const partial = '目標：改寫 README\n進度：40%'
  const tookOver = formatSteerNotice({ outcome: 'took-over', runningTitle: '舊任務', partial })
  const queued = formatSteerNotice({
    outcome: 'queued',
    runningTitle: '舊任務',
    partial,
    queuePosition: 2,
    queueTotal: 3,
  })
  const stuck = formatSteerNotice({ outcome: 'not-abortable', runningTitle: '舊任務', partial })
  const refused = formatSteerNotice({ outcome: 'aborted-not-queued', runningTitle: '舊任務', partial })
  assert.match(refused, /已中止前一個任務/)
  assert.match(refused, /佇列已滿或重複/)
  for (const outcome of ['took-over', 'queued', 'aborted-not-queued', 'not-abortable'] as const) {
    const shape = { outcome, runningTitle: '舊任務', partial, queuePosition: 2, queueTotal: 3 }
    assert.ok(
      formatSteerNotice(shape).startsWith(steerOutcomeSummary(shape)),
      `${outcome}: bubble and returned sentence must not drift apart`,
    )
  }

  assert.match(tookOver, /已中止/)
  assert.ok(!/佇列/.test(tookOver), 'a real steer must not mention a queue it never used')
  assert.match(queued, /已中止/)
  assert.match(queued, /佇列第 2 位/, 'the queue position is the fact the user needs')
  assert.match(stuck, /無法中止/)
  assert.ok(!/已中止前一個任務/.test(stuck), 'never claim an abort that did not happen')

  for (const [label, text] of [
    ['took-over', tookOver],
    ['queued', queued],
    ['aborted-not-queued', refused],
    ['not-abortable', stuck],
  ]) {
    assert.match(text, /### 中止前摘要/, `${label} keeps the partial digest heading`)
    assert.ok(text.includes(partial), `${label} keeps the partial digest body`)
  }
})

await test('notice wording: an empty digest leaves no dangling heading', () => {
  const text = formatSteerNotice({ outcome: 'took-over' })
  assert.ok(!/中止前摘要/.test(text), 'no heading without a summary under it')
  assert.equal(buildSteerPartialDigest({ steps: [], toolCalls: [] } as never), '')
})

await test('steer whose previous run will not stop: objective is queued, never dropped', async () => {
  resetWorld('steer')
  const tid = useThreadStore.getState().createThread({ title: '轉向測試' })
  // A parked run that has not reached its tool boundary: reserved, told to
  // stop, and still holding its slot when the wait window expires.
  assert.equal(useAgentStore.getState().reserveRun('run_stuck', tid, 'builtin'), true)

  const objective = '改成先寫測試再改實作'
  const result = await runTask({ sourceKind: 'composer', objective, reuseThreadId: tid })

  assert.equal(result.skipReason, 'queued', `expected queued, got ${result.skipReason}`)
  assert.equal(result.queued, true)
  assert.ok(result.queueId, 'a queue id proves the objective is really parked in the queue')
  assert.equal(result.threadId, tid)

  const queued = listQueuedRuns()
  assert.equal(queued.length, 1, 'exactly one queue entry')
  assert.equal(queued[0]?.objective, objective, 'the queued item carries the new goal verbatim')
  assert.ok(queued[0]?.dedupeKey, 'the queue entry keeps its dedupe key')

  const systemBubbles = bubbles(tid)
  assert.ok(
    systemBubbles.some((b) => b.startsWith(String(result.error))),
    'the returned error is the same sentence the thread was given',
  )
  assert.ok(
    systemBubbles.some((b) => /已中止/.test(b) && /佇列第 1 位/.test(b)),
    `thread must say aborted + queued, got: ${JSON.stringify(systemBubbles)}`,
  )
  assert.ok(
    !systemBubbles.some((b) => /新目標已接手/.test(b)),
    'never claim the steer took over when it did not',
  )
})

await test('steer with nothing abortable behind it is the one honest busy', async () => {
  resetWorld('steer')
  // Global capacity is spent by two other conversations; this thread has no
  // run of its own, so there is nothing to abort.
  const otherA = useThreadStore.getState().createThread({ title: '別的對話 A' })
  const otherB = useThreadStore.getState().createThread({ title: '別的對話 B' })
  useAgentStore.getState().reserveRun('run_a', otherA, 'builtin')
  useAgentStore.getState().reserveRun('run_b', otherB, 'builtin')
  const tid = useThreadStore.getState().createThread({ title: '空的對話' })

  const result = await runTask({
    sourceKind: 'composer',
    objective: '這個對話沒有在跑的任務',
    reuseThreadId: tid,
  })

  assert.equal(result.skipReason, 'busy', `expected busy, got ${result.skipReason}`)
  assert.equal(listQueuedRuns().length, 0, 'nothing was aborted, so nothing is queued')
  assert.match(
    String(result.error),
    /無法中止前一個任務/,
    'busy must say why, not fall through to the generic capacity line',
  )
  assert.ok(
    bubbles(tid).some((b) => /無法中止前一個任務/.test(b)),
    'the thread and the caller are told the same thing',
  )
})

await test('automation follow-ups keep queueing, untouched by the steer branch', async () => {
  resetWorld('steer')
  const tid = useThreadStore.getState().createThread({ title: '排程對話' })
  useAgentStore.getState().reserveRun('run_sched', tid, 'builtin')

  const result = await runTask({
    sourceKind: 'webhook',
    objective: 'webhook 觸發的後續任務',
    reuseThreadId: tid,
  })

  assert.equal(result.skipReason, 'queued', 'automation overflow still queues')
  assert.equal(listQueuedRuns().length, 1)
  assert.equal(listQueuedRuns()[0]?.sourceKind, 'webhook')
})

await test('drift guard: the steer branch enqueues instead of falling through to busy', () => {
  const coordinator = read('src/agent/taskRunCoordinator.ts')
  const steer = coordinator.slice(
    coordinator.indexOf("if (policy === 'steer'"),
    coordinator.indexOf("} else if (policy === 'queue'"),
  )
  assert.ok(steer.length > 0, 'the steer branch must still be identifiable')
  assert.match(steer, /enqueueExternalRun/, 'the timeout fallback is the existing queue mechanism')
  assert.match(steer, /formatSteerNotice/, 'every branch speaks through one formatter')
  assert.match(steer, /steerOutcomeSummary/, 'and returns that same sentence to the caller')
  assert.ok(
    !/並行執行上限/.test(steer),
    'the steer branch must never answer with the generic capacity wording',
  )
})

await test('CLAUDE.md busy policy documents the steer timeout fallback', () => {
  const guidance = fs.readFileSync(path.join(appRoot, '..', 'CLAUDE.md'), 'utf8')
  const busy = guidance.slice(guidance.indexOf('**Busy policy.**')).slice(0, 900)
  assert.match(busy, /steer/i, 'the steer policy still lives here')
  assert.match(
    busy,
    /queues instead of reporting busy|enqueue|queue fallback/i,
    'the timeout fallback must be written down, not just the happy path',
  )
  assert.match(busy, /busy/i)
})

console.log(`\n${passed} tests passed`)
