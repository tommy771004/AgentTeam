import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

export function resolveReleaseVersion({ requested, refName, packageVersion }) {
  const candidate = String(requested || refName || '').replace(/^v/, '')
  return /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(candidate) ? candidate : String(packageVersion)
}

export function resolveProvenanceSource({ githubActions }) {
  return githubActions === true || githubActions === 'true' ? 'github-actions' : 'local'
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function serialFromLock(lockText) {
  const hex = sha256(lockText).slice(0, 32)
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function componentFromLock(key, value) {
  const name = key.split('node_modules/').pop()
  if (!value?.version || !name || key === '') return null
  const encoded = encodeURIComponent(name).replace(/%40/g, '@')
  return {
    type: 'library',
    name,
    version: value.version,
    purl: `pkg:npm/${encoded}@${value.version}`,
  }
}

export async function createCycloneDxSbom({ packageLockPath, outputPath }) {
  const lockText = await fs.readFile(packageLockPath, 'utf8')
  const lock = JSON.parse(lockText)
  const components = Object.entries(lock.packages || {})
    .map(([key, value]) => componentFromLock(key, value))
    .filter(Boolean)
    .sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))
  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: serialFromLock(lockText),
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: 'SubAgents AI', name: 'release-evidence', version: '1.0.0' }],
    },
    components,
  }
  await fs.writeFile(outputPath, `${JSON.stringify(bom, null, 2)}\n`, 'utf8')
  return bom
}

async function listFiles(root, current = root) {
  const entries = await fs.readdir(current, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolute = path.join(current, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(root, absolute))
    else files.push(path.relative(root, absolute))
  }
  return files.sort()
}

