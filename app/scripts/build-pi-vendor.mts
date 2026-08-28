import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { hashPiVendorTree } from './piVendorTree.mts'
import { resolveNpmCliInvocation } from './npm-cli-invocation.mts'
import { relinkPiBuildWorkspaces } from './piBuildWorkspaceLinks.mts'
import { readBuildablePiUpstreamPin } from './piUpstreamPin.mts'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const appRoot = path.resolve(import.meta.dirname, '..')
const vendorRoot = path.join(repositoryRoot, 'vendor/pi')
const buildCachePath = path.join(appRoot, '.cache/pi-vendor-build.json')

const buildPackages = [
  'packages/tui',
  'packages/telemetry',
  'packages/ai',
  'packages/agent',
  'packages/session-backends/sqlite-node',
  'packages/protocol',
  'packages/client',
  'packages/server',
  'packages/coding-agent',
]

const requiredArtifacts = [
  'packages/telemetry/dist/index.js',
  'packages/ai/dist/index.js',
  'packages/agent/dist/index.js',
  'packages/session-backends/sqlite-node/dist/index.js',
  'packages/protocol/dist/index.js',
  'packages/client/dist/index.js',
  'packages/coding-agent/dist/index.js',
  'packages/coding-agent/dist/config.js',
  'packages/server/dist/index.js',
]

type PiBuildCache = {
  schemaVersion: 2
  sourceTreeSha256: string
  packageVersion: string
  buildMode: 'offline' | 'network'
  modelDataManifestSha256: string
}

async function modelDataManifestSha256(root = vendorRoot): Promise<string | undefined> {
  try {
    return createHash('sha256')
      .update(await readFile(path.join(root, 'packages/ai/src/providers/data/.manifest.json')))
      .digest('hex')
  } catch {
    return undefined
  }
}

async function validateModelDataDirectory(root: string): Promise<void> {
  const modulePath = path.join(root, 'packages/ai/scripts/model-data.ts')
  const validator = await import(pathToFileURL(modulePath).href) as {
    validateGeneratedModelData: (packageRoot: string) => void
  }
  validator.validateGeneratedModelData(path.join(root, 'packages/ai'))
}

function runNpm(args: string[], cwd: string): void {
  const invocation = resolveNpmCliInvocation(args, {
    platform: process.platform,
    execPath: process.execPath,
    npmExecPath: process.env.npm_execpath,
  })
  execFileSync(invocation.command, invocation.args, { cwd, stdio: 'inherit' })
}

function hasRuntimeDependencies(): boolean {
  return [
    'node_modules/.package-lock.json',
    'node_modules/@earendil-works/pi-ai',
    'node_modules/@earendil-works/pi-agent-core',
    'node_modules/@earendil-works/pi-client',
    'node_modules/@earendil-works/pi-protocol',
    'node_modules/@earendil-works/pi-session-backend-sqlite-node',
    'node_modules/@earendil-works/pi-telemetry',
    'node_modules/@earendil-works/pi-tui',
    'node_modules/chalk',
    'node_modules/typebox',
  ].every((relative) => existsSync(path.join(vendorRoot, relative)))
}

function hasBuildDependencies(): boolean {
  return hasRuntimeDependencies() && [
    'node_modules/.bin/tsgo',
    'node_modules/.bin/shx',
    'node_modules/@silvia-odwyer/photon-node',
  ].every((relative) => existsSync(path.join(vendorRoot, relative)))
}

function hasRequiredArtifacts(): boolean {
  return requiredArtifacts.every((relative) => existsSync(path.join(vendorRoot, relative)))
}

async function readBuildCache(): Promise<PiBuildCache | undefined> {
  try {
    const parsed = JSON.parse(await readFile(buildCachePath, 'utf8')) as Partial<PiBuildCache>
    if (
      parsed.schemaVersion !== 2
      || typeof parsed.sourceTreeSha256 !== 'string'
      || typeof parsed.packageVersion !== 'string'
      || typeof parsed.modelDataManifestSha256 !== 'string'
      || (parsed.buildMode !== 'offline' && parsed.buildMode !== 'network')
    ) return undefined
    return parsed as PiBuildCache
  } catch {
    return undefined
  }
}

