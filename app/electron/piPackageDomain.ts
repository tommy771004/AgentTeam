import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { resolvePiAgentDir } from './piUserConfig.ts'
import { piCodingAgentModule } from './piVendor.ts'

const MAX_PACKAGES = 128
const MAX_PACKAGE_SOURCE_BYTES = 512
const MAX_PACKAGE_JSON_BYTES = 128 * 1024
const MAX_DIAGNOSTICS = 32
const MAX_DIAGNOSTIC_MESSAGE = 320
const PACKAGE_TOOL_TRUST_FILE = 'agentstudio-package-tools.json'

export type PiPackageMutationAction = 'install' | 'remove'
export type PiPackageDomainErrorCode = 'invalid_request' | 'conflict' | 'not_found' | 'unavailable' | 'runtime_error'

export class PiPackageDomainError extends Error {
  readonly code: PiPackageDomainErrorCode

  constructor(code: PiPackageDomainErrorCode, message: string) {
    super(boundedMessage(message))
    this.name = 'PiPackageDomainError'
    this.code = code
  }
}

export type PiPackageResourceKind = 'extensions' | 'skills' | 'prompts' | 'themes'

export type PiPackageDiagnostic = {
  code: 'agent-dir-unavailable' | 'inventory-truncated' | 'metadata-missing' | 'metadata-invalid' | 'version-mismatch' | 'resource-resolution-failed' | 'tool-name-collision'
  message: string
}

export type PiPackageToolTrust = 'unsupported' | 'inactive' | 'trusted-disabled' | 'active'

export type PiPackageToolProvenance = Readonly<{
  packageName: string
  version: string
  source: string
  origin: 'package'
}>

export type PiPackageInventoryItem = {
  source: string
  scope: 'user'
  filtered: boolean
  installed: boolean
  name?: string
  version?: string
  resourceTypesKnown: boolean
  resources: Array<{ kind: PiPackageResourceKind; total: number; enabled: number }>
  toolTrust: PiPackageToolTrust
  toolNames: string[]
  diagnostics: PiPackageDiagnostic[]
}

export type PiPackageInventory = {
  packages: PiPackageInventoryItem[]
  diagnostics: PiPackageDiagnostic[]
}

type ConfiguredPackage = {
  source: string
  scope: 'user' | 'project'
  filtered: boolean
  installedPath?: string
}

type ResolvedResource = {
  path: string
  enabled: boolean
  metadata: { source: string; scope: 'user' | 'project' | 'temporary'; origin: 'package' | 'top-level' }
}

export type PiPackageSkillResource = {
  path: string
  installedPath: string
  packageName: string
  version: string
  source: string
  origin: 'package'
}

export type PiPackageExtensionResource = PiPackageToolProvenance & {
  path: string
  installedPath: string
}

type PiPackageToolTrustRecord = PiPackageToolProvenance & {
  trusted: true
  enabled: boolean
}

type PiPackageToolTrustState = {
  version: 1
  packages: Record<string, PiPackageToolTrustRecord>
}

type ResolvedPaths = Record<PiPackageResourceKind, ResolvedResource[]>

type PackageManager = {
  listConfiguredPackages(): ConfiguredPackage[]
  resolve(onMissing: (source: string) => Promise<'skip'>): Promise<ResolvedPaths>
  installAndPersist(source: string, options?: { local?: boolean }): Promise<void>
  removeAndPersist(source: string, options?: { local?: boolean }): Promise<boolean>
}

type PiPackageApi = {
  SettingsManager: {
    create(cwd: string, agentDir: string, options?: { projectTrusted?: boolean }): unknown
  }
  DefaultPackageManager: new (options: { cwd: string; agentDir: string; settingsManager: unknown }) => PackageManager
}

const RESOURCE_KINDS: PiPackageResourceKind[] = ['extensions', 'skills', 'prompts', 'themes']
const discoveredPackageTools = new Map<string, { names: string[]; collisions: string[] }>()

