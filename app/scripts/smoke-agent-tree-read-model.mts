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
import { handlePiHostAgentDomain } from '../electron/piHostAgentDomain.ts'

const approvalSession: import('../electron/piHostProtocol.ts').SessionRecord = { id: 'approval-agent', title: 'Approval', messages: [] }
for (const state of ['admitted', 'running', 'waiting-approval'] as const) recordAgentLifecycle([approvalSession], approvalSession.id, state, 'approval-run')
const approvalInput = {
  method: 'agents/list', params: { agentId: approvalSession.id }, id: 'approval-list', sessions: [approvalSession],
  queue: [{ runId: 'approval-run', sessionId: approvalSession.id, status: 'running' as const, enqueuedAt: 1, prompt: 'fixture' }],
  activeSessionIds: new Set([approvalSession.id]),
  activeRunIds: new Map([[approvalSession.id, 'approval-run']]),
}
const approvalResponse = handlePiHostAgentDomain(approvalInput)?.[0] as import('../electron/piHostProtocol.ts').PiHostResponse
assert.equal(approvalResponse.result?.agents?.[0]?.lifecycle, 'waiting-approval', 'active registry must not hide the Turn Record approval wait')
recordAgentLifecycle([approvalSession], approvalSession.id, 'queued', 'next-run')
const waitingWithFollowUp = handlePiHostAgentDomain({ ...approvalInput, queue: [...approvalInput.queue, { ...approvalInput.queue[0]!, runId: 'next-run', status: 'queued' }] })?.[0] as import('../electron/piHostProtocol.ts').PiHostResponse
assert.equal(waitingWithFollowUp.result?.agents?.[0]?.lifecycle, 'waiting-approval', 'queued follow-up must not hide the active run wait')
assert.equal(waitingWithFollowUp.result?.agents?.[0]?.runId, 'approval-run')
recordAgentLifecycle([approvalSession], approvalSession.id, 'running', 'approval-run')
const resumed = handlePiHostAgentDomain(approvalInput)?.[0] as import('../electron/piHostProtocol.ts').PiHostResponse
assert.equal(resumed.result?.agents?.[0]?.lifecycle, 'running', 'approval resolution returns the same run to running')
const nextRun = handlePiHostAgentDomain({ ...approvalInput, activeRunIds: new Map([[approvalSession.id, 'new-active-run']]) })?.[0] as import('../electron/piHostProtocol.ts').PiHostResponse
assert.equal(nextRun.result?.agents?.[0]?.lifecycle, 'running', 'old lifecycle must not leak into a new active run')

type Agent = { agentId: string; rootAgentId: string; parentAgentId?: string; taskPath: string; lifecycle: string }
type Message = { id?: number; event?: string; payload?: Record<string, unknown>; result?: { capabilities?: string[]; sessionId?: string; runId?: string; agents?: Agent[]; rootAgentId?: string; page?: { entries?: Array<{ kind?: string; event?: Record<string, unknown> }> } }; error?: { code: string; message: string } }
const stateDir = await mkdtemp(join(tmpdir(), 'pi-agent-tree-'))
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json') }, stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as Message))
const waitFor = async (id: number) => { for (;;) { const message = messages.find((item) => item.id === id); if (message) return message; await once(output, 'line') } }
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
const createRoot = async (id: number, title: string) => { send(id, 'sessions/create', { title }); const result = await waitFor(id); assert.equal(result.error, undefined); return String(result.result?.sessionId) }
const spawnChild = async (id: number, parentAgentId: string, objective: string, role: string, depth: number) => {
  send(id, 'agents/spawn', { spawnId: `spawn-${id}`, parentAgentId, objective, role, depth, profile: { activeTools: [] }, context: { objective, facts: [], constraints: [] }, workspace: { mode: 'shared-readonly' } })
  const result = await waitFor(id)
  assert.equal(result.error, undefined, result.error?.message)
  return { sessionId: String(result.result?.sessionId), runId: String(result.result?.runId) }
}

