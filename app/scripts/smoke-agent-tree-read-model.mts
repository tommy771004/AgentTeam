import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { agentLifecycleFromTurnSettlement, createAgentLifecycleEvent, isLegalAgentLifecycleTransition } from '../src/agent/agentLifecycle.ts'
import { projectAgentTree } from '../src/agent/agentTree.ts'
import { hasAgentTreeCapability, projectAgentTreeSnapshot } from '../src/agent/agentTreeProjection.ts'
import { recordAgentLifecycle } from '../electron/piAgentLifecycleRecord.ts'

type AgentLifecycleState =
  | 'queued'
  | 'admitted'
  | 'running'
  | 'waiting-approval'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'unknown'

type AgentTreeNode = {
  agentId: string
  rootAgentId: string
  parentAgentId?: string
  taskPath: string
  title: string
  role?: string
  depth: number
  lifecycle: AgentLifecycleState
  archived: boolean
  legacy: boolean
  runId?: string
}

type Message = {
  event?: string
  payload?: {
    entry?: { kind?: string; event?: { state?: AgentLifecycleState; runId?: string } }
    entries?: Array<{ kind?: string; event?: { state?: AgentLifecycleState; runId?: string } }>
  }
  id?: number
  result?: {
    capabilities?: string[]
    sessionId?: string
    agents?: AgentTreeNode[]
    rootAgentId?: string
    run?: { runId: string }
    page?: { entries?: Array<{ kind?: string; event?: { state?: AgentLifecycleState; agentId?: string; taskPath?: string } }> }
  }
  error?: { code: string; message: string }
}

const stateDir = await mkdtemp(join(tmpdir(), 'pi-agent-tree-'))
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
const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
}
const createSession = async (id: number, params: Record<string, unknown>) => {
  send(id, 'sessions/create', params)
  const response = await waitFor(id)
  assert.equal(response.error, undefined)
  assert.ok(response.result?.sessionId)
  return response.result.sessionId
}

