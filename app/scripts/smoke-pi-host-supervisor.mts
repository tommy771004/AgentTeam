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
}

const supervisor = new PiHostSupervisor(() => new FakeChild())
const events: unknown[] = []
supervisor.onEvent((event) => events.push(event))
await supervisor.start()
const cancelled = await supervisor.cancelTurn('supervised-run')
assert.equal(cancelled.settlement, 'cancelled')
const tool = await supervisor.executeTool('read', { cwd: '/tmp', path: 'hello.txt' })
assert.equal(tool.tool, 'read')
assert.equal(events.length, 1)
console.log('Pi Host Supervisor exposes cancellation to Electron callers')
