import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

type Message = { id?: number; result?: Record<string, any>; error?: { code: string; message: string } }

const [protocolSource, mainSource, preloadSource, storeSource] = await Promise.all([
  readFile(resolve(import.meta.dirname, '../electron/piHostProtocol.ts'), 'utf8'),
  readFile(resolve(import.meta.dirname, '../electron/main.ts'), 'utf8'),
  readFile(resolve(import.meta.dirname, '../electron/preload.ts'), 'utf8'),
  readFile(resolve(import.meta.dirname, '../src/store/agentStore.ts'), 'utf8'),
])
assert.match(protocolSource, /'workflow\/run'.*'workflow\/repair'.*'workflow\/status'.*'workflow\/record'.*'workflow\/checkpoint'/s)
assert.match(mainSource, /pi-host:workflow:run/)
assert.match(preloadSource, /workflow:\s*\{[\s\S]*run:/)
assert.match(storeSource, /executePiHostWorkflow[\s\S]*overrides\.workflowDefinition[\s\S]*piHost\?\.workflow\?\.run/)

const agentDir = await mkdtemp(join(tmpdir(), 'workflow-prod-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'workflow-prod-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'workflow-prod-cwd-'))
let providerCalls = 0
let activeCalls = 0
let maxActiveCalls = 0
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions') return response.writeHead(404).end()
  const chunks: Buffer[] = []
  request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  await once(request, 'end')
  const body = Buffer.concat(chunks).toString('utf8')
  const artifactId = body.includes('\\"id\\":\\"left\\"') ? 'left' : 'right'
  providerCalls += 1
  activeCalls += 1
  maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
  await new Promise((done) => setTimeout(done, 80))
  activeCalls -= 1
  const content = JSON.stringify({ outputs: [{ artifactId, schemaId: 'text-v1', value: artifactId.toUpperCase() }] })
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' })
  response.write(`data: ${JSON.stringify({ id: 'workflow-production', object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: 'stop' }] })}\n\n`)
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('model fixture did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', models: [{ id: 'smoke-model', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 128_000 }] } } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'smoke' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const lines = createInterface({ input: host.stdout })
const received: Message[] = []
lines.on('line', (line) => received.push(JSON.parse(line) as Message))
let sequence = 0
const call = async (method: string, params: Record<string, unknown> = {}) => {
  const id = ++sequence
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  for (;;) {
    const message = received.find((candidate) => candidate.id === id)
    if (message) return message
    await new Promise<Array<unknown>>((resolveLine, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30_000)
      once(lines, 'line').then((value) => { clearTimeout(timer); resolveLine(value) }, (error) => { clearTimeout(timer); reject(error) })
    })
  }
}

const agentNode = (id: string) => ({
  id,
  kind: 'agent',
  task: `Produce ${id}`,
  dependsOn: [],
  inputs: [],
  outputs: [{ id, schemaId: 'text-v1', required: true }],
  runner: { requiredCapabilities: [], workspaceMode: 'shared-readonly' },
  retry: { maxAttempts: 2, retryOn: ['execution-failed', 'schema-failed', 'criterion-failed'] },
})
const definition = {
  schemaVersion: 1,
  id: 'production-fanout-fanin',
  revision: 1,
  nodes: [
    agentNode('left'),
    agentNode('right'),
    {
      id: 'join',
      kind: 'deterministic-reducer',
      task: 'collect-inputs-v1',
      dependsOn: ['left', 'right'],
      inputs: [
        { name: 'left', artifactRef: 'left', required: true },
        { name: 'right', artifactRef: 'right', required: true },
      ],
      outputs: [{ id: 'joined', schemaId: 'json-value-v1', required: true }],
      runner: { requiredCapabilities: [], workspaceMode: 'shared-readonly' },
      retry: { maxAttempts: 1, retryOn: ['schema-failed'] },
    },
  ],
  terminalNodeIds: ['join'],
  budgets: { maxConcurrentNodes: 2, maxTotalAttempts: 5, maxWallClockMs: 30_000 },
}

try {
  await call('initialize', { protocolVersion: 5, capabilities: ['tool-contract-v1'] })
  const forbidden = await call('workflow/run', { definition, taskRunId: 'task-forbidden', workflowRunId: 'workflow-forbidden', cwd: workspace })
  assert.equal(forbidden.error?.code, 'forbidden')

  await call('initialize', { protocolVersion: 5, capabilities: ['tool-contract-v1', 'goal-contract-v1', 'workflow-graph-v1', 'workflow-record-v1', 'workflow-scheduler-v1'] })
  const run = await call('workflow/run', {
    definition,
    taskRunId: 'task-production',
    workflowRunId: 'workflow-production',
    cwd: workspace,
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: true },
  })
  assert.equal(run.error, undefined)
  assert.equal(run.result?.workflow?.result?.verdict, 'passed')
  assert.deepEqual(run.result?.workflow?.result?.nodeStatuses, { left: 'passed', right: 'passed', join: 'passed' })
  assert.deepEqual(run.result?.workflow?.result?.artifacts?.find((item: Record<string, unknown>) => item.artifactId === 'joined')?.value, ['LEFT', 'RIGHT'])
  assert.equal(providerCalls, 2, 'deterministic fan-in reducer must not call the model')
  assert.ok(maxActiveCalls >= 2, 'ready agent nodes must execute concurrently')
  const record = await call('workflow/record', { workflowRunId: 'workflow-production' })
  assert.ok(record.result?.workflowRecord?.some((entry: Record<string, unknown>) => entry.kind === 'barrier-opened'))
  assert.equal(record.result?.workflowRecord?.filter((entry: Record<string, unknown>) => entry.kind === 'node-observed').length, 3)
  const checkpoint = await call('workflow/checkpoint', { workflowRunId: 'workflow-production' })
  assert.equal(checkpoint.result?.workflowCheckpoint?.workflowRunId, 'workflow-production')

  console.log('Production Workflow dispatch passed: negotiated protocol, fresh node sessions, fan-out/fan-in, records, checkpoint')
} finally {
  host.stdin.end()
  if (host.exitCode === null) await new Promise<void>((done) => {
    const timer = setTimeout(() => { host.kill(); done() }, 1_000)
    once(host, 'exit').then(() => { clearTimeout(timer); done() })
  })
  lines.close()
  modelServer.close()
  await Promise.all([
    rm(agentDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(workspace, { recursive: true, force: true }),
  ])
}
