import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

type Session = { id: string; parentSessionId?: string; role?: string; context?: { objective: string; facts: string[]; constraints: string[] }; depth?: number; agentAdmission?: { objective: string; executionKind: string }; record?: { entries: Array<{ kind?: string; event?: { state?: string } }> } }
type Message = { id?: number; result?: { sessionId?: string; sessions?: Session[]; runId?: string; page?: { entries?: Array<{ kind?: string; event?: { state?: string } }> } }; error?: { code: string; message: string } }
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
  send(1, 'initialize', { protocolVersion: 5, capabilities: ['agent-tree-v1', 'agent-collaboration-v1'] }); await waitFor(1)
  send(2, 'sessions/create', { title: 'Parent' }); const parentSessionId = (await waitFor(2)).result?.sessionId
  assert.ok(parentSessionId)

  send(3, 'sessions/create', { title: 'Bypass', parentSessionId, role: 'Analyzer', profile: {}, context: { objective: 'x', facts: [], constraints: [] }, depth: 1 })
  assert.match((await waitFor(3)).error?.message || '', /agents\/spawn/)

  send(4, 'agents/spawn', {
    spawnId: 'child-session-smoke', parentAgentId: parentSessionId,
    title: 'Analyzer child', objective: 'inspect project', role: 'Analyzer',
    profile: { activeTools: [] },
    context: { objective: 'inspect project', facts: ['fact'], constraints: ['no writes'] },
    depth: 1, workspace: { mode: 'shared-readonly' },
  })
  const spawned = await waitFor(4)
  assert.equal(spawned.error, undefined, spawned.error?.message)
  const childSessionId = spawned.result?.sessionId
  assert.ok(childSessionId)
  assert.ok(spawned.result?.runId)

  send(5, 'sessions/list')
  const child = (await waitFor(5)).result?.sessions?.find((session) => session.id === childSessionId)
  assert.equal(child?.parentSessionId, parentSessionId)
  assert.equal(child?.role, 'Analyzer')
  assert.equal(child?.depth, 1)
  assert.deepEqual(child?.context, { objective: 'inspect project', facts: ['fact'], constraints: ['no writes'] })
  assert.equal(child?.agentAdmission?.objective, 'inspect project')
  assert.equal(child?.agentAdmission?.executionKind, 'builtin-agent')
  send(51, 'sessions/record', { sessionId: childSessionId })
  const childRecord = (await waitFor(51)).result?.page?.entries || []
  assert.deepEqual(childRecord.filter((entry) => entry.kind === 'agent-lifecycle').map((entry) => entry.event?.state), ['admitted', 'queued'])

  send(6, 'agents/spawn', {
    spawnId: 'too-deep', parentAgentId: childSessionId, objective: 'x', role: 'Analyzer', profile: { activeTools: [] },
    context: { objective: 'x', facts: [], constraints: [] }, depth: 4, workspace: { mode: 'shared-readonly' },
  })
  assert.equal((await waitFor(6)).error?.code, 'invalid_request')
} finally {
  host.stdin.end(); await once(host, 'exit'); await rm(stateDir, { recursive: true, force: true })
}

console.log('Pi Agent Communication Domain exclusively admits bounded child sessions')
