import assert from 'node:assert/strict'
import {
  consumeRecoveryReports,
  getJournalEntry,
  recordQueueDispatching,
  recordQueueEnqueued,
  recordQueueTerminal,
  recordRunAdmitted,
  recordRunStarted,
  recordRunTerminal,
  recordScheduleStatus,
  reconcileStartup,
  resetRunJournalForTests,
} from '../src/agent/runJournal.ts'
import {
  drainExternalRunQueue,
  enqueueExternalRun,
  hydrateRunQueue,
  listQueuedRuns,
  resetRunQueueForTests,
} from '../src/agent/runQueue.ts'

class MemoryStorage {
  private values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value))
  }
}

const memory = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true })
Object.defineProperty(globalThis, 'window', {
  value: { subagents: {} },
  configurable: true,
})
resetRunJournalForTests()

recordRunAdmitted({ runId: 'run-crash', objective: 'recover me', sourceKind: 'composer' })
recordRunStarted({ runId: 'run-crash', threadId: 'thread-crash' })
const report = reconcileStartup()
assert.ok(report)
assert.equal(report.items[0]?.action, 'marked-interrupted')
assert.equal(getJournalEntry('run', 'run-crash')?.status, 'interrupted')

recordRunAdmitted({ runId: 'run-complete', objective: 'do not replay' })
recordRunStarted({ runId: 'run-complete', threadId: 'thread-complete' })
recordRunTerminal({ runId: 'run-complete', threadId: 'thread-complete', status: 'success' })
assert.equal(reconcileStartup(), null)
assert.equal(getJournalEntry('run', 'run-complete')?.status, 'success')

// Pi Host is the execution authority after a renderer reload. Host-recognized
// active/terminal attachments must survive startup reconciliation; only a run
// absent from both sets is honestly marked interrupted.
resetRunJournalForTests()
recordRunAdmitted({ runId: 'host-active', objective: 'still running' })
recordRunStarted({ runId: 'host-active', threadId: 'thread-host' })
assert.equal(
  reconcileStartup({ activeRunIds: new Set(['host-active']), terminalRunIds: new Set() }),
  null,
)
assert.equal(getJournalEntry('run', 'host-active')?.status, 'running')
recordRunAdmitted({ runId: 'host-terminal', objective: 'finished while away' })
recordRunStarted({ runId: 'host-terminal', threadId: 'thread-host' })
assert.equal(
  reconcileStartup({ activeRunIds: new Set(['host-active']), terminalRunIds: new Set(['host-terminal']) }),
  null,
)
assert.equal(getJournalEntry('run', 'host-terminal')?.status, 'running')
recordRunAdmitted({ runId: 'renderer-died', objective: 'no Host witness' })
recordRunStarted({ runId: 'renderer-died', threadId: 'thread-missing' })
assert.ok(reconcileStartup({ activeRunIds: new Set(['host-active']), terminalRunIds: new Set(['host-terminal']) })?.items.some((item) => item.id === 'renderer-died'))
assert.equal(getJournalEntry('run', 'renderer-died')?.status, 'interrupted')

recordQueueEnqueued({ queueId: 'queue-safe', runId: 'run-safe', objective: 'queued once', sourceKind: 'schedule' })
assert.equal(getJournalEntry('queue', 'queue-safe')?.status, 'queued')
// A queued item may resume once; once it is claimed, an interruption is never
// silently replayed because the dispatch marker survives process termination.
recordQueueDispatching({ queueId: 'queue-safe', runId: 'run-safe' })
const queueReport = reconcileStartup()
assert.ok(queueReport?.items.some((item) => item.id === 'queue-safe'))
assert.equal(getJournalEntry('queue', 'queue-safe')?.status, 'interrupted')
recordQueueTerminal({ queueId: 'queue-safe', status: 'success' })
assert.equal(getJournalEntry('queue', 'queue-safe')?.status, 'success')

// A corrupt primary is restored from the last-known-good journal backup.
recordRunAdmitted({ runId: 'run-backup', objective: 'backup' })
recordRunStarted({ runId: 'run-backup', threadId: 'thread-backup' })
memory.setItem('subagents.runJournal.v1', '{broken')
assert.equal(getJournalEntry('run', 'run-backup')?.status, 'admitted')
assert.ok(consumeRecoveryReports().some((entry) => entry.items.some((item) => item.action === 'restored')))

