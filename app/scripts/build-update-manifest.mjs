import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function sign(payload, privateKey) {
  return crypto.createSign('RSA-SHA256').update(payload).end().sign(privateKey).toString('base64')
}
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex') }
async function listFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(file))
    else if (/\.(?:exe|dmg|pkg|zip|appimage)$/i.test(entry.name)) files.push(file)
  }
  return files.sort()
}
function arg(args, name, fallback = '') { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || fallback : fallback }
function normalizePlatform(value) {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'windows') return 'win32'
  if (normalized === 'macos' || normalized === 'mac') return 'darwin'
  if (normalized === 'win32' || normalized === 'darwin') return normalized
  throw new Error(`unsupported update platform: ${value}`)
}
function assertHttpsBaseUrl(value) {
  const parsed = new URL(String(value || ''))
  if (parsed.protocol !== 'https:' || !parsed.hostname) throw new Error('baseUrl must be an HTTPS URL')
  return parsed.toString().replace(/\/$/, '')
}

export async function buildSignedUpdateManifest({ artifactDir, outputDir, version, platform, arch, channel = 'beta', baseUrl, privateKeyPem }) {
  if (!privateKeyPem || !baseUrl || !artifactDir || !outputDir || !version || !platform || !arch) throw new Error('artifactDir, outputDir, version, platform, arch, baseUrl, and privateKeyPem are required')
  platform = normalizePlatform(platform)
  baseUrl = assertHttpsBaseUrl(baseUrl)
  const files = await listFiles(artifactDir)
  if (!files.length) throw new Error('no installer artifacts found')
  const artifacts = []
  for (const file of files) {
    const bytes = await fs.readFile(file)
    const name = path.basename(file)
    const descriptor = { url: `${baseUrl}/${encodeURIComponent(name)}`, size: bytes.byteLength, sha256: sha256(bytes), signature: '', signatureAlgorithm: 'rsa-sha256' }
    descriptor.signature = sign(canonical({ sha256: descriptor.sha256, size: descriptor.size, url: descriptor.url }), privateKeyPem)
    artifacts.push(descriptor)
  }
  const manifest = { schemaVersion: 1, product: 'AgentStudio', channel, version: String(version).replace(/^v/, ''), platform, arch, mandatory: false, releaseNotes: process.env.UPDATE_RELEASE_NOTES || `AgentStudio ${version}`, publishedAt: new Date().toISOString(), artifact: artifacts[0], signature: '' }
  const unsignedManifest = { ...manifest }
  delete unsignedManifest.signature
  manifest.signature = sign(canonical(unsignedManifest), privateKeyPem)
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2)
  const privateKey = process.env.UPDATE_PRIVATE_KEY || (process.env.UPDATE_PRIVATE_KEY_FILE ? await fs.readFile(process.env.UPDATE_PRIVATE_KEY_FILE, 'utf8') : '')
  const manifest = await buildSignedUpdateManifest({
    artifactDir: path.resolve(arg(args, '--artifact-dir', 'release')),
    outputDir: path.resolve(arg(args, '--output-dir', 'release-evidence/update-channel')),
    version: arg(args, '--version', process.env.RELEASE_VERSION),
    platform: arg(args, '--platform', process.env.RELEASE_PLATFORM),
    arch: arg(args, '--arch', process.env.RELEASE_ARCH),
    channel: arg(args, '--channel', 'beta'),
    baseUrl: arg(args, '--base-url', process.env.UPDATE_BASE_URL),
    privateKeyPem: privateKey,
  })
  console.log(`Signed update manifest written for ${manifest.platform}/${manifest.arch}: ${manifest.version}`)
}
