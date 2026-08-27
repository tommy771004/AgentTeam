import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  BASELINE_MEMORY_CONTROL_PACKAGE,
  createMemoryControlPackage,
  memoryControlPackageDocument,
} from '../electron/memoryControlPackageRepository.ts'

const agentDir = await mkdtemp(join(tmpdir(), 'memory-control-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'memory-control-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'memory-control-workspace-'))
const statePath = join(stateDir, 'state.json')
const packagePath = join(stateDir, 'memory-control-packages.json')
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

let completion = 0
let releaseFirstResponse: (() => void) | undefined
const firstResponseGate = new Promise<void>((resolveGate) => { releaseFirstResponse = resolveGate })
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const modelServer = createServer(async (request, response) => {
  request.resume()
  await once(request, 'end')
  completion += 1
  if (completion === 1) await firstResponseGate
  const chunk = (delta: unknown, finish: string | null) => sse({
    id: `memory-control-${completion}`,
    object: 'chat.completion.chunk',
    model: 'smoke-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (completion === 1 || completion === 3) {
    const second = completion === 3
    response.write(chunk({ role: 'assistant', tool_calls: [{
      index: 0,
      id: second ? 'call_package_two' : 'call_package_one',
      type: 'function',
      function: {
        name: 'write',
        arguments: JSON.stringify({ path: second ? 'second.txt' : 'first.txt', content: second ? 'second\n' : 'first\n' }),
      },
    }] }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: 'Verified.' }, null))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})

await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('memory-control model fixture did not bind')
await mkdir(agentDir, { recursive: true })
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: {
  baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'test-key',
  models: [{ id: 'smoke-model', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 16_384, maxTokens: 256 }],
} } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

type Harness = {
  host: ChildProcessWithoutNullStreams
  messages: Array<Record<string, any>>
  send(id: number, method: string, params?: Record<string, unknown>): void
  waitFor(id: number): Promise<Record<string, any>>
  waitForPackageRevision(revision: number): Promise<void>
}

