import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'

const protocolVersion = Number(
  (await readFile(resolve(import.meta.dirname, '../electron/piHostProtocol.ts'), 'utf8'))
    .match(/PI_HOST_PROTOCOL_VERSION = (\d+) as const/)?.[1],
)

const currentCliPath = process.env.SUBAGENTS_CODEX_AUTH_PATH || join(homedir(), '.codex', 'auth.json')
const stalePiPath = process.env.SUBAGENTS_STALE_PI_AUTH_PATH
  || join(homedir(), 'Library/Application Support/subagents-ai/pi-agent/auth.json')
const currentCli = JSON.parse(await readFile(currentCliPath, 'utf8')) as {
  tokens?: { access_token?: string; refresh_token?: string; account_id?: string }
  last_refresh?: string
}
const stalePi = JSON.parse(await readFile(stalePiPath, 'utf8')) as Record<string, {
  access?: string
  refresh?: string
  accountId?: string
  expires?: number
  subagentsSource?: { updatedAt?: string }
}>
const stale = stalePi['openai-codex']
if (!stale?.access || !stale.refresh || !stale.accountId) throw new Error('stale Pi Codex credential is unavailable')
if (!currentCli.tokens?.access_token || !currentCli.tokens.refresh_token || !currentCli.tokens.account_id) {
  throw new Error('current Codex CLI credential is unavailable')
}
if (stale.access === currentCli.tokens.access_token) throw new Error('Pi and Codex CLI credentials are identical; no rotation to qualify')

const stateDir = await mkdtemp(join(tmpdir(), 'pi-sub-oauth-rotation-'))
const agentDir = join(stateDir, 'agent')
const sourcePath = join(stateDir, 'codex-auth.json')
await writeFile(sourcePath, JSON.stringify({
  tokens: {
    access_token: stale.access,
    refresh_token: stale.refresh,
    account_id: stale.accountId,
  },
  last_refresh: stale.subagentsSource?.updatedAt,
}))

const hostEntry = process.env.PI_HOST_ENTRY || resolve(import.meta.dirname, '../electron/piHostEntry.ts')
const host = spawn(process.execPath, ['--experimental-strip-types', hostEntry], {
  env: {
    ...process.env,
    SUBAGENTS_PI_SYNC_CLI_OAUTH: 'true',
    SUBAGENTS_CODEX_AUTH_PATH: sourcePath,
    SUBAGENTS_CLAUDE_CREDENTIALS_PATH: join(stateDir, 'missing-claude.json'),
    SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'),
    SUBAGENTS_PI_AGENT_DIR: agentDir,
    SUBAGENTS_PI_NATIVE_AGENT_DIR: join(stateDir, 'missing-native-agent'),
  },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, unknown>> = []
output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, unknown>))
const send = (id: number, method: string, params: Record<string, unknown> = {}) =>
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
const waitForId = async (id: number): Promise<Record<string, unknown>> => {
  for (;;) {
    const found = messages.find((message) => message.id === id)
    if (found) return found
    await once(output, 'line')
  }
}

try {
  send(1, 'initialize', { protocolVersion, client: 'subagents-oauth-rotation-e2e', capabilities: [] })
  await waitForId(1)
  send(2, 'sessions/create', { title: 'OAuth rotation qualification' })
  const created = await waitForId(2)
  const sessionId = String((created.result as { sessionId?: string } | undefined)?.sessionId || '')
  if (!sessionId) throw new Error(`sessions/create failed: ${JSON.stringify(created)}`)
  send(3, 'settings/update', { provider: 'openai-codex', model: 'gpt-5.6-luna' })
  await waitForId(3)

  send(4, 'turn/submit', { sessionId, runId: 'oauth-rotation-stale', prompt: 'Reply with exactly: pong' })
  const staleAttempt = await waitForId(4)
  const staleDetail = JSON.stringify(staleAttempt)
  if (!staleDetail.includes('invalidated oauth token')) {
    throw new Error(`stale token did not reproduce the reported failure: ${staleDetail.slice(0, 1000)}`)
  }
  console.log('RED-CAPABLE: stale App credential reproduced "invalidated oauth token"')

  await writeFile(sourcePath, JSON.stringify(currentCli))
  send(5, 'turn/submit', { sessionId, runId: 'oauth-rotation-current', prompt: 'Reply with exactly: pong' })
  const recovered = await waitForId(5)
  const result = recovered.result as { settlement?: string; items?: Array<{ content?: string }> } | undefined
  if (result?.settlement !== 'answered') {
    throw new Error(`Host did not recover after CLI OAuth rotation: ${JSON.stringify(recovered).slice(0, 1200)}`)
  }
  console.log('OAUTH ROTATION E2E PASS: a running Host picked up the rotated CLI token without restart')
} finally {
  host.stdin.end()
  await once(host, 'exit').catch(() => host.kill())
  await rm(stateDir, { recursive: true, force: true })
}
