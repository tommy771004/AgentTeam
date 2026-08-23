import { strict as assert } from 'node:assert'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

const stateDir = await mkdtemp(`${tmpdir()}/pi-turn-`)
const host = spawn(process.execPath, ['--experimental-strip-types', 'electron/piHostEntry.ts'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: `${stateDir}/state.json`, SUBAGENTS_PI_AGENT_DIR: `${stateDir}/agent` },
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
try {
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor((message) => message.id === 1)
  send(2, 'sessions/create', { title: 'Smoke' })
  const created = await waitFor((message) => message.id === 2)
  const sessionId = String(created.result.sessionId)
  send(3, 'turn/submit', { sessionId, runId: 'smoke-run', prompt: 'hello' })
  const settled = await waitFor((message) => message.id === 3)
  assert.equal(settled.result.settlement, 'failed')
  assert.equal(settled.result.sessionId, sessionId)
  assert.match(settled.result.items[0].content, /No API key found for the selected model/)
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(stateDir, { recursive: true, force: true })
}
console.log('pi turn protocol is valid')
