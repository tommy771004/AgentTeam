import { strict as assert } from 'node:assert'
import { PiHostSupervisor } from '../electron/piHostSupervisor.ts'
import { PiHostAttachmentJournal, PI_HOST_ATTACHMENT_MAX_SUMMARY_BYTES } from '../electron/piHostAttachment.ts'
import type { TurnRecordEntry } from '../src/agent/turnRecord.ts'

class FakeChild {
  private listeners = new Map<string, Array<(...args: any[]) => void>>()
  on(event: string, listener: (...args: any[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), listener])
  }
  postMessage(message: { id: number; method: string }) {
    const result = message.method === 'initialize'
      ? { protocolVersion: 2, capabilities: ['turns'], status: 'ready' }
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
const tool = await supervisor.executeTool('read', { cwd: '/tmp', path: 'hello.txt' })
assert.equal(tool.tool, 'read')
assert.equal(events.length, 1)
firstChild?.exit(1)
for (let attempt = 0; attempt < 20 && spawnCount < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10))
assert.equal(spawnCount, 2)
assert.equal(supervisor.status().state, 'ready')
supervisor.stop()
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
boundedSupervisor.stop()

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
const terminal = journal.settle('run-1', 'answered', '字'.repeat(70_000), 4)
assert.ok(new TextEncoder().encode(terminal?.summary || '').byteLength <= PI_HOST_ATTACHMENT_MAX_SUMMARY_BYTES)
assert.equal(journal.acknowledge('run-1'), true)
assert.equal(journal.acknowledge('run-1'), true)
assert.equal(journal.get('run-1'), undefined)
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
