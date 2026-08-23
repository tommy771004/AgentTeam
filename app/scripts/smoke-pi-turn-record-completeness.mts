import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { TurnRecord } from '../src/agent/turnRecord.ts'
import {
  projectRunOperations,
  projectProducedFiles,
} from '../src/agent/runOperationsProjection.ts'

/**
 * Seam 1: a run that exceeds the old live-cache caps (120 live / 40 terminal
 * events) still yields its COMPLETE execution process once settled, because
 * the summary derives from the durable Turn Record and no longer from the
 * ephemeral activity store. The record the Host returns travels to the same
 * pure projection the coordinator uses — one source, one reading.
 */

const OPERATIONS = 45 // > MAX_TERMINAL_EVENTS(40); each op = call+result entries

const agentDir = await mkdtemp(join(tmpdir(), 'pi-record-fidelity-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-record-fidelity-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-record-fidelity-cwd-'))

let completions = 0
// Round 1 asks for a tool call; every later round answers with text only.
const scripted = (round: number) => {
  if (round > 1) return { content: `結論：完成了 ${round - 1} 項工作。`, toolCalls: [] }
  const toolCalls = Array.from({ length: OPERATIONS }, (_, index) => ({
    index,
    id: `call_${index + 1}`,
    type: 'function',
    function: { name: 'grep', arguments: JSON.stringify({ pattern: `p-${index + 1}`, path: '.' }) },
  }))
  return { content: '我先逐一搜尋。', toolCalls }
}
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const chunk = (delta: unknown, finish: string | null) => sse({
  id: `fidelity-${completions}`,
  object: 'chat.completion.chunk',
  model: 'smoke-model',
  choices: [{ index: 0, delta, finish_reason: finish }],
})
let pendingToolResults = 0
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  for await (const part of request) void part
  completions += 1
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (completions === 1) {
    const script = scripted(1)
    response.write(chunk({ role: 'assistant', content: script.content }, null))
    response.write(chunk({ tool_calls: script.toolCalls }, null))
    response.write(chunk({}, 'tool_calls'))
    pendingToolResults = OPERATIONS
  }
  else if (pendingToolResults === 0 || completions > 2) {
    const round = completions - Math.max(0, pendingToolResults)
    const script = scripted(Math.min(round, 2))
    response.write(chunk({ role: 'assistant', content: script.content }, null))
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
      models: [{ id: 'smoke-model', name: 'Smoke Model', reasoning: false, input: ['text'], contextWindow: 128_000 }],
    },
  },
}))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, any>> = []
output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, any>))
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((item) => item.id === id)
    if (message) return message
    await Promise.race([
      once(output, 'line'),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for host response ${id}`)), 15_000)),
    ])
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)

try {
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor(1)
  send(2, 'sessions/create', { title: 'Record fidelity smoke' })
  const created = await waitFor(2)
  send(3, 'turn/submit', {
    sessionId: String(created.result.sessionId),
    runId: 'record-fidelity-run',
    cwd: workspace,
    prompt: '跑一個超過舊快取上限的長工作',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: ['grep'], compaction: 'manual', approvalMode: 'full', unattended: true },
  })
  const settled = await waitFor(3)
  assert.equal(settled.result.settlement, 'answered')

  // Rebuild the record exactly as the renderer receives it.
  const record: TurnRecord = settled.result.record
  assert.ok(record, 'the settled turn returns its Turn Record slice')
  const rows = projectRunOperations(record)
  const toolRows = rows.filter((row) => row.kind === 'tool')
  assert.ok(
    toolRows.length >= OPERATIONS,
    `expected at least ${OPERATIONS} operation rows past the old 40-event cap, saw ${toolRows.length}`,
  )
  // Ordered by seq; the first call is present.
  for (let index = 1; index < rows.length; index += 1) {
    assert.ok(rows[index - 1].seq < rows[index].seq, 'rows ordered by ascending seq')
  }
  assert.equal(toolRows[0]?.callId, 'call_1', 'the earliest operation survives')

  // Produced files derive from the record too (reads excluded).
  const files = projectProducedFiles(record)
  assert.equal(files.length, 0, 'a read-only run produces no files')

  console.log(`a ${toolRows.length}-operation turn projects completely from its Turn Record, past every cache cap`)
} finally {
  host.stdin.end()
  await once(host, 'exit')
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}