const startHost = (): Harness => {
  const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
    env: {
      ...process.env,
      SUBAGENTS_PI_HOST_STATE_PATH: statePath,
      SUBAGENTS_PI_AGENT_DIR: agentDir,
      SUBAGENTS_MEMORY_CONTROL_PACKAGE_PATH: packagePath,
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const messages: Array<Record<string, any>> = []
  let stdout = ''
  host.stdout.on('data', (buffer) => {
    stdout += String(buffer)
    for (;;) {
      const newline = stdout.indexOf('\n')
      if (newline < 0) break
      const line = stdout.slice(0, newline).trim()
      stdout = stdout.slice(newline + 1)
      if (line) messages.push(JSON.parse(line))
    }
  })
  const waitUntil = async (predicate: () => boolean, label: string) => {
    const timeoutAt = Date.now() + 25_000
    while (!predicate()) {
      if (Date.now() > timeoutAt) throw new Error(`timed out waiting for ${label}`)
      await new Promise((done) => setTimeout(done, 10))
    }
  }
  return {
    host,
    messages,
    send: (id, method, params = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`),
    waitFor: async (id) => {
      await waitUntil(() => messages.some((message) => message.id === id), `response ${id}`)
      return messages.find((message) => message.id === id)!
    },
    waitForPackageRevision: async (revision) => waitUntil(() => messages.some((message) =>
      message.event === 'host/record-append'
      && message.payload?.entries?.some((entry: any) => entry.kind === 'memory-control-package' && entry.packageIdentity?.revision === revision)), `package revision ${revision}`),
  }
}

const stopHost = async (harness: Harness) => {
  harness.host.stdin.end()
  if (harness.host.exitCode === null) await once(harness.host, 'exit')
}

const assertPackageLinks = (entries: any[], revision: number) => {
  const governing = entries.find((entry) => entry.kind === 'memory-control-package')?.packageIdentity
  assert.equal(governing?.revision, revision)
  assert.match(String(governing?.digest), /^[a-f0-9]{64}$/)
  const skill = entries.find((entry) => entry.kind === 'skill-invocation')?.invocation
  const check = entries.find((entry) => entry.kind === 'state-check')
  assert.deepEqual(skill?.packageIdentity, governing)
  assert.deepEqual(check?.packageIdentity, governing)
}

try {
  const firstHost = startHost()
  firstHost.send(1, 'initialize', { protocolVersion: 5, capabilities: [] })
  assert.equal((await firstHost.waitFor(1)).error, undefined)
  firstHost.send(2, 'memory-control/v1/package/get', { schemaVersion: 1 })
  assert.match((await firstHost.waitFor(2)).error?.message || '', /not negotiated/i)
  firstHost.send(3, 'initialize', { protocolVersion: 5, capabilities: ['memory-control-v1'] })
  assert.equal((await firstHost.waitFor(3)).error, undefined)
  firstHost.send(4, 'memory-control/v1/package/get', { schemaVersion: 1 })
  assert.equal((await firstHost.waitFor(4)).result?.memoryControlPackage?.revision, 1)
  firstHost.send(5, 'sessions/create', { title: 'Memory-Control lifecycle' })
  const sessionId = String((await firstHost.waitFor(5)).result?.sessionId)
  firstHost.send(6, 'turn/submit', {
    sessionId, runId: 'package-run-one', cwd: workspace, prompt: 'write first.txt',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: ['write'], approvalMode: 'full', unattended: false, compaction: 'manual' },
    pattern: 'Goal-based', maxIterations: 1,
    workingGoal: { kind: 'file-content', path: 'first.txt', sha256: sha256('first\n') },
  })
  await firstHost.waitForPackageRevision(1)
  const secondPackage = createMemoryControlPackage({
    id: BASELINE_MEMORY_CONTROL_PACKAGE.id,
    revision: 2,
    parentRevision: 1,
    status: 'active',
    components: {
      ...BASELINE_MEMORY_CONTROL_PACKAGE.components,
      invocationPolicy: {
        id: BASELINE_MEMORY_CONTROL_PACKAGE.components.invocationPolicy.id,
        revision: 2,
        body: { ...BASELINE_MEMORY_CONTROL_PACKAGE.components.invocationPolicy.body, qualification: 'revision-two' },
      },
    },
  })
  await writeFile(packagePath, `${JSON.stringify(memoryControlPackageDocument([BASELINE_MEMORY_CONTROL_PACKAGE, secondPackage], 2))}\n`, { mode: 0o600 })
  releaseFirstResponse?.()
  const firstTurn = await firstHost.waitFor(6)
  assert.equal(firstTurn.error, undefined, JSON.stringify(firstTurn))
  assertPackageLinks(firstTurn.result?.record?.entries || [], 1)
  await stopHost(firstHost)

  const secondHost = startHost()
  secondHost.send(10, 'initialize', { protocolVersion: 5, capabilities: ['memory-control-v1'] })
  assert.equal((await secondHost.waitFor(10)).error, undefined)
  secondHost.send(11, 'memory-control/v1/package/get', { schemaVersion: 1 })
  assert.equal((await secondHost.waitFor(11)).result?.memoryControlPackage?.revision, 2)
  secondHost.send(12, 'memory-control/v1/package/get', { schemaVersion: 1, revision: 1 })
  assert.equal((await secondHost.waitFor(12)).result?.memoryControlPackage?.digest, BASELINE_MEMORY_CONTROL_PACKAGE.digest)
  secondHost.send(13, 'turn/submit', {
    sessionId, runId: 'package-run-two', cwd: workspace, prompt: 'write second.txt',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: ['write'], approvalMode: 'full', unattended: false, compaction: 'manual' },
    pattern: 'Goal-based', maxIterations: 1,
    workingGoal: { kind: 'file-content', path: 'second.txt', sha256: sha256('second\n') },
  })
  const secondTurn = await secondHost.waitFor(13)
  assert.equal(secondTurn.error, undefined, JSON.stringify(secondTurn))
  assertPackageLinks(secondTurn.result?.record?.entries || [], 2)
  await stopHost(secondHost)
  console.log('Task admission freezes active Memory-Control Package identity across in-flight change and Host restart')
} finally {
  releaseFirstResponse?.()
  modelServer.close()
  await Promise.all([
    rm(agentDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(workspace, { recursive: true, force: true }),
  ])
}
