import { strict as assert } from 'node:assert'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = await mkdtemp(join(tmpdir(), 'pi-edit-'))
await writeFile(join(root, 'note.txt'), 'before\nkeep\n')
const stateDir = await mkdtemp(join(tmpdir(), 'pi-edit-state-'))
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
const send = (id: number, method: string, params: Record<string, unknown>) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
try {
  send(1, 'initialize', { protocolVersion: 1 })
  await waitFor(1)
  send(2, 'tools/edit', { cwd: root, path: 'note.txt', edits: [{ oldText: 'before', newText: 'after' }] })
  const denied = await waitFor(2)
  assert.match(denied.error?.message ?? '', /approval/i)
  assert.equal(await readFile(join(root, 'note.txt'), 'utf8'), 'before\nkeep\n')

  send(3, 'tools/edit', { cwd: root, path: 'note.txt', edits: [{ oldText: 'before', newText: 'after' }], approval: 'allow' })
  const edited = await waitFor(3)
  assert.equal(edited.result?.tool, 'edit')
  assert.equal(await readFile(join(root, 'note.txt'), 'utf8'), 'after\nkeep\n')
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(root, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi edit tool obeys Host approval and edits through Pi Core')