try {
  send(1, 'initialize', { protocolVersion: 5, capabilities: [] })
  assert.equal((await waitFor(1)).error, undefined)
  send(99, 'agents/list', { rootAgentId: 'missing' })
  assert.equal((await waitFor(99)).error?.code, 'protocol_mismatch')
  send(100, 'initialize', { protocolVersion: 5, capabilities: ['agent-tree-v1'] })
  const initialized = await waitFor(100)
  assert.equal(initialized.error, undefined)
  assert.equal(hasAgentTreeCapability(initialized.result?.capabilities), true)

  const rootA = await createSession(2, { title: 'Conversation A', threadId: 'thread-a' })
  const childA = await createSession(3, {
    title: 'Analyze lifecycle',
    parentSessionId: rootA,
    role: 'Analyzer',
    profile: { model: 'smoke-model' },
    context: { objective: 'analyze', facts: [], constraints: [] },
    depth: 1,
  })
  const nestedA = await createSession(4, {
    title: 'Verify lifecycle',
    parentSessionId: childA,
    role: 'Verifier',
    profile: { model: 'smoke-model' },
    context: { objective: 'verify', facts: [], constraints: [] },
    depth: 2,
  })
  const rootB = await createSession(5, { title: 'Conversation B', threadId: 'thread-b' })
  assert.ok(messages.some((message) => message.event === 'host/agent-lifecycle'
    && message.payload?.entry?.event?.state === 'admitted'), 'admission publishes a live lifecycle event')

  send(6, 'agents/list', { rootAgentId: rootA })
  const initial = await waitFor(6)
  assert.equal(initial.error, undefined)
  assert.equal(initial.result?.rootAgentId, rootA)
  assert.deepEqual(initial.result?.agents?.map((agent) => agent.agentId), [rootA, childA, nestedA])
  assert.deepEqual(initial.result?.agents?.map((agent) => agent.taskPath), [
    '/root',
    `/root/analyzer-${childA.slice(-6)}`,
    `/root/analyzer-${childA.slice(-6)}/verifier-${nestedA.slice(-6)}`,
  ])
  assert.ok(initial.result?.agents?.every((agent) => agent.rootAgentId === rootA))
  assert.ok(initial.result?.agents?.every((agent) => agent.lifecycle === 'admitted'))
  assert.ok(!initial.result?.agents?.some((agent) => agent.agentId === rootB), 'a tree read must not leak another root')
  assert.deepEqual(
    projectAgentTreeSnapshot(initial.result).map((row) => row.key),
    [rootA, childA, nestedA],
    'renderer projection remains disposable and derives only from the Host snapshot',
  )
  assert.deepEqual(projectAgentTreeSnapshot({ agents: [{ agentId: rootB }] }), [], 'partial/legacy IPC payloads fail closed')

  send(7, 'runs/enqueue', {
    runId: 'agent-tree-run',
    sessionId: childA,
    prompt: 'work',
    trigger: 'interactive',
    profile: { model: 'smoke-model' },
  })
  assert.equal((await waitFor(7)).error, undefined)
  assert.ok(messages.some((message) => message.event === 'host/record-append'
    && message.payload?.entries?.some((entry) => entry.event?.runId === 'agent-tree-run')), 'run lifecycle uses the live Turn Record stream')
  assert.ok(messages.some((message) => message.event === 'host/agent-lifecycle'
    && message.payload?.entry?.event?.runId === 'agent-tree-run'), 'queued run publishes the committed lifecycle entry')
  send(8, 'agents/list', { rootAgentId: rootA })
  const queued = await waitFor(8)
  assert.equal(queued.result?.agents?.find((agent) => agent.agentId === childA)?.lifecycle, 'queued')

  send(9, 'runs/claim', { runId: 'agent-tree-run' })
  assert.equal((await waitFor(9)).result?.run?.runId, 'agent-tree-run')
  send(10, 'agents/list', { agentId: nestedA })
  const running = await waitFor(10)
  assert.equal(running.result?.rootAgentId, rootA)
  assert.equal(running.result?.agents?.find((agent) => agent.agentId === childA)?.lifecycle, 'running')

  send(11, 'runs/cancel', { runId: 'agent-tree-run' })
  assert.equal((await waitFor(11)).error, undefined)
  send(12, 'agents/list', { rootAgentId: rootA })
  assert.equal((await waitFor(12)).result?.agents?.find((agent) => agent.agentId === childA)?.lifecycle, 'interrupted')

  send(17, 'sessions/record', { sessionId: childA })
  const lifecycleEntries = (await waitFor(17)).result?.page?.entries?.filter((entry) => entry.kind === 'agent-lifecycle') || []
  assert.deepEqual(lifecycleEntries.map((entry) => entry.event?.state), ['admitted', 'queued', 'running', 'interrupted'])
  assert.ok(lifecycleEntries.every((entry) => entry.event?.agentId === childA))
  assert.ok(lifecycleEntries.every((entry) => entry.event?.taskPath === `/root/analyzer-${childA.slice(-6)}`))

  send(13, 'sessions/archive', { sessionId: nestedA })
  assert.equal((await waitFor(13)).error, undefined)
  send(14, 'agents/list', { agentId: nestedA })
  const archived = (await waitFor(14)).result?.agents?.find((agent) => agent.agentId === nestedA)
  assert.equal(archived?.archived, true)
  assert.equal(archived?.lifecycle, 'unknown', 'archived legacy data without a terminal record must degrade honestly')

  send(15, 'agents/list', { rootAgentId: rootB })
  assert.deepEqual((await waitFor(15)).result?.agents?.map((agent) => agent.agentId), [rootB])

  send(16, 'agents/list', {})
  assert.equal((await waitFor(16)).error?.code, 'invalid_request')

  send(18, 'runs/enqueue', { runId: 'empty-run', sessionId: nestedA, prompt: 'empty', trigger: 'interactive', profile: {} })
  assert.equal((await waitFor(18)).error, undefined)
  send(19, 'runs/claim', { runId: 'empty-run' }); assert.equal((await waitFor(19)).error, undefined)
  send(20, 'runs/settle', { runId: 'empty-run', settlement: 'empty' }); assert.equal((await waitFor(20)).error, undefined)
  send(21, 'agents/list', { agentId: nestedA })
  assert.equal((await waitFor(21)).result?.agents?.find((agent) => agent.agentId === nestedA)?.lifecycle, 'failed')

  send(22, 'runs/enqueue', { runId: 'answered-run', sessionId: rootB, prompt: 'answer', trigger: 'interactive', profile: {} })
  assert.equal((await waitFor(22)).error, undefined)
  send(23, 'runs/claim', { runId: 'answered-run' }); assert.equal((await waitFor(23)).error, undefined)
  send(24, 'runs/settle', { runId: 'answered-run', settlement: 'answered' }); assert.equal((await waitFor(24)).error, undefined)
  send(25, 'agents/list', { rootAgentId: rootB })
  assert.equal((await waitFor(25)).result?.agents?.[0]?.lifecycle, 'completed')
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(stateDir, { recursive: true, force: true })
}

