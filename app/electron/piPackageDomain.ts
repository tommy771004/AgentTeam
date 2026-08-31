import { join } from 'node:path'
import { open } from 'node:fs/promises'
import { resolvePiAgentDir } from './piUserConfig.ts'
import { piCodingAgentModule } from './piVendor.ts'

const MAX_PACKAGES = 128
const MAX_PACKAGE_SOURCE_BYTES = 512
const MAX_PACKAGE_JSON_BYTES = 128 * 1024
const MAX_DIAGNOSTICS = 32
const MAX_DIAGNOSTIC_MESSAGE = 320

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
  code: 'agent-dir-unavailable' | 'inventory-truncated' | 'metadata-missing' | 'metadata-invalid' | 'version-mismatch' | 'resource-resolution-failed'
  message: string
}

export type PiPackageInventoryItem = {
  source: string
  scope: 'user'
  filtered: boolean
  installed: boolean
  name?: string
  version?: string
  resourceTypesKnown: boolean
  extensionToolsEnabled?: boolean
  extensionToolsTrusted?: boolean
  resources: Array<{ kind: PiPackageResourceKind; total: number; enabled: number }>
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

export type PiPackageResourceDescriptor = {
  path: string
  installedPath: string
  packageName: string
  version: string
  source: string
  origin: 'package'
}

export type PiPackageSkillResource = PiPackageResourceDescriptor
export type PiPackageExtensionResource = PiPackageResourceDescriptor

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

function boundedMessage(message: string): string {
  return message.trim().slice(0, MAX_DIAGNOSTIC_MESSAGE) || 'Unknown package inventory error'
}

function diagnostic(code: PiPackageDiagnostic['code'], message: string): PiPackageDiagnostic {
  return { code, message: boundedMessage(message) }
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
    return {
      source: item.source.slice(0, 2_048),
      scope: 'user',
      filtered: item.filtered,
      installed: Boolean(item.installedPath),
      ...(metadata.name ? { name: metadata.name } : {}),
      ...(metadata.version ? { version: metadata.version } : {}),
      resourceTypesKnown,
      resources: resourceTypesKnown ? packageResources(item.source, resolved) : [],
      diagnostics: itemDiagnostics.slice(0, MAX_DIAGNOSTICS),
    }
  }))

  return { packages, diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS) }
}

async function resolvePiPackageResources(
  agentDir: string | undefined,
  kind: 'skills' | 'extensions',
): Promise<{ resources: PiPackageResourceDescriptor[]; diagnostics: Array<{ path: string; message: string }> }> {
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
      diagnostics: [{ path: '', message: boundedMessage(error instanceof Error ? error.message : `Unable to resolve package ${kind}`) }],
    }
  }

  const metadataBySource = new Map<string, Awaited<ReturnType<typeof readPackageMetadata>>>()
  const resources: PiPackageResourceDescriptor[] = []
  const diagnostics: Array<{ path: string; message: string }> = []
  for (const resource of resolved[kind]) {
    if (!resource.enabled || resource.metadata.origin !== 'package' || resource.metadata.scope !== 'user') continue
    const configuredPackage = configuredBySource.get(resource.metadata.source)
    if (!configuredPackage?.installedPath) continue
    let parsed: ReturnType<typeof parsePinnedNpmPackageSource>
    try {
      parsed = parsePinnedNpmPackageSource(configuredPackage.source)
    } catch (error) {
      diagnostics.push({ path: resource.path, message: error instanceof Error ? error.message : 'Package source is not pinned npm' })
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

export function resolvePiPackageSkillResources(agentDir: string | undefined) {
  return resolvePiPackageResources(agentDir, 'skills')
}

export function resolvePiPackageExtensionResources(agentDir: string | undefined) {
  return resolvePiPackageResources(agentDir, 'extensions')
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
      await packageManager.installAndPersist(source)
    } else {
      if (!exactMatch) throw new PiPackageDomainError('not_found', 'This exact user-scope package source is not configured')
      const removed = await packageManager.removeAndPersist(source)
      if (!removed) throw new PiPackageDomainError('not_found', 'The package source was not present in user settings')
    }
  } catch (error) {
    if (error instanceof PiPackageDomainError) throw error
    throw new PiPackageDomainError('runtime_error', error instanceof Error ? error.message : `Unable to ${action} Pi package`)
  }

  return { action, source, inventory: await listPiPackageInventory() }
}
