import { strict as assert } from 'node:assert'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = await mkdtemp(join(tmpdir(), 'pi-write-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-write-state-'))
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
const waitForEvent = async (event: string, runId: string) => {
  for (;;) {
    const message = messages.find((item) => item.event === event && item.payload?.runId === runId)
    if (message) return message
    await once(output, 'line')
  }
}
const send = (id: number, method: string, params: Record<string, unknown>) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
try {
  send(1, 'initialize', { protocolVersion: 1 })
  await waitFor(1)
  send(2, 'tools/write', { cwd: root, path: 'draft.txt', content: 'should not write' })
  const denied = await waitFor(2)
  assert.match(denied.error?.message ?? '', /approval/i)
  await assert.rejects(readFile(join(root, 'draft.txt')))

  send(3, 'tools/write', { cwd: root, runId: 'write-smoke', path: 'draft.txt', content: 'approved content', approval: 'allow' })
  const start = await waitForEvent('host/tool-start', 'write-smoke')
  assert.equal(start.payload.tool, 'write')
  const decision = await waitForEvent('host/tool-decision', 'write-smoke')
  assert.equal(decision.payload.decision, 'allow')
  const written = await waitFor(3)
  assert.equal(written.result?.tool, 'write')
  const result = await waitForEvent('host/tool-result', 'write-smoke')
  assert.equal(result.payload.settlement, 'success')
  assert.equal(await readFile(join(root, 'draft.txt'), 'utf8'), 'approved content')
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(root, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi write tool obeys Host approval and writes through Pi Core')
