import assert from 'node:assert/strict'
import {
  buildHandoffAvailability,
  buildHandoffDocument,
  buildComposerRunOverrides,
  resolveComposerApprovalMode,
} from '../src/agent/composerRunControls.ts'
import {
  clearRunQueue,
  enqueueExternalRun,
  listQueuedRuns,
  resetRunQueueForTests,
} from '../src/agent/runQueue.ts'

function test(name: string, run: () => void) {
  run()
  console.log(`✓ ${name}`)
}

test('composer selection overrides the Settings default for one submitted run', () => {
  assert.equal(resolveComposerApprovalMode('auto', 'always'), 'always')
  assert.equal(resolveComposerApprovalMode('full', undefined), 'full')
  assert.deepEqual(buildComposerRunOverrides('auto', 'always'), { approvalMode: 'always' })
})

test('handoff is unavailable when the current thread has no Artifact Index', () => {
  assert.deepEqual(buildHandoffAvailability(null, 'thread-a'), {
    available: false,
    reason: '此對話尚無 Artifact Index。完成可索引的任務後才能建立 Handoff。',
  })
})

test('an Artifact Index from another thread cannot power this Handoff', () => {
  assert.equal(
    buildHandoffAvailability(
      { threadId: 'thread-b', runId: 'run-b', entries: [{ id: 'x', type: 'diff', status: 'complete', source: 'x', at: 'now' }] },
      'thread-a',
    ).available,
    false,
  )
})

test('handoff only references indexed evidence and preserves run/thread identity', () => {
  const document = buildHandoffDocument({
    threadId: 'thread-a',
    runId: 'run-a',
    index: {
      threadId: 'thread-a',
      runId: 'run-a',
      entries: [
        {
          id: 'diff-1',
          type: 'diff',
          status: 'complete',
          source: 'app/src/App.tsx',
          revision: 2,
          digest: 'sha256:abc',
          at: '2026-07-19T03:00:00.000Z',
        },
      ],
    },
  })

  assert.match(document, /thread-a/)
  assert.match(document, /run-a/)
  assert.match(document, /app\/src\/App\.tsx/)
  assert.match(document, /sha256:abc/)
  assert.doesNotMatch(document, /secret transcript payload/i)
})

test('queued composer runs persist the captured approval mode', () => {
  class MemoryStorage implements Storage {
    private values = new Map<string, string>()
    get length() { return this.values.size }
    clear() { this.values.clear() }
    getItem(key: string) { return this.values.get(key) || null }
    key(index: number) { return [...this.values.keys()][index] || null }
    removeItem(key: string) { this.values.delete(key) }
    setItem(key: string, value: string) { this.values.set(key, value) }
  }

  const previous = globalThis.localStorage
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  try {
    resetRunQueueForTests()
    enqueueExternalRun({
      runId: 'run-queued',
      objective: 'queued composer task',
      sourceKind: 'composer',
      overrides: { approvalMode: 'always' },
    })
    assert.equal(listQueuedRuns()[0]?.overrides?.approvalMode, 'always')
    assert.equal(
      JSON.parse(storage.getItem('subagents.runQueue.v1') || '{}').items[0].overrides.approvalMode,
      'always',
    )
    clearRunQueue()
  } finally {
    resetRunQueueForTests()
    if (previous) Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previous })
    else delete (globalThis as { localStorage?: Storage }).localStorage
  }
})
