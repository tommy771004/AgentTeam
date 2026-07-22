import { strict as assert } from 'node:assert'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const parent = await mkdtemp(join(tmpdir(), 'pi-scope-parent-'))
const root = join(parent, 'project')
await import('node:fs/promises').then(({ mkdir }) => mkdir(root))
await writeFile(join(parent, 'secret.txt'), 'outside')
const stateDir = await mkdtemp(join(tmpdir(), 'pi-scope-state-'))
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json') },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, any>> = []
output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, any>))
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((item) => item.id === id)
    if (message) return message
    await once(output, 'line')
  }
}
try {
  host.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { protocolVersion: 1 } })}\n`)
  await waitFor(1)
  host.stdin.write(`${JSON.stringify({ id: 2, method: 'tools/read', params: { cwd: root, path: '../secret.txt' } })}\n`)
  const denied = await waitFor(2)
  assert.match(denied.error?.message ?? '', /scope|outside|project/i)
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(parent, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi Host filesystem tools remain inside the requested project scope')
