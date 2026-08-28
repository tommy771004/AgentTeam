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
      SUBAGENTS_MEMORY_CONTROL_MAINTAINER_TOKEN: 'ticket-11-maintainer-secret',
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

const assertPackageLinks = (entries: any[], revision: number, lifecycleReason?: RegExp) => {
  const packageEntry = entries.find((entry) => entry.kind === 'memory-control-package')
  const governing = packageEntry?.packageIdentity
  assert.equal(governing?.revision, revision)
  assert.match(String(governing?.digest), /^[a-f0-9]{64}$/)
  const skill = entries.find((entry) => entry.kind === 'skill-invocation')?.invocation
  const check = entries.find((entry) => entry.kind === 'state-check')
  assert.deepEqual(skill?.packageIdentity, governing)
  assert.deepEqual(check?.packageIdentity, governing)
  if (lifecycleReason) assert.match(packageEntry?.lifecycleEvent?.reason || '', lifecycleReason)
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
  const maintain = (id: number, operation: string, params: Record<string, unknown>) => {
    firstHost.send(id, 'memory-control/v1/maintain', {
      maintenanceToken: 'ticket-11-maintainer-secret', sessionId, operation, ...params,
    })
    return firstHost.waitFor(id)
  }
  firstHost.send(7, 'memory-control/v1/maintain', {
    maintenanceToken: 'wrong-token', sessionId, operation: 'rollback', revision: 1,
    expectedActiveRevision: 1, reason: 'renderer must not gain mutation authority',
  })
  assert.match((await firstHost.waitFor(7)).error?.message || '', /authority is unavailable/i)
  const created = await maintain(8, 'create-candidate', {
    expectedActiveRevision: 1, diagnosisComponent: 'invocationPolicy',
    patch: [{ op: 'replace', path: '/maxSkills', value: 1 }],
    reason: 'source trace diagnosis localized to invocation policy',
  })
  const secondRevision = Number(created.result?.memoryControlPackage?.revision)
  assert.equal(secondRevision, 2)
  const rejected = await maintain(9, 'create-candidate', {
    expectedActiveRevision: 1, diagnosisComponent: 'checkers',
    patch: [{ op: 'add', path: '/qualification', value: 'must-reject' }],
    reason: 'competing checker diagnosis',
  })
  const rejectedRevision = Number(rejected.result?.memoryControlPackage?.revision)
  assert.equal(rejectedRevision, 3)
  assert.equal((await maintain(10, 'reject-candidate', {
    revision: rejectedRevision, reason: 'held-out checker anchor regressed',
  })).result?.memoryControlPackage?.status, 'rejected')
  const activation = await maintain(11, 'activate-candidate', {
    revision: secondRevision, expectedActiveRevision: 1,
    reason: 'direct promotion must be unavailable',
  })
  assert.match(activation.error?.message || '', /operation is invalid/i)
  releaseFirstResponse?.()
  while (completion < 2) await new Promise((resolve) => setTimeout(resolve, 5))
  firstHost.send(16, 'memory-control/v1/maintain', {
    maintenanceToken: 'ticket-11-maintainer-secret', sessionId, operation: 'create-candidate',
    expectedActiveRevision: 1, diagnosisComponent: 'workingMemorySpec',
    patch: [{ op: 'add', path: '/tooLate', value: true }], reason: 'must not enter after settlement closes audit admission',
  })
  assert.match((await firstHost.waitFor(16)).error?.message || '', /settling.*closed|active audit Task run/i)
  const firstTurn = await firstHost.waitFor(6)
  assert.equal(firstTurn.error, undefined, JSON.stringify(firstTurn))
  assertPackageLinks(firstTurn.result?.record?.entries || [], 1)
  const firstLifecycle = firstTurn.result?.record?.entries
    ?.filter((entry: any) => entry.kind === 'memory-control-lifecycle') || []
  assert.deepEqual(firstLifecycle.map((entry: any) => entry.event.kind), [
    'candidate-created', 'candidate-created', 'candidate-rejected',
  ])
  assert.match(firstLifecycle[2]?.event?.reason || '', /held-out checker anchor regressed/)

  firstHost.send(12, 'memory-control/v1/package/get', { schemaVersion: 1 })
  assert.equal((await firstHost.waitFor(12)).result?.memoryControlPackage?.revision, 1)
  firstHost.send(13, 'memory-control/v1/package/get', { schemaVersion: 1, revision: 1 })
  assert.equal((await firstHost.waitFor(13)).result?.memoryControlPackage?.digest, BASELINE_MEMORY_CONTROL_PACKAGE.digest)
  firstHost.send(14, 'memory-control/v1/package/get', { schemaVersion: 1, view: 'lineage' })
  const lineage = (await firstHost.waitFor(14)).result?.memoryControlLineage
  assert.equal(lineage?.activeRevision, 1)
  assert.match(lineage?.events?.at(-1)?.reason || '', /held-out checker anchor regressed/)
  firstHost.send(15, 'turn/submit', {
    sessionId, runId: 'package-run-two', cwd: workspace, prompt: 'write second.txt',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: ['write'], approvalMode: 'full', unattended: false, compaction: 'manual' },
    pattern: 'Goal-based', maxIterations: 1,
    workingGoal: { kind: 'file-content', path: 'second.txt', sha256: sha256('second\n') },
  })
  const secondTurn = await firstHost.waitFor(15)
  assert.equal(secondTurn.error, undefined, JSON.stringify(secondTurn))
  assertPackageLinks(secondTurn.result?.record?.entries || [], 1)
  await stopHost(firstHost)

  const secondHost = startHost()
  secondHost.send(20, 'initialize', { protocolVersion: 5, capabilities: ['memory-control-v1'] })
  assert.equal((await secondHost.waitFor(20)).error, undefined)
  secondHost.send(21, 'memory-control/v1/package/get', { schemaVersion: 1 })
  assert.equal((await secondHost.waitFor(21)).result?.memoryControlPackage?.revision, 1)
  await stopHost(secondHost)
  console.log('Direct candidate activation is unavailable; inactive candidates and audit history survive restart')
} finally {
  releaseFirstResponse?.()
  modelServer.close()
  await Promise.all([
    rm(agentDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(workspace, { recursive: true, force: true }),
  ])
}
