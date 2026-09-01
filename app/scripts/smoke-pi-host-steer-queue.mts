import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { followUpActionForRunner, projectPendingFollowUps, projectRendererQueuedFollowUps, submitHostInteractiveFollowUp } from '../src/agent/interactiveFollowUp.ts'

assert.equal(followUpActionForRunner('builtin', 'steer'), 'steer')
assert.equal(followUpActionForRunner('codex', 'steer'), 'takeover')
const projectedFixture = projectPendingFollowUps([
  { runId: 'projection-steer', sessionId: 'projection-session', prompt: 'redirect', trigger: 'interactive', profile: { threadId: 'projection-thread' }, status: 'settled', action: 'steer', clientMessageId: 'projection-client-1', revision: 1 },
  { runId: 'projection-queue', sessionId: 'projection-session', prompt: 'later', trigger: 'interactive', profile: { threadId: 'projection-thread' }, status: 'queued', action: 'queue', clientMessageId: 'projection-client-2', revision: 2 },
  { runId: 'projection-queue-same-text', sessionId: 'projection-session', prompt: 'later', trigger: 'interactive', profile: { threadId: 'projection-thread' }, status: 'queued', action: 'queue', clientMessageId: 'projection-client-3', revision: 3 },
  { runId: 'projection-paused', sessionId: 'projection-session', prompt: 'start me', trigger: 'interactive', profile: { threadId: 'projection-thread' }, status: 'queued', action: 'queue', clientMessageId: 'projection-client-4', revision: 4, autoStartPaused: true },
], 'projection-thread')
assert.deepEqual(projectedFixture.map((item) => item.state), ['accepted', 'queued', 'queued', 'paused'])
assert.equal(projectedFixture.length, 4, 'same text with different client identities remains two intents')
assert.equal(projectedFixture[1]?.editable, true)
assert.equal(projectedFixture[3]?.startable, true)
const externalCompatibility = projectRendererQueuedFollowUps([
  { id: 'external-q', enqueuedAt: new Date(0).toISOString(), dedupeKey: 'external-q', objective: 'resume external work', reuseThreadId: 'projection-thread', runner: 'codex', followUpAction: 'takeover' },
], 'projection-thread')
assert.equal(externalCompatibility[0]?.action, 'takeover')
assert.equal(externalCompatibility[0]?.editable, false)
const retryCalls: Array<Record<string, unknown>> = []
const retriedSteer = await submitHostInteractiveFollowUp({
  sessions: { list: async () => ({ sessions: [{ id: 'retry-session', threadId: 'retry-thread' }] }) },
  turn: { submit: async (input) => {
    retryCalls.push(input)
    if (retryCalls.length === 1) throw new Error('Active Pi run changed: current-run')
    return { queued: 'steer', followUp: { clientMessageId: input.clientMessageId } }
  } },
}, { action: 'steer', threadId: 'retry-thread', runId: 'stable-client-id', expectedActiveRunId: 'stale-run', prompt: 'keep this text', runner: 'builtin', attachments: [], profile: {} })
assert.equal((retriedSteer as { queued?: string }).queued, 'steer')
assert.deepEqual(retryCalls.map((call) => call.expectedActiveRunId), ['stale-run', 'current-run'], 'stale steer retries exactly once against Host identity')
assert.deepEqual(new Set(retryCalls.map((call) => call.clientMessageId)).size, 1, 'retry preserves client identity')
await assert.rejects(() => submitHostInteractiveFollowUp({
  sessions: { list: async () => ({ sessions: [{ id: 'retry-session', threadId: 'retry-thread' }] }) },
  turn: { submit: async () => { throw new Error('Active Pi session cannot accept steering messages') } },
}, { action: 'steer', threadId: 'retry-thread', runId: 'rejected-client-id', expectedActiveRunId: 'current-run', prompt: 'preserved rejection', runner: 'builtin', attachments: [], profile: {} }), /cannot accept/, 'non-steerable operation is a distinct rejection')

