import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROMOTION_TARGET_KEYS = ['darwin/arm64', 'darwin/x64', 'win32/x64']

export function normalizeReleaseChannel(value) {
  if (value === 'beta' || value === 'stable') return value
  throw new Error(`unsupported release channel: ${value || '<missing>'}`)
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function listFiles(root, current = root) {
  const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
  const files = []
  for (const entry of entries) {
    const absolute = path.join(current, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(root, absolute))
    else files.push(absolute)
  }
  return files.sort()
}

function parseVerificationLog(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf('=')
    return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : []
  }))
}

function expectedUpdatePlatform(platform) {
  if (platform === 'windows') return 'win32'
  if (platform === 'macos') return 'darwin'
  throw new Error(`unsupported release platform: ${platform}`)
}

function safeRelative(root, absolute) {
  const relative = path.relative(root, absolute).replaceAll('\\', '/')
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error(`promotion path escapes its root: ${absolute}`)
  }
  return relative
}

async function readJsonWithBytes(filePath) {
  const bytes = await fs.readFile(filePath)
  return { bytes, value: JSON.parse(bytes.toString('utf8')) }
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${expected}, got ${actual ?? '<missing>'}`)
}

function normalizePublicBaseUrls(baseUrls) {
  const normalized = {}
  for (const channel of ['beta', 'stable']) {
    const parsed = new URL(String(baseUrls?.[channel] || ''))
    if (parsed.protocol !== 'https:' || !parsed.hostname) throw new Error(`${channel} public base URL must use HTTPS`)
    normalized[channel] = parsed.toString().replace(/\/$/, '')
  }
  if (normalized.beta === normalized.stable) throw new Error('Beta and Stable public base URLs must be distinct')
  return normalized
}

async function readBuiltInUpdatePublicKey(sourcePath) {
  const source = await fs.readFile(path.resolve(sourcePath), 'utf8')
  const match = source.match(/BUILT_IN_UPDATE_PUBLIC_KEY\s*=\s*`([\s\S]*?-----END PUBLIC KEY-----)`/)
  if (!match) throw new Error('built-in update public key was not found')
  return match[1]
}

function verifyUpdateManifestSignatures(manifest, publicKey) {
  const artifact = manifest?.artifact
  if (artifact?.signatureAlgorithm !== 'rsa-sha256') throw new Error('update artifact signature algorithm must be rsa-sha256')
  if (typeof artifact.signature !== 'string' || typeof manifest.signature !== 'string') {
    throw new Error('signed update manifest is incomplete')
  }
  const artifactPayload = canonical({ sha256: artifact.sha256, size: artifact.size, url: artifact.url })
  const artifactValid = crypto.createVerify('RSA-SHA256').update(artifactPayload).end().verify(publicKey, artifact.signature, 'base64')
  if (!artifactValid) throw new Error('update artifact signature is invalid')
  const unsignedManifest = { ...manifest }
  delete unsignedManifest.signature
  const manifestValid = crypto.createVerify('RSA-SHA256').update(canonical(unsignedManifest)).end().verify(publicKey, manifest.signature, 'base64')
  if (!manifestValid) throw new Error('update manifest signature is invalid')
}

async function resolveArtifact(artifactFiles, descriptor) {
  const artifactName = decodeURIComponent(new URL(descriptor.url).pathname.split('/').pop() || '')
  if (!artifactName || artifactName !== path.basename(artifactName)) throw new Error(`unsafe update artifact name: ${artifactName}`)
  const candidates = []
  for (const filePath of artifactFiles.filter((file) => path.basename(file) === artifactName)) {
    const bytes = await fs.readFile(filePath)
    if (sha256(bytes) === descriptor.sha256 && bytes.byteLength === descriptor.size) candidates.push({ filePath, bytes })
  }
  if (candidates.length !== 1) {
    throw new Error(`expected exactly one qualified installer for ${artifactName}, found ${candidates.length}`)
  }
  return { name: artifactName, ...candidates[0] }
}

export async function buildVerifiedPromotionReceipt({
  evidenceRoot,
  artifactRoot,
  qualificationPath,
  commit,
  runId,
  runAttempt,
  version,
  channel,
  publicBaseUrls,
  updatePublicKeyPath,
  issuedAt = new Date().toISOString(),
}) {
  channel = normalizeReleaseChannel(channel)
  const normalizedPublicBaseUrls = normalizePublicBaseUrls(publicBaseUrls)
  const publicBaseUrl = normalizedPublicBaseUrls[channel]
  const updatePublicKey = await readBuiltInUpdatePublicKey(updatePublicKeyPath)
  const identity = {
    commit: String(commit || ''),
    runId: String(runId || ''),
    runAttempt: String(runAttempt || ''),
    version: String(version || '').replace(/^v/, ''),
    channel,
  }
  for (const [key, value] of Object.entries(identity)) {
    if (!value) throw new Error(`promotion ${key} is required`)
  }
  if (!/^[a-f0-9]{40}$/i.test(identity.commit)) throw new Error('promotion commit must be a full Git SHA')
  if (!/^\d+$/.test(identity.runId) || !/^[1-9]\d*$/.test(identity.runAttempt)) {
    throw new Error('promotion runId and runAttempt must be positive integers')
  }
  if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(identity.version)) throw new Error('promotion version must be semver')

  const qualification = await readJsonWithBytes(path.resolve(qualificationPath))
  requireEqual(qualification.value.decision, 'GO', 'qualification decision')
  requireEqual(qualification.value.ready, true, 'qualification readiness')
  requireEqual(qualification.value.releaseVersion, identity.version, 'qualification version')

  const resolvedEvidenceRoot = path.resolve(evidenceRoot)
  const resolvedArtifactRoot = path.resolve(artifactRoot)
  const evidenceFiles = await listFiles(resolvedEvidenceRoot)
  const artifactFiles = await listFiles(resolvedArtifactRoot)
  const verificationLogs = evidenceFiles.filter((file) => path.basename(file) === 'verification.log')
  if (verificationLogs.length !== 3) throw new Error(`expected 3 verification logs, found ${verificationLogs.length}`)

  const targets = []
  for (const verificationPath of verificationLogs) {
    const evidenceDir = path.dirname(verificationPath)
    const verification = parseVerificationLog(await fs.readFile(verificationPath, 'utf8'))
    requireEqual(verification.status, 'success', 'verification status')
    requireEqual(verification.attempt, identity.runAttempt, 'verification attempt')
    requireEqual(verification.version, identity.version, 'verification version')
    requireEqual(verification.channel, identity.channel, 'verification channel')

    const releaseManifest = await readJsonWithBytes(path.join(evidenceDir, 'release-manifest.json'))
    const updateManifestPath = path.join(evidenceDir, 'update-channel', 'manifest.json')
    const updateManifest = await readJsonWithBytes(updateManifestPath)
    for (const [label, manifest] of [['release', releaseManifest.value], ['update', updateManifest.value]]) {
      requireEqual(manifest.version, identity.version, `${label} manifest version`)
      requireEqual(manifest.channel, identity.channel, `${label} manifest channel`)
      requireEqual(manifest.arch, verification.arch, `${label} manifest architecture`)
    }
    requireEqual(releaseManifest.value.platform, verification.platform, 'release manifest platform')
    requireEqual(updateManifest.value.platform, expectedUpdatePlatform(verification.platform), 'update manifest platform')
    requireEqual(releaseManifest.value.provenance?.commit, identity.commit, 'release manifest commit')
    requireEqual(releaseManifest.value.provenance?.runId, identity.runId, 'release manifest run')
    requireEqual(releaseManifest.value.provenance?.runAttempt, identity.runAttempt, 'release manifest attempt')
    verifyUpdateManifestSignatures(updateManifest.value, updatePublicKey)

    const artifact = await resolveArtifact(artifactFiles, updateManifest.value.artifact)
    const expectedPublicUrl = `${publicBaseUrl}/${updateManifest.value.platform}/${verification.arch}/${encodeURIComponent(artifact.name)}`
    requireEqual(updateManifest.value.artifact.url, expectedPublicUrl, 'update artifact public URL')
    const releaseDescriptor = releaseManifest.value.artifacts?.find((item) => item.name === artifact.name)
    if (!releaseDescriptor) throw new Error(`release manifest does not contain ${artifact.name}`)
    requireEqual(releaseDescriptor.sha256, updateManifest.value.artifact.sha256, 'installer hash')
    requireEqual(releaseDescriptor.size, updateManifest.value.artifact.size, 'installer size')
    targets.push({
      platform: updateManifest.value.platform,
      arch: verification.arch,
      manifest: {
        relativePath: safeRelative(resolvedEvidenceRoot, updateManifestPath),
        sha256: sha256(updateManifest.bytes),
        size: updateManifest.bytes.byteLength,
      },
      artifact: {
        name: artifact.name,
        publicUrl: updateManifest.value.artifact.url,
        relativePath: safeRelative(resolvedArtifactRoot, artifact.filePath),
        sha256: updateManifest.value.artifact.sha256,
        size: updateManifest.value.artifact.size,
      },
    })
  }
  targets.sort((left, right) => `${left.platform}/${left.arch}`.localeCompare(`${right.platform}/${right.arch}`))
  const targetKeys = targets.map((target) => `${target.platform}/${target.arch}`)
  if (JSON.stringify(targetKeys) !== JSON.stringify(PROMOTION_TARGET_KEYS)) {
    throw new Error(`promotion targets mismatch: expected ${PROMOTION_TARGET_KEYS.join(', ')}, got ${targetKeys.join(', ')}`)
  }

  const qualificationDescriptor = {
    decision: 'GO',
    evaluatedAt: qualification.value.evaluatedAt,
    sha256: sha256(qualification.bytes),
  }
  const immutableIdentity = { ...identity, qualification: qualificationDescriptor, targets }
  return {
    schemaVersion: 1,
    verified: true,
    promotionIdentity: `promotion_${sha256(canonical(immutableIdentity))}`,
    ...identity,
    qualification: qualificationDescriptor,
    targets,
    issuedAt,
  }
}

function assertVerifiedReceipt(receipt) {
  if (receipt?.schemaVersion !== 1 || receipt?.verified !== true) throw new Error('verified promotion receipt is required')
  normalizeReleaseChannel(receipt.channel)
  if (!Array.isArray(receipt.targets) || receipt.targets.length !== 3) throw new Error('verified promotion receipt requires 3 targets')
  const targetKeys = receipt.targets.map((target) => `${target.platform}/${target.arch}`).sort()
  if (JSON.stringify(targetKeys) !== JSON.stringify(PROMOTION_TARGET_KEYS)) {
    throw new Error(`verified promotion receipt targets mismatch: ${targetKeys.join(', ')}`)
  }
  const immutableIdentity = {
    commit: receipt.commit,
    runId: receipt.runId,
    runAttempt: receipt.runAttempt,
    version: receipt.version,
    channel: receipt.channel,
    qualification: receipt.qualification,
    targets: receipt.targets,
  }
  const expectedIdentity = `promotion_${sha256(canonical(immutableIdentity))}`
  requireEqual(receipt.promotionIdentity, expectedIdentity, 'promotion identity')
}

function assertExpectedWorkflowIdentity(receipt, expectedIdentity) {
  if (!expectedIdentity) throw new Error('expected workflow identity is required')
  for (const key of ['commit', 'runId', 'runAttempt', 'version', 'channel']) {
    requireEqual(receipt[key], expectedIdentity[key], `published receipt ${key}`)
  }
}

function promotionDestination(destinations, channel, allowInsecureLocalhost) {
  const resolved = {}
  for (const candidate of ['beta', 'stable']) {
    const parsed = new URL(String(destinations?.[candidate] || ''))
    const localhost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1'
    if (parsed.protocol !== 'https:' && !(allowInsecureLocalhost && parsed.protocol === 'http:' && localhost)) {
      throw new Error(`promotion destination for ${candidate} must use HTTPS`)
    }
    resolved[candidate] = parsed.toString().replace(/\/$/, '')
  }
  if (resolved.beta === resolved.stable) throw new Error('Beta and Stable promotion destinations must be distinct')
  return resolved[channel]
}

async function verifiedFile(root, descriptor, label) {
  const filePath = path.resolve(root, descriptor.relativePath)
  safeRelative(path.resolve(root), filePath)
  const bytes = await fs.readFile(filePath)
  requireEqual(bytes.byteLength, descriptor.size, `${label} size`)
  requireEqual(sha256(bytes), descriptor.sha256, `${label} hash`)
  return bytes
}

async function requestPromotion(url, { method, token, sha, identity, body, fetchImpl }) {
  const response = await fetchImpl(url, {
    method,
    redirect: 'error',
    headers: {
      authorization: `Bearer ${token}`,
      ...(sha ? { 'x-content-sha256': sha } : {}),
      'x-promotion-identity': identity,
      ...(body && method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    body,
  })
  return response
}

async function stageObject({ url, bytes, sha, token, identity, fetchImpl }) {
  const existing = await requestPromotion(url, { method: 'HEAD', token, identity, fetchImpl })
  if (existing.status === 200) {
    requireEqual(existing.headers.get('x-content-sha256'), sha, `staged object ${url}`)
    return 'existing'
  }
  if (existing.status !== 404) throw new Error(`promotion preflight failed (${existing.status}) for ${url}`)
  const uploaded = await requestPromotion(url, { method: 'PUT', token, sha, identity, body: bytes, fetchImpl })
  if (uploaded.status !== 200 && uploaded.status !== 201) {
    throw new Error(`promotion staging failed (${uploaded.status}) for ${url}`)
  }
  return 'uploaded'
}

export async function publishVerifiedPromotion({
  receipt,
  evidenceRoot,
  artifactRoot,
  destinations,
  token,
  expectedIdentity,
  fetchImpl = fetch,
  allowInsecureLocalhost = false,
  publishedAt = new Date().toISOString(),
}) {
  assertVerifiedReceipt(receipt)
  assertExpectedWorkflowIdentity(receipt, expectedIdentity)
  if (!token) throw new Error('update publish token is required')
  const destination = promotionDestination(destinations, receipt.channel, allowInsecureLocalhost)
  const staged = []
  for (const target of receipt.targets) {
    const bytes = await verifiedFile(artifactRoot, target.artifact, `installer ${target.platform}/${target.arch}`)
    const url = `${destination}/staging/${receipt.promotionIdentity}/${target.platform}/${target.arch}/${encodeURIComponent(target.artifact.name)}`
    staged.push({ kind: 'installer', target, url, bytes, sha: target.artifact.sha256 })
  }
  for (const target of receipt.targets) {
    const bytes = await verifiedFile(evidenceRoot, target.manifest, `manifest ${target.platform}/${target.arch}`)
    const url = `${destination}/staging/${receipt.promotionIdentity}/${target.platform}/${target.arch}/manifest.json`
    staged.push({ kind: 'manifest', target, url, bytes, sha: target.manifest.sha256 })
  }
  for (const object of staged) {
    await stageObject({
      url: object.url,
      bytes: object.bytes,
      sha: object.sha,
      token,
      identity: receipt.promotionIdentity,
      fetchImpl,
    })
  }
  const committed = await requestPromotion(`${destination}/promotions/${encodeURIComponent(receipt.version)}`, {
    method: 'POST',
    token,
    identity: receipt.promotionIdentity,
    body: JSON.stringify(receipt),
    fetchImpl,
  })
  if (committed.status !== 200 && committed.status !== 201) {
    throw new Error(`promotion commit failed (${committed.status}) for ${receipt.channel}/${receipt.version}`)
  }
  const acknowledgment = await committed.json().catch(() => null)
  if (!acknowledgment || typeof acknowledgment !== 'object') throw new Error('promotion commit acknowledgment is missing')
  for (const key of ['promotionIdentity', 'channel', 'version']) {
    requireEqual(acknowledgment[key], receipt[key], `promotion commit acknowledgment ${key}`)
  }
  return {
    schemaVersion: 1,
    status: 'published',
    promotionIdentity: receipt.promotionIdentity,
    channel: receipt.channel,
    commit: receipt.commit,
    runId: receipt.runId,
    runAttempt: receipt.runAttempt,
    version: receipt.version,
    qualificationSha256: receipt.qualification.sha256,
    targets: receipt.targets.map((target) => ({
      platform: target.platform,
      arch: target.arch,
      manifestSha256: target.manifest.sha256,
      artifactSha256: target.artifact.sha256,
    })),
    publishedAt,
  }
}

function argument(args, name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] || fallback : fallback
}

function requiredArgument(args, name) {
  const value = argument(args, name)
  if (!value) throw new Error(`${name} is required`)
  return value
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2)
  const outputPath = path.resolve(requiredArgument(args, '--output'))
  if (args.includes('--build-receipt')) {
    const receipt = await buildVerifiedPromotionReceipt({
      evidenceRoot: path.resolve(requiredArgument(args, '--evidence-root')),
      artifactRoot: path.resolve(requiredArgument(args, '--artifact-root')),
      qualificationPath: path.resolve(requiredArgument(args, '--qualification')),
      commit: process.env.GITHUB_SHA,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      version: process.env.RELEASE_VERSION,
      channel: process.env.RELEASE_CHANNEL,
      publicBaseUrls: {
        beta: process.env.UPDATE_BETA_BASE_URL,
        stable: process.env.UPDATE_STABLE_BASE_URL,
      },
      updatePublicKeyPath: path.resolve(requiredArgument(args, '--update-public-key')),
    })
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
    console.log(`Verified promotion receipt written: ${receipt.promotionIdentity}`)
  } else if (args.includes('--publish')) {
    const receipt = JSON.parse(await fs.readFile(path.resolve(requiredArgument(args, '--receipt')), 'utf8'))
    const published = await publishVerifiedPromotion({
      receipt,
      evidenceRoot: path.resolve(requiredArgument(args, '--evidence-root')),
      artifactRoot: path.resolve(requiredArgument(args, '--artifact-root')),
      destinations: {
        beta: process.env.UPDATE_BETA_PUBLISH_URL,
        stable: process.env.UPDATE_STABLE_PUBLISH_URL,
      },
      token: process.env.UPDATE_PUBLISH_TOKEN,
      expectedIdentity: {
        commit: process.env.GITHUB_SHA,
        runId: process.env.GITHUB_RUN_ID,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT,
        version: String(process.env.RELEASE_VERSION || '').replace(/^v/, ''),
        channel: process.env.RELEASE_CHANNEL,
      },
    })
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, `${JSON.stringify(published, null, 2)}\n`, 'utf8')
    console.log(`Promotion published: ${published.promotionIdentity}`)
  } else {
    throw new Error('one of --build-receipt or --publish is required')
  }
}
