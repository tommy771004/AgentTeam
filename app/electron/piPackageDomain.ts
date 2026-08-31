import { join } from 'node:path'
import { open } from 'node:fs/promises'
import { resolvePiAgentDir } from './piUserConfig.ts'
import { piCodingAgentModule } from './piVendor.ts'

const MAX_PACKAGES = 128
const MAX_PACKAGE_JSON_BYTES = 128 * 1024
const MAX_DIAGNOSTICS = 32
const MAX_DIAGNOSTIC_MESSAGE = 320

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
  enabled: boolean
  metadata: { source: string; scope: 'user' | 'project' | 'temporary'; origin: 'package' | 'top-level' }
}

type ResolvedPaths = Record<PiPackageResourceKind, ResolvedResource[]>

type PackageManager = {
  listConfiguredPackages(): ConfiguredPackage[]
  resolve(onMissing: (source: string) => Promise<'skip'>): Promise<ResolvedPaths>
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

function exactConfiguredNpmVersion(source: string): string | undefined {
  if (!source.startsWith('npm:')) return undefined
  const spec = source.slice(4).trim()
  const separator = spec.lastIndexOf('@')
  if (separator <= 0 || (spec.startsWith('@') && separator < spec.indexOf('/'))) return undefined
  const version = spec.slice(separator + 1)
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version) ? version : undefined
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

  const pi = piCodingAgentModule as unknown as PiPackageApi
  // Keep project-local settings out of this user-scope projection. The path is
  // only a read context; inventory never creates it.
  const inventoryCwd = join(agentDir, '.agentstudio-package-inventory')
  const settingsManager = pi.SettingsManager.create(inventoryCwd, agentDir, { projectTrusted: false })
  const packageManager = new pi.DefaultPackageManager({ cwd: inventoryCwd, agentDir, settingsManager })
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