// If both copies are corrupt, the invalid payload is quarantined and startup
// still returns a usable empty state rather than silently pretending history
// never existed.
memory.setItem('subagents.runJournal.v1', '{primary-broken')
memory.setItem('subagents.runJournal.v1.backup', '{backup-broken')
assert.equal(getJournalEntry('run', 'missing') ?? null, null)
const quarantineReports = consumeRecoveryReports()
assert.ok(quarantineReports.some((entry) => entry.items.some((item) => item.action === 'quarantined')))

// Valid JSON with an invalid enum/schema is still corrupt: restore the backup
// or quarantine it instead of silently accepting an empty/unknown state.
resetRunJournalForTests()
recordRunAdmitted({ runId: 'run-semantic', objective: 'semantic backup' })
recordRunStarted({ runId: 'run-semantic', threadId: 'thread-semantic' })
const validBackup = memory.getItem('subagents.runJournal.v1')
memory.setItem(
  'subagents.runJournal.v1',
  JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), entries: [{ id: 'bad', kind: 'run', status: 'unknown' }] }),
)
assert.equal(getJournalEntry('run', 'run-semantic')?.status, 'admitted')
assert.ok(consumeRecoveryReports().some((entry) => entry.items.some((item) => item.action === 'restored')))
assert.ok(validBackup)

// The parser rebuilds an allowlisted bounded entry instead of retaining an
// arbitrary prompt/tool payload from localStorage.
const safeEntry = getJournalEntry('run', 'run-semantic')
assert.ok(safeEntry)
assert.equal('secret' in safeEntry, false)

// Active markers remain bounded but are never evicted in favour of older
// terminal records. This protects crash reconciliation after a busy session.
for (let i = 0; i < 305; i += 1) {
  recordRunAdmitted({ runId: `active-${i}`, objective: `active ${i}` })
}
const retained = JSON.parse(memory.getItem('subagents.runJournal.v1') || '{}')
assert.ok(retained.entries.length <= 300)
assert.equal(getJournalEntry('run', 'active-304')?.status, 'admitted')

// Exercise the real queue drain boundary: the item is marked dispatching and
// removed from persisted queue state before a deferred runner settles. A
// fresh queue hydrate sees the stale copy plus interrupted marker and refuses
// to replay it.
resetRunJournalForTests()
resetRunQueueForTests()
memory.setItem('subagents.runQueue.v1', JSON.stringify({ v: 1, items: { invalid: true } }))
assert.equal(hydrateRunQueue(), 0)
assert.ok(consumeRecoveryReports().some((entry) => entry.items.some((item) => item.action === 'quarantined')))
resetRunQueueForTests()
memory.removeItem('subagents.runQueue.v1')
memory.removeItem('subagents.runQueue.v1.backup')
const queued = enqueueExternalRun({ runId: 'run-drain', objective: 'deferred drain', sourceKind: 'composer' })
assert.ok(queued)
const staleQueuePayload = memory.getItem('subagents.runQueue.v1')
let releaseRunner!: () => void
let runnerStarted!: () => void
const started = new Promise<void>((resolve) => { runnerStarted = resolve })
const release = new Promise<void>((resolve) => { releaseRunner = resolve })
const draining = drainExternalRunQueue(async () => {
  runnerStarted()
  await release
  return { path: 'builtin', status: 'success', threadId: null, runId: 'run-drain' }
})
await started
assert.equal(getJournalEntry('queue', queued!.id)?.status, 'dispatching')
assert.ok(staleQueuePayload)
memory.setItem('subagents.runQueue.v1', staleQueuePayload!)
reconcileStartup()
resetRunQueueForTests()
assert.equal(hydrateRunQueue(), 0)
assert.equal(listQueuedRuns().length, 0)
releaseRunner()
await draining

recordScheduleStatus('schedule-smoke', 'running', 'run-drain')
assert.equal(getJournalEntry('schedule', 'schedule-smoke')?.status, 'running')
assert.equal(reconcileStartup()?.items.some((item) => item.kind === 'schedule'), true)

console.log('Run journal smoke: crash reconciliation, queue exactly-once marker, and corrupt-state recovery passed')