function boundedMessage(message: string): string {
  return message.trim().slice(0, MAX_DIAGNOSTIC_MESSAGE) || 'Unknown package inventory error'
}

function diagnostic(code: PiPackageDiagnostic['code'], message: string): PiPackageDiagnostic {
  return { code, message: boundedMessage(message) }
}

function packageToolTrustPath(agentDir: string): string {
  return join(agentDir, PACKAGE_TOOL_TRUST_FILE)
}

async function readPackageToolTrust(agentDir: string): Promise<PiPackageToolTrustState> {
  try {
    const raw = await readFile(packageToolTrustPath(agentDir), 'utf8')
    if (Buffer.byteLength(raw, 'utf8') > 128 * 1024) return { version: 1, packages: {} }
    const parsed = JSON.parse(raw) as Partial<PiPackageToolTrustState>
    if (parsed.version !== 1 || !parsed.packages || typeof parsed.packages !== 'object' || Array.isArray(parsed.packages)) {
      return { version: 1, packages: {} }
    }
    const packages: Record<string, PiPackageToolTrustRecord> = {}
    for (const [source, value] of Object.entries(parsed.packages).slice(0, MAX_PACKAGES)) {
      if (!value || typeof value !== 'object') continue
      const record = value as Partial<PiPackageToolTrustRecord>
      try {
        const pinned = parsePinnedNpmPackageSource(source)
        if (record.trusted !== true || typeof record.enabled !== 'boolean'
          || record.packageName !== pinned.name || record.version !== pinned.version
          || record.source !== pinned.source || record.origin !== 'package') continue
        packages[source] = { ...record, trusted: true } as PiPackageToolTrustRecord
      } catch { /* an invalid or stale record grants no authority */ }
    }
    return { version: 1, packages }
  } catch {
    return { version: 1, packages: {} }
  }
}

