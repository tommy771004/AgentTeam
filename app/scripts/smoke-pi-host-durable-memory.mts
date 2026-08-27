import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import { canonicalProjectId, InMemoryDurableMemoryStore, type MemoryAccessContext } from '../electron/durableMemoryStore.ts'
import { createPiHostServer, PI_HOST_PROTOCOL_VERSION, type PiHostMessage } from '../electron/piHostProtocol.ts'
import { PiHostSupervisor } from '../electron/piHostSupervisor.ts'

type Response = Extract<PiHostMessage, { id: string | number }>

const stateDir = await mkdtemp(join(tmpdir(), 'subagents-pi-memory-v1-'))
const statePath = join(stateDir, 'state.json')
const databasePath = join(stateDir, 'durable-memory.sqlite')
const hostBundle = resolve(import.meta.dirname, '../dist-electron/pi-host.js')
const project = canonicalProjectId('/workspace/protocol')
const access: MemoryAccessContext = {
  origin: 'runtime',
  canonicalProject: project,
  memoryReadEnabled: true,
  memoryWriteEnabled: true,
  temporary: false,
  runId: 'run-memory-v1',
  sessionId: 'session-memory-v1',
}

function launch() {
  const child = spawn(process.execPath, [hostBundle], {
    env: {
      ...process.env,
      SUBAGENTS_PI_HOST_STATE_PATH: statePath,
      SUBAGENTS_DURABLE_MEMORY_DB_PATH: databasePath,
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const lines = createInterface({ input: child.stdout })
  const messages: PiHostMessage[] = []
  lines.on('line', (line) => messages.push(JSON.parse(line) as PiHostMessage))
  const waitFor = async (id: number): Promise<Response> => {
    for (;;) {
      const found = messages.find((message): message is Response => 'id' in message && message.id === id)
      if (found) return found
      await once(lines, 'line')
    }
  }
  const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  }
  return { child, messages, send, waitFor }
}

class RelayChild {
  private readonly listeners = new Map<string, Array<(...args: any[]) => void>>()
  private readonly server

  constructor() {
    this.server = createPiHostServer((message) => {
      queueMicrotask(() => this.listeners.get('message')?.forEach((listener) => listener(message)))
    }, undefined, undefined, undefined, undefined, new InMemoryDurableMemoryStore())
  }

  on(event: string, listener: (...args: any[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), listener])
  }

  postMessage(message: unknown) { void this.server.handle(message) }
  kill() {}
}

try {
  const unsupported = launch()
  unsupported.send(1, 'initialize', { protocolVersion: PI_HOST_PROTOCOL_VERSION, capabilities: [] })
  assert.equal((await unsupported.waitFor(1)).error, undefined)
  unsupported.send(2, 'memory/v1/list', { access })
  assert.equal((await unsupported.waitFor(2)).error?.code, 'protocol_mismatch')
  unsupported.child.stdin.end()
  await once(unsupported.child, 'exit')

  const host = launch()
  host.send(10, 'initialize', { protocolVersion: PI_HOST_PROTOCOL_VERSION, capabilities: ['memory-store-v1'] })
  assert.equal((await host.waitFor(10)).error, undefined)
  host.send(11, 'memory/v1/upsert', {
    access,
    entry: {
      scope: { kind: 'global' },
      logicalKey: 'shared-rule',
      kind: 'memory',
      text: 'Global protocol memory',
      tags: ['protocol'],
      createdAt: '2026-08-27T00:00:00.000Z',
    },
  })
  assert.equal((await host.waitFor(11)).result?.memoryStore?.operation, 'upsert')
  host.send(12, 'memory/v1/upsert', {
    access,
    entry: {
      scope: { kind: 'project', project },
      logicalKey: 'project-rule',
      kind: 'memory',
      text: 'Project protocol memory',
      tags: ['protocol', 'project'],
      createdAt: '2026-08-27T00:01:00.000Z',
    },
  })
  assert.equal((await host.waitFor(12)).result?.memoryStore?.revision, 2)
  host.send(13, 'memory/v1/get', { access, scope: { kind: 'project', project }, logicalKey: 'project-rule' })
  assert.equal((await host.waitFor(13)).result?.memoryStore?.entry?.text, 'Project protocol memory')
  host.send(14, 'memory/v1/list', { access })
  assert.equal((await host.waitFor(14)).result?.memoryStore?.page?.total, 2)
  host.send(15, 'memory/v1/recall', { access, query: 'protocol', limit: 10 })
  assert.deepEqual((await host.waitFor(15)).result?.memoryStore?.recall?.items.map((entry) => entry.logicalKey), ['project-rule', 'shared-rule'])
  host.send(16, 'memory/v1/delete', { access, scope: { kind: 'project', project }, logicalKey: 'project-rule' })
  assert.deepEqual((await host.waitFor(16)).result?.memoryStore?.mutation, { changed: 1, revision: 3 })

  const changes = host.messages.filter((message): message is Extract<PiHostMessage, { event: 'memory/changed' }> => 'event' in message && message.event === 'memory/changed')
  assert.deepEqual(changes.map((event) => event.payload.revision), [1, 2, 3])
  assert.equal(changes.some((event) => JSON.stringify(event).includes('protocol memory')), false)
  host.child.stdin.end()
  await once(host.child, 'exit')

  const restarted = launch()
  restarted.send(20, 'initialize', { protocolVersion: PI_HOST_PROTOCOL_VERSION, capabilities: ['memory-store-v1'] })
  await restarted.waitFor(20)
  restarted.send(21, 'memory/v1/get', { access, scope: { kind: 'global' }, logicalKey: 'shared-rule' })
  const restored = (await restarted.waitFor(21)).result?.memoryStore
  assert.equal(restored?.entry?.text, 'Global protocol memory')
  assert.equal(restored?.revision, 3)
  restarted.child.stdin.end()
  await once(restarted.child, 'exit')

  const legacySnapshot = JSON.parse(await readFile(statePath, 'utf8')) as { memories?: unknown[] }
  assert.deepEqual(legacySnapshot.memories, [])

  const relay = new PiHostSupervisor(
    () => new RelayChild(),
    { requestedCapabilities: ['attachments-v1', 'tool-contract-v1', 'memory-store-v1'] },
  )
  await relay.start()
  const relayWrite = await relay.upsertDurableMemory({
    access,
    scope: { kind: 'project', project },
    logicalKey: 'relay-proof',
    kind: 'memory',
    text: 'Supervisor relay uses the typed v1 envelope',
    tags: ['relay'],
    createdAt: '2026-08-27T00:02:00.000Z',
  })
  assert.equal(relayWrite.operation, 'upsert')
  assert.equal((await relay.getDurableMemory({ access, scope: { kind: 'project', project }, logicalKey: 'relay-proof' })).operation, 'get')
  relay.stop()

  console.log('Pi Host memory-store-v1: negotiation, scoped CRUD, revision events, restart, and supervisor relay passed')
} finally {
  await rm(stateDir, { recursive: true, force: true })
}
