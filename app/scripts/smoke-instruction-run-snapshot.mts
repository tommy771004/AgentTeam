import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'

type ModelRequest = { messages?: Array<{ role?: string; content?: unknown }> }
type HostHandle = {
  host: ChildProcess
  messages: Array<Record<string, any>>
  send: (id: number, method: string, params?: Record<string, unknown>) => void
  waitFor: (predicate: (message: Record<string, any>) => boolean) => Promise<Record<string, any>>
}

function providerMessageText(message: { content?: unknown }): string {
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content.map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text
      return JSON.stringify(part)
    }).join('\n')
  }
  if (message.content && typeof message.content === 'object' && 'text' in message.content && typeof message.content.text === 'string') return message.content.text
  return JSON.stringify(message.content ?? '')
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let offset = 0
  while (offset <= text.length - needle.length) {
    const index = text.indexOf(needle, offset)
    if (index < 0) break
    count += 1
    offset = index + needle.length
  }
  return count
}

function assertProviderRequestOrder(
  request: ModelRequest,
  currentRequest: string,
  expectedInstructions: readonly string[],
  forbiddenInstructions: readonly string[],
): void {
  const messages = request.messages || []
  const serialized = JSON.stringify(messages)
  const requestIndex = serialized.lastIndexOf(currentRequest)
  assert.ok(requestIndex >= 0, `provider request contains ${currentRequest}`)

  const lastUserIndex = messages.reduce((found, message, index) => message.role === 'user' ? index : found, -1)
  assert.ok(lastUserIndex >= 0, 'provider request has a user-authored message')
  const lastUserText = providerMessageText(messages[lastUserIndex])
  assert.ok(lastUserText.includes(currentRequest), 'current request is the last user-authored salient content')
  assert.equal(countOccurrences(lastUserText, currentRequest), 1, `${currentRequest} appears exactly once in the delivered user message`)
  for (const instruction of expectedInstructions) {
    assert.equal(countOccurrences(lastUserText, instruction), 1, `${instruction} appears exactly once in the delivered user message`)
    assert.ok(lastUserText.indexOf(instruction) < lastUserText.indexOf(currentRequest), `${instruction} precedes current request`)
  }
  for (const instruction of forbiddenInstructions) {
    assert.equal(countOccurrences(serialized, instruction), 0, `${instruction} is not delivered`)
  }
  const requestInLastUser = lastUserText.lastIndexOf(currentRequest)
  const suffix = lastUserText.slice(requestInLastUser + currentRequest.length).trim()
  if (suffix) assert.ok(suffix.startsWith('## Goal continuation contract'), 'only Host-owned continuation follows the current request')
  for (const instruction of [...expectedInstructions, ...forbiddenInstructions]) {
    assert.equal(countOccurrences(suffix, instruction), 0, `${instruction} is not reinjected after the current request`)
  }
}

const delay = (ms: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms))

const agentDir = await mkdtemp(join(tmpdir(), 'pi-instruction-snapshot-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-instruction-snapshot-state-'))
const projectDir = await mkdtemp(join(tmpdir(), 'pi-instruction-snapshot-project-'))
const switchedProjectDir = await mkdtemp(join(tmpdir(), 'pi-instruction-snapshot-switched-project-'))
const switchedCanonicalProjectDir = await realpath(switchedProjectDir)
const instructionDb = join(stateDir, 'instructions.sqlite')
const projectInstruction = join(projectDir, 'AGENTS.md')
const includedInstruction = join(projectDir, 'included.md')
const nestedInstruction = join(projectDir, 'nested.md')
const requests: ModelRequest[] = []
let holdFirstRequest = false
let releaseFirstRequest: (() => void) | undefined
let firstRequestReadyResolve: (() => void) | undefined
const firstRequestReady = new Promise<void>((resolveReady) => { firstRequestReadyResolve = resolveReady })

