import { strict as assert } from 'node:assert'
import { PiHostSupervisor } from '../electron/piHostSupervisor.ts'

class FakeChild {
  private listeners = new Map<string, Array<(...args: any[]) => void>>()
  on(event: string, listener: (...args: any[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), listener])
  }
  postMessage(message: { id: number; method: string }) {
    const result = message.method === 'initialize'
      ? { protocolVersion: 1, capabilities: ['turns'], status: 'ready' }
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
console.log('Pi Host Supervisor exposes cancellation to Electron callers')
