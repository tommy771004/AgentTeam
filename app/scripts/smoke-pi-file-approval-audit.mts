import { strict as assert } from 'node:assert'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = await mkdtemp(join(tmpdir(), 'pi-file-audit-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-file-audit-state-'))
await writeFile(join(root, 'note.txt'), 'before\n')
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
  send(2, 'sessions/create', { title: 'Approval audit', threadId: 'thread-audit' })
  const sessionId = (await waitFor(2)).result?.sessionId as string
  assert.ok(sessionId)

  send(3, 'tools/write', { cwd: root, sessionId, runId: 'ask-run', path: 'note.txt', content: 'ask' })
  assert.equal((await waitForEvent('host/tool-decision', 'ask-run')).payload.decision, 'ask')
  assert.match((await waitFor(3)).error?.message ?? '', /approval/i)

  send(4, 'tools/write', { cwd: root, sessionId, runId: 'deny-run', path: 'note.txt', content: 'deny', approval: 'deny' })
  assert.equal((await waitForEvent('host/tool-decision', 'deny-run')).payload.decision, 'deny')
  assert.equal((await waitForEvent('host/tool-result', 'deny-run')).payload.settlement, 'denied')
  assert.match((await waitFor(4)).error?.message ?? '', /denied/i)

  send(5, 'tools/write', { cwd: root, sessionId, runId: 'timeout-run', path: 'note.txt', content: 'timeout', approval: 'timeout' })
  assert.equal((await waitForEvent('host/tool-decision', 'timeout-run')).payload.decision, 'deny')
  assert.equal((await waitForEvent('host/tool-result', 'timeout-run')).payload.settlement, 'denied')
  assert.match((await waitFor(5)).error?.message ?? '', /timed out/i)

  send(14, 'tools/write', { cwd: root, sessionId, runId: 'cancel-approval-run', path: 'note.txt', content: 'cancel', approval: 'cancel' })
  assert.equal((await waitForEvent('host/tool-decision', 'cancel-approval-run')).payload.decision, 'deny')
  assert.equal((await waitForEvent('host/tool-result', 'cancel-approval-run')).payload.settlement, 'cancelled')
  assert.match((await waitFor(14)).error?.message ?? '', /cancel/i)

  send(6, 'settings/update', { unattended: true })
  await waitFor(6)
  send(7, 'tools/write', { cwd: root, sessionId, runId: 'unattended-run', path: 'note.txt', content: 'unattended' })
  assert.equal((await waitForEvent('host/tool-decision', 'unattended-run')).payload.decision, 'deny')
  assert.equal((await waitForEvent('host/tool-result', 'unattended-run')).payload.settlement, 'denied')
  assert.match((await waitFor(7)).error?.message ?? '', /unattended|approval/i)

  send(8, 'settings/update', { unattended: false, approvalMode: 'full' })
  await waitFor(8)
  send(9, 'tools/write', { cwd: root, sessionId, runId: 'allow-run', path: 'note.txt', content: 'approved', approval: 'allow' })
  assert.equal((await waitForEvent('host/tool-decision', 'allow-run')).payload.decision, 'allow')
  assert.equal((await waitFor(9)).result?.tool, 'write')
  assert.equal((await waitForEvent('host/tool-result', 'allow-run')).payload.settlement, 'success')
  assert.equal(await readFile(join(root, 'note.txt'), 'utf8'), 'approved')

  send(10, 'tools/edit', { cwd: root, sessionId, runId: 'failed-edit', path: 'note.txt', edits: [{ oldText: 'missing', newText: 'x' }], approval: 'allow' })
  assert.equal((await waitFor(10)).error?.code, 'invalid_request')
  assert.equal((await waitForEvent('host/tool-result', 'failed-edit')).payload.settlement, 'failed')

  send(11, 'sessions/list', {})
  const session = ((await waitFor(11)).result?.sessions || []).find((item: any) => item.id === sessionId)
  const audit = session?.toolAudit || []
  assert.ok(audit.some((item: any) => item.runId === 'allow-run' && item.phase === 'result' && item.settlement === 'success'))
  assert.ok(audit.some((item: any) => item.runId === 'failed-edit' && item.phase === 'result' && item.settlement === 'failed'))
  assert.ok(audit.some((item: any) => item.runId === 'deny-run' && item.phase === 'decision' && item.decision === 'deny'))
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(root, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi file approvals emit one decision, structured outcomes, and durable session audit')