function normalizeArtifactPath(value) {
  const normalized = String(value || '').replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe release artifact path: ${value}`)
  }
  return normalized
}

export async function verifyArtifactManifest({ manifest, manifestPath, artifactDir }) {
  if (!artifactDir || (!manifest && !manifestPath)) {
    throw new Error('manifest or manifestPath and artifactDir are required')
  }
  const resolvedManifest = manifest || JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const files = (await listFiles(artifactDir)).map(normalizeArtifactPath)
  const fileSet = new Set(files)
  const expected = new Map()
  for (const artifact of resolvedManifest.artifacts || []) {
    const name = normalizeArtifactPath(artifact.name)
    if (expected.has(name)) throw new Error(`Duplicate packaged artifact ${name}`)
    expected.set(name, artifact)
    if (!fileSet.has(name)) throw new Error(`Missing packaged artifact ${name}`)
    const bytes = await fs.readFile(path.join(artifactDir, ...name.split('/')))
    const digest = sha256(bytes)
    if (digest !== artifact.sha256) throw new Error(`Checksum mismatch for ${name}`)
  }
  for (const file of fileSet) {
    if (!expected.has(file)) throw new Error(`Unexpected packaged artifact ${file}`)
  }
  return { artifactCount: expected.size }
}

function isEvidenceFile(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/')
  return normalized.startsWith('evidence/') ||
    normalized === 'release-manifest.json' ||
    normalized === 'checksums.txt' ||
    normalized.endsWith('.cdx.json') ||
    normalized.endsWith('.provenance.json') ||
    normalized.endsWith('.sha256')
}

export async function buildReleaseEvidence({
  artifactDir,
  outputDir,
  platform,
  arch,
  version,
  channel,
  sbomPath,
  packageLockPath,
  releaseNotesPath,
  provenance = {},
}) {
  if (!artifactDir || !outputDir || !platform || !arch || !version || !channel) {
    throw new Error('artifactDir, outputDir, platform, arch, version, and channel are required')
  }
  await fs.mkdir(outputDir, { recursive: true })

  let resolvedSbomPath = sbomPath
  if (!resolvedSbomPath && packageLockPath) {
    resolvedSbomPath = path.join(outputDir, 'sbom.cdx.json')
    await createCycloneDxSbom({ packageLockPath, outputPath: resolvedSbomPath })
  }
  if (!resolvedSbomPath) throw new Error('sbomPath or packageLockPath is required')
  if (!releaseNotesPath) throw new Error('releaseNotesPath is required')

  const outputSbomPath = path.join(outputDir, path.basename(resolvedSbomPath))
  if (path.resolve(resolvedSbomPath) !== path.resolve(outputSbomPath)) {
    await fs.copyFile(resolvedSbomPath, outputSbomPath)
  }
  resolvedSbomPath = outputSbomPath

  const sbomText = await fs.readFile(resolvedSbomPath, 'utf8')
  const sbom = JSON.parse(sbomText)
  const releaseNotes = await fs.readFile(releaseNotesPath, 'utf8')
  const files = (await listFiles(artifactDir)).filter((file) => !isEvidenceFile(file))
  if (!files.length) throw new Error(`No release artifacts found in ${artifactDir}`)

  const artifacts = []
  const checksumLines = []
  for (const file of files) {
    const bytes = await fs.readFile(path.join(artifactDir, file))
    const digest = sha256(bytes)
    artifacts.push({ name: file, size: bytes.byteLength, sha256: digest })
    checksumLines.push(`${digest}  ${file}`)
  }

  const manifest = {
    schemaVersion: 1,
    product: 'SubAgents AI',
    version: String(version).replace(/^v/, ''),
    channel,
    platform,
    arch,
    generatedAt: new Date().toISOString(),
    artifacts,
    checksums: 'checksums.txt',
    sbom: {
      path: path.basename(resolvedSbomPath),
      format: sbom.bomFormat || 'CycloneDX',
      serialNumber: sbom.serialNumber || null,
    },
    releaseNotes: {
      path: 'release-notes.md',
      sha256: sha256(releaseNotes),
    },
    provenance: {
      source: resolveProvenanceSource({ githubActions: process.env.GITHUB_ACTIONS }),
      repository: process.env.GITHUB_REPOSITORY || null,
      commit: process.env.GITHUB_SHA || null,
      ref: process.env.GITHUB_REF_NAME || null,
      runId: process.env.GITHUB_RUN_ID || null,
      ...provenance,
    },
  }
  await fs.writeFile(path.join(outputDir, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await fs.writeFile(path.join(outputDir, 'checksums.txt'), `${checksumLines.join('\n')}\n`, 'utf8')
  await fs.writeFile(path.join(outputDir, 'release-notes.md'), releaseNotes, 'utf8')
  return manifest
}

function argumentValue(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2)
  const appRoot = path.resolve(scriptDir, '..')
  if (args.includes('--verify-manifest')) {
    const manifestPath = path.resolve(argumentValue(args, '--manifest') || '')
    const artifactDir = path.resolve(argumentValue(args, '--artifact-dir') || '')
    await verifyArtifactManifest({ manifestPath, artifactDir })
    console.log(`Release manifest verified: ${manifestPath}`)
    process.exit(0)
  }
  const artifactDir = path.resolve(appRoot, argumentValue(args, '--artifact-dir') || 'release')
  const outputDir = path.resolve(appRoot, argumentValue(args, '--output-dir') || 'release-evidence')
  const packageLockPath = path.resolve(appRoot, argumentValue(args, '--package-lock') || 'package-lock.json')
  const releaseNotesPath = path.resolve(appRoot, argumentValue(args, '--release-notes') || 'RELEASE_NOTES.md')
  const packageLock = JSON.parse(await fs.readFile(packageLockPath, 'utf8'))
  if (args.includes('--print-version')) {
    console.log(resolveReleaseVersion({
      requested: process.env.RELEASE_VERSION,
      refName: process.env.GITHUB_REF_NAME,
      packageVersion: packageLock.version,
    }))
    process.exit(0)
  }
  await buildReleaseEvidence({
    artifactDir,
    outputDir,
    platform: argumentValue(args, '--platform') || process.env.RELEASE_PLATFORM,
    arch: argumentValue(args, '--arch') || process.env.RELEASE_ARCH,
    version: resolveReleaseVersion({
      requested: argumentValue(args, '--version') || process.env.RELEASE_VERSION,
      refName: process.env.GITHUB_REF_NAME,
      packageVersion: packageLock.version,
    }),
    channel: argumentValue(args, '--channel') || process.env.RELEASE_CHANNEL || 'beta',
    packageLockPath,
    releaseNotesPath,
    provenance: {
      workflow: process.env.GITHUB_WORKFLOW || 'local-release',
    },
  })
  console.log(`Release evidence written to ${outputDir}`)
}
