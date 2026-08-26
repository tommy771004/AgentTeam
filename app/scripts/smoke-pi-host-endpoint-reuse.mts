import assert from 'node:assert/strict'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

type Message = {
  id?: number
  result?: { settings?: { provider?: string; model?: string } }
  error?: { code: string; message: string }
}

// Drift guard for the "Pi model is not configured" regression: the renderer
// strips Pi-owned keys (baseUrl included) from its own storage, so a Settings
// save that only changes the model arrives WITHOUT an endpoint. The Host must
// reuse the endpoint already persisted in models.json — otherwise it adopts a
// provider/model pair no turn can run and every submit fails closed.
const ENDPOINT = 'http://127.0.0.1:4318/v1'
const root = await mkdtemp(join(tmpdir(), 'pi-host-endpoint-reuse-'))
const agentDir = join(root, 'agent')
await mkdir(agentDir, { recursive: true })
const modelsPath = join(agentDir, 'models.json')
await writeFile(modelsPath, JSON.stringify({
  providers: {
    custom: {
      api: 'openai-completions',
      baseUrl: ENDPOINT,
      models: [
        { id: 'legacy-model', name: 'legacy-model', api: 'openai-completions', baseUrl: ENDPOINT },
      ],
    },
  },
}))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: {
    ...process.env,
    SUBAGENTS_PI_HOST_STATE_PATH: join(root, 'state.json'),
    SUBAGENTS_PI_AGENT_DIR: agentDir,
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

  // A model-only save (no baseUrl — exactly what the stripped renderer sends)
  // must land the new model under the ALREADY-PERSISTED endpoint.
  send(2, 'settings/update', { provider: 'custom', model: 'gpt-5.6-luna' })
  const updated = await waitFor(2)
  assert.ok(!updated.error, `settings/update failed: ${updated.error?.message}`)
  assert.equal(updated.result?.settings?.provider, 'custom')
  assert.equal(updated.result?.settings?.model, 'gpt-5.6-luna')

  const saved = JSON.parse(await readFile(modelsPath, 'utf8')) as {
    providers?: Record<string, { baseUrl?: string; models?: Array<{ id?: string }> }>
  }
  const custom = saved.providers?.custom
  assert.equal(custom?.baseUrl, ENDPOINT, 'persisted endpoint must survive a model-only save')
  assert.ok(custom?.models?.some((model) => model.id === 'gpt-5.6-luna'), 'the new model must be registered under the persisted endpoint')
  assert.ok(custom?.models?.some((model) => model.id === 'legacy-model'), 'previously registered models must be preserved')

  // An explicit baseUrl always wins over the stored one.
  send(3, 'settings/update', { provider: 'custom', model: 'other-model', baseUrl: 'http://127.0.0.1:9999/v1' })
  const explicit = await waitFor(3)
  assert.ok(!explicit.error, `explicit-baseUrl update failed: ${explicit.error?.message}`)
  const savedExplicit = JSON.parse(await readFile(modelsPath, 'utf8')) as {
    providers?: Record<string, { baseUrl?: string; models?: Array<{ id?: string; baseUrl?: string }> }>
  }
  assert.equal(savedExplicit.providers?.custom?.baseUrl, 'http://127.0.0.1:9999/v1')
  const other = savedExplicit.providers?.custom?.models?.find((model) => model.id === 'other-model')
  assert.equal(other?.baseUrl, 'http://127.0.0.1:9999/v1')
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(root, { recursive: true, force: true })
}

console.log('Pi Host reuses the persisted endpoint for model-only saves')
