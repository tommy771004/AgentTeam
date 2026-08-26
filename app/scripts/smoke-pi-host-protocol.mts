import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

type HostMessage = {
  id?: string | number
  result?: { protocolVersion?: number; capabilities?: string[]; status?: string }
  error?: { code: string; message: string }
  event?: string
}

const hostEntry = process.env.PI_HOST_ENTRY || resolve(import.meta.dirname, '../dist-electron/pi-host.js')
const hostArgs = hostEntry.endsWith('.ts') ? ['--experimental-strip-types', hostEntry] : [hostEntry]
const stateDir = await mkdtemp(join(tmpdir(), 'pi-host-protocol-'))
const host = spawn(process.execPath, hostArgs, {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json') },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: HostMessage[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as HostMessage))

const waitFor = async (predicate: (message: HostMessage) => boolean): Promise<HostMessage> => {
  for (;;) {
    const current = messages.find(predicate)
    if (current) return current
    await once(output, 'line')
  }
}

try {
  host.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { protocolVersion: 4, client: 'smoke', capabilities: ['attachments-v1'] } })}\n`)
  const initialized = await waitFor((message) => message.id === 1)
  assert.deepEqual(initialized.result, {
    protocolVersion: 4,
    capabilities: ['health', 'settings', 'sessions', 'turns', 'runtime', 'tools', 'tool-contract-v1', 'attachments-v1', 'events', 'automation', 'resources', 'memory', 'capabilities'],
    status: 'ready',
  })

  host.stdin.write(`${JSON.stringify({ id: 2, method: 'runs/active', params: {} })}\n`)
  const attachments = await waitFor((message) => message.id === 2)
  assert.deepEqual(attachments.result?.activeRuns, [])
  assert.deepEqual(attachments.result?.terminalRuns, [])

  host.stdin.write(`${JSON.stringify({ id: 21, method: 'runs/finalize-claim', params: { runId: 'unknown-run', claimantId: 'renderer-a' } })}\n`)
  const claim = await waitFor((message) => message.id === 21)
  assert.deepEqual(claim.result?.finalizationClaim, {
    runId: 'unknown-run',
    claimed: false,
    owner: false,
    state: 'missing',
    claimEpoch: 0,
  })

  host.stdin.write(`${JSON.stringify({ id: 22, method: 'runs/finalize-complete', params: { runId: 'unknown-run', claimantId: 'renderer-a', claimEpoch: 1 } })}\n`)
  const complete = await waitFor((message) => message.id === 22)
  assert.deepEqual(complete.result?.finalizationComplete, {
    runId: 'unknown-run',
    completed: false,
    owner: false,
    state: 'missing',
    claimEpoch: 0,
  })

  host.stdin.write(`${JSON.stringify({ id: 3, method: 'health/get', params: {} })}\n`)
  const health = await waitFor((message) => message.id === 3)
  assert.equal(health.result?.status, 'ready')

  host.stdin.write(`${JSON.stringify({ id: 4, method: 'runs/ack', params: { runId: 'unknown-run' } })}\n`)
  const ack = await waitFor((message) => message.id === 4)
  assert.deepEqual(ack.result, { runId: 'unknown-run', resolved: true })

  host.stdin.write(`${JSON.stringify({ id: 5, method: 'initialize', params: { protocolVersion: 99 } })}\n`)
  const rejected = await waitFor((message) => message.id === 5)
  assert.deepEqual(rejected.error, {
    code: 'protocol_mismatch',
    message: 'Unsupported Pi Host Protocol version: 99',
  })
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(stateDir, { recursive: true, force: true })
}
console.log('pi host protocol handshake is valid')
