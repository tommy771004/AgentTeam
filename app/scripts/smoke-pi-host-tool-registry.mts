import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

type Message = { id?: number; result?: { builtinTools?: string[] }; error?: { code: string; message: string } }
const stateDir = await mkdtemp(join(tmpdir(), 'pi-host-tool-registry-'))
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json') },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as Message))
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((item) => item.id === id)
    if (message) return message
    await once(output, 'line')
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
try {
  send(1, 'initialize', { protocolVersion: 2 })
  assert.equal((await waitFor(1)).error, undefined)
  send(2, 'tools/list')
  const listed = await waitFor(2)
  assert.deepEqual(listed.result?.builtinTools, ['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write'])
  assert.equal(new Set(listed.result?.builtinTools).size, listed.result?.builtinTools?.length)
  send(3, 'runtime/status')
  assert.deepEqual((await waitFor(3)).result?.builtinTools, listed.result?.builtinTools)
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi Host tool registry is canonical and duplicate-free')