try {
  send(1, 'initialize', { protocolVersion: 5, capabilities: [] }); await waitFor(1)
  send(2, 'agents/list', { rootAgentId: 'missing' }); assert.equal((await waitFor(2)).error?.code, 'protocol_mismatch')
  send(3, 'initialize', { protocolVersion: 5, capabilities: ['agent-tree-v1', 'agent-collaboration-v1'] })
  assert.equal(hasAgentTreeCapability((await waitFor(3)).result?.capabilities), true)

  const rootA = await createRoot(4, 'Conversation A')
  const child = await spawnChild(5, rootA, 'Analyze lifecycle', 'Analyzer', 1)
  const nested = await spawnChild(6, child.sessionId, 'Verify lifecycle', 'Verifier', 2)
  const rootB = await createRoot(7, 'Conversation B')

  send(8, 'agents/list', { rootAgentId: rootA })
  const tree = await waitFor(8)
  assert.equal(tree.result?.rootAgentId, rootA)
  assert.deepEqual(tree.result?.agents?.map((agent) => agent.agentId), [rootA, child.sessionId, nested.sessionId])
  assert.deepEqual(tree.result?.agents?.map((agent) => agent.lifecycle), ['admitted', 'queued', 'queued'])
  assert.ok(tree.result?.agents?.every((agent) => agent.rootAgentId === rootA))
  assert.ok(!tree.result?.agents?.some((agent) => agent.agentId === rootB))
  assert.deepEqual(projectAgentTreeSnapshot(tree.result).map((row) => row.key), [rootA, child.sessionId, nested.sessionId])

  send(9, 'runs/claim', { runId: child.runId }); assert.equal((await waitFor(9)).error, undefined)
  send(10, 'runs/settle', { runId: child.runId, settlement: 'answered' }); assert.equal((await waitFor(10)).error, undefined)
  send(11, 'runs/cancel', { runId: nested.runId }); assert.equal((await waitFor(11)).error, undefined)
  send(12, 'agents/list', { rootAgentId: rootA })
  const settled = (await waitFor(12)).result?.agents || []
  assert.equal(settled.find((agent) => agent.agentId === child.sessionId)?.lifecycle, 'completed')
  assert.equal(settled.find((agent) => agent.agentId === nested.sessionId)?.lifecycle, 'interrupted')

  send(13, 'sessions/record', { sessionId: child.sessionId })
  const lifecycle = (await waitFor(13)).result?.page?.entries?.filter((entry) => entry.kind === 'agent-lifecycle') || []
  assert.deepEqual(lifecycle.map((entry) => entry.event?.state), ['admitted', 'queued', 'running', 'completed'])
  send(14, 'agents/list', { rootAgentId: rootB })
  assert.deepEqual((await waitFor(14)).result?.agents?.map((agent) => agent.agentId), [rootB])
  send(15, 'agents/list', {}); assert.equal((await waitFor(15)).error?.code, 'invalid_request')
  assert.ok(messages.some((message) => message.event === 'host/agent-collaboration'), 'collaboration changes publish live events')
} finally {
  host.stdin.end(); await once(host, 'exit'); await rm(stateDir, { recursive: true, force: true })
}

assert.equal(agentLifecycleFromTurnSettlement('truncated'), 'failed')
assert.equal(agentLifecycleFromTurnSettlement('empty'), 'completed')
const bounded = createAgentLifecycleEvent({ agentId: 'agent', rootAgentId: 'agent', taskPath: '/root', state: 'failed', runId: 'run', reason: '界'.repeat(2_000) })!
assert.ok(new TextEncoder().encode(bounded.reason).byteLength <= 2_048)
assert.equal(isLegalAgentLifecycleTransition(
  createAgentLifecycleEvent({ agentId: 'agent', rootAgentId: 'agent', taskPath: '/root', state: 'completed', runId: 'run-1' }),
  createAgentLifecycleEvent({ agentId: 'agent', rootAgentId: 'agent', taskPath: '/root', state: 'running', runId: 'run-1' })!,
), false)

const nextTurnSession: import('../electron/piHostProtocol.ts').SessionRecord = {
  id: 'next-turn-agent', title: 'Next turn', messages: [], record: { version: 14, entries: [{ kind: 'turn-end', source: 'host', settlement: 'answered', seq: 0, turn: 1, step: 1, at: 1 }] },
}
assert.equal(recordAgentLifecycle([nextTurnSession], nextTurnSession.id, 'queued', 'run-2'), true)
assert.equal(nextTurnSession.record?.entries.at(-1)?.turn, 2)
assert.equal(projectAgentTree({ sessions: [{ id: 'orphan', title: 'Old child', parentSessionId: 'missing-parent' }], agentId: 'orphan' })?.agents[0]?.legacy, true)

console.log('Pi Host exposes a root-scoped Agent Work Tree from Host-owned admission and lifecycle')
