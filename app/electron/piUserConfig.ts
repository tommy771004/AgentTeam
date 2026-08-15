import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { PiSettings, PiThinkingLevel } from './piAgentProfile.ts'

type JsonObject = Record<string, unknown>

export type PiOAuthSyncStatus = {
  sources: string[]
  sourceKinds: Array<'codex-cli' | 'claude-cli'>
  importedProviders: string[]
  skippedProviders: string[]
  conflicts: string[]
}

export type PiUserConfigBootstrap = {
  agentDir?: string
  settingsPath?: string
  authPath?: string
  settings: Partial<Pick<PiSettings, 'provider' | 'model' | 'thinkingLevel' | 'compaction'>>
  oauth: PiOAuthSyncStatus
}

type PiOAuthCredential = JsonObject & {
  type: 'oauth'
  access: string
  refresh: string
  expires: number
}

type OAuthImport = {
  provider: string
  credential: PiOAuthCredential
  sourcePath: string
  sourceKind: 'codex-cli' | 'claude-cli'
  sourceUpdatedAt?: string
  accountId?: string
}

const PI_AGENT_FILES = ['settings.json', 'models.json', 'auth.json']

function expandPath(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith(`~${path.sep}`) || trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  return path.resolve(trimmed)
}

function envPath(name: string): string | undefined {
  const value = process.env[name]
  return value?.trim() ? expandPath(value) : undefined
}

function hasPiConfig(dir: string): boolean {
  return PI_AGENT_FILES.some((name) => existsSync(path.join(dir, name)))
}

/**
 * Resolve the Pi directory used by the Electron host.
 *
 * The packaged app supplies SUBAGENTS_PI_NATIVE_AGENT_DIR as the user's normal
 * ~/.pi/agent directory. An empty native directory deliberately falls back to
 * the app-owned directory so first-run state stays isolated and test hosts do
 * not accidentally read the developer's personal Pi account.
 */
export function resolvePiAgentDir(): string | undefined {
  const nativeDir = envPath('SUBAGENTS_PI_NATIVE_AGENT_DIR')
  const appDir = envPath('SUBAGENTS_PI_AGENT_DIR')
  if (nativeDir && hasPiConfig(nativeDir)) return nativeDir
  return appDir || nativeDir
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}

async function readJsonObject(filePath: string): Promise<JsonObject | null> {
  try {
    return asObject(JSON.parse(await readFile(filePath, 'utf8')))
  } catch {
    return null
  }
}

export function normalizePiThinkingLevel(value: unknown): PiThinkingLevel | undefined {
  if (typeof value !== 'string') return undefined
  const level = value.trim().toLowerCase()
  return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level)
    ? level as PiThinkingLevel
    : undefined
}

export function projectNativePiSettings(value: unknown): PiUserConfigBootstrap['settings'] {
  const source = asObject(value)
  if (!source) return {}
  const settings: PiUserConfigBootstrap['settings'] = {}
  if (typeof source.defaultProvider === 'string') settings.provider = source.defaultProvider.trim()
  if (typeof source.defaultModel === 'string') settings.model = source.defaultModel.trim()
  const thinkingLevel = normalizePiThinkingLevel(source.defaultThinkingLevel)
  if (thinkingLevel) settings.thinkingLevel = thinkingLevel
  if (source.compaction && typeof source.compaction === 'object' && !Array.isArray(source.compaction)) {
    settings.compaction = (source.compaction as JsonObject).enabled === false ? 'manual' : 'auto'
  }
  return settings
}

async function readNativePiSettings(agentDir: string): Promise<{
  settingsPath?: string
  settings: PiUserConfigBootstrap['settings']
}> {
  const settingsPath = path.join(agentDir, 'settings.json')
  if (!existsSync(settingsPath)) return { settings: {} }
  try {
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8'))
    return { settingsPath, settings: projectNativePiSettings(parsed) }
  } catch {
    return { settingsPath, settings: {} }
  }
}

function decodeJwtPayload(token: string): JsonObject | null {
  try {
    const segment = token.split('.')[1]
    if (!segment) return null
    return asObject(JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')))
  } catch {
    return null
  }
}

function accountIdFromCodexAccessToken(token: string): string | undefined {
  const payload = decodeJwtPayload(token)
  const auth = asObject(payload?.['https://api.openai.com/auth'])
  return typeof auth?.chatgpt_account_id === 'string' ? auth.chatgpt_account_id : undefined
}

function expiresFromAccessToken(token: string): number | undefined {
  const exp = decodeJwtPayload(token)?.exp
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : undefined
}

function expiresFromRefreshTimestamp(value: unknown): number {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed + 60 * 60_000
  }
  return Date.now() + 60 * 60_000
}

function codexOAuthImport(value: unknown, sourcePath: string): OAuthImport | null {
  const root = asObject(value)
  const tokens = asObject(root?.tokens)
  const access = typeof tokens?.access_token === 'string' ? tokens.access_token.trim() : ''
  const refresh = typeof tokens?.refresh_token === 'string' ? tokens.refresh_token.trim() : ''
  if (!access || !refresh) return null
  const accountId = typeof tokens?.account_id === 'string'
    ? tokens.account_id.trim()
    : accountIdFromCodexAccessToken(access)
  if (!accountId) return null
  const expires = expiresFromAccessToken(access) || expiresFromRefreshTimestamp(root?.last_refresh)
  return {
    provider: 'openai-codex',
    sourcePath,
    sourceKind: 'codex-cli',
    sourceUpdatedAt: typeof root?.last_refresh === 'string' ? root.last_refresh : undefined,
    accountId,
    credential: { type: 'oauth', access, refresh, expires, accountId },
  }
}