const agentDir = await mkdtemp(join(tmpdir(), 'pi-steer-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-steer-state-'))
const modelRequests: string[] = []
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') return response.writeHead(404).end()
  let body = ''
  for await (const chunk of request) body += String(chunk)
  modelRequests.push(body)
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000))
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(`data: ${JSON.stringify({ id: 'steer', object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
})
await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('model server did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'test', models: [{ id: 'smoke-model', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 64 }] } } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test' } }))
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], { env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir }, stdio: ['pipe', 'pipe', 'inherit'] })
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, any>> = []
output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, any>))
const waitFor = async (predicate: (message: Record<string, any>) => boolean) => { for (;;) { const found = messages.find(predicate); if (found) return found; await once(output, 'line') } }
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
try {
  send(1, 'initialize', { protocolVersion: 5, capabilities: ['agent-tree-v1'] }); await waitFor((m) => m.id === 1)
  send(2, 'sessions/create', { title: 'steer queue', threadId: 'thread-follow-up' }); const sessionId = String((await waitFor((m) => m.id === 2)).result.sessionId)
  send(3, 'settings/update', { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full' }); await waitFor((m) => m.id === 3)
  send(4, 'turn/submit', { sessionId, runId: 'active-run', cwd: process.cwd(), prompt: 'long task', profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full' } })
  await waitFor((m) => m.event === 'host/orchestration' && m.payload?.runId === 'active-run' && m.payload?.phase === 'iterate')
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 750))
  send(40, 'turn/submit', { sessionId, runId: 'stale-steer-request', cwd: process.cwd(), prompt: 'wrong turn', mode: 'steer', clientMessageId: 'client-stale', expectedActiveRunId: 'not-active' })
  const stale = await waitFor((m) => m.id === 40)
  assert.equal(stale.error?.code, 'conflict', 'stale steer target is rejected atomically')
  send(5, 'turn/submit', { sessionId, runId: 'steer-request', cwd: process.cwd(), prompt: 'stop and focus', mode: 'steer', clientMessageId: 'client-steer', expectedActiveRunId: 'active-run' })
  const steered = await waitFor((m) => m.id === 5)
  assert.equal(steered.result?.queued, 'steer'); assert.equal(steered.result?.runId, 'active-run')
  assert.equal(steered.result?.followUp?.clientMessageId, 'client-steer')
  send(50, 'turn/submit', { sessionId, runId: 'steer-retry', cwd: process.cwd(), prompt: 'stop and focus', mode: 'steer', clientMessageId: 'client-steer', expectedActiveRunId: 'active-run' })
  const retried = await waitFor((m) => m.id === 50)
  assert.equal(retried.result?.followUp?.id, steered.result?.followUp?.id, 'same client identity returns the accepted Host receipt')
  send(6, 'turn/submit', { sessionId, runId: 'queued-request', cwd: process.cwd(), prompt: 'run this later', mode: 'queue', clientMessageId: 'client-queue', expectedActiveRunId: 'active-run', profile: { runner: 'builtin', threadId: 'thread-follow-up' } })
  const queued = await waitFor((m) => m.id === 6)
  assert.equal(queued.result?.queued, 'queue'); assert.ok(queued.result?.queue?.some((item: any) => item.runId === 'queued-request'))
  const queuedFollowUp = queued.result?.queue?.find((item: any) => item.runId === 'queued-request')
  assert.equal(queuedFollowUp?.clientMessageId, 'client-queue')
  assert.equal(queuedFollowUp?.action, 'queue')
  assert.equal(queuedFollowUp?.profile?.threadId, 'thread-follow-up')
  assert.equal(typeof queuedFollowUp?.revision, 'number')
  send(60, 'turn/submit', { sessionId, runId: 'queued-request-2', cwd: process.cwd(), prompt: 'second queued task', mode: 'queue', clientMessageId: 'client-queue-2', expectedActiveRunId: 'active-run', profile: { runner: 'builtin', threadId: 'thread-follow-up' } })
  await waitFor((m) => m.id === 60)
  send(66, 'turn/submit', { sessionId, runId: 'queued-request-3', cwd: process.cwd(), prompt: 'third queued task', mode: 'queue', clientMessageId: 'client-queue-3', expectedActiveRunId: 'active-run', profile: { runner: 'builtin', threadId: 'thread-follow-up' } })
  const queuedThird = await waitFor((m) => m.id === 66)
  const queueRevision = Number(queuedThird.result?.queueRevision)
  assert.ok(queueRevision > Number(queuedFollowUp?.revision))
  send(600, 'runs/claim')
  assert.equal((await waitFor((m) => m.id === 600)).error?.code, 'busy', 'same-session queue cannot release before active turn settles')
  send(601, 'sessions/create', { title: 'independent queue', threadId: 'thread-independent' })
  const independentSessionId = String((await waitFor((m) => m.id === 601)).result.sessionId)
  send(602, 'runs/enqueue', { runId: 'independent-run', sessionId: independentSessionId, prompt: 'independent work', trigger: 'interactive', profile: { runner: 'builtin', threadId: 'thread-independent' } })
  await waitFor((m) => m.id === 602)
  send(603, 'runs/claim')
  assert.equal((await waitFor((m) => m.id === 603)).result?.run?.runId, 'independent-run', 'an active session does not block another session queue')
  send(604, 'runs/settle', { runId: 'independent-run', settlement: 'answered' })
  const independentSettled = await waitFor((m) => m.id === 604)
  const mutationRevision = Math.max(...independentSettled.result.queue.map((item: { revision?: number }) => item.revision || 0))
  assert.equal((await waitFor((m) => m.id === 4)).result?.settlement, 'answered')
  assert.equal(modelRequests.reduce((count, body) => count + (body.match(/stop and focus/g)?.length || 0), 0), 1, 'accepted steer reaches model input exactly once')
  send(61, 'runs/update', { runId: 'queued-request', prompt: 'edited queued task', expectedRevision: mutationRevision })
  const updated = await waitFor((m) => m.id === 61)
  assert.equal(updated.result?.followUp?.prompt, 'edited queued task')
  const updatedRevision = Number(updated.result?.queueRevision)
  send(62, 'runs/reorder', { sessionId, runIds: ['queued-request-2', 'queued-request-3', 'queued-request'], expectedRevision: updatedRevision })
  const reordered = await waitFor((m) => m.id === 62)
  assert.deepEqual(reordered.result?.queue?.filter((item: any) => item.status === 'queued').map((item: any) => item.runId), ['queued-request-2', 'queued-request-3', 'queued-request'])
  send(63, 'runs/update', { runId: 'queued-request', prompt: 'stale write', expectedRevision: queueRevision })
  assert.equal((await waitFor((m) => m.id === 63)).error?.code, 'conflict')
  send(64, 'runs/cancel', { runId: 'queued-request-2', expectedRevision: Number(reordered.result?.queueRevision) })
  const cancelled = await waitFor((m) => m.id === 64)
  assert.equal(cancelled.result?.followUp?.status, 'interrupted')
  send(65, 'runs/cancel', { runId: 'queued-request-2', expectedRevision: Number(reordered.result?.queueRevision) })
  assert.equal((await waitFor((m) => m.id === 65)).result?.followUp?.status, 'interrupted', 'cancel transport retry is idempotent')
  send(7, 'sessions/record', { sessionId })
  const queuedEntry = (await waitFor((m) => m.id === 7)).result?.page?.entries
    ?.find((entry: any) => entry.kind === 'agent-lifecycle' && entry.event?.runId === 'queued-request')
  assert.equal(queuedEntry?.event?.state, 'queued')
  assert.equal(queuedEntry?.turn, 2, 'an active follow-up is attributed to the upcoming turn')
  send(8, 'agents/list', { agentId: sessionId })
  assert.equal((await waitFor((m) => m.id === 8)).result?.agents?.[0]?.lifecycle, 'queued')
  send(80, 'turn/submit', { sessionId, runId: 'queue-transport-retry', cwd: process.cwd(), prompt: 'run this later', mode: 'queue', clientMessageId: 'client-queue', expectedActiveRunId: 'ended-run' })
  assert.equal((await waitFor((m) => m.id === 80)).result?.followUp?.runId, 'queued-request', 'post-terminal transport retry does not create a new turn')
  send(81, 'runs/claim')
  const claimed = await waitFor((m) => m.id === 81)
  assert.equal(claimed.result?.run?.runId, 'queued-request-3', 'queue releases the first remaining FIFO item after terminal settlement')
  send(82, 'runs/settle', { runId: 'queued-request-3', settlement: 'answered' })
  assert.equal((await waitFor((m) => m.id === 82)).result?.run?.status, 'settled')
  send(83, 'runs/claim')
  assert.equal((await waitFor((m) => m.id === 83)).result?.run?.runId, 'queued-request', 'the next same-session item waits for the prior queued run settlement')
  send(84, 'runs/settle', { runId: 'queued-request', settlement: 'answered' })
  assert.equal((await waitFor((m) => m.id === 84)).result?.run?.status, 'settled')
} finally {
  host.stdin.end(); await once(host, 'exit'); modelServer.close(); await rm(agentDir, { recursive: true, force: true }); await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi Host serializes active sessions and supports steer plus queued follow-up runs with one UI projection contract')
