/**
 * Production coordinator queue scenario for issue 08.
 *
 * This deliberately enters twice through runTask. The first Pi Host turn is
 * held at the shipped `piHost.turn.submit` bridge; the second call is parked
 * by the coordinator and is dispatched only by its normal finalization drain.
 * The test never calls Host runs/enqueue/claim and never submits B itself.
 *
 * Run: node --experimental-strip-types scripts/smoke-run-task-same-thread-queue.mts
 */
import assert from 'node:assert/strict'

class MemoryStorage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

/** An injectable, deterministic scheduler for observing async coordinator turns. */
class FakeScheduler {
  ticks = 0
  async yield(): Promise<void> {
    this.ticks += 1
    await Promise.resolve()
  }

  async until(predicate: () => boolean, limit = 200): Promise<void> {
    for (let i = 0; i < limit && !predicate(); i += 1) await this.yield()
    assert.equal(predicate(), true, `scheduler exhausted after ${this.ticks} ticks`)
  }
}

type SubmitInput = {
  sessionId: string
  prompt: string
  runId?: string
  [key: string]: unknown
}

const storage = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
const scheduler = new FakeScheduler()
let releaseA!: () => void
const aReleased = new Promise<void>((resolve) => { releaseA = resolve })
let instructionRevision = 1
const submissions: Array<SubmitInput & { revision: number }> = []
const session = { id: 'pi-session-run-task-queue', title: 'queue scenario', threadId: 'thread-run-task-queue' }

// This is the shipped Pi Host protocol surface consumed by submitPiHostRun.
// Only the turn bridge is instrumented; there is intentionally no runs queue,
// claim, or enqueue method available to this smoke.
const piHostBridge = {
  sessions: {
    list: async () => ({ sessions: [session] }),
    create: async () => ({ sessionId: session.id, sessions: [session] }),
  },
  instructions: {
    get: async () => ({ instructions: { revision: instructionRevision } }),
    migrateLegacy: async () => ({ migrated: false }),
    resolve: async () => ({
      instructionSnapshot: {
        id: `snapshot-${instructionRevision}`,
        revision: instructionRevision,
        effectiveHash: instructionRevision === 1 ? 'old-hash' : 'new-hash',
        effectiveText: instructionRevision === 1 ? 'old instruction' : 'new instruction',
        globalEffectiveText: instructionRevision === 1 ? 'old instruction' : 'new instruction',
        sources: [],
        diagnostics: [],
        usage: { personalizationBytes: 0, projectInstructionBytes: 0, totalBytes: 0, budgetBytes: 120_000 },
      },
    }),
  },
  turn: {
    submit: async (input: SubmitInput) => {
      submissions.push({ ...input, revision: instructionRevision })
      if (submissions.length === 1) await aReleased
      return {
        sessionId: session.id,
        runId: input.runId,
        settlement: 'answered',
        items: [{ type: 'assistant_message', content: `settled ${input.runId}` }],
      }
    },
  },
}

Object.defineProperty(globalThis, 'window', {
  value: { subagents: { piHost: piHostBridge } },
  configurable: true,
})

const { runTask } = await import('../src/agent/taskRunCoordinator.ts')
const { useAgentStore } = await import('../src/store/agentStore.ts')
const { useSettingsStore } = await import('../src/store/settingsStore.ts')
const { useThreadStore } = await import('../src/store/threadStore.ts')
const { clearRunQueue, listQueuedRuns } = await import('../src/agent/runQueue.ts')

useAgentStore.getState().reset()
clearRunQueue()
useSettingsStore.setState({
  settings: {
    ...useSettingsStore.getState().settings,
    maxConcurrentRuns: 1,
    followUpMode: 'queue',
    sessionRecallEnabled: false,
    referenceChatHistory: false,
  },
})
const threadId = useThreadStore.getState().createThread({ title: '同 thread queue scenario' })
session.threadId = threadId
assert.equal(threadId, session.threadId, 'the protocol session is bound to the test thread')

const settledB: Array<{ runId?: string; status?: string; skipped?: boolean }> = []
const runA = runTask({
  sourceKind: 'composer',
  objective: 'Run A holds the real Pi Host turn',
  runId: 'run-task-queue-A',
  reuseThreadId: threadId,
  onSettled: (result) => { settledB.push({ runId: result.runId, status: result.status, skipped: result.skipped }) },
})

await scheduler.until(() => submissions.length === 1)
assert.equal(submissions[0]?.runId, 'run-task-queue-A')
assert.equal(useAgentStore.getState().activeRunIds.includes('run-task-queue-A'), true)

const runB = runTask({
  sourceKind: 'composer',
  objective: 'Run B resolves only at automatic queue admission',
  runId: 'run-task-queue-B',
  reuseThreadId: threadId,
  onSettled: (result) => { settledB.push({ runId: result.runId, status: result.status, skipped: result.skipped }) },
})
const queuedB = await runB
assert.equal(queuedB.queued, true, 'the second run is queued by runTask capacity admission')
assert.equal(queuedB.skipReason, 'queued')
assert.equal(listQueuedRuns().some((item) => item.runId === 'run-task-queue-B'), true)
assert.equal(submissions.length, 1, 'queue admission does not submit B early')

// This mutation occurs while B is parked. The coordinator must not resolve or
// dispatch B until A finalization releases capacity and drains the queue.
instructionRevision = 2
assert.equal(submissions.some((submission) => submission.runId === 'run-task-queue-B'), false)
releaseA()
const resultA = await runA
assert.equal(resultA.status, 'success')

await scheduler.until(() => submissions.length === 2)
assert.equal(submissions[1]?.runId, 'run-task-queue-B')
assert.equal(submissions[1]?.revision, 2, 'B observes mutation at its real admission, not enqueue time')
assert.equal(listQueuedRuns().length, 0, 'production finalization drain consumed B')
await scheduler.until(() => settledB.some((result) => result.runId === 'run-task-queue-B'))
assert.equal(settledB.some((result) => result.runId === 'run-task-queue-B' && result.status === 'success'), true)
await scheduler.until(() => useAgentStore.getState().activeRunIds.length === 0)

console.log(`smoke-run-task-same-thread-queue: ok (A held/released, B auto-dispatched, ticks=${scheduler.ticks})`)
