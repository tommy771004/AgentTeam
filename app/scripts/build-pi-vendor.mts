import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hashPiVendorTree } from './piVendorTree.mts'
import { resolveNpmCliInvocation } from './npm-cli-invocation.mts'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const appRoot = path.resolve(import.meta.dirname, '..')
const vendorRoot = path.join(repositoryRoot, 'vendor/pi')
const buildCachePath = path.join(appRoot, '.cache/pi-vendor-build.json')

const buildPackages = [
  'packages/tui',
  'packages/ai',
  'packages/agent',
  'packages/storage/sqlite-node',
  'packages/coding-agent',
  'packages/server',
]

const requiredArtifacts = [
  'packages/ai/dist/index.js',
  'packages/agent/dist/index.js',
  'packages/coding-agent/dist/index.js',
  'packages/coding-agent/dist/config.js',
  'packages/server/dist/index.js',
]

type PiBuildCache = {
  schemaVersion: 1
  sourceTreeSha256: string
  packageVersion: string
  buildMode: 'offline' | 'network'
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
      parsed.schemaVersion !== 1
      || typeof parsed.sourceTreeSha256 !== 'string'
      || typeof parsed.packageVersion !== 'string'
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

  const existingModelData = path.join(vendorRoot, 'packages/ai/src/providers/data')
  if (existsSync(existingModelData)) {
    await cp(existingModelData, path.join(stagingVendor, 'packages/ai/src/providers/data'), {
      recursive: true,
      force: true,
    })
  }
  return stagingVendor
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
const packageJson = JSON.parse(await readFile(path.join(vendorRoot, 'package.json'), 'utf8')) as { version?: string }
const previous = await readBuildCache()
if (
  previous?.sourceTreeSha256 === sourceTreeSha256
  && previous.packageVersion === packageJson.version
  && hasRequiredArtifacts()
) {
  if (!hasRuntimeDependencies()) runNpm(['ci', '--omit=dev', '--ignore-scripts'], vendorRoot)
  console.log(`Pi vendor dist is ready (${packageJson.version ?? 'unknown'})`)
  process.exit(0)
}

if (!hasBuildDependencies()) runNpm(['ci', '--ignore-scripts'], vendorRoot)

const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'subagents-pi-build-'))
let buildMode: PiBuildCache['buildMode'] = 'network'
try {
  const stagingVendor = await prepareBuildWorkspace(temporaryRoot)
  const hasModelData = existsSync(path.join(stagingVendor, 'packages/ai/src/providers/data'))
  if (hasModelData) {
    buildMode = 'offline'
    try {
      runNpm(['run', 'build:offline'], stagingVendor)
    } catch {
      // A stale local model-data cache must not leave a half-built vendor. The
      // isolated workspace can safely refresh its generated catalog instead.
      await rm(path.join(stagingVendor, 'packages/ai/src/providers/data'), { recursive: true, force: true })
      buildMode = 'network'
      runNpm(['run', 'build'], stagingVendor)
    }
  } else {
    runNpm(['run', 'build'], stagingVendor)
  }

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
    schemaVersion: 1,
    sourceTreeSha256,
    packageVersion: packageJson.version ?? 'unknown',
    buildMode,
  } satisfies PiBuildCache, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  console.log(`Built Pi vendor dist (${packageJson.version ?? 'unknown'}, ${buildMode})`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
