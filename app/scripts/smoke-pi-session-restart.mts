import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'

const agentDir = await mkdtemp(join(tmpdir(), 'pi-restart-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-restart-state-'))
const liveHosts = new Set<ChildProcess>()
const requests: Array<{ messages?: Array<{ role: string; content: unknown }> }> = []
let completion = 0
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  let body = ''
  for await (const chunk of request) body += String(chunk)
  requests.push(JSON.parse(body) as { messages?: Array<{ role: string; content: unknown }> })
  completion += 1
  if (completion === 1) await new Promise((resolveDelay) => setTimeout(resolveDelay, 600))
  const text = completion === 1 ? 'first from Pi' : 'second from Pi'
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  response.write(`data: ${JSON.stringify({ id: `restart-${completion}`, model: 'restart-model', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`)
  response.write(`data: ${JSON.stringify({ id: `restart-${completion}`, model: 'restart-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((resolveListen) => modelServer.listen(0, '127.0.0.1', resolveListen))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('Loopback model server did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: {
  baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'test-key',
  models: [{ id: 'restart-model', name: 'Restart Model', reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 256 }],
} } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'restart-model', defaultThinkingLevel: 'off' }))

const entry = resolve(import.meta.dirname, '../dist-electron/pi-host.js')
const spawnHost = () => {
  const host = spawn(process.execPath, [entry], {
    env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  liveHosts.add(host)
  host.once('exit', () => liveHosts.delete(host))
  const output = createInterface({ input: host.stdout })
  const messages: Array<Record<string, any>> = []
  output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, any>))
  const waitFor = async (predicate: (message: Record<string, any>) => boolean) => {
    for (;;) {
      const current = messages.find(predicate)
      if (current) return current
      await once(output, 'line')
    }
  }
  const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  return { host, output, waitFor, send }
}
const waitForExit = (host: ChildProcess, timeoutMs: number): Promise<boolean> => {
  if (host.exitCode !== null || host.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolveExit) => {
    let settled = false
    const finish = (exited: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      host.removeListener('exit', onExit)
      resolveExit(exited)
    }
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    host.once('exit', onExit)
  })
}
const closeHost = async (host: ChildProcess, output?: ReturnType<typeof createInterface>) => {
  output?.close()
  if (host.exitCode === null && host.signalCode === null) {
    host.stdin.end()
    if (!(await waitForExit(host, 2_000))) {
      host.kill('SIGTERM')
      if (!(await waitForExit(host, 1_000))) {
        host.kill('SIGKILL')
        await waitForExit(host, 1_000)
      }
    }
  }
  liveHosts.delete(host)
}

const closeModelServer = async (): Promise<void> => {
  if (!modelServer.listening) return
  await new Promise<void>((resolveClose) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveClose()
    }
    const timer = setTimeout(() => {
      modelServer.closeAllConnections?.()
      finish()
    }, 2_000)
    modelServer.close(finish)
  })
}

try {
  const first = spawnHost()
  first.send(1, 'initialize', { protocolVersion: 2 })
  await first.waitFor((message) => message.id === 1)
  first.send(2, 'sessions/create', { title: 'Restart smoke', threadId: 'restart-thread' })
  const created = await first.waitFor((message) => message.id === 2)
  const sessionId = String(created.result.sessionId)
  first.send(3, 'turn/submit', { sessionId, runId: 'restart-first', cwd: process.cwd(), prompt: 'first prompt' })
  await first.waitFor((message) => message.event === 'host/orchestration' && message.payload?.runId === 'restart-first' && message.payload?.phase === 'iterate')
  first.send(31, 'turn/submit', { sessionId, runId: 'restart-follow-up', cwd: process.cwd(), prompt: 'queued before restart', mode: 'queue', clientMessageId: 'restart-client', expectedActiveRunId: 'restart-first', profile: { runner: 'builtin', threadId: 'restart-thread', attachments: [{ id: 'file-1', kind: 'binary', name: 'evidence.txt', mimeType: 'text/plain', size: 12, filePath: '/tmp/evidence.txt' }] } })
  const acceptedFollowUp = await first.waitFor((message) => message.id === 31)
  const acceptedRevision = Number(acceptedFollowUp.result.queueRevision)
  first.send(32, 'runs/update', { runId: 'restart-follow-up', prompt: 'edited before restart', expectedRevision: acceptedRevision })
  const editedFollowUp = await first.waitFor((message) => message.id === 32)
  first.send(33, 'turn/submit', { sessionId, runId: 'restart-follow-up-cancelled', cwd: process.cwd(), prompt: 'queued before restart', mode: 'queue', clientMessageId: 'restart-client-cancelled', expectedActiveRunId: 'restart-first', profile: { runner: 'builtin', threadId: 'restart-thread' } })
  const cancellable = await first.waitFor((message) => message.id === 33)
  first.send(34, 'runs/cancel', { runId: 'restart-follow-up-cancelled', expectedRevision: Number(cancellable.result.queueRevision) })
  await first.waitFor((message) => message.id === 34)
  const firstTurn = await first.waitFor((message) => message.id === 3)
  assert.equal(firstTurn.result.settlement, 'answered')
  await closeHost(first.host, first.output)
  const persistedPiFiles = await readdir(agentDir, { recursive: true })
  assert.ok(persistedPiFiles.some((file) => String(file).endsWith('.jsonl')), 'Pi must persist a canonical session file')

  const second = spawnHost()
  second.send(4, 'initialize', { protocolVersion: 2 })
  await second.waitFor((message) => message.id === 4)
  second.send(5, 'sessions/list')
  const restored = await second.waitFor((message) => message.id === 5)
  const restoredSession = restored.result.sessions.find((candidate: { id: string }) => candidate.id === sessionId)
  assert.deepEqual(restoredSession.messages, [
    { role: 'user', content: 'first prompt' },
    { role: 'assistant', content: 'first from Pi' },
  ])
  second.send(51, 'runs/list')
  const restoredQueue = (await second.waitFor((message) => message.id === 51)).result.queue
  const restoredFollowUp = restoredQueue.find((item: { runId: string }) => item.runId === 'restart-follow-up')
  assert.equal(restoredFollowUp.prompt, 'edited before restart')
  assert.equal(restoredFollowUp.clientMessageId, 'restart-client')
  assert.equal(restoredFollowUp.action, 'queue')
  assert.equal(restoredFollowUp.revision, editedFollowUp.result.queueRevision)
  assert.equal(restoredFollowUp.profile.attachments[0].filePath, '/tmp/evidence.txt')
  assert.equal(restoredQueue.find((item: { runId: string }) => item.runId === 'restart-follow-up-cancelled')?.status, 'interrupted', 'cancel tombstone survives restart')
  second.send(52, 'turn/submit', { sessionId, runId: 'transport-retry-after-restart', cwd: process.cwd(), prompt: 'queued before restart', mode: 'queue', clientMessageId: 'restart-client', expectedActiveRunId: 'stale-after-restart' })
  const dedupedAfterRestart = await second.waitFor((message) => message.id === 52)
  assert.equal(dedupedAfterRestart.result.followUp.runId, 'restart-follow-up', 'transport retry reuses persisted client identity')
  second.send(6, 'turn/submit', { sessionId, runId: 'restart-second', cwd: process.cwd(), prompt: 'second prompt' })
  const secondTurn = await second.waitFor((message) => message.id === 6)
  assert.equal(secondTurn.result.settlement, 'answered')
  assert.equal(requests.length, 2)
  const delivered = requests[1].messages?.filter((message) => message.role !== 'system').slice(-3) ?? []
  assert.deepEqual(delivered.map((message) => message.role), ['user', 'assistant', 'user'])
  assert.equal(delivered[1]?.content, 'first from Pi')
  const deliveredUserText = (message: (typeof delivered)[number] | undefined): string => {
    if (!Array.isArray(message?.content)) return ''
    const firstPart = message.content[0]
    return firstPart && typeof firstPart === 'object' && 'text' in firstPart && typeof firstPart.text === 'string'
      ? firstPart.text
      : ''
  }
  const firstDelivered = deliveredUserText(delivered[0])
  const secondDelivered = deliveredUserText(delivered[2])
  assert.ok(firstDelivered.endsWith('## 當前請求\nfirst prompt'))
  assert.ok(secondDelivered.endsWith('## 當前請求\nsecond prompt'))
  assert.equal(firstDelivered.match(/first prompt/g)?.length, 1)
  assert.equal(secondDelivered.match(/second prompt/g)?.length, 1)
  const sourceFile = String(restoredSession.piSessionFile)
  second.send(7, 'turn/submit', { sessionId, runId: 'restart-third', cwd: process.cwd(), prompt: 'third prompt' })
  await second.waitFor((message) => message.id === 7)
  second.send(8, 'sessions/compact', { sessionId })
  await second.waitFor((message) => message.id === 8)
  const compactedPiSession = await readFile(sourceFile, 'utf8')
  assert.match(compactedPiSession, /"type":"compaction"/)
  second.send(9, 'sessions/fork', { sessionId })
  const forked = await second.waitFor((message) => message.id === 9)
  try {
    assert.equal(typeof forked.result.sessions[0].piSessionFile, 'string')
  } finally {
    await closeHost(second.host, second.output)
  }
} finally {
  await Promise.all([...liveHosts].map((host) => closeHost(host)))
  await closeModelServer()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi session history survives Host restart and resumes through Pi')
