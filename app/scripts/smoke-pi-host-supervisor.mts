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
      : { runId: 'supervised-run', settlement: 'cancelled' }
    queueMicrotask(() => this.listeners.get('message')?.forEach((listener) => listener({ id: message.id, result })))
  }
  kill() {}
}

const supervisor = new PiHostSupervisor(() => new FakeChild())
await supervisor.start()
const cancelled = await supervisor.cancelTurn('supervised-run')
assert.equal(cancelled.settlement, 'cancelled')
console.log('Pi Host Supervisor exposes cancellation to Electron callers')
