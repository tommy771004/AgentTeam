import { strict as assert } from 'node:assert'
import { PiHostSupervisor } from '../electron/piHostSupervisor.ts'
import { PiHostAttachmentJournal, PI_HOST_ATTACHMENT_MAX_SUMMARY_BYTES } from '../electron/piHostAttachment.ts'
import type { TurnRecordEntry } from '../src/agent/turnRecord.ts'

class FakeChild {
  protected listeners = new Map<string, Array<(...args: any[]) => void>>()
  on(event: string, listener: (...args: any[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), listener])
  }
  postMessage(message: { id: number; method: string }) {
    const result = message.method === 'initialize'
      ? { protocolVersion: 3, capabilities: ['turns', 'attachments-v1'], status: 'ready' }
      : message.method === 'health/get'
        ? { protocolVersion: 3, capabilities: ['turns', 'attachments-v1'], status: 'ready', memoryHealth: { status: 'ready', revision: 0 } }
      : message.method === 'lifecycle/shutdown'
        ? { memoryHealth: { status: 'closed', revision: 0 } }
      : message.method === 'runs/finalize-claim'
        ? { finalizationClaim: { runId: 'supervised-run', claimed: true, owner: true, state: 'claimed', claimEpoch: 1, leaseExpiresAt: 30_000 } }
        : message.method === 'runs/finalize-complete'
          ? { finalizationComplete: { runId: 'supervised-run', completed: true, owner: true, state: 'completed', claimEpoch: 1, leaseExpiresAt: 30_000, completedAt: 1 } }
          : message.method === 'runs/ack'
            ? { runId: 'supervised-run', resolved: true }
      : message.method === 'tools/read'
        ? { tool: 'read', content: [{ type: 'text', text: 'hello' }] }
      : { runId: 'supervised-run', settlement: 'cancelled' }
    queueMicrotask(() => {
      this.listeners.get('message')?.forEach((listener) => listener({ id: message.id, result }))
      if (message.method === 'initialize') this.listeners.get('message')?.forEach((listener) => listener({ event: 'host/tool-update', payload: { runId: 'supervised-run', tool: 'bash', item: {} } }))
    })
  }
  kill() {}
  exit(code = 1) { this.listeners.get('exit')?.forEach((listener) => listener(code, undefined)) }
}

class HangingTurnChild extends FakeChild {
  override postMessage(message: { id: number; method: string }) {
    if (message.method === 'turn/submit' || message.method === 'turn/cancel') return
    super.postMessage(message)
  }
}

class DegradedStorageChild extends FakeChild {
  override postMessage(message: { id: number; method: string }) {
    if (message.method !== 'initialize') return
    queueMicrotask(() => {
      this.listeners.get('message')?.forEach((listener) => listener({
        event: 'host/storage-health',
        payload: {
          status: 'degraded', code: 'sqlite_integrity_failure',
          message: 'integrity failed', recovery: 'preserve-storage', readOnlyExport: false,
        },
      }))
      this.exit(78)
    })
  }
}

let spawnCount = 0
let firstChild: FakeChild | undefined
const supervisor = new PiHostSupervisor(() => {
  const child = new FakeChild()
  spawnCount += 1
  if (!firstChild) firstChild = child
  return child
})
const events: unknown[] = []
supervisor.onEvent((event) => events.push(event))
await supervisor.start()
const cancelled = await supervisor.cancelTurn('supervised-run')
assert.equal(cancelled.settlement, 'cancelled')
const claim = await supervisor.claimRunFinalization('supervised-run', 'renderer-a')
assert.deepEqual(claim, { runId: 'supervised-run', claimed: true, owner: true, state: 'claimed', claimEpoch: 1, leaseExpiresAt: 30_000 })
const complete = await supervisor.completeRunFinalization('supervised-run', 'renderer-a', claim.claimEpoch)
assert.equal(complete.completed, true)
const tool = await supervisor.executeTool('read', { cwd: '/tmp', path: 'hello.txt' })
assert.equal(tool.tool, 'read')
assert.equal(events.length, 1)
firstChild?.exit(1)
for (let attempt = 0; attempt < 20 && spawnCount < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10))
assert.equal(spawnCount, 2)
assert.equal(supervisor.status().state, 'ready')
await supervisor.stop()
assert.equal(supervisor.status().state, 'stopped')

const boundedSupervisor = new PiHostSupervisor(
  () => new HangingTurnChild(),
  { requestTimeoutMs: 50, turnIdleTimeoutMs: 50 },
)
await boundedSupervisor.start()
await assert.rejects(
  boundedSupervisor.submitTurn('session-timeout', 'never settles', 'run-timeout'),
  /Pi Core Host turn\/submit timed out after 50ms/,
)
await boundedSupervisor.stop()

const degradedSupervisor = new PiHostSupervisor(() => new DegradedStorageChild(), { requestTimeoutMs: 50 })
await assert.rejects(degradedSupervisor.start(), /Pi Core Host exited/)
assert.deepEqual(degradedSupervisor.status(), {
  state: 'error', message: 'integrity failed',
  memoryHealth: {
    status: 'degraded', code: 'sqlite_integrity_failure',
    message: 'integrity failed', recovery: 'preserve-storage', readOnlyExport: false,
  },
})
await degradedSupervisor.stop()

