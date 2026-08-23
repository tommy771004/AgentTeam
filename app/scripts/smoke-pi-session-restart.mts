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
  return { host, waitFor, send }
}
const closeHost = async (host: ChildProcess) => {
  host.stdin.end()
  await once(host, 'exit')
}

try {
  const first = spawnHost()
  first.send(1, 'initialize', { protocolVersion: 2 })
  await first.waitFor((message) => message.id === 1)
  first.send(2, 'sessions/create', { title: 'Restart smoke' })
  const created = await first.waitFor((message) => message.id === 2)
  const sessionId = String(created.result.sessionId)
  first.send(3, 'turn/submit', { sessionId, runId: 'restart-first', cwd: process.cwd(), prompt: 'first prompt' })
  const firstTurn = await first.waitFor((message) => message.id === 3)
  assert.equal(firstTurn.result.settlement, 'answered')
  await closeHost(first.host)
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
  second.send(6, 'turn/submit', { sessionId, runId: 'restart-second', cwd: process.cwd(), prompt: 'second prompt' })
  const secondTurn = await second.waitFor((message) => message.id === 6)
  assert.equal(secondTurn.result.settlement, 'answered')
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1].messages?.filter((message) => message.role !== 'system').slice(-3), [
    { role: 'user', content: [{ type: 'text', text: 'first prompt' }] },
    { role: 'assistant', content: 'first from Pi' },
    { role: 'user', content: [{ type: 'text', text: 'second prompt' }] },
  ])
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
    await closeHost(second.host)
  }
} finally {
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi session history survives Host restart and resumes through Pi')
