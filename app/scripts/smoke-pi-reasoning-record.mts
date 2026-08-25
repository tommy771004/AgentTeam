import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { TurnRecord, TurnRecordEntry } from '../src/agent/turnRecord.ts'
import { projectConversationRows } from '../src/agent/conversationProjection.ts'

/**
 * Model-visible means logged: what the model thought reaches the Turn Record.
 *
 * The thinking already travelled to the UI as a stream, so the record's
 * silence about it was the whole defect — an hour later nobody could answer
 * «它跑那個指令之前在想什麼». This drives a real Host over a real provider
 * stream and reads what the record ended up holding.
 *
 * It also pins the live path: `host/record-append` frames published DURING the
 * turn must carry exactly the entries, in exactly the seq order, the committed
 * record ends with. That equality is what lets one projection serve both.
 */

// Long enough that any "helpful" per-entry cap would show up as a mismatch.
const THOUGHT_ONE = Array.from({ length: 40 }, (_, index) => `第 ${index + 1} 步：先確認 grep 的目標範圍。`).join('')
const THOUGHT_TWO = '工具回來了，可以下結論。'

const agentDir = await mkdtemp(join(tmpdir(), 'pi-reasoning-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-reasoning-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-reasoning-cwd-'))

let completions = 0
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const chunk = (delta: unknown, finish: string | null) => sse({
  id: `reasoning-${completions}`,
  object: 'chat.completion.chunk',
  model: 'smoke-model',
  choices: [{ index: 0, delta, finish_reason: finish }],
})
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  for await (const part of request) void part
  completions += 1
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (completions === 1) {
    // Reasoning first, in many small deltas — exactly how a provider sends it.
    for (const piece of THOUGHT_ONE.match(/.{1,17}/gu) || []) {
      response.write(chunk({ reasoning_content: piece }, null))
    }
    response.write(chunk({ role: 'assistant', content: '我先搜尋。' }, null))
    response.write(chunk({
      tool_calls: [{
        index: 0,
        id: 'call_1',
        type: 'function',
        function: { name: 'grep', arguments: JSON.stringify({ pattern: 'loop', path: '.' }) },
      }],
    }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ reasoning_content: THOUGHT_TWO }, null))
    response.write(chunk({ role: 'assistant', content: '結論：Pi Core 擁有迴圈。' }, null))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((resolveListen) => modelServer.listen(0, '127.0.0.1', resolveListen))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('Loopback model server did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({
  providers: {
    loopback: {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      api: 'openai-completions',
      apiKey: 'test-key-placeholder',
      models: [{ id: 'smoke-model', name: 'Smoke Model', reasoning: true, input: ['text'], contextWindow: 128_000 }],
    },
  },
}))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'medium' }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, any>> = []
/** Every entry the Host published live, in the order the frames arrived. */
const live: TurnRecordEntry[] = []
output.on('line', (line) => {
  const message = JSON.parse(line) as Record<string, any>
  messages.push(message)
  if (message.event === 'host/record-append') live.push(...(message.payload?.entries || []))
})
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((item) => item.id === id)
    if (message) return message
    await Promise.race([
      once(output, 'line'),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for host response ${id}`)), 20_000)),
    ])
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)

try {
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor(1)
  send(2, 'sessions/create', { title: 'Reasoning record smoke' })
  const created = await waitFor(2)
  send(3, 'turn/submit', {
    sessionId: String(created.result.sessionId),
    runId: 'reasoning-run',
    cwd: workspace,
    prompt: '誰擁有迴圈？',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'medium', activeTools: ['grep'], compaction: 'manual', approvalMode: 'full', unattended: true },
  })
  const settled = await waitFor(3)
  assert.equal(settled.result.settlement, 'answered')

  const record: TurnRecord = settled.result.record
  const entries: TurnRecordEntry[] = record.entries
  const reasoning = entries.filter((entry) => entry.kind === 'reasoning')
  assert.ok(reasoning.length >= 1, `the thinking the model streamed is on the record (saw ${reasoning.length})`)

  // Complete, not summarised. A cap anywhere on this path would show here.
  const first = reasoning[0]
  assert.equal(first.kind === 'reasoning' ? first.content : '', THOUGHT_ONE, 'the thought is recorded whole')
  assert.equal(
    reasoning.map((entry) => (entry.kind === 'reasoning' ? entry.content : '')).join(''),
    THOUGHT_ONE + THOUGHT_TWO,
    'every thinking delta reaches the record, and none of them twice',
  )

  // The reasoning is a model claim, not the Host's own account.
  assert.ok(reasoning.every((entry) => entry.source === 'model'), 'reasoning is attributed to the model')

  // Ordered: the thought sits BEFORE the call it explains, in the same step.
  const call = entries.find((entry) => entry.kind === 'tool-call')
  assert.ok(call, 'the turn really did call a tool')
  assert.ok(first.seq < call.seq, 'the reasoning precedes the tool call it led to')
  assert.equal(first.step, call.step, 'and belongs to the same step')
  const later = reasoning[reasoning.length - 1]
  assert.ok(later.seq > call.seq, 'the thinking that followed the tool result is recorded after it')
  // A `step` is one ORCHESTRATION iteration, not one model request: Pi runs its
  // own tool loop inside a single turn, so the request before the tool and the
  // request after it share a step. That is exactly why seq — and not step — is
  // what decides order.
  assert.equal(later.step, call.step, 'both thoughts belong to the orchestration iteration they happened in')

  // Sequence is a total order over the whole record, reasoning included.
  for (let index = 1; index < entries.length; index += 1) {
    assert.ok(entries[index - 1].seq < entries[index].seq, 'seq is strictly monotonic')
  }

  // ── Live and committed are the same account ──────────────────────────────
  // Same entries, same seq, same order. This is what lets the running view and
  // the replayed view share one projection instead of hoping they agree.
  assert.ok(live.length > 0, 'the Host published its record entries live')
  assert.deepEqual(
    live.map((entry) => [entry.seq, entry.kind]),
    entries.map((entry) => [entry.seq, entry.kind]),
    'the live stream and the committed record carry identical entries in identical order',
  )
  assert.deepEqual(
    projectConversationRows({ version: record.version, entries: live }),
    projectConversationRows(record),
    'projecting the live entries and the committed ones yields the same rows',
  )

  console.log(`the model's thinking is on the record — ${reasoning.length} entries, ${THOUGHT_ONE.length + THOUGHT_TWO.length} chars, live and committed identical`)
} finally {
  host.stdin.end()
  await once(host, 'exit')
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}