const entry = (seq: number): TurnRecordEntry => ({
  kind: seq === 1 ? 'turn-start' : seq === 4 ? 'turn-end' : 'assistant-text',
  source: seq === 1 || seq === 4 ? 'host' : 'model',
  ...(seq === 1 ? {} : seq === 4 ? { settlement: 'answered' as const } : { content: `entry-${seq}` }),
  seq,
  turn: 1,
  step: 1,
  at: seq,
} as TurnRecordEntry)
let now = 10_000
const journal = new PiHostAttachmentJournal({}, undefined, () => now)
journal.begin({ runId: 'run-1', sessionId: 'session-1', threadId: 'thread-1', turn: 1 })
journal.append('run-1', [entry(1), entry(2)])
journal.append('run-1', [entry(2), entry(3)])
assert.deepEqual({ latestSeq: journal.get('run-1')?.latestSeq, total: journal.get('run-1')?.total }, { latestSeq: 3, total: 3 })
const pendingApproval = {
  runId: 'run-1',
  sessionId: 'session-1',
  tool: 'write',
  callId: 'call-approval',
  args: {
    path: 'note.txt',
    content: 'approved content',
    apiKey: 'must-not-reach-renderer',
  },
  reason: 'This tool changes a workspace file',
  timeoutMs: 90_000,
}
journal.setPendingApproval('run-1', pendingApproval)
assert.deepEqual(journal.active()[0]?.pendingApproval, {
  ...pendingApproval,
  args: {
    path: 'note.txt',
    content: 'approved content',
    apiKey: '[redacted]',
  },
})
assert.deepEqual(journal.attach('run-1', [])?.attachment.pendingApproval, journal.active()[0]?.pendingApproval)
journal.clearPendingApproval('run-1', 'call-approval')
assert.equal(journal.get('run-1')?.pendingApproval, undefined)
journal.setPendingApproval('run-1', pendingApproval)
const terminal = journal.settle('run-1', 'answered', '字'.repeat(70_000), 4)
assert.ok(new TextEncoder().encode(terminal?.summary || '').byteLength <= PI_HOST_ATTACHMENT_MAX_SUMMARY_BYTES)
assert.equal(terminal?.pendingApproval, undefined)
const firstClaim = journal.claimFinalization('run-1', 'renderer-a', 100)
assert.deepEqual(firstClaim, { runId: 'run-1', claimed: true, owner: true, state: 'claimed', claimEpoch: 1, leaseExpiresAt: now + 100 })
now += 40
const renewedClaim = journal.claimFinalization('run-1', 'renderer-a', 100)
assert.deepEqual(renewedClaim, {
  runId: 'run-1',
  claimed: true,
  owner: true,
  state: 'claimed',
  claimEpoch: 1,
  leaseExpiresAt: now + 100,
})
assert.deepEqual(journal.claimFinalization('run-1', 'renderer-b', 100), {
  runId: 'run-1',
  claimed: false,
  owner: false,
  state: 'claimed',
  claimEpoch: 1,
  leaseExpiresAt: now + 100,
  reason: 'claimed_by_other',
})
assert.equal(journal.acknowledge('run-1'), false, 'ack cannot release before the app finalizer completes')
assert.deepEqual(journal.completeFinalization('run-1', 'renderer-b', firstClaim.claimEpoch), {
  runId: 'run-1',
  completed: false,
  owner: false,
  state: 'claimed',
  claimEpoch: 1,
  leaseExpiresAt: now + 100,
  reason: 'not_owner',
})
now += 101
const takeover = journal.claimFinalization('run-1', 'renderer-b', 100)
assert.equal(takeover.claimed, true, 'an expired claimant lease is recoverable by a new renderer')
assert.equal(takeover.claimEpoch, 2)
assert.equal(journal.completeFinalization('run-1', 'renderer-b', takeover.claimEpoch).completed, true)
assert.equal(journal.completeFinalization('run-1', 'renderer-a', firstClaim.claimEpoch).completed, true, 'complete is idempotent after ownership changes')
assert.equal(journal.acknowledge('run-1'), true)
assert.equal(journal.acknowledge('run-1'), true)
assert.equal(journal.get('run-1'), undefined)
const long = new PiHostAttachmentJournal({}, undefined, () => now)
long.begin({ runId: 'long', sessionId: 'session-1' })
long.append('long', Array.from({ length: 300 }, (_, index) => entry(index + 1)))
const bounded = long.attach('long', Array.from({ length: 300 }, (_, index) => entry(index + 1)))
assert.equal(bounded?.entries.length, 200)
assert.equal(bounded?.availableFromSeq, 101)
assert.deepEqual(bounded?.gap, { missingBefore: 100, earliestSeq: 101 })
const orphan = new PiHostAttachmentJournal({}, undefined, () => now)
orphan.begin({ runId: 'orphan', sessionId: 'session-1' })
assert.equal(orphan.recoverOrphanedActive()[0]?.settlement, 'interrupted')
assert.equal(orphan.active().length, 0)
for (let index = 0; index < 260; index += 1) {
  const runId = `terminal-${index}`
  journal.begin({ runId, sessionId: 'session-1' })
  journal.settle(runId, 'answered', `summary-${index}`, index + 1)
}
assert.equal(journal.pendingTerminal().length, 256)
console.log('Pi Host Supervisor exposes cancellation to Electron callers')
