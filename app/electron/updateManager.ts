import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app, safeStorage } from 'electron'
import {
  artifactSignaturePayload,
  buildMigrationSnapshot,
  normalizeMigrationSnapshot,
  validateUpdateManifest,
  type MigrationSnapshot,
  type SignedUpdateManifest,
  type UpdateArch,
  type UpdatePlatform,
} from '../src/agent/updateContracts.ts'
import { sha256Hex, verifyArtifactSignature, verifyManifestSignature } from './updateVerification'
import { BUILT_IN_UPDATE_PUBLIC_KEY } from './updatePublicKey'

export const DEFAULT_UPDATE_CHANNEL_URL = 'https://updates.subagents.ai/beta/{platform}/{arch}/manifest.json'
export const UPDATE_STATE_VERSION = 1
const MAX_DOWNLOAD_BYTES = 1_000_000_000
const SENSITIVE_KEY = /(?:apiKey|token|secret|password|clientSecret|accessKey|privateKey)/i

function mergeMigrationSettings(current: unknown, migrated: unknown): unknown {
  if (!current || typeof current !== 'object' || Array.isArray(current) || !migrated || typeof migrated !== 'object' || Array.isArray(migrated)) return migrated
  const result: Record<string, unknown> = { ...(migrated as Record<string, unknown>) }
  for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key) && !(key in result)) result[key] = value
    else if (key in result) result[key] = mergeMigrationSettings(value, result[key])
  }
  return result
}

export type UpdateState = {
  schemaVersion: 1
  status: 'idle' | 'available' | 'deferred' | 'downloaded' | 'install-pending' | 'rolled-back' | 'failed'
  currentVersion: string
  manifest?: SignedUpdateManifest
  downloadedPath?: string
  progress: number
  deferredUntil?: string
  transactionId?: string
  backupPath?: string
  lastError?: string
  updatedAt: string
}

export type MigrationCaptureInput = {
  appVersion: string
  rendererStorage?: Record<string, string>
  vaultMetadata?: unknown[]
  projects?: Array<{ root: string; name?: string; branch?: string | null }>
  queue?: unknown
  schedules?: unknown[]
  artifactIndex?: unknown
}

function updatesRoot() {
  const root = path.join(app.getPath('userData'), 'updates')
  fs.mkdirSync(root, { recursive: true })
  return root
}

function statePath() { return path.join(updatesRoot(), 'state.json') }

function isSafeUpdatePath(candidate: string): boolean {
  const rootPath = path.resolve(updatesRoot())
  const root = fs.existsSync(rootPath) ? fs.realpathSync(rootPath) : rootPath
  const candidatePath = path.resolve(candidate)
  if (fs.existsSync(candidatePath)) {
    try {
      if (fs.lstatSync(candidatePath).isSymbolicLink()) return false
      candidate = fs.realpathSync(candidatePath)
    } catch { return false }
  }
  const resolved = path.resolve(candidate)
  const relative = path.relative(root, resolved)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function atomicWrite(file: string, value: unknown) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

function writeMigrationBackup(file: string, snapshot: MigrationSnapshot) {
  const text = JSON.stringify(snapshot)
  const bytes = (() => {
    try {
      if (safeStorage.isEncryptionAvailable()) return Buffer.concat([Buffer.from('ENC1'), safeStorage.encryptString(text)])
    } catch { /* fall back to the already-redacted snapshot */ }
    return Buffer.from(text, 'utf8')
  })()
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, bytes, { mode: 0o600 })
  fs.renameSync(tmp, file)
}

function readMigrationBackup(file: string): unknown {
  const bytes = fs.readFileSync(file)
  if (bytes.subarray(0, 4).toString('utf8') === 'ENC1') {
    return JSON.parse(safeStorage.decryptString(bytes.subarray(4)))
  }
  return JSON.parse(bytes.toString('utf8'))
}

function baseState(currentVersion: string): UpdateState {
  return { schemaVersion: 1, status: 'idle', currentVersion, progress: 0, updatedAt: new Date().toISOString() }
}

