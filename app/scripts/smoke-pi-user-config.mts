import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { bootstrapPiUserConfig, resolvePiAgentDir } from '../electron/piUserConfig.ts'

const root = await mkdtemp(join(tmpdir(), 'subagents-pi-user-config-'))
const nativeDir = join(root, 'native-agent')
const appDir = join(root, 'app-agent')
const codexAuthPath = join(root, 'codex-auth.json')
const absentClaudePath = join(root, 'missing-claude-credentials.json')
const envKeys = [
  'SUBAGENTS_PI_NATIVE_AGENT_DIR',
  'SUBAGENTS_PI_AGENT_DIR',
  'SUBAGENTS_CODEX_AUTH_PATH',
  'SUBAGENTS_CLAUDE_CREDENTIALS_PATH',
  'SUBAGENTS_PI_SYNC_CLI_OAUTH',
] as const
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))

const jwt = (accountId: string, expiresAt: number) => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt, 'https://api.openai.com/auth': { chatgpt_account_id: accountId } })).toString('base64url')
  return `${header}.${payload}.signature`
}

try {
  await mkdir(nativeDir, { recursive: true })
  await writeFile(join(nativeDir, 'settings.json'), JSON.stringify({
    defaultProvider: 'openai-codex',
    defaultModel: 'gpt-5.6-luna',
    defaultThinkingLevel: 'max',
    compaction: { enabled: false },
  }))
  const firstAccess = jwt('acct-smoke', Math.floor(Date.now() / 1000) + 3600)
  await writeFile(codexAuthPath, JSON.stringify({
    tokens: { access_token: firstAccess, refresh_token: 'refresh-one', account_id: 'acct-smoke' },
    last_refresh: '2026-08-15T10:00:00.000Z',
  }))
  process.env.SUBAGENTS_PI_NATIVE_AGENT_DIR = nativeDir
  process.env.SUBAGENTS_PI_AGENT_DIR = appDir
  process.env.SUBAGENTS_CODEX_AUTH_PATH = codexAuthPath
  process.env.SUBAGENTS_CLAUDE_CREDENTIALS_PATH = absentClaudePath
  process.env.SUBAGENTS_PI_SYNC_CLI_OAUTH = 'true'

  assert.equal(resolvePiAgentDir(), nativeDir)
  const first = await bootstrapPiUserConfig()
  assert.deepEqual(first.settings, {
    provider: 'openai-codex',
    model: 'gpt-5.6-luna',
    thinkingLevel: 'max',
    compaction: 'manual',
  })
  assert.deepEqual(first.oauth.sourceKinds, ['codex-cli'])
  assert.deepEqual(first.oauth.importedProviders, ['openai-codex'])
  const firstAuth = JSON.parse(await readFile(join(nativeDir, 'auth.json'), 'utf8')) as Record<string, Record<string, unknown>>
  assert.equal(firstAuth['openai-codex'].access, firstAccess)
  assert.equal(firstAuth['openai-codex'].accountId, 'acct-smoke')

  const second = await bootstrapPiUserConfig()
  assert.deepEqual(second.oauth.skippedProviders, ['openai-codex'])

  const secondAccess = jwt('acct-smoke', Math.floor(Date.now() / 1000) + 7200)
  await writeFile(codexAuthPath, JSON.stringify({
    tokens: { access_token: secondAccess, refresh_token: 'refresh-two', account_id: 'acct-smoke' },
    last_refresh: '2026-08-15T11:00:00.000Z',
  }))
  const third = await bootstrapPiUserConfig()
  assert.deepEqual(third.oauth.importedProviders, ['openai-codex'])
  const secondAuth = JSON.parse(await readFile(join(nativeDir, 'auth.json'), 'utf8')) as Record<string, Record<string, unknown>>
  assert.equal(secondAuth['openai-codex'].refresh, 'refresh-two')

  const staleAccess = jwt('acct-smoke', Math.floor(Date.now() / 1000) + 5400)
  await writeFile(codexAuthPath, JSON.stringify({
    tokens: { access_token: staleAccess, refresh_token: 'refresh-stale', account_id: 'acct-smoke' },
    last_refresh: '2026-08-15T10:30:00.000Z',
  }))
  const stale = await bootstrapPiUserConfig()
  assert.deepEqual(stale.oauth.skippedProviders, ['openai-codex'])
  const preservedAuth = JSON.parse(await readFile(join(nativeDir, 'auth.json'), 'utf8')) as Record<string, Record<string, unknown>>
  assert.equal(preservedAuth['openai-codex'].refresh, 'refresh-two')

  const otherAccountAccess = jwt('acct-other', Math.floor(Date.now() / 1000) + 7200)
  await writeFile(codexAuthPath, JSON.stringify({
    tokens: { access_token: otherAccountAccess, refresh_token: 'refresh-other', account_id: 'acct-other' },
    last_refresh: '2026-08-15T12:00:00.000Z',
  }))
  const conflict = await bootstrapPiUserConfig()
  assert.deepEqual(conflict.oauth.conflicts, ['openai-codex'])
  const conflictPreservedAuth = JSON.parse(await readFile(join(nativeDir, 'auth.json'), 'utf8')) as Record<string, Record<string, unknown>>
  assert.equal(conflictPreservedAuth['openai-codex'].accountId, 'acct-smoke')
  assert.equal(conflictPreservedAuth['openai-codex'].refresh, 'refresh-two')
} finally {
  for (const key of envKeys) {
    const value = previousEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(root, { recursive: true, force: true })
}

console.log('pi user config and CLI OAuth bootstrap are valid')
