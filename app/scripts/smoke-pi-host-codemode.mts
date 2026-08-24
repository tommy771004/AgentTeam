import { strict as assert } from 'node:assert'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = await mkdtemp(join(tmpdir(), 'pi-codemode-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-codemode-state-'))
await writeFile(join(root, 'note.txt'), 'hello from codemode')
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
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor(1)
  send(2, 'tools/code', { cwd: root, runId: 'code-isolation', approval: 'allow', code: 'return 2 + 2' })
  const isolated = await waitFor(2)
  assert.equal(isolated.result?.tool, 'code')
  assert.match(String(isolated.result?.content?.[0]?.text || ''), /4/)

  send(3, 'tools/code', { cwd: root, runId: 'code-isolation-blocked', approval: 'allow', code: 'return typeof process' })
  const blockedGlobal = await waitFor(3)
  assert.equal(blockedGlobal.result?.settlement, 'failed')
  send(4, 'settings/update', { activeTools: ['read'], approvalMode: 'full' })
  await waitFor(4)
  send(5, 'tools/code', { cwd: root, runId: 'code-nested', approval: 'allow', code: "const r = await tools.read({ path: 'note.txt' }); return r" })
  const nested = await waitFor(5)
  assert.equal(nested.result?.tool, 'code')
  assert.match(String(nested.result?.content?.[0]?.text || ''), /hello from codemode/)
  assert.ok(messages.some((item) => item.event === 'host/tool-start' && item.payload?.runId === 'code-nested' && item.payload?.callId?.includes(':code:') && item.payload?.parentRunId === 'code-nested'))
  assert.ok(messages.some((item) => item.event === 'host/tool-result' && item.payload?.runId === 'code-nested' && item.payload?.settlement === 'success'))

  send(6, 'tools/code', { cwd: root, runId: 'code-blocked', approval: 'allow', code: "return await tools.write({ path: 'blocked.txt', content: 'nope' })" })
  const blocked = await waitFor(6)
  assert.equal(blocked.result?.settlement, 'failed')
  send(7, 'settings/update', { activeTools: ['bash'], approvalMode: 'full' })
  await waitFor(7)
  send(8, 'tools/code', { cwd: root, runId: 'code-cancel', approval: 'allow', code: "return await tools.bash({ command: 'sleep 2' })" })
  await waitForEvent('host/tool-start', 'code-cancel')
  send(9, 'turn/cancel', { runId: 'code-cancel' })
  assert.equal((await waitFor(9)).result?.settlement, 'cancelled')
  assert.equal((await waitFor(8)).result?.settlement, 'cancelled')

  send(10, 'settings/update', { activeTools: ['read'], approvalMode: 'full' })
  await waitFor(10)
  send(11, 'tools/code', {
    cwd: root,
    runId: 'code-timeout',
    approval: 'allow',
    timeoutMs: 5_000,
    code: "while (true) { await new Promise((resolve) => setTimeout(resolve, 10)); await tools.read({ path: 'note.txt' }) }",
  })
  const timedOut = await waitFor(11)
  assert.equal(timedOut.result?.settlement, 'failed')
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(messages.some((item) => item.event === 'host/tool-start' && item.payload?.runId === 'code-timeout'), false)
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(root, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi Host CodeMode isolates globals and gates nested calls by active tools')
