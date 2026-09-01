import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { diffPiVendorTrees, hashPiVendorTree, listPiVendorFiles, PI_LEDGER_FILE, PI_PIN_FILE } from './piVendorTree.mts'
import { parseBuildablePiUpstreamPin } from './piUpstreamPin.mts'
import { inspectPiUpstreamDebt } from './piUpstreamDebt.mts'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function requiredArg(name: string): string {
  const value = arg(name)
  if (!value) throw new Error(`${name} is required`)
  return value
}

const forbidden = ['--branch', '--ref', '--latest', '--main', '--remote']
assert.ok(!forbidden.some((flag) => process.argv.includes(flag)), 'Pi sync accepts explicit commits only; it never moves a branch')
const fromCommit = requiredArg('--from-commit')
const toCommit = requiredArg('--to-commit')
const releaseSourceAsset = requiredArg('--release-source-asset')
const releaseSourceSha256 = requiredArg('--release-source-sha256')
const releaseModelDataManifestSha256 = requiredArg('--release-model-data-manifest-sha256')
assert.match(fromCommit, /^[0-9a-f]{40}$/)
assert.match(toCommit, /^[0-9a-f]{40}$/)
assert.match(releaseSourceAsset, /^pi-\d+\.\d+\.\d+-source\.tar\.gz$/)
assert.match(releaseSourceSha256, /^[0-9a-f]{64}$/)
assert.match(releaseModelDataManifestSha256, /^[0-9a-f]{64}$/)
assert.notEqual(fromCommit, toCommit, 'synchronization must advance to a different commit')

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const vendorRoot = path.resolve(arg('--vendor-dir') || path.join(repositoryRoot, 'vendor/pi'))
const sourceRoot = path.resolve(requiredArg('--source-dir'))
assert.notEqual(vendorRoot, sourceRoot, 'source and vendor directories must be different')
assert.ok(!sourceRoot.startsWith(`${vendorRoot}${path.sep}`), 'source directory cannot be inside vendor directory')

const pinPath = path.join(vendorRoot, PI_PIN_FILE)
const ledgerPath = path.join(vendorRoot, PI_LEDGER_FILE)
const pin = JSON.parse(await readFile(pinPath, 'utf8')) as {
  repository?: string
  tag?: string | null
  commit?: string
  packageVersion?: string
  treeSha256?: string
}
assert.equal(fromCommit, pin.commit, 'from commit must equal the recorded vendor pin')
const ledger = await readFile(ledgerPath, 'utf8')
assert.match(ledger, /Core Patch Ledger/)
assert.match(ledger, /No undocumented core edits/)

const git = (args: string[]) => execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8' }).trim()
assert.equal(git(['rev-parse', 'HEAD']), toCommit, 'source checkout HEAD must equal toCommit')
assert.equal(git(['status', '--porcelain']), '', 'source checkout must be clean')

const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'pi-sync-'))
const fromSnapshot = path.join(temporaryRoot, 'from')
const toSnapshot = path.join(temporaryRoot, 'to')
await mkdir(fromSnapshot, { recursive: true })
await mkdir(toSnapshot, { recursive: true })

function archiveCommit(commit: string, target: string): void {
  const archive = execFileSync('git', ['archive', '--format=tar', commit], { cwd: sourceRoot, maxBuffer: 512 * 1024 * 1024 })
  execFileSync('tar', ['-xf', '-', '-C', target], { input: archive, maxBuffer: 16 * 1024 * 1024 })
}

try {
  archiveCommit(fromCommit, fromSnapshot)
  archiveCommit(toCommit, toSnapshot)
  const baselineDifferences = await diffPiVendorTrees(vendorRoot, fromSnapshot)
  assert.equal(
    baselineDifferences.length,
    0,
    `vendor differs from the recorded fromCommit; reconcile Core Patch Ledger before syncing: ${baselineDifferences.slice(0, 20).join(', ')}`,
  )

  execFileSync(process.platform === 'win32' ? 'bash.exe' : 'bash', ['test.sh'], {
    cwd: sourceRoot,
    stdio: 'inherit',
  })

  const sourceFiles = await listPiVendorFiles(toSnapshot)
  const vendorFiles = await listPiVendorFiles(vendorRoot)
  const sourceSet = new Set(sourceFiles)
  for (const relative of vendorFiles) {
    if (!sourceSet.has(relative)) await rm(path.join(vendorRoot, relative), { force: true })
  }
  for (const relative of sourceFiles) {
    const destination = path.join(vendorRoot, relative)
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(path.join(toSnapshot, relative), destination, { force: true })
  }

  const packageJson = JSON.parse(
    await readFile(path.join(toSnapshot, 'packages/coding-agent/package.json'), 'utf8'),
  ) as { version?: string }
  assert.match(packageJson.version || '', /^\d+\.\d+\.\d+$/,
    'Pi coding-agent package must declare a release version')
  const expectedTag = `v${packageJson.version}`
  const tags = git(['tag', '--points-at', toCommit]).split('\n').filter(Boolean)
  assert.ok(tags.includes(expectedTag), `Pi sync target must be the exact release tag ${expectedTag}`)
  const tag = expectedTag
  const treeSha256 = await hashPiVendorTree(vendorRoot)
  const nextPin = parseBuildablePiUpstreamPin({
    ...pin,
    tag,
    commit: toCommit,
    packageVersion: packageJson.version,
    releaseSourceArchive: {
      asset: releaseSourceAsset,
      sha256: releaseSourceSha256,
      modelDataManifestSha256: releaseModelDataManifestSha256,
    },
    treeSha256,
  })
  const temporaryPinPath = `${pinPath}.next`
  await writeFile(temporaryPinPath, `${JSON.stringify(nextPin, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryPinPath, pinPath)

  const manifest = {
    schemaVersion: 2,
    kind: 'pi-core-synchronization',
    repository: pin.repository,
    fromCommit,
    toCommit,
    recordedPin: { tag, treeSha256 },
    branchMutation: 'none',
    status: 'synchronized',
    vendorUpdated: true,
    ledgerReconciled: true,
    upstreamTests: true,
    upstreamTestCommand: 'bash test.sh',
    upstreamDebt: await inspectPiUpstreamDebt(vendorRoot),
    generatedAt: new Date().toISOString(),
  }
  const output = arg('--output')
  if (output) {
    const outputPath = path.resolve(process.cwd(), output)
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  }
  console.log(JSON.stringify(manifest))
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
