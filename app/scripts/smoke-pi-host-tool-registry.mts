import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

type Message = { id?: number; result?: { builtinTools?: string[]; catalog?: Array<{ name: string; active: boolean; available: boolean }> }; error?: { code: string; message: string } }
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
  // The flat list is canonical: sorted, duplicate-free, and equal to exactly
  // the entries the catalog marks available-and-active — one projection, not
  // two lists that can disagree.
  const tools = [...new Set(listed.result?.builtinTools)].sort()
  assert.deepEqual(listed.result?.builtinTools, tools)
  const catalogActive = (listed.result?.catalog || []).filter((entry) => entry.active && entry.available).map((entry) => entry.name).sort()
  assert.deepEqual(tools, catalogActive)
  // Every Pi builtin remains present; the always-on pack tools joined them.
  for (const builtin of ['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']) {
    assert.equal(tools.includes(builtin), true, `${builtin} stays in the registry`)
  }
  assert.equal(tools.includes('ask_user'), true, 'always-on interaction tool is callable')
  send(3, 'runtime/status')
  const status = await waitFor(3)
  // The vendored runtime's OWN factory list is unchanged by pack registration.
  for (const builtin of ['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']) {
    assert.equal(status.result?.builtinTools?.includes(builtin), true)
  }
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi Host tool registry is canonical and duplicate-free')
