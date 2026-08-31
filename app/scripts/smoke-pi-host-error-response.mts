import assert from 'node:assert/strict'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

type Message = {
  id?: number
  result?: { sessionId?: string; settings?: { provider?: string; model?: string } }
  error?: { code: string; message: string }
}

const root = await mkdtemp(join(tmpdir(), 'pi-host-error-response-'))
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: {
    ...process.env,
    SUBAGENTS_PI_HOST_STATE_PATH: join(root, 'state.json'),
    SUBAGENTS_PI_AGENT_DIR: join(root, 'agent'),
    SUBAGENTS_PI_NATIVE_AGENT_DIR: join(root, 'native-agent'),
  },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as Message))
const waitFor = async (id: number, timeoutMs = 2_000): Promise<Message> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const message = messages.find((candidate) => candidate.id === id)
    if (message) return message
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error(`Pi Host did not respond to request ${id}`)
    await Promise.race([
      once(output, 'line'),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Pi Host did not respond to request ${id}`)), remaining)),
    ])
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
}

try {
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor(1)
  send(2, 'sessions/create', { title: 'invalid model smoke' })
  const created = await waitFor(2)
  assert.ok(created.result?.sessionId)
  send(3, 'settings/update', { provider: 'custom', model: 'gpt-5.6-sol' })
  const invalidSave = await waitFor(3)
  assert.equal(invalidSave.error?.code, 'invalid_request', 'invalid provider/model must fail at save, not the next turn')
  assert.match(invalidSave.error?.message || '', /custom\/gpt-5.6-sol/)
  send(5, 'settings/get')
  const unchanged = await waitFor(5)
  assert.notEqual(unchanged.result?.settings?.provider, 'custom', 'rejected save cannot mutate Host settings')
  send(4, 'turn/submit', {
    sessionId: created.result?.sessionId,
    runId: 'invalid-model-run',
    cwd: root,
    prompt: 'This must fail before any network request.',
    // Per-turn overrides still fail closed, even when bypassing Settings UI.
    profile: { provider: 'missing-provider', model: 'missing-model' },
  })
  const failed = await waitFor(4)
  assert.equal(failed.error?.code, 'runtime_error')
  assert.match(failed.error?.message || '', /Pi model is not configured: missing-provider\/missing-model/)
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(root, { recursive: true, force: true })
}

console.log('Pi Host converts async turn failures into terminal protocol errors')
