import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

type Session = { id: string; parentSessionId?: string; role?: string; profile?: Record<string, unknown>; context?: { objective: string; facts: string[]; constraints: string[] }; depth?: number }
type Message = { id?: number; result?: { sessionId?: string; sessions?: Session[] }; error?: { code: string; message: string } }
const stateDir = await mkdtemp(join(tmpdir(), 'pi-child-session-'))
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json') },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as Message))
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((item) => item.id === id)
    if (message) return message
    await once(output, 'line')
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)

try {
  send(1, 'initialize', { protocolVersion: 2 }); await waitFor(1)
  send(2, 'sessions/create', { title: 'Parent' }); const parent = await waitFor(2)
  const parentSessionId = parent.result?.sessionId
  assert.ok(parentSessionId)
  send(3, 'sessions/create', {
    title: 'Analyzer child',
    parentSessionId,
    role: 'Analyzer',
    profile: { model: 'analyzer-model', activeTools: ['read'] },
    context: { objective: 'inspect project', facts: ['fact'], constraints: ['no writes'] },
    depth: 1,
  })
  const child = await waitFor(3)
  assert.equal(child.error, undefined)
  const childRecord = child.result?.sessions?.[0]
  assert.deepEqual(childRecord, {
    id: child.result?.sessionId,
    title: 'Analyzer child',
    parentSessionId,
    role: 'Analyzer',
    profile: { model: 'analyzer-model', activeTools: ['read'] },
    context: { objective: 'inspect project', facts: ['fact'], constraints: ['no writes'] },
    depth: 1,
    messages: [],
  })
  send(4, 'sessions/create', { title: 'Too deep', parentSessionId, role: 'Analyzer', profile: {}, context: { objective: 'x', facts: [], constraints: [] }, depth: 3 })
  assert.equal((await waitFor(4)).error?.code, 'invalid_request')
} finally {
  host.stdin.end(); await once(host, 'exit'); await rm(stateDir, { recursive: true, force: true })
}

console.log('Pi Delegation Extension creates bounded child sessions with isolated context')
