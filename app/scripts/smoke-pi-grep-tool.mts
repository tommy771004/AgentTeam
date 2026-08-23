import { strict as assert } from 'node:assert'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = await mkdtemp(join(tmpdir(), 'pi-grep-'))
await writeFile(join(root, 'notes.md'), '# Notes\nPi Core is active\n')
const stateDir = await mkdtemp(join(tmpdir(), 'pi-grep-state-'))
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
  host.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { protocolVersion: 2 } })}\n`)
  await waitFor(1)
  host.stdin.write(`${JSON.stringify({ id: 2, method: 'tools/grep', params: { cwd: root, pattern: 'Pi Core', path: '.' } })}\n`)
  const response = await waitFor(2)
  assert.equal(response.result?.tool, 'grep')
  assert.match(response.result?.content?.[0]?.text ?? '', /notes\.md:2:\s*Pi Core is active/)
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(root, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi grep tool is exposed through the Host Protocol')