function shouldCopyFromVendor(relative: string): boolean {
  const normalized = relative.split(path.sep).join('/')
  if (!normalized) return true
  if (normalized === 'node_modules' || normalized.startsWith('node_modules/')) return false
  if (normalized.split('/').includes('dist')) return false
  if (normalized === 'packages/ai/src/providers/data' || normalized.startsWith('packages/ai/src/providers/data/')) return false
  return true
}

async function prepareBuildWorkspace(root: string): Promise<string> {
  const stagingVendor = path.join(root, 'pi')
  await cp(vendorRoot, stagingVendor, {
    recursive: true,
    force: true,
    filter: (source) => shouldCopyFromVendor(path.relative(vendorRoot, source)),
  })

  // Keep workspace links and the pinned external dependency tree available in
  // the isolated build without adding node_modules to the vendored source.
  await cp(path.join(vendorRoot, 'node_modules'), path.join(stagingVendor, 'node_modules'), {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
  })
  await relinkPiBuildWorkspaces(stagingVendor)

  const existingModelData = path.join(vendorRoot, 'packages/ai/src/providers/data')
  if (existsSync(existingModelData)) {
    await cp(existingModelData, path.join(stagingVendor, 'packages/ai/src/providers/data'), {
      recursive: true,
      force: true,
    })
  }
  return stagingVendor
}