function claudeOAuthImport(value: unknown, sourcePath: string): OAuthImport | null {
  const root = asObject(value)
  const oauth = asObject(root?.claudeAiOauth)
  const access = typeof oauth?.accessToken === 'string' ? oauth.accessToken.trim() : ''
  const refresh = typeof oauth?.refreshToken === 'string' ? oauth.refreshToken.trim() : ''
  const expiresAt = typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : undefined
  if (!access || !refresh || !expiresAt) return null
  return {
    provider: 'anthropic',
    sourcePath,
    sourceKind: 'claude-cli',
    credential: { type: 'oauth', access, refresh, expires: expiresAt },
  }
}

function credentialAccountId(value: unknown): string | undefined {
  const object = asObject(value)
  return typeof object?.accountId === 'string' ? object.accountId : undefined
}

function sourceMarker(value: unknown): { kind?: string; updatedAt?: string } | undefined {
  const marker = asObject(asObject(value)?.subagentsSource)
  if (!marker) return undefined
  return {
    kind: typeof marker.kind === 'string' ? marker.kind : undefined,
    updatedAt: typeof marker.updatedAt === 'string' ? marker.updatedAt : undefined,
  }
}

function shouldImportCredential(current: unknown, incoming: OAuthImport): 'import' | 'skip' | 'conflict' {
  const existing = asObject(current)
  if (!existing) return 'import'
  if (existing.type !== 'oauth') return 'conflict'

  const existingAccountId = credentialAccountId(existing)
  if (incoming.accountId && existingAccountId && incoming.accountId !== existingAccountId) return 'conflict'
  if (existing.access === incoming.credential.access && existing.refresh === incoming.credential.refresh) return 'skip'

  const marker = sourceMarker(existing)
  if (marker?.kind === incoming.sourceKind) {
    if (marker.updatedAt && incoming.sourceUpdatedAt && incoming.sourceUpdatedAt <= marker.updatedAt) return 'skip'
    return 'import'
  }

  // A valid CLI OAuth source is an explicit user choice. If the account matches,
  // let it become Pi's credential on first bootstrap; the source marker then
  // prevents a stale CLI snapshot from replacing a later Pi refresh.
  return 'import'
}

async function syncPiCliOAuth(agentDir: string): Promise<PiOAuthSyncStatus> {
  const sources: OAuthImport[] = []
  const codexPath = envPath('SUBAGENTS_CODEX_AUTH_PATH') || path.join(os.homedir(), '.codex', 'auth.json')
  if (existsSync(codexPath)) {
    const imported = codexOAuthImport(await readJsonObject(codexPath), codexPath)
    if (imported) sources.push(imported)
  }
  const claudePath = envPath('SUBAGENTS_CLAUDE_CREDENTIALS_PATH') || path.join(os.homedir(), '.claude', '.credentials.json')
  if (existsSync(claudePath)) {
    const imported = claudeOAuthImport(await readJsonObject(claudePath), claudePath)
    if (imported) sources.push(imported)
  }

  const status: PiOAuthSyncStatus = {
    sources: sources.map((source) => source.sourcePath),
    sourceKinds: sources.map((source) => source.sourceKind),
    importedProviders: [],
    skippedProviders: [],
    conflicts: [],
  }
  if (!sources.length || process.env.SUBAGENTS_PI_SYNC_CLI_OAUTH === 'false') return status

  const authPath = path.join(agentDir, 'auth.json')
  const existing = existsSync(authPath) ? await readJsonObject(authPath) : {}
  if (existsSync(authPath) && !existing) return status
  const next = { ...(existing || {}) }
  let changed = false
  for (const source of sources) {
    const decision = shouldImportCredential(next[source.provider], source)
    if (decision === 'conflict') {
      status.conflicts.push(source.provider)
      continue
    }
    if (decision === 'skip') {
      status.skippedProviders.push(source.provider)
      continue
    }
    next[source.provider] = {
      ...source.credential,
      subagentsSource: {
        kind: source.sourceKind,
        ...(source.sourceUpdatedAt ? { updatedAt: source.sourceUpdatedAt } : {}),
      },
    }
    status.importedProviders.push(source.provider)
    changed = true
  }
  if (!changed) return status

  await mkdir(agentDir, { recursive: true, mode: 0o700 })
  const temporaryPath = `${authPath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryPath, authPath)
  return status
}

export async function bootstrapPiUserConfig(): Promise<PiUserConfigBootstrap> {
  const agentDir = resolvePiAgentDir()
  if (!agentDir) return { settings: {}, oauth: { sources: [], sourceKinds: [], importedProviders: [], skippedProviders: [], conflicts: [] } }
  const native = await readNativePiSettings(agentDir)
  let oauth: PiOAuthSyncStatus = { sources: [], sourceKinds: [], importedProviders: [], skippedProviders: [], conflicts: [] }
  try {
    oauth = await syncPiCliOAuth(agentDir)
  } catch (error) {
    console.error('[pi-host] CLI OAuth sync skipped', error)
  }
  return {
    agentDir,
    settingsPath: native.settingsPath,
    authPath: path.join(agentDir, 'auth.json'),
    settings: native.settings,
    oauth,
  }
}