export function readUpdateState(currentVersion = app.getVersion()): UpdateState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as Partial<UpdateState>
    if (parsed.schemaVersion !== 1 || typeof parsed.status !== 'string' || typeof parsed.progress !== 'number') return baseState(currentVersion)
    return { ...baseState(currentVersion), ...parsed, currentVersion }
  } catch {
    return baseState(currentVersion)
  }
}

function writeState(state: UpdateState) {
  atomicWrite(statePath(), state)
  return state
}

function targetForCurrentApp(): { platform: UpdatePlatform; arch: UpdateArch; currentVersion: string } {
  const platform = process.platform === 'darwin' ? 'darwin' : 'win32'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return { platform, arch, currentVersion: app.getVersion() }
}

function assertChannelUrl(url: string) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('更新通道必須使用 HTTPS')
  return parsed.toString()
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(assertChannelUrl(url), { redirect: 'error', signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchBytes(url: string, onProgress?: (progress: number) => void): Promise<Uint8Array> {
  const response = await fetchWithTimeout(url, 10 * 60_000)
  if (!response.ok) throw new Error(`更新下載失敗：HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_DOWNLOAD_BYTES) throw new Error('更新檔案超過大小上限')
  if (!response.body) {
    throw new Error('更新服務未提供可限制大小的串流回應')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    total += next.value.byteLength
    if (total > MAX_DOWNLOAD_BYTES) throw new Error('更新檔案超過大小上限')
    chunks.push(next.value)
    onProgress?.(length > 0 ? Math.min(99, Math.round((total / length) * 100)) : 0)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  onProgress?.(100)
  return bytes
}

async function readManifestBytes(response: Response): Promise<Uint8Array> {
  const maxBytes = 2_000_000
  const length = Number(response.headers.get('content-length') || 0)
  if (length > maxBytes) throw new Error('更新 manifest 超過大小上限')
  if (!response.body) throw new Error('更新服務未提供可限制大小的 manifest 串流')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    total += next.value.byteLength
    if (total > maxBytes) throw new Error('更新 manifest 超過大小上限')
    chunks.push(next.value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

function resolveChannelUrl(url: string, target: { platform: UpdatePlatform; arch: UpdateArch }): string {
  return url.replaceAll('{platform}', target.platform).replaceAll('{arch}', target.arch)
}

export async function discoverUpdate(options: { url?: string; publicKeyPem: string; currentVersion?: string } ): Promise<UpdateState> {
  const currentVersion = options.currentVersion || app.getVersion()
  const target = { ...targetForCurrentApp(), currentVersion }
  const url = resolveChannelUrl(options.url || process.env.SUBAGENTS_UPDATE_MANIFEST_URL || DEFAULT_UPDATE_CHANNEL_URL, target)
  const response = await fetchWithTimeout(url, 30_000)
  if (!response.ok) throw new Error(`更新通道回應失敗：HTTP ${response.status}`)
  const manifestBytes = await readManifestBytes(response)
  const raw = JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown
  const validation = validateUpdateManifest(raw, target)
  if (!validation.ok) throw new Error(`更新 manifest 無效：${validation.errors.join('；')}`)
  if (!options.publicKeyPem.trim() || !verifyManifestSignature(validation.manifest, options.publicKeyPem)) {
    throw new Error('更新 manifest 簽章驗證失敗')
  }
  const previous = readUpdateState(currentVersion)
  const deferred = !validation.manifest.mandatory && previous.manifest?.version === validation.manifest.version && previous.deferredUntil && Date.parse(previous.deferredUntil) > Date.now()
  return writeState({
    ...baseState(currentVersion),
    status: deferred ? 'deferred' : 'available',
    manifest: validation.manifest,
    progress: deferred ? previous.progress : 0,
    deferredUntil: deferred ? previous.deferredUntil : undefined,
    updatedAt: new Date().toISOString(),
  })
}

export function deferUpdate(version: string, days = 7): UpdateState {
  const state = readUpdateState()
  if (state.manifest?.version !== version) throw new Error('找不到可延後的更新')
  if (state.manifest.mandatory) throw new Error('必要安全更新不可延後')
  const until = new Date(Date.now() + Math.max(1, Math.min(days, 30)) * 86_400_000).toISOString()
  return writeState({ ...state, status: 'deferred', deferredUntil: until, updatedAt: new Date().toISOString() })
}

export async function downloadUpdate(options: { publicKeyPem: string; onProgress?: (progress: number) => void }): Promise<UpdateState> {
  const state = readUpdateState()
  if (!state.manifest) throw new Error('尚未發現可下載的更新')
  const targetValidation = validateUpdateManifest(state.manifest, targetForCurrentApp())
  if (!targetValidation.ok) throw new Error(`更新 manifest 無效：${targetValidation.errors.join('；')}`)
  if (!options.publicKeyPem.trim() || !verifyManifestSignature(state.manifest, options.publicKeyPem)) throw new Error('更新 manifest 簽章驗證失敗')
  const bytes = await fetchBytes(state.manifest.artifact.url, options.onProgress)
  if (bytes.byteLength !== state.manifest.artifact.size || !verifyArtifactSignature(state.manifest.artifact, bytes, options.publicKeyPem)) {
    throw new Error('更新檔案雜湊或簽章驗證失敗')
  }
  const sourceName = path.basename(new URL(state.manifest.artifact.url).pathname).replace(/[^A-Za-z0-9._-]+/g, '-') || 'AgentStudio-update.bin'
  const file = path.join(updatesRoot(), `${state.manifest.version}-${state.manifest.platform}-${state.manifest.arch}-${sourceName}`)
  fs.writeFileSync(file, bytes, { mode: 0o600 })
  return writeState({ ...state, status: 'downloaded', downloadedPath: file, progress: 100, lastError: undefined, updatedAt: new Date().toISOString() })
}

export function captureMigrationSnapshot(input: MigrationCaptureInput): MigrationSnapshot {
  return buildMigrationSnapshot({
    appVersion: input.appVersion,
    rendererStorage: input.rendererStorage || {},
    projects: input.projects || [],
    queue: input.queue ?? [],
    schedules: input.schedules || [],
    artifactIndex: input.artifactIndex ?? null,
    vaultMetadata: input.vaultMetadata || [],
  })
}

export function prepareUpdateInstall(snapshot: unknown, publicKeyPem: string): UpdateState {
  const state = readUpdateState()
  if (state.status !== 'downloaded' || !state.downloadedPath || !isSafeUpdatePath(state.downloadedPath) || !fs.existsSync(state.downloadedPath)) throw new Error('更新檔案尚未下載完成')
  if (!state.manifest || !publicKeyPem.trim()) throw new Error('更新 public key 未設定')
  const bytes = fs.readFileSync(state.downloadedPath)
  const targetValidation = validateUpdateManifest(state.manifest, targetForCurrentApp())
  if (!targetValidation.ok || !verifyManifestSignature(state.manifest, publicKeyPem) || bytes.byteLength !== state.manifest.artifact.size || !verifyArtifactSignature(state.manifest.artifact, bytes, publicKeyPem)) {
    throw new Error('安裝前更新檔案驗證失敗')
  }
  const normalizedSnapshot = normalizeMigrationSnapshot(snapshot)
  if (!normalizedSnapshot) throw new Error('migration snapshot 無效或超過大小上限')
  const id = randomUUID()
  const backupPath = path.join(updatesRoot(), `migration-backup-${id}.json`)
  writeMigrationBackup(backupPath, normalizedSnapshot)
  return writeState({ ...state, status: 'install-pending', transactionId: id, backupPath, updatedAt: new Date().toISOString() })
}

export function markInstallFailure(error: unknown): UpdateState {
  const state = readUpdateState()
  return writeState({ ...state, status: 'failed', lastError: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() })
}

export function rollbackUpdate(): { ok: boolean; launchable: boolean; state: UpdateState; rollbackPath?: string; snapshot?: MigrationSnapshot } {
  const state = readUpdateState()
  if (!state.backupPath || !isSafeUpdatePath(state.backupPath) || !fs.existsSync(state.backupPath)) {
    const failed = writeState({ ...state, status: 'failed', lastError: '找不到 migration backup', updatedAt: new Date().toISOString() })
    return { ok: false, launchable: true, state: failed }
  }
  let snapshot: MigrationSnapshot
  try {
    const parsed = readMigrationBackup(state.backupPath) as unknown
    const normalized = normalizeMigrationSnapshot(parsed)
    if (!normalized) throw new Error('migration backup 無效')
    snapshot = normalized
  } catch (error) {
    const failed = writeState({ ...state, status: 'failed', lastError: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() })
    return { ok: false, launchable: true, state: failed }
  }
  try {
    const rollbackPath = path.join(updatesRoot(), `migration-rollback-${state.transactionId || Date.now()}.json`)
    writeMigrationBackup(rollbackPath, snapshot)
    if (state.downloadedPath && isSafeUpdatePath(state.downloadedPath) && fs.existsSync(state.downloadedPath)) fs.rmSync(state.downloadedPath, { force: true })
    const configDir = path.join(app.getPath('userData'), 'config')
    fs.mkdirSync(configDir, { recursive: true })
    atomicWrite(path.join(configDir, 'jobs.json'), snapshot.schedules)
    const next = writeState({ ...state, status: 'rolled-back', downloadedPath: undefined, updatedAt: new Date().toISOString() })
    return { ok: true, launchable: true, state: next, rollbackPath, snapshot }
  } catch (error) {
    const failed = { ...state, status: 'failed' as const, lastError: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() }
    try { return { ok: false, launchable: true, state: writeState(failed) } } catch { return { ok: false, launchable: true, state: failed } }
  }
}

export function pendingMigration(): { ok: boolean; snapshot?: MigrationSnapshot; state: UpdateState; error?: string } {
  const state = readUpdateState()
  if (state.status !== 'install-pending' || !state.backupPath || !isSafeUpdatePath(state.backupPath) || !fs.existsSync(state.backupPath)) return { ok: false, state }
  try {
    const parsed = readMigrationBackup(state.backupPath) as unknown
    const normalized = normalizeMigrationSnapshot(parsed)
    if (!normalized) throw new Error('migration backup 無效')
    return { ok: true, state, snapshot: normalized }
  } catch (error) {
    return { ok: false, state, error: error instanceof Error ? error.message : String(error) }
  }
}

export function completeMigration(snapshotInput?: unknown): UpdateState {
  const state = readUpdateState()
  if (state.status !== 'install-pending' && state.status !== 'rolled-back') return state
  const snapshot = normalizeMigrationSnapshot(snapshotInput)
  const settingsRaw = snapshot?.rendererStorage?.['subagents.settings.v1']
  if (settingsRaw) {
    try {
      const settingsFile = path.join(app.getPath('userData'), 'config', 'settings.json')
      const current = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {}
      const migrated = JSON.parse(settingsRaw)
      atomicWrite(settingsFile, mergeMigrationSettings(current, migrated))
    } catch { /* renderer localStorage remains the fallback */ }
  }
  return writeState({ ...state, status: state.status === 'install-pending' ? 'idle' : 'rolled-back', updatedAt: new Date().toISOString() })
}

export function updatePublicKeyFromEnv(): string {
  const override = String(process.env.SUBAGENTS_UPDATE_PUBLIC_KEY || '').replace(/\\n/g, '\n').trim()
  return !app.isPackaged && override ? override : BUILT_IN_UPDATE_PUBLIC_KEY
}

export function artifactDigestForDiagnostics(artifact: Uint8Array) { return sha256Hex(artifact) }
export function artifactPayloadForDiagnostics(manifest: SignedUpdateManifest) { return artifactSignaturePayload(manifest.artifact) }