async function writePackageToolTrust(agentDir: string, state: PiPackageToolTrustState): Promise<void> {
  await mkdir(agentDir, { recursive: true, mode: 0o700 })
  const path = packageToolTrustPath(agentDir)
  const temporary = `${path}.${process.pid}.${createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 12)}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

async function clearPackageToolTrust(agentDir: string, source: string): Promise<void> {
  const state = await readPackageToolTrust(agentDir)
  if (!(source in state.packages)) return
  delete state.packages[source]
  await writePackageToolTrust(agentDir, state)
  discoveredPackageTools.delete(source)
}

/** Runtime-owned diagnostics discovered only after a trusted extension loads. */
export function recordPiPackageToolDiscovery(source: string, names: readonly string[], collisions: readonly string[]): void {
  discoveredPackageTools.set(source, {
    names: [...new Set(names)].sort().slice(0, 128),
    collisions: [...new Set(collisions)].sort().slice(0, 32),
  })
}

async function readPackageMetadata(installedPath: string): Promise<{
  name?: string
  version?: string
  diagnostic?: PiPackageDiagnostic
}> {
  const packageJsonPath = join(installedPath, 'package.json')
  try {
    const handle = await open(packageJsonPath, 'r')
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > MAX_PACKAGE_JSON_BYTES) {
        return { diagnostic: diagnostic('metadata-invalid', 'package.json is not a bounded regular file') }
      }
      const bytes = Buffer.alloc(info.size)
      const { bytesRead } = await handle.read(bytes, 0, info.size, 0)
      const value = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')) as { name?: unknown; version?: unknown }
      const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 256) : undefined
      const version = typeof value.version === 'string' && value.version.trim() ? value.version.trim().slice(0, 128) : undefined
      return {
        ...(name ? { name } : {}),
        ...(version ? { version } : {}),
        ...(!version ? { diagnostic: diagnostic('metadata-invalid', 'package.json does not declare an exact installed version') } : {}),
      }
    } finally {
      await handle.close()
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'metadata-missing' : 'metadata-invalid'
    return { diagnostic: diagnostic(code, error instanceof Error ? error.message : 'Unable to read package.json') }
  }
}

const EXACT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const NPM_PACKAGE_SEGMENT = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9_-])?$/

function validNpmPackageName(name: string): boolean {
  const scoped = name.startsWith('@')
  const segments = scoped ? name.slice(1).split('/') : [name]
  if (segments.length !== (scoped ? 2 : 1) || segments.some((segment) => !NPM_PACKAGE_SEGMENT.test(segment))) return false
  const packageName = segments.at(-1)
  return packageName !== 'node_modules' && packageName !== 'favicon.ico'
}

function npmPackageName(source: string): string | undefined {
  if (!source.startsWith('npm:')) return undefined
  const spec = source.slice(4).trim()
  const separator = spec.lastIndexOf('@')
  if (separator > 0 && (!spec.startsWith('@') || separator > spec.indexOf('/'))) return spec.slice(0, separator)
  return spec || undefined
}

export function parsePinnedNpmPackageSource(input: unknown): { source: string; name: string; version: string } {
  if (typeof input !== 'string') throw new PiPackageDomainError('invalid_request', 'Package source must be a string')
  const source = input.trim()
  if (!source || Buffer.byteLength(source, 'utf8') > MAX_PACKAGE_SOURCE_BYTES) {
    throw new PiPackageDomainError('invalid_request', `Package source must be between 1 and ${MAX_PACKAGE_SOURCE_BYTES} bytes`)
  }
  if (!source.startsWith('npm:')) {
    throw new PiPackageDomainError('invalid_request', 'Only pinned npm sources are supported; git, URL, and local paths are unavailable')
  }
  const spec = source.slice(4)
  const separator = spec.lastIndexOf('@')
  const name = separator > 0 ? spec.slice(0, separator) : ''
  const version = separator > 0 ? spec.slice(separator + 1) : ''
  if (name.length > 214 || !validNpmPackageName(name) || !EXACT_SEMVER.test(version)) {
    throw new PiPackageDomainError('invalid_request', 'Expected npm:<valid-package-name>@<exact-semver> in user scope')
  }
  return { source, name, version }
}

function exactConfiguredNpmVersion(source: string): string | undefined {
  try {
    return parsePinnedNpmPackageSource(source).version
  } catch {
    return undefined
  }
}

function createPackageManager(agentDir: string): PackageManager {
  // This synthetic cwd prevents project-local settings from entering the
  // user package lifecycle. No directory is created by this helper.
  const packageCwd = join(agentDir, '.agentstudio-package-inventory')
  const pi = piCodingAgentModule as unknown as PiPackageApi
  const settingsManager = pi.SettingsManager.create(packageCwd, agentDir, { projectTrusted: false })
  return new pi.DefaultPackageManager({ cwd: packageCwd, agentDir, settingsManager })
}

function packageResources(source: string, resolved: ResolvedPaths | undefined) {
  if (!resolved) return []
  return RESOURCE_KINDS.flatMap((kind) => {
    const resources = resolved[kind].filter((resource) =>
      resource.metadata.origin === 'package'
      && resource.metadata.scope === 'user'
      && resource.metadata.source === source)
    return resources.length > 0
      ? [{ kind, total: resources.length, enabled: resources.filter((resource) => resource.enabled).length }]
      : []
  })
}

/**
 * Read-only projection of Pi's configured user packages.
 *
 * Missing sources are always skipped during resource resolution. Inventory
 * must never turn a Settings page visit into npm/git installation or execute
 * an extension module.
 */
export async function listPiPackageInventory(): Promise<PiPackageInventory> {
  const agentDir = resolvePiAgentDir()
  if (!agentDir) {
    return {
      packages: [],
      diagnostics: [diagnostic('agent-dir-unavailable', 'Pi user agent directory is unavailable')],
    }
  }

  const packageManager = createPackageManager(agentDir)
  const toolTrust = await readPackageToolTrust(agentDir)
  const configured = packageManager.listConfiguredPackages().filter((item) => item.scope === 'user')
  const diagnostics: PiPackageDiagnostic[] = []
  const selected = configured.slice(0, MAX_PACKAGES)
  if (configured.length > selected.length) {
    diagnostics.push(diagnostic('inventory-truncated', `Package inventory is limited to ${MAX_PACKAGES} entries`))
  }

  let resolved: ResolvedPaths | undefined
  try {
    resolved = await packageManager.resolve(async () => 'skip')
  } catch (error) {
    diagnostics.push(diagnostic('resource-resolution-failed', error instanceof Error ? error.message : 'Unable to resolve package resources'))
  }

  const packages = await Promise.all(selected.map(async (item): Promise<PiPackageInventoryItem> => {
    const itemDiagnostics: PiPackageDiagnostic[] = []
    const metadata = item.installedPath ? await readPackageMetadata(item.installedPath) : {}
    if (!item.installedPath) itemDiagnostics.push(diagnostic('metadata-missing', 'Configured package is not installed'))
    if (metadata.diagnostic) itemDiagnostics.push(metadata.diagnostic)
    const configuredVersion = exactConfiguredNpmVersion(item.source)
    const versionMismatch = Boolean(configuredVersion && metadata.version && configuredVersion !== metadata.version)
    if (versionMismatch) itemDiagnostics.push(diagnostic('version-mismatch', `Configured ${configuredVersion} but found ${metadata.version}`))
    const resourceTypesKnown = Boolean(item.installedPath && resolved && !versionMismatch)
    const extensionCount = resourceTypesKnown
      ? packageResources(item.source, resolved).find((resource) => resource.kind === 'extensions')?.total || 0
      : 0
    const trust = toolTrust.packages[item.source]
    const discovery = discoveredPackageTools.get(item.source)
    if (discovery?.collisions.length) {
      itemDiagnostics.push(...discovery.collisions.map((name) => diagnostic('tool-name-collision', `Package tool ${name} collides with a Host tool and was not admitted`)))
    }
    return {
      source: item.source.slice(0, 2_048),
      scope: 'user',
      filtered: item.filtered,
      installed: Boolean(item.installedPath),
      ...(metadata.name ? { name: metadata.name } : {}),
      ...(metadata.version ? { version: metadata.version } : {}),
      resourceTypesKnown,
      resources: resourceTypesKnown ? packageResources(item.source, resolved) : [],
      toolTrust: extensionCount === 0 ? 'unsupported' : trust?.enabled ? 'active' : trust ? 'trusted-disabled' : 'inactive',
      toolNames: discovery?.names || [],
      diagnostics: itemDiagnostics.slice(0, MAX_DIAGNOSTICS),
    }
  }))

  return { packages, diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS) }
}

export async function setPiPackageToolsEnabled(
  requestedSource: unknown,
  enabled: boolean,
  trusted: boolean,
): Promise<PiPackageInventory> {
  const pinned = parsePinnedNpmPackageSource(requestedSource)
  const agentDir = resolvePiAgentDir()
  if (!agentDir) throw new PiPackageDomainError('unavailable', 'Pi user agent directory is unavailable')
  const packageManager = createPackageManager(agentDir)
  const configured = packageManager.listConfiguredPackages()
    .find((item) => item.scope === 'user' && item.source === pinned.source)
  if (!configured?.installedPath) throw new PiPackageDomainError('not_found', 'This exact Pi package is not installed')
  const metadata = await readPackageMetadata(configured.installedPath)
  if (metadata.diagnostic || metadata.name !== pinned.name || metadata.version !== pinned.version) {
    throw new PiPackageDomainError('conflict', metadata.diagnostic?.message || 'Installed package metadata does not match the pinned source')
  }
  const resolved = await packageManager.resolve(async () => 'skip')
  const hasExtensions = resolved.extensions.some((resource) =>
    resource.metadata.origin === 'package'
    && resource.metadata.scope === 'user'
    && resource.metadata.source === pinned.source)
  if (!hasExtensions) throw new PiPackageDomainError('not_found', 'This package does not expose a compatible extension tool resource')
  const state = await readPackageToolTrust(agentDir)
  const previous = state.packages[pinned.source]
  if (enabled && trusted !== true) {
    throw new PiPackageDomainError('invalid_request', 'Explicit Trusted Extension confirmation is required before enabling Pi package tools')
  }
  if (enabled || previous) {
    state.packages[pinned.source] = {
      packageName: pinned.name,
      version: pinned.version,
      source: pinned.source,
      origin: 'package',
      trusted: true,
      enabled,
    }
  }
  await writePackageToolTrust(agentDir, state)
  return listPiPackageInventory()
}

export async function resolvePiPackageExtensionResources(agentDir: string | undefined): Promise<{
  resources: PiPackageExtensionResource[]
  digest: string
  diagnostics: Array<{ path: string; message: string }>
}> {
  if (!agentDir) return { resources: [], digest: '', diagnostics: [] }
  const trust = await readPackageToolTrust(agentDir)
  const enabledSources = new Set(Object.values(trust.packages).filter((record) => record.enabled).map((record) => record.source))
  if (enabledSources.size === 0) return { resources: [], digest: createHash('sha256').update('[]').digest('hex'), diagnostics: [] }
  const packageManager = createPackageManager(agentDir)
  const configured = packageManager.listConfiguredPackages().filter((item) => item.scope === 'user' && enabledSources.has(item.source))
  const bySource = new Map(configured.map((item) => [item.source, item]))
  let resolved: ResolvedPaths
  try {
    resolved = await packageManager.resolve(async () => 'skip')
  } catch (error) {
    return { resources: [], digest: '', diagnostics: [{ path: '', message: boundedMessage(error instanceof Error ? error.message : 'Unable to resolve package extensions') }] }
  }
  const resources: PiPackageExtensionResource[] = []
  const diagnostics: Array<{ path: string; message: string }> = []
  for (const resource of resolved.extensions) {
    if (resource.metadata.origin !== 'package' || resource.metadata.scope !== 'user' || !enabledSources.has(resource.metadata.source)) continue
    const configuredPackage = bySource.get(resource.metadata.source)
    const record = trust.packages[resource.metadata.source]
    if (!configuredPackage?.installedPath || !record) continue
    const metadata = await readPackageMetadata(configuredPackage.installedPath)
    if (metadata.diagnostic || metadata.name !== record.packageName || metadata.version !== record.version) {
      diagnostics.push({ path: resource.path, message: metadata.diagnostic?.message || `Package metadata does not match ${record.packageName}@${record.version}` })
      continue
    }
    const installedRoot = resolve(configuredPackage.installedPath)
    const extensionPath = resolve(resource.path)
    const relativeExtensionPath = relative(installedRoot, extensionPath)
    if (relativeExtensionPath.startsWith('..') || isAbsolute(relativeExtensionPath)) {
      diagnostics.push({ path: resource.path, message: 'Package extension escaped its installed package root' })
      continue
    }
    resources.push({ path: extensionPath, installedPath: installedRoot, packageName: record.packageName, version: record.version, source: record.source, origin: 'package' })
    if (resources.length >= MAX_PACKAGES) break
  }
  const digest = createHash('sha256').update(JSON.stringify(resources.map(({ installedPath: _installedPath, ...resource }) => resource))).digest('hex')
  return { resources, digest, diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS) }
}

export async function resolvePiPackageSkillResources(agentDir: string | undefined): Promise<{
  resources: PiPackageSkillResource[]
  diagnostics: Array<{ path: string; message: string }>
}> {
  if (!agentDir) return { resources: [], diagnostics: [] }
  const packageManager = createPackageManager(agentDir)
  const configured = packageManager.listConfiguredPackages()
    .filter((item) => item.scope === 'user')
    .slice(0, MAX_PACKAGES)
  const configuredBySource = new Map(configured.map((item) => [item.source, item]))
  let resolved: ResolvedPaths
  try {
    resolved = await packageManager.resolve(async () => 'skip')
  } catch (error) {
    return {
      resources: [],
      diagnostics: [{ path: '', message: boundedMessage(error instanceof Error ? error.message : 'Unable to resolve package skills') }],
    }
  }

  const metadataBySource = new Map<string, Awaited<ReturnType<typeof readPackageMetadata>>>()
  const resources: PiPackageSkillResource[] = []
  const diagnostics: Array<{ path: string; message: string }> = []
  for (const resource of resolved.skills) {
    if (!resource.enabled || resource.metadata.origin !== 'package' || resource.metadata.scope !== 'user') continue
    const configuredPackage = configuredBySource.get(resource.metadata.source)
    if (!configuredPackage?.installedPath) continue
    let parsed: ReturnType<typeof parsePinnedNpmPackageSource>
    try {
      parsed = parsePinnedNpmPackageSource(configuredPackage.source)
    } catch (error) {
      diagnostics.push({ path: resource.path, message: error instanceof Error ? error.message : 'Package skill source is not pinned npm' })
      continue
    }
    let metadata = metadataBySource.get(configuredPackage.source)
    if (!metadata) {
      metadata = await readPackageMetadata(configuredPackage.installedPath)
      metadataBySource.set(configuredPackage.source, metadata)
    }
    if (metadata.diagnostic || metadata.name !== parsed.name || metadata.version !== parsed.version) {
      diagnostics.push({
        path: resource.path,
        message: metadata.diagnostic?.message || `Package metadata does not match ${parsed.name}@${parsed.version}`,
      })
      continue
    }
    resources.push({
      path: resource.path,
      installedPath: configuredPackage.installedPath,
      packageName: parsed.name,
      version: parsed.version,
      source: parsed.source,
      origin: 'package',
    })
    if (resources.length >= MAX_PACKAGES) break
  }
  return { resources, diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS) }
}

export async function mutatePiPackage(
  action: PiPackageMutationAction,
  requestedSource: unknown,
): Promise<{ action: PiPackageMutationAction; source: string; inventory: PiPackageInventory }> {
  const { source, name } = parsePinnedNpmPackageSource(requestedSource)
  const agentDir = resolvePiAgentDir()
  if (!agentDir) throw new PiPackageDomainError('unavailable', 'Pi user agent directory is unavailable')

  const packageManager = createPackageManager(agentDir)
  const configured = packageManager.listConfiguredPackages().filter((item) => item.scope === 'user')
  const exactMatch = configured.find((item) => item.source === source)

  try {
    if (action === 'install') {
      const samePackage = configured.find((item) => npmPackageName(item.source) === name)
      if (samePackage && samePackage.source !== source) {
        throw new PiPackageDomainError('conflict', 'This package is already configured at another source; package updates are not supported here')
      }
      if (exactMatch?.installedPath) throw new PiPackageDomainError('conflict', 'This exact package source is already installed')
      // A previous installation of the exact source must never silently
      // reactivate newly downloaded code with stale trust evidence.
      await clearPackageToolTrust(agentDir, source)
      await packageManager.installAndPersist(source)
    } else {
      if (!exactMatch) throw new PiPackageDomainError('not_found', 'This exact user-scope package source is not configured')
      // Revoke execution authority before changing package-manager state so a
      // failed removal can only leave installed-but-inactive code behind.
      await clearPackageToolTrust(agentDir, source)
      const removed = await packageManager.removeAndPersist(source)
      if (!removed) throw new PiPackageDomainError('not_found', 'The package source was not present in user settings')
    }
  } catch (error) {
    if (error instanceof PiPackageDomainError) throw error
    throw new PiPackageDomainError('runtime_error', error instanceof Error ? error.message : `Unable to ${action} Pi package`)
  }

  return { action, source, inventory: await listPiPackageInventory() }
}
