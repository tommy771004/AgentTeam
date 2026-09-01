import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

// The handshake version is EXTRACTED from the protocol module's source rather
// than hardcoded a fourth time (ticket 03): bumping PI_HOST_PROTOCOL_VERSION
// updates this smoke without anyone remembering the literal here.
const protocolSource = await readFile(resolve(import.meta.dirname, '../electron/piHostProtocol.ts'), 'utf8')
const PROTOCOL_VERSION = Number(protocolSource.match(/PI_HOST_PROTOCOL_VERSION = (\d+) as const/)?.[1])
assert.ok(Number.isInteger(PROTOCOL_VERSION) && PROTOCOL_VERSION >= 2, 'protocol version constant must be extractable from piHostProtocol.ts')

type HostMessage = {
  id?: string | number
  result?: {
    protocolVersion?: number
    capabilities?: string[]
    status?: string
    config?: { oauthImportedProviders?: string[]; oauthSkippedProviders?: string[]; oauthConflicts?: string[] }
    settings?: { provider?: string; model?: string }
  }
  error?: { code: string; message: string }
  event?: string
}

const hostEntry = process.env.PI_HOST_ENTRY || resolve(import.meta.dirname, '../dist-electron/pi-host.js')
const hostArgs = hostEntry.endsWith('.ts') ? ['--experimental-strip-types', hostEntry] : [hostEntry]
const stateDir = await mkdtemp(join(tmpdir(), 'pi-host-protocol-'))
const nativeAgentDir = join(stateDir, 'native-agent')
const appAgentDir = join(stateDir, 'app-agent')
const codexAuthPath = join(stateDir, 'codex-auth.json')
await Promise.all([
  mkdir(nativeAgentDir, { recursive: true }),
  mkdir(appAgentDir, { recursive: true }),
])
const codexAccess = (accountId: string) => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + 3600,
    'https://api.openai.com/auth': { chatgpt_account_id: accountId },
  })).toString('base64url')
  return `${header}.${payload}.signature`
}
const writeCodexLogin = (accountId: string) => writeFile(codexAuthPath, JSON.stringify({
  tokens: { access_token: codexAccess(accountId), refresh_token: `refresh-${accountId}`, account_id: accountId },
  last_refresh: new Date().toISOString(),
}))
await writeCodexLogin('account-a')
const host = spawn(process.execPath, hostArgs, {
  env: {
    ...process.env,
    SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'),
    SUBAGENTS_PI_NATIVE_AGENT_DIR: nativeAgentDir,
    SUBAGENTS_PI_AGENT_DIR: appAgentDir,
    SUBAGENTS_CODEX_AUTH_PATH: codexAuthPath,
    SUBAGENTS_CLAUDE_CREDENTIALS_PATH: join(stateDir, 'absent-claude.json'),
    SUBAGENTS_PI_SYNC_CLI_OAUTH: 'true',
  },
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
  host.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, client: 'smoke', capabilities: ['attachments-v1'] } })}\n`)
  const initialized = await waitFor((message) => message.id === 1)
  assert.deepEqual(initialized.result, {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: ['health', 'settings', 'sessions', 'turns', 'runtime', 'tools', 'tool-contract-v1', 'attachments-v1', 'events', 'automation', 'resources', 'packages', 'memory', 'memory-store-v1', 'memory-control-v1', 'instructions-v1', 'review-v1', 'agent-tree-v1', 'agent-collaboration-v1', 'goal-contract-v1', 'workflow-graph-v1', 'capabilities'],
    status: 'ready',
  })

  host.stdin.write(`${JSON.stringify({ id: 20, method: 'settings/get', params: {} })}\n`)
  const initialSettings = await waitFor((message) => message.id === 20)
  assert.ok(initialSettings.result?.config?.oauthSkippedProviders?.includes('openai-codex'))
  await writeCodexLogin('account-b')
  host.stdin.write(`${JSON.stringify({ id: 23, method: 'settings/get', params: {} })}\n`)
  const refreshedSettings = await waitFor((message) => message.id === 23)
  assert.ok(refreshedSettings.result?.config?.oauthImportedProviders?.includes('openai-codex'))
  host.stdin.write(`${JSON.stringify({ id: 24, method: 'settings/update', params: { provider: 'openai-codex', model: 'gpt-5.6-sol' } })}\n`)
  const followedSave = await waitFor((message) => message.id === 24)
  assert.equal(followedSave.error, undefined, 'the Host follows the currently logged-in CLI account')

  host.stdin.write(`${JSON.stringify({ id: 28, method: 'settings/update', params: { followCliOAuthAccount: false } })}\n`)
  const optedOut = await waitFor((message) => message.id === 28)
  assert.equal(optedOut.result?.settings?.followCliOAuthAccount, false)
  await writeCodexLogin('account-a')
  host.stdin.write(`${JSON.stringify({ id: 25, method: 'settings/get', params: {} })}\n`)
  const conflicted = await waitFor((message) => message.id === 25)
  assert.ok(conflicted.result?.config?.oauthConflicts?.includes('openai-codex'), 'opt-out preserves conflict protection')
  host.stdin.write(`${JSON.stringify({ id: 29, method: 'settings/update', params: { followCliOAuthAccount: true } })}\n`)
  const followedAgain = await waitFor((message) => message.id === 29)
  assert.equal(followedAgain.error, undefined)
  assert.equal(followedAgain.result?.settings?.followCliOAuthAccount, true)
  host.stdin.write(`${JSON.stringify({ id: 26, method: 'settings/update', params: { model: 'missing-subscription-model' } })}\n`)
  const missingModelSave = await waitFor((message) => message.id === 26)
  assert.equal(missingModelSave.error?.code, 'invalid_request')
  host.stdin.write(`${JSON.stringify({ id: 27, method: 'settings/get', params: {} })}\n`)
  const preservedSettings = await waitFor((message) => message.id === 27)
  assert.equal(preservedSettings.result?.settings?.model, 'gpt-5.6-sol', 'failed save leaves the valid Host pair intact')

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