async function hydratePinnedReleaseModelData(stagingVendor: string): Promise<void> {
  const pin = await readBuildablePiUpstreamPin(path.join(vendorRoot, 'PI_UPSTREAM_PIN.json'))
  const asset = pin.releaseSourceArchive.asset
  const expectedSha256 = pin.releaseSourceArchive.sha256
  const expectedModelDataManifestSha256 = pin.releaseSourceArchive.modelDataManifestSha256

  const repository = pin.repository.replace(/\.git$/, '')
  const url = `${repository}/releases/download/${encodeURIComponent(pin.tag)}/${encodeURIComponent(asset)}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to download pinned Pi release source (${response.status})`)
  const archiveBytes = Buffer.from(await response.arrayBuffer())
  const actualSha256 = createHash('sha256').update(archiveBytes).digest('hex')
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Pinned Pi release source checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`)
  }

  const workspaceRoot = path.dirname(stagingVendor)
  const archivePath = path.join(workspaceRoot, asset)
  const extractionRoot = path.join(workspaceRoot, 'release-source')
  await writeFile(archivePath, archiveBytes, { mode: 0o600 })
  const entries = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  if (entries.some((entry) => path.posix.isAbsolute(entry) || entry.split('/').includes('..'))) {
    throw new Error('Pinned Pi release source archive contains an unsafe path')
  }
  await mkdir(extractionRoot, { recursive: true })
  execFileSync('tar', ['-xzf', archivePath, '-C', extractionRoot])
  const sourceModelData = path.join(
    extractionRoot,
    `pi-${pin.packageVersion}`,
    'packages/ai/src/providers/data',
  )
  if (!existsSync(path.join(sourceModelData, '.manifest.json'))) {
    throw new Error('Pinned Pi release source archive is missing model data')
  }
  const actualModelDataManifestSha256 = await modelDataManifestSha256(path.join(extractionRoot, `pi-${pin.packageVersion}`))
  if (actualModelDataManifestSha256 !== expectedModelDataManifestSha256) {
    throw new Error(`Pinned Pi model-data manifest checksum mismatch: expected ${expectedModelDataManifestSha256}, got ${actualModelDataManifestSha256 || 'missing'}`)
  }
  await rm(path.join(stagingVendor, 'packages/ai/src/providers/data'), { recursive: true, force: true })
  await cp(sourceModelData, path.join(stagingVendor, 'packages/ai/src/providers/data'), {
    recursive: true,
    force: true,
  })
  await validateModelDataDirectory(stagingVendor)
}

async function copyBuildArtifacts(stagingVendor: string): Promise<void> {
  for (const relative of buildPackages) {
    const source = path.join(stagingVendor, relative, 'dist')
    const destination = path.join(vendorRoot, relative, 'dist')
    await rm(destination, { recursive: true, force: true })
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(source, destination, { recursive: true, force: true })
  }
}

const sourceTreeSha256 = await hashPiVendorTree(vendorRoot)
const packageJson = JSON.parse(
  await readFile(path.join(vendorRoot, 'packages/coding-agent/package.json'), 'utf8'),
) as { version?: string }
const previous = await readBuildCache()
const pin = await readBuildablePiUpstreamPin(path.join(vendorRoot, 'PI_UPSTREAM_PIN.json'))
const pinnedModelDataManifestSha256 = pin.releaseSourceArchive.modelDataManifestSha256
const currentModelDataManifestSha256 = await modelDataManifestSha256()
const forceBuild = process.env.SUBAGENTS_PI_VENDOR_FORCE_BUILD === '1'
if (
  !forceBuild
  && previous?.sourceTreeSha256 === sourceTreeSha256
  && previous.packageVersion === packageJson.version
  && previous.modelDataManifestSha256 === pinnedModelDataManifestSha256
  && currentModelDataManifestSha256 === pinnedModelDataManifestSha256
  && hasRequiredArtifacts()
) {
  await validateModelDataDirectory(vendorRoot)
  if (!hasRuntimeDependencies()) runNpm(['ci', '--omit=dev', '--ignore-scripts'], vendorRoot)
  console.log(`Pi vendor dist is ready (${packageJson.version ?? 'unknown'})`)
  process.exit(0)
}

if (!hasBuildDependencies()) runNpm(['ci', '--ignore-scripts'], vendorRoot)

const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'subagents-pi-build-'))
let buildMode: PiBuildCache['buildMode'] = 'network'
try {
  const stagingVendor = await prepareBuildWorkspace(temporaryRoot)
  // A cache miss always rebuilds from the archive-pinned model-data snapshot;
  // an unpinned local catalog can no longer silently satisfy offline build.
  await hydratePinnedReleaseModelData(stagingVendor)
  buildMode = 'offline'
  runNpm(['run', 'build:offline'], stagingVendor)

  const pinnedModelData = path.join(stagingVendor, 'packages/ai/src/providers/data')
  const vendorModelData = path.join(vendorRoot, 'packages/ai/src/providers/data')
  await rm(vendorModelData, { recursive: true, force: true })
  await mkdir(path.dirname(vendorModelData), { recursive: true })
  await cp(pinnedModelData, vendorModelData, { recursive: true, force: true })
  await validateModelDataDirectory(vendorRoot)

  await copyBuildArtifacts(stagingVendor)
  runNpm(['prune', '--omit=dev', '--ignore-scripts'], vendorRoot)
  if (!hasRuntimeDependencies()) {
    throw new Error('Pi vendor build removed or omitted required runtime dependencies')
  }
  if (!hasRequiredArtifacts()) {
    throw new Error('Pi vendor build completed without the required coding-agent runtime artifacts')
  }
  await mkdir(path.dirname(buildCachePath), { recursive: true })
  await writeFile(buildCachePath, `${JSON.stringify({
    schemaVersion: 2,
    sourceTreeSha256,
    packageVersion: packageJson.version ?? 'unknown',
    buildMode,
    modelDataManifestSha256: pinnedModelDataManifestSha256!,
  } satisfies PiBuildCache, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  console.log(`Built Pi vendor dist (${packageJson.version ?? 'unknown'}, ${buildMode})`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