assert.equal(hasAgentTreeCapability([]), false, 'older Hosts degrade before the renderer invokes an unknown method')
assert.equal(agentLifecycleFromTurnSettlement('truncated'), 'failed')
assert.equal(agentLifecycleFromTurnSettlement('empty'), 'failed')

const bounded = createAgentLifecycleEvent({
  agentId: 'agent', rootAgentId: 'agent', taskPath: '/root', state: 'failed', runId: 'run', reason: '界'.repeat(2_000),
})
assert.ok(bounded)
assert.ok(new TextEncoder().encode(bounded.reason).byteLength <= 2_048)
assert.equal(createAgentLifecycleEvent({ agentId: 'agent', rootAgentId: 'agent', taskPath: '/root', state: 'queued', runId: 'x'.repeat(513) }), undefined)
assert.equal(isLegalAgentLifecycleTransition(
  createAgentLifecycleEvent({ agentId: 'agent', rootAgentId: 'agent', taskPath: '/root', state: 'completed', runId: 'run-1' }),
  createAgentLifecycleEvent({ agentId: 'agent', rootAgentId: 'agent', taskPath: '/root', state: 'running', runId: 'run-1' })!,
), false, 'same-run terminal transitions cannot regress')

for (const state of ['waiting-approval', 'blocked', 'cancelled'] as const) {
  const event = createAgentLifecycleEvent({ agentId: `fixture-${state}`, rootAgentId: `fixture-${state}`, taskPath: '/root', state, runId: `run-${state}` })!
  const snapshot = projectAgentTree({
    sessions: [{
      id: event.agentId,
      title: state,
      record: { version: 13, entries: [{ kind: 'agent-lifecycle', source: 'host', event, seq: 0, turn: 1, step: 0, at: 1 }] },
    }],
    rootAgentId: event.agentId,
  })
  assert.equal(snapshot?.agents[0]?.lifecycle, state)
}

const nextTurnSession: import('../electron/piHostProtocol.ts').SessionRecord = {
  id: 'next-turn-agent', title: 'Next turn', messages: [], record: {
    version: 13 as const,
    entries: [{ kind: 'turn-end' as const, source: 'host' as const, settlement: 'answered' as const, seq: 0, turn: 1, step: 1, at: 1 }],
  },
}
assert.equal(recordAgentLifecycle([nextTurnSession], nextTurnSession.id, 'queued', 'run-2'), true)
assert.equal(nextTurnSession.record.entries.at(-1)?.turn, 2, 'out-of-turn lifecycle belongs to the upcoming turn')

const legacy = projectAgentTree({
  sessions: [{ id: 'orphan', title: 'Old child', parentSessionId: 'missing-parent' }],
  agentId: 'orphan',
})
assert.equal(legacy?.agents[0]?.legacy, true)

console.log('Pi Host exposes a root-scoped agent tree and lifecycle read model')
