import { strict as assert } from 'node:assert'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = await mkdtemp(join(tmpdir(), 'pi-bash-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-bash-state-'))
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
  send(1, 'initialize', { protocolVersion: 2 })
  await waitFor(1)
  send(12, 'sessions/create', { title: 'Bash audit', threadId: 'bash-audit' })
  const sessionId = (await waitFor(12)).result?.sessionId as string
  assert.ok(sessionId)
  send(2, 'settings/update', { activeTools: ['read'] })
  await waitFor(2)
  send(3, 'tools/bash', { cwd: root, command: 'printf "hello bash"', approval: 'allow' })
  const disabled = await waitFor(3)
  assert.match(disabled.error?.message ?? '', /disabled|active tool/i)

  send(4, 'settings/update', { activeTools: ['bash'] })
  await waitFor(4)
  send(5, 'tools/bash', { cwd: root, command: 'printf "hello bash"' })
  const denied = await waitFor(5)
  assert.match(denied.error?.message ?? '', /approval/i)

  send(6, 'tools/bash', { cwd: root, sessionId, command: 'printf "hello bash"', approval: 'allow' })
  const result = await waitFor(6)
  assert.equal(result.result?.tool, 'bash')
  assert.equal(result.result?.content?.[0]?.text, 'hello bash')

  // The Host applies the same segment-aware Bash decision before execution,
  // including when approvalMode=full: dangerous commands cannot be silently
  // widened by the broad mode.
  send(7, 'settings/update', { approvalMode: 'full', unattended: false, bashRequireAsk: true })
  await waitFor(7)
  send(8, 'tools/bash', { cwd: root, runId: 'bash-policy', command: 'printf safe; rm -f should-not-run' })
  const policy = await waitFor(8)
  assert.match(policy.error?.message ?? '', /approval/i)
  assert.ok(messages.some((item) => item.event === 'host/tool-decision' && item.payload?.runId === 'bash-policy' && item.payload?.decision === 'ask'))
  send(9, 'tools/bash', { cwd: root, runId: 'bash-policy-allowed', command: 'printf safe; printf also-safe', approval: 'allow' })
  const allowed = await waitFor(9)
  assert.equal(allowed.result?.content?.[0]?.text, 'safealso-safe')

  send(10, 'settings/update', { approvalMode: 'full', unattended: true })
  await waitFor(10)
  send(11, 'tools/bash', { cwd: root, command: 'printf "blocked unattended"' })
  const unattended = await waitFor(11)
  assert.match(unattended.error?.message ?? '', /approval/i)
  send(13, 'sessions/list', {})
  const session = ((await waitFor(13)).result?.sessions || []).find((item: any) => item.id === sessionId)
  assert.ok(session?.toolAudit?.some((item: any) => item.tool === 'bash' && item.settlement === 'success'))
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(root, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi bash tool obeys Host approval and returns Pi output')