const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  let body = ''
  for await (const chunk of request) body += String(chunk)
  requests.push(JSON.parse(body) as ModelRequest)
  if (requests.length === 1) firstRequestReadyResolve?.()
  if (holdFirstRequest && requests.length === 1) {
    holdFirstRequest = false
    await new Promise<void>((resolveRequest) => { releaseFirstRequest = resolveRequest })
  }
  const answer = `snapshot-answer-${requests.length}`
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  response.write(`data: ${JSON.stringify({ id: answer, model: 'snapshot-model', choices: [{ index: 0, delta: { role: 'assistant', content: answer }, finish_reason: null }] })}\n\n`)
  response.write(`data: ${JSON.stringify({ id: answer, model: 'snapshot-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((resolveListen) => modelServer.listen(0, '127.0.0.1', resolveListen))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('Loopback model server did not bind')

await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: {
  baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'test-key',
  models: [{ id: 'snapshot-model', name: 'Snapshot Model', reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 256 }],
} } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'snapshot-model', defaultThinkingLevel: 'off' }))
await writeFile(nestedInstruction, 'NESTED_OLD\n')
await writeFile(includedInstruction, `INCLUDE_OLD\n@${nestedInstruction}\n`)
await writeFile(projectInstruction, `PROJECT_OLD\n@${includedInstruction}\n`)
await writeFile(join(projectDir, 'CLAUDE.md'), 'SHADOWED-MUST-NOT-DELIVER\n')
await writeFile(join(switchedProjectDir, 'AGENTS.md'), 'PROJECT_SWITCHED_ONLY\n')

const spawnHost = (): HostHandle => {
  const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
    env: {
      ...process.env,
      SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'),
      SUBAGENTS_PI_AGENT_DIR: agentDir,
      SUBAGENTS_INSTRUCTION_DB_PATH: instructionDb,
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const output = createInterface({ input: host.stdout })
  const messages: Array<Record<string, any>> = []
  output.on('line', (line) => {
    try { messages.push(JSON.parse(line) as Record<string, any>) } catch { /* Host diagnostics stay on stderr. */ }
  })
  const waitFor = async (predicate: (message: Record<string, any>) => boolean) => {
    const deadline = Date.now() + 20_000
    for (;;) {
      const current = messages.find(predicate)
      if (current) return current
      if (host.exitCode !== null) throw new Error(`Pi Host exited before response: ${host.exitCode}`)
      if (Date.now() >= deadline) throw new Error('Timed out waiting for Pi Host response')
      await delay(25)
    }
  }
  const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
    if (!host.stdin.destroyed) host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  }
  return { host, messages, send, waitFor }
}

const closeHost = async (host: ChildProcess) => {
  if (host.exitCode !== null) return
  host.stdin.end()
  await Promise.race([once(host, 'exit'), delay(3_000)])
  if (host.exitCode === null) host.kill('SIGTERM')
  if (host.exitCode === null) await Promise.race([once(host, 'exit'), delay(1_000)])
}

let host: HostHandle | undefined
try {
  host = spawnHost()
  host.send(1, 'initialize', { protocolVersion: 5, capabilities: ['instructions-v1', 'memory-store-v1'] })
  await host.waitFor((message) => message.id === 1)
  host.send(2, 'sessions/create', { title: 'Instruction snapshot smoke' })
  const created = await host.waitFor((message) => message.id === 2)
  const sessionId = String(created.result.sessionId)
  host.send(3, 'instructions/v1/save', { expectedRevision: 0, globalCustomInstructions: 'GLOBAL_OLD' })
  const saved = await host.waitFor((message) => message.id === 3)
  assert.equal(saved.result.instructions.revision, 1)

  holdFirstRequest = true
  host.send(4, 'turn/submit', {
    sessionId,
    runId: 'instruction-snapshot-run',
    cwd: projectDir,
    prompt: 'SNAPSHOT_REQUEST',
    pattern: 'Goal-based',
    maxIterations: 2,
    contextPolicy: { memoryEnabled: false, memoryWriteEnabled: false, referenceChatHistory: true, temporary: false, outboundShellMode: 'off' },
    profile: { provider: 'loopback', model: 'snapshot-model', thinkingLevel: 'off', activeTools: ['read'], compaction: 'auto', approvalMode: 'full', unattended: false },
  })
  await firstRequestReady

  // Same-thread follow-up enters the real Pi Host queue while Run A is
  // active. It carries only the request/profile placeholder; mutable
  // instructions are deliberately admitted later, after A settles.
  host.send(13, 'turn/submit', {
    sessionId,
    runId: 'instruction-snapshot-queued-follow-up',
    cwd: projectDir,
    prompt: 'QUEUED_REQUEST',
    followUpMode: 'queue',
    contextPolicy: { memoryEnabled: false, memoryWriteEnabled: false, referenceChatHistory: false, temporary: false, outboundShellMode: 'off' },
    profile: { provider: 'loopback', model: 'snapshot-model', thinkingLevel: 'off', activeTools: ['read'], compaction: 'auto', approvalMode: 'full', unattended: false },
  })
  const queuedFollowUp = await host.waitFor((message) => message.id === 13)
  assert.equal(queuedFollowUp.result.queued, 'queue', 'same-thread follow-up is queued by the production Host turn contract')
  assert.equal(queuedFollowUp.result.runId, 'instruction-snapshot-queued-follow-up')

  // Change the DB-owned source through the public Host contract while
  // iteration one is in flight. The run must continue with its already-
  // admitted Host snapshot, not a direct SQL mutation or a renderer shortcut.
  const instructionEventsBefore = host.messages.filter((message) => message.event === 'instruction/changed').length
  host.send(11, 'instructions/v1/save', { expectedRevision: 1, globalCustomInstructions: 'GLOBAL_NEW' })
  const publicMutation = await host.waitFor((message) => message.id === 11)
  assert.equal(publicMutation.error, undefined)
  assert.equal(publicMutation.result.instructions.revision, 2)
  const publicMutationEvent = await host.waitFor((message) => message.event === 'instruction/changed'
    && message.payload?.operation === 'save'
    && message.payload?.revision >= 2)
  assert.equal(publicMutationEvent.payload.operation, 'save')
  assert.equal(host.messages.filter((message) => message.event === 'instruction/changed').length, instructionEventsBefore + 1)
  await writeFile(projectInstruction, `PROJECT_NEW\n@${includedInstruction}\n`)
  await writeFile(includedInstruction, `INCLUDE_NEW\n@${nestedInstruction}\n`)
  await writeFile(nestedInstruction, 'NESTED_NEW\n')
  // External filesystem edits become visible through the Host resolver, not
  // by replacing the admitted run's captured object.
  host.send(12, 'instructions/v1/resolve', { projectRoot: projectDir, workPath: projectDir })
  const refreshed = await host.waitFor((message) => message.id === 12)
  assert.ok(refreshed.result.instructionSnapshot.effectiveText.includes('PROJECT_NEW'))
  assert.ok(refreshed.result.instructionSnapshot.effectiveText.includes('INCLUDE_NEW'))
  assert.ok(refreshed.result.instructionSnapshot.effectiveText.includes('NESTED_NEW'))
  releaseFirstRequest?.()

  const firstTurn = await host.waitFor((message) => message.id === 4)
  assert.equal(firstTurn.result.settlement, 'answered', 'the two-iteration Goal-based run settles with its final answer')
  assert.equal(requests.length, 2)
  const firstRecord = firstTurn.result.record
  const snapshotEntries = firstRecord.entries.filter((entry: { kind?: string }) => entry.kind === 'instruction-snapshot')
  assert.equal(snapshotEntries.length, 1)
  const snapshot = snapshotEntries[0].snapshot
  assert.ok(Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 1)
  assert.ok(snapshot.id && snapshot.effectiveHash)
  assert.ok(snapshot.effectiveText.includes('GLOBAL_OLD'))
  assert.ok(snapshot.effectiveText.includes('PROJECT_OLD'))
  assert.ok(snapshot.effectiveText.includes('INCLUDE_OLD'))
  assert.ok(snapshot.effectiveText.includes('NESTED_OLD'))
  assert.ok(!snapshot.effectiveText.includes('GLOBAL_NEW'))
  assert.ok(!snapshot.effectiveText.includes('PROJECT_NEW'))
  assert.ok(!snapshot.effectiveText.includes('INCLUDE_NEW'))
  assert.ok(!snapshot.effectiveText.includes('NESTED_NEW'))
  const recordedIncludePath = await realpath(includedInstruction)
  const recordedNestedPath = await realpath(nestedInstruction)
  const recordedProjectPath = await realpath(projectInstruction)
  const recordedInclude = snapshot.sources.find((source: { path?: string }) => source.path === recordedIncludePath)
  const recordedNested = snapshot.sources.find((source: { path?: string }) => source.path === recordedNestedPath)
  const shadowedRecord = snapshot.sources.find((source: { path?: string }) => source.path?.endsWith('/CLAUDE.md'))
  assert.equal(shadowedRecord?.applied, false)
  assert.equal(shadowedRecord?.content, '')
  assert.equal(shadowedRecord?.hash, createHash('sha256').update('SHADOWED-MUST-NOT-DELIVER\n').digest('hex'))
  assert.equal(recordedInclude?.applied, true)
  assert.equal(recordedInclude?.includeDepth, 1)
  assert.equal(recordedInclude?.parentPath, recordedProjectPath)
  assert.equal(recordedInclude?.bytes, Buffer.byteLength(`INCLUDE_OLD\n@${nestedInstruction}\n`))
  assert.equal(recordedInclude?.hash, createHash('sha256').update(`INCLUDE_OLD\n@${nestedInstruction}\n`).digest('hex'))
  assert.equal(recordedNested?.applied, true)
  assert.equal(recordedNested?.includeDepth, 2)
  assert.equal(recordedNested?.parentPath, recordedIncludePath)
  assert.equal(recordedNested?.bytes, Buffer.byteLength('NESTED_OLD\n'))
  const prompts = firstRecord.entries.filter((entry: { kind?: string }) => entry.kind === 'provider-prompt')
  assert.equal(prompts.length, 2)
  for (const entry of prompts) {
    assert.ok(entry.content.includes('GLOBAL_OLD'))
    assert.ok(entry.content.includes('PROJECT_OLD'))
    assert.ok(entry.content.includes('INCLUDE_OLD'))
    assert.ok(entry.content.includes('NESTED_OLD'))
    assert.ok(!entry.content.includes('GLOBAL_NEW'))
    assert.ok(!entry.content.includes('PROJECT_NEW'))
    assert.ok(!entry.content.includes('INCLUDE_NEW'))
    assert.ok(!entry.content.includes('NESTED_NEW'))
    assert.ok(entry.content.indexOf('GLOBAL_OLD') < entry.content.indexOf('SNAPSHOT_REQUEST'))
    assert.ok(entry.content.indexOf('PROJECT_OLD') < entry.content.indexOf('SNAPSHOT_REQUEST'))
    assert.ok(entry.content.indexOf('INCLUDE_OLD') < entry.content.indexOf('SNAPSHOT_REQUEST'))
    assert.ok(entry.content.indexOf('NESTED_OLD') < entry.content.indexOf('SNAPSHOT_REQUEST'))
    const currentRequestIndex = entry.content.lastIndexOf('SNAPSHOT_REQUEST')
    const continuationIndex = entry.content.indexOf('## Goal continuation contract')
    assert.ok(currentRequestIndex >= 0 && (continuationIndex < 0 || currentRequestIndex < continuationIndex))
  }
  assert.equal(requests.length, 2)
  for (const request of requests) {
    assertProviderRequestOrder(request, 'SNAPSHOT_REQUEST', ['GLOBAL_OLD', 'PROJECT_OLD', 'INCLUDE_OLD', 'NESTED_OLD'], ['GLOBAL_NEW', 'PROJECT_NEW', 'INCLUDE_NEW', 'NESTED_NEW'])
  }

  // Drain B only after A has settled. This is the real Host queue claim and
  // turn admission path, so B resolves the latest DB/project/include files
  // without restarting the Host process.
  host.send(14, 'runs/claim', { runId: 'instruction-snapshot-queued-follow-up' })
  const claimedFollowUp = await host.waitFor((message) => message.id === 14)
  assert.equal(claimedFollowUp.result.run.runId, 'instruction-snapshot-queued-follow-up')
  assert.equal(claimedFollowUp.result.run.status, 'running')
  host.send(15, 'turn/submit', {
    sessionId,
    runId: 'instruction-snapshot-queued-follow-up',
    cwd: projectDir,
    prompt: 'QUEUED_REQUEST',
    contextPolicy: { memoryEnabled: false, memoryWriteEnabled: false, referenceChatHistory: false, temporary: false, outboundShellMode: 'off' },
    profile: { provider: 'loopback', model: 'snapshot-model', thinkingLevel: 'off', activeTools: ['read'], compaction: 'auto', approvalMode: 'full', unattended: false },
  })
  const queuedTurn = await host.waitFor((message) => message.id === 15)
  assert.equal(queuedTurn.result.settlement, 'answered', 'queued same-thread follow-up is admitted after Run A settles')
  assert.equal(requests.length, 3)
  const queuedRecord = queuedTurn.result.record
  const queuedSnapshotEntry = queuedRecord.entries.find((entry: { kind?: string }) => entry.kind === 'instruction-snapshot')
  assert.ok(queuedSnapshotEntry)
  const queuedSnapshot = queuedSnapshotEntry.snapshot
  assert.ok(queuedSnapshot.effectiveHash && queuedSnapshot.effectiveHash !== snapshot.effectiveHash, 'queued follow-up receives a newly admitted instruction snapshot')
  assert.ok(queuedSnapshot.effectiveText.includes('GLOBAL_NEW'))
  assert.ok(queuedSnapshot.effectiveText.includes('PROJECT_NEW'))
  assert.ok(queuedSnapshot.effectiveText.includes('INCLUDE_NEW'))
  assert.ok(queuedSnapshot.effectiveText.includes('NESTED_NEW'))
  assertProviderRequestOrder(requests[2], 'QUEUED_REQUEST', ['GLOBAL_NEW', 'PROJECT_NEW', 'INCLUDE_NEW', 'NESTED_NEW'], ['GLOBAL_OLD', 'PROJECT_OLD', 'INCLUDE_OLD', 'NESTED_OLD'])

  // Temporary chats retain explicit instructions while durable memory stays off.
  host.send(20, 'memory/v1/upsert', {
    access: { origin: 'admin', memoryReadEnabled: true, memoryWriteEnabled: true, temporary: false },
    entry: {
      scope: { kind: 'global' },
      logicalKey: 'temporary-proof',
      kind: 'memory',
      text: 'MEMORY_SENTINEL_SECRET',
      tags: ['snapshot-smoke'],
      createdAt: '2026-08-29T00:00:00.000Z',
    },
  })
  const seededMemory = await host.waitFor((message) => message.id === 20)
  assert.equal(seededMemory.error, undefined)
  assert.equal(seededMemory.result.memoryStore.revision, 1)
  host.send(21, 'sessions/create', { title: 'Temporary instruction smoke' })
  const temporarySession = await host.waitFor((message) => message.id === 21)
  const temporarySessionId = String(temporarySession.result.sessionId)
  requests.splice(0)
  host.send(22, 'turn/submit', {
    sessionId: temporarySessionId,
    runId: 'temporary-instruction-run',
    cwd: projectDir,
    prompt: 'TEMPORARY_REQUEST',
    contextPolicy: { memoryEnabled: false, memoryWriteEnabled: false, referenceChatHistory: true, temporary: true, outboundShellMode: 'off' },
    profile: { provider: 'loopback', model: 'snapshot-model', thinkingLevel: 'off', activeTools: ['read'], compaction: 'auto', approvalMode: 'full', unattended: false },
  })
  const temporaryTurn = await host.waitFor((message) => message.id === 22)
  assert.equal(temporaryTurn.result.settlement, 'answered')
  assert.equal(requests.length, 1)
  const temporaryInput = JSON.stringify(requests[0].messages || [])
  assert.ok(temporaryInput.includes('GLOBAL_NEW'))
  assert.ok(temporaryInput.includes('PROJECT_NEW'))
  assert.ok(temporaryInput.includes('INCLUDE_NEW'))
  assert.ok(temporaryInput.includes('NESTED_NEW'))
  assert.ok(temporaryInput.indexOf('GLOBAL_NEW') < temporaryInput.lastIndexOf('TEMPORARY_REQUEST'))
  assert.ok(temporaryInput.indexOf('PROJECT_NEW') < temporaryInput.lastIndexOf('TEMPORARY_REQUEST'))
  assert.ok(temporaryInput.indexOf('INCLUDE_NEW') < temporaryInput.lastIndexOf('TEMPORARY_REQUEST'))
  assert.ok(temporaryInput.indexOf('NESTED_NEW') < temporaryInput.lastIndexOf('TEMPORARY_REQUEST'))
  assert.ok(!temporaryInput.includes('MEMORY_SENTINEL_SECRET'))
  assert.ok(!JSON.stringify(temporaryTurn.result.record.entries).includes('MEMORY_SENTINEL_SECRET'))
  assert.ok(!temporaryTurn.result.record.entries.some((entry: { kind?: string }) => entry.kind === 'memory-recall'))
  assertProviderRequestOrder(requests[0], 'TEMPORARY_REQUEST', ['GLOBAL_NEW', 'PROJECT_NEW', 'INCLUDE_NEW', 'NESTED_NEW'], ['MEMORY_SENTINEL_SECRET'])
  host.send(23, 'memory/v1/list', {
    scope: { kind: 'global' },
    access: { origin: 'admin', memoryReadEnabled: true, memoryWriteEnabled: true, temporary: false },
    limit: 10,
  })
  const memory = await host.waitFor((message) => message.id === 23)
  assert.equal(memory.result.memoryStore.revision, 1, 'temporary instructions do not create durable memory')
  assert.equal(memory.result.memoryStore.page.total, 1)
  assert.equal(memory.result.memoryStore.page.items[0].text, 'MEMORY_SENTINEL_SECRET')

  // A project switch is a new filesystem authority boundary. The next Host
  // admission must use only the selected project's canonical sources.
  host.send(24, 'instructions/v1/resolve', { projectRoot: switchedProjectDir, workPath: switchedProjectDir })
  const switchedProjection = await host.waitFor((message) => message.id === 24)
  assert.equal(switchedProjection.result.instructionSnapshot.projectIdentity, switchedCanonicalProjectDir)
  assert.ok(switchedProjection.result.instructionSnapshot.effectiveText.includes('PROJECT_SWITCHED_ONLY'))
  assert.ok(!switchedProjection.result.instructionSnapshot.effectiveText.includes('PROJECT_OLD'))
  assert.ok(switchedProjection.result.instructionSnapshot.sources.some((source: { path?: string; kind?: string; revision?: number; hash?: string; bytes?: number }) =>
    source.path === join(switchedCanonicalProjectDir, 'AGENTS.md')
      && source.kind === 'project-root'
      && Number.isSafeInteger(source.revision)
      && typeof source.hash === 'string'
      && typeof source.bytes === 'number'))
  host.send(25, 'sessions/create', { title: 'Switched project instruction smoke' })
  const switchedSession = await host.waitFor((message) => message.id === 25)
  const switchedSessionId = String(switchedSession.result.sessionId)
  requests.splice(0)
  host.send(26, 'turn/submit', {
    sessionId: switchedSessionId,
    runId: 'switched-project-instruction-run',
    cwd: switchedProjectDir,
    prompt: 'SWITCHED_PROJECT_REQUEST',
    contextPolicy: { memoryEnabled: false, memoryWriteEnabled: false, referenceChatHistory: true, temporary: false, outboundShellMode: 'off' },
    profile: { provider: 'loopback', model: 'snapshot-model', thinkingLevel: 'off', activeTools: ['read'], compaction: 'auto', approvalMode: 'full', unattended: false },
  })
  const switchedTurn = await host.waitFor((message) => message.id === 26)
  assert.equal(switchedTurn.result.settlement, 'answered')
  const switchedSnapshot = switchedTurn.result.record.entries.find((entry: { kind?: string }) => entry.kind === 'instruction-snapshot')?.snapshot
  assert.equal(switchedSnapshot.projectIdentity, switchedCanonicalProjectDir)
  assert.ok(switchedSnapshot.effectiveText.includes('PROJECT_SWITCHED_ONLY'))
  assert.ok(!switchedSnapshot.effectiveText.includes('PROJECT_OLD'))
  assert.ok(switchedSnapshot.sources.some((source: { path?: string }) => source.path === join(switchedCanonicalProjectDir, 'AGENTS.md')))
  assertProviderRequestOrder(requests[0], 'SWITCHED_PROJECT_REQUEST', ['GLOBAL_NEW', 'PROJECT_SWITCHED_ONLY'], ['PROJECT_OLD', 'INCLUDE_OLD', 'NESTED_OLD'])

  await closeHost(host.host)
  await writeFile(projectInstruction, 'PROJECT_AFTER_RESTART\n')
  await writeFile(includedInstruction, 'INCLUDE_AFTER_RESTART\n')
  await writeFile(nestedInstruction, 'NESTED_AFTER_RESTART\n')
  host = spawnHost()
  host.send(30, 'initialize', { protocolVersion: 5, capabilities: ['instructions-v1', 'memory-store-v1'] })
  await host.waitFor((message) => message.id === 30)
  host.send(31, 'instructions/v1/save', { expectedRevision: 2, globalCustomInstructions: 'GLOBAL_AFTER_RESTART' })
  const restartSave = await host.waitFor((message) => message.id === 31)
  assert.equal(restartSave.error, undefined)
  assert.equal(restartSave.result.instructions.revision, 3)
  const restartSaveEvent = await host.waitFor((message) => message.event === 'instruction/changed'
    && message.payload?.operation === 'save'
    && message.payload?.revision >= 3)
  assert.equal(restartSaveEvent.payload.operation, 'save')
  await closeHost(host.host)
  host = spawnHost()
  host.send(32, 'initialize', { protocolVersion: 5, capabilities: ['instructions-v1', 'memory-store-v1'] })
  await host.waitFor((message) => message.id === 32)
  host.send(33, 'sessions/record', { sessionId, limit: 500 })
  const replay = await host.waitFor((message) => message.id === 33)
  host.send(34, 'instructions/v1/get')
  const currentInstructions = await host.waitFor((message) => message.id === 34)
  assert.equal(currentInstructions.result.instructions.globalCustomInstructions, 'GLOBAL_AFTER_RESTART')
  const replayEntries = replay.result.page.entries
  const replaySnapshot = replayEntries.find((entry: { kind?: string; turn?: number }) => entry.kind === 'instruction-snapshot' && entry.turn === 1)
  assert.ok(replaySnapshot)
  assert.equal(replaySnapshot.snapshot.id, snapshot.id)
  assert.equal(replaySnapshot.snapshot.revision, snapshot.revision)
  assert.equal(replaySnapshot.snapshot.effectiveHash, snapshot.effectiveHash)
  assert.equal(replaySnapshot.snapshot.effectiveText, snapshot.effectiveText)
  const replayFirstTurnEntries = replayEntries.filter((entry: { turn?: number }) => entry.turn === 1)
  assert.ok(!JSON.stringify(replayFirstTurnEntries).includes('GLOBAL_AFTER_RESTART'))
  assert.ok(!JSON.stringify(replayFirstTurnEntries).includes('PROJECT_AFTER_RESTART'))
  assert.ok(!JSON.stringify(replayFirstTurnEntries).includes('INCLUDE_AFTER_RESTART'))
  assert.ok(!JSON.stringify(replayFirstTurnEntries).includes('NESTED_AFTER_RESTART'))
  const replayPrompts = replayFirstTurnEntries.filter((entry: { kind?: string }) => entry.kind === 'provider-prompt')
  assert.deepEqual(replayPrompts.map((entry: { content: string }) => entry.content), prompts.map((entry: { content: string }) => entry.content))
} finally {
  releaseFirstRequest?.()
  if (host) await closeHost(host.host)
  modelServer.close()
  await Promise.all([
    rm(agentDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(projectDir, { recursive: true, force: true }),
    rm(switchedProjectDir, { recursive: true, force: true }),
  ])
}

console.log('Instruction admission snapshots stay frozen across iterations, temporary runs and restart replay')
