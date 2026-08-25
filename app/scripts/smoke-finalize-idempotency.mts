/**
 * Finalization runs at most once per run, and the capacity slot is always let go.
 *
 * The sequence writes a terminal journal marker, notifies onSettled (which is
 * how scheduler / webhook settlement fires) and archives the run. Re-entering
 * it — the outer catch used to do exactly that when a step threw — would
 * publish two contradictory endings for one run and settle downstream
 * automation twice. A per-run claim makes the second entry a no-op that
 * returns the first result, and release rides a finally so a thrown sequence
 * cannot strand a slot.
 *
 * Real seam: the shipped `finalizeTaskRun` against the real stores and journal.
 *
 * Run: node --experimental-strip-types scripts/smoke-finalize-idempotency.mts
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

const { finalizeTaskRun } = await import('../src/agent/taskRunCoordinator.ts')
const { useAgentStore } = await import('../src/store/agentStore.ts')
const { useThreadStore } = await import('../src/store/threadStore.ts')
const { useSettingsStore } = await import('../src/store/settingsStore.ts')
const { getJournalEntry, listJournalEntries } = await import('../src/agent/runJournal.ts')
const { clearRunQueue, listQueuedRuns } = await import('../src/agent/runQueue.ts')

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

const settings = () => useSettingsStore.getState().settings

function reserved(runId: string): boolean {
  return useAgentStore.getState().activeRunIds.includes(runId)
}

function hasEnding(runId: string): boolean {
  const entry = getJournalEntry('run', runId)
  return Boolean(entry && ['success', 'failed', 'cancelled', 'interrupted'].includes(entry.status))
}

function terminalBubbles(threadId: string): string[] {
  return (useThreadStore.getState().threads.find((t) => t.id === threadId)?.bubbles || [])
    .map((b) => b.content)
}

console.log('smoke-finalize-idempotency')

await test('a second finalization of the same run is a no-op returning the first result', async () => {
  useAgentStore.getState().reset()
  clearRunQueue()
  const tid = useThreadStore.getState().createThread({ title: '冪等測試' })
  const runId = 'run_idem_1'
  useAgentStore.getState().reserveRun(runId, tid, 'builtin')

  const settled: string[] = []
  const input = {
    runId,
    threadId: tid,
    objective: '第一次結算',
    settings: settings(),
    onSettled: (r: { status?: string }) => { settled.push(String(r.status)) },
    early: { error: '執行失敗：first' },
  }

  const first = await finalizeTaskRun(input)
  const before = terminalBubbles(tid).length
  const second = await finalizeTaskRun({ ...input, early: { error: '執行失敗：second' } })

  assert.equal(second, first, 'the re-entry returns the very first result object')
  assert.equal(settled.length, 1, `onSettled must fire exactly once, fired ${settled.length}`)
  assert.equal(
    terminalBubbles(tid).length,
    before,
    're-entry must not push a second terminal bubble',
  )
  assert.ok(
    !terminalBubbles(tid).some((b) => b.includes('second')),
    'the second reason must never reach the thread',
  )
  assert.equal(getJournalEntry('run', runId)?.status, 'failed', 'one terminal journal record')
  assert.equal(
    listJournalEntries().filter((e) => e.kind === 'run' && e.id === runId).length,
    1,
    'exactly one journal record for the run',
  )
  assert.equal(reserved(runId), false, 'the capacity slot was released')
})

await test('a sequence that throws mid-way still settles each effect exactly once', async () => {
  useAgentStore.getState().reset()
  clearRunQueue()
  const tid = useThreadStore.getState().createThread({ title: '中途拋錯' })
  const runId = 'run_idem_throw'
  useAgentStore.getState().reserveRun(runId, tid, 'builtin')

  // Break one unguarded step of the sequence, the way a store/bridge fault
  // would: the run must still end, exactly once, with its slot given back.
  const store = useThreadStore.getState()
  const realSetAwaitingReply = store.setAwaitingReply
  let settledCount = 0
  useThreadStore.setState({
    setAwaitingReply: () => {
      throw new Error('thread store fault mid-finalization')
    },
  })

  let result: { status?: string; error?: string }
  try {
    result = await finalizeTaskRun({
      runId,
      threadId: tid,
      objective: '中途拋錯的結算',
      settings: settings(),
      onSettled: () => { settledCount += 1 },
      dispatchResult: { path: 'builtin', status: 'success', result: '完成' },
    })
  } finally {
    useThreadStore.setState({ setAwaitingReply: realSetAwaitingReply })
  }

  assert.ok(result, 'a thrown sequence still resolves to a result instead of rejecting')
  assert.equal(result.status, 'failed')
  assert.match(
    String(result.error),
    /thread store fault mid-finalization/,
    'the injected fault really reached the sequence — otherwise this test proves nothing',
  )
  assert.equal(reserved(runId), false, 'a thrown sequence must not strand the capacity slot')
  // Exactly once, not at most once: a run whose finalization died still owes
  // the user an ending and owes downstream automation its settlement.
  assert.equal(settledCount, 1, `onSettled must fire exactly once, fired ${settledCount}`)
  assert.ok(
    hasEnding(runId),
    'the closeout writes the terminal journal record the throw prevented',
  )
  assert.ok(
    terminalBubbles(tid).some((b) => b.includes('thread store fault mid-finalization')),
    'the thread is told how the run ended',
  )
  const journalAfterThrow = JSON.stringify(getJournalEntry('run', runId) ?? null)

  // The outer catch in runTask re-enters finalization on exactly this shape.
  const settledBefore = settledCount
  const bubblesBefore = terminalBubbles(tid).length
  const again = await finalizeTaskRun({
    runId,
    threadId: tid,
    objective: '中途拋錯的結算',
    settings: settings(),
    onSettled: () => { settledCount += 1 },
    early: { error: '執行失敗：thread store fault mid-finalization' },
  })
  assert.equal(again, result, 're-entry returns the first outcome')
  assert.equal(settledCount, settledBefore, 'onSettled must not fire a second time')
  assert.equal(settledCount, 1, 'still exactly one settlement for the run')
  assert.equal(
    terminalBubbles(tid).length,
    bubblesBefore,
    'no second terminal bubble after the re-entry',
  )
  assert.equal(
    JSON.stringify(getJournalEntry('run', runId) ?? null),
    journalAfterThrow,
    'the re-entry must not write a second, contradictory ending into the journal',
  )
  assert.equal(
    listJournalEntries().filter((e) => e.kind === 'run' && e.id === runId).length,
    1,
    'exactly one journal record per run',
  )
  assert.equal(reserved(runId), false, 'still released, exactly once')
})

await test('the queue still drains from finalization, and only from there', async () => {
  useAgentStore.getState().reset()
  clearRunQueue()
  const tid = useThreadStore.getState().createThread({ title: 'drain' })
  const runId = 'run_idem_drain'
  useAgentStore.getState().reserveRun(runId, tid, 'builtin')
  await finalizeTaskRun({
    runId,
    threadId: tid,
    objective: 'drain 測試',
    settings: settings(),
    early: { error: '執行失敗：drain' },
  })
  assert.equal(listQueuedRuns().length, 0, 'nothing queued, nothing to drain')
  assert.equal(reserved(runId), false)
})

await test('drift guard: one claim gate, release and drain in a finally', () => {
  const coordinator = read('src/agent/taskRunCoordinator.ts')
  assert.match(
    coordinator,
    /export async function finalizeTaskRun/,
    'the public finalization seam still exists',
  )
  assert.match(
    coordinator,
    /finalizationClaims/,
    'finalization is claimed per run, not left to caller discipline',
  )
  const gate = coordinator.slice(
    coordinator.indexOf('export async function finalizeTaskRun'),
    coordinator.indexOf('async function runFinalizationSequence'),
  )
  assert.ok(gate.length > 0, 'the claim gate and the sequence are separate functions')
  assert.match(gate, /finally\s*\{/, 'release/drain ride a finally, not a step of the sequence')
  assert.match(gate, /releaseRunCapacity/, 'the claim holder owns release')
  assert.match(gate, /drainOnce|drainExternalRunQueue/, 'the claim holder owns the single drain')

  const sequence = coordinator.slice(coordinator.indexOf('async function runFinalizationSequence'))
  const stray = sequence.slice(0, sequence.indexOf('export async function finalizeRecoveredExternalRun'))
  assert.ok(
    !/await releaseRunCapacity\(/.test(stray),
    'the sequence must not release capacity itself — the claim holder does',
  )
  assert.equal(
    (stray.match(/thr\.setThreadRunning\(tid, false, runId\)/g) || []).length,
    2,
    'one setThreadRunning per terminal path (early + normal), no redundant second call',
  )
})

console.log(`\n${passed} tests passed`)
