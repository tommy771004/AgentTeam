import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { artifactSignaturePayload, buildMigrationSnapshot, canonicalJson, compareVersions, sanitizeRendererStorage, validateMigrationSnapshot, validateUpdateManifest, unsignedManifestPayload, type SignedUpdateManifest } from '../src/agent/updateContracts.ts'
import { sha256Hex, verifyArtifactSignature, verifyManifestSignature } from '../electron/updateVerification.ts'
import { applyRendererStorageSnapshot, markMigrationApplied, prepareMigrationTransaction, rollbackMigrationTransaction } from '../src/agent/updateMigration.ts'
import { buildSignedUpdateManifest } from './build-update-manifest.mjs'

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const sign = (payload: string) => crypto.createSign('RSA-SHA256').update(payload).end().sign(privateKey).toString('base64')
const bytes = Buffer.from('signed beta installer')
const testPlatform = process.platform === 'darwin' ? 'darwin' as const : 'win32' as const
const installerName = testPlatform === 'darwin' ? 'SubAgents-AI-1.1.0.dmg' : 'SubAgents-AI-1.1.0.exe'
const artifact = { url: `https://updates.example.test/beta/${installerName}`, size: bytes.length, sha256: sha256Hex(bytes), signature: '', signatureAlgorithm: 'rsa-sha256' as const }
artifact.signature = sign(artifactSignaturePayload(artifact))
const manifest = {
  schemaVersion: 1 as const,
  product: 'AgentStudio' as const,
  channel: 'beta' as const,
  version: '1.1.0',
  platform: testPlatform,
  arch: 'x64' as const,
  mandatory: false,
  releaseNotes: 'Signed Beta update',
  publishedAt: new Date().toISOString(),
  artifact,
  signature: '',
} satisfies SignedUpdateManifest
manifest.signature = sign(unsignedManifestPayload(manifest))

const valid = validateUpdateManifest(manifest, { platform: testPlatform, arch: 'x64', currentVersion: '1.0.0' })
assert.equal(valid.ok, true)
const legacyManifest = { ...manifest, product: 'SubAgents AI' as const }
legacyManifest.signature = sign(unsignedManifestPayload(legacyManifest))
assert.equal(
  validateUpdateManifest(legacyManifest, { platform: testPlatform, arch: 'x64', currentVersion: '1.0.0' }).ok,
  true,
)
assert.equal(verifyManifestSignature(manifest, publicKey.export({ type: 'spki', format: 'pem' }).toString()), true)
assert.equal(verifyArtifactSignature(artifact, bytes, publicKey.export({ type: 'spki', format: 'pem' }).toString()), true)
assert.equal(validateUpdateManifest({ ...manifest, artifact: { ...artifact, url: 'http://evil.test/a.exe' } }).ok, false)
assert.equal(validateUpdateManifest(manifest, { platform: testPlatform === 'darwin' ? 'win32' : 'darwin', arch: 'x64', currentVersion: '1.0.0' }).ok, false)
assert.equal(validateUpdateManifest({ ...manifest, version: '1.0.0' }, { platform: 'win32', arch: 'x64', currentVersion: '1.0.0' }).ok, false)
assert.equal(validateUpdateManifest({ ...manifest, signature: 'tampered' }).ok, true, 'signature shape is validated separately from cryptographic verification')
assert.equal(verifyManifestSignature({ ...manifest, releaseNotes: 'tampered' }, publicKey.export({ type: 'spki', format: 'pem' }).toString()), false)
assert.equal(compareVersions('1.1.0-beta.10', '1.1.0-beta.2') > 0, true)
assert.equal(compareVersions('1.1.0+build.2', '1.1.0+build.1'), 0)

const manifestRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'subagents-update-manifest-'))
const manifestArtifacts = path.join(manifestRoot, 'release')
const manifestOutput = path.join(manifestRoot, 'channel')
await fs.mkdir(manifestArtifacts)
await fs.writeFile(path.join(manifestArtifacts, installerName), bytes)
const generatedManifest = await buildSignedUpdateManifest({
  artifactDir: manifestArtifacts,
  outputDir: manifestOutput,
  version: '1.1.0',
  platform: testPlatform,
  arch: 'x64',
  baseUrl: 'https://updates.example.test/beta',
  privateKeyPem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
})
assert.equal(verifyManifestSignature(generatedManifest, publicKey.export({ type: 'spki', format: 'pem' }).toString()), true)
assert.equal((await fs.readFile(path.join(manifestOutput, 'manifest.json'), 'utf8')).includes(installerName), true)
assert.equal(generatedManifest.platform, testPlatform)
assert.equal(generatedManifest.product, 'SubAgents AI', 'schema-v1 producer must remain readable by N-1 clients')
// Frozen compatibility assertion for the last pre-rename client. Do not
// replace this with validateUpdateManifest: it intentionally preserves the
// old binary's strict product check.
assert.equal(generatedManifest.schemaVersion === 1 && generatedManifest.product === 'SubAgents AI', true)
await assert.rejects(
  buildSignedUpdateManifest({ artifactDir: manifestArtifacts, outputDir: manifestOutput, version: '1.1.0', platform: testPlatform, arch: 'x64', baseUrl: 'http://insecure.example.test', privateKeyPem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString() }),
  /HTTPS URL/,
)
const legacyPlatformManifest = await buildSignedUpdateManifest({
  artifactDir: manifestArtifacts,
  outputDir: manifestOutput,
  version: '1.1.0',
  platform: testPlatform === 'darwin' ? 'macos' : 'windows',
  arch: 'x64',
  baseUrl: 'https://updates.example.test/beta/win32/x64',
  privateKeyPem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
})
assert.equal(legacyPlatformManifest.platform, testPlatform)

const snapshot = buildMigrationSnapshot({
  appVersion: '1.0.0',
  rendererStorage: { 'subagents.threads.v5': '{"threads":[1]}', 'subagents.settings.v1': '{"theme":"dark"}', 'subagents.project.root.v1': 'C:/repo', 'subagents.runQueue.v1': '{"items":[]}', 'subagents.artifactIndex.v1': '{"refs":["ticket-05"]}' },
  vaultMetadata: [{ id: 'openai', encrypted: true }],
  projects: [{ root: 'C:/repo', name: 'repo', branch: 'main' }],
  queue: { v: 1, items: [{ id: 'queued-1' }] },
  schedules: [{ id: 'daily-1', enabled: true }],
  artifactIndex: { refs: ['ticket-05'] },
})
assert.equal(validateMigrationSnapshot(snapshot), true)
assert.deepEqual(snapshot.rendererStorage['subagents.threads.v5'], '{"threads":[1]}')
assert.deepEqual(snapshot.vaultMetadata, [{ id: 'openai', encrypted: true }])
assert.deepEqual((snapshot.queue as { items: unknown[] }).items, [{ id: 'queued-1' }])
assert.equal(sanitizeRendererStorage({ 'subagents.settings.v1': '{"apiKey":"secret","theme":"dark"}' })['subagents.settings.v1'], '{"theme":"dark"}')
assert.equal(JSON.parse(sanitizeRendererStorage({ 'subagents.plugin-secrets.v1': '{"openai":{"token":"secret","label":"kept"}}' })['subagents.plugin-secrets.v1']).openai.token, undefined)
assert.equal(JSON.parse(sanitizeRendererStorage({ 'subagents.plugin-secrets.v1': '{"openai":{"token":"secret","label":"kept"}}' })['subagents.plugin-secrets.v1']).openai.label, 'kept')
assert.deepEqual(JSON.parse(applyRendererStorageSnapshot({ 'subagents.settings.v1': '{"apiKey":"keep","theme":"old"}' }, { 'subagents.settings.v1': '{"theme":"new"}' })['subagents.settings.v1']), { apiKey: 'keep', theme: 'new' })
assert.deepEqual(applyRendererStorageSnapshot({ 'subagents.settings.v1': 'old', 'unrelated': 'keep' }, { 'subagents.settings.v1': 'new', 'subagents.runQueue.v1': '{"items":[1]}' }), { unrelated: 'keep', 'subagents.settings.v1': 'new', 'subagents.runQueue.v1': '{"items":[1]}' })
const transaction = markMigrationApplied(prepareMigrationTransaction({ id: 'tx-05', previousVersion: '1.0.0', targetVersion: '1.1.0', snapshot }))
const rollback = rollbackMigrationTransaction({ ...transaction, status: 'failed' })
assert.equal(rollback.status, 'rolled-back')
assert.equal(rollback.launchable, true)
assert.deepEqual(rollback.restoredSnapshot, snapshot)

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subagents-update-'))
const backup = path.join(root, 'migration-backup.json')
await fs.writeFile(backup, JSON.stringify(snapshot), 'utf8')
const restored = JSON.parse(await fs.readFile(backup, 'utf8'))
assert.deepEqual(restored, snapshot)
assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}')
if (process.env.UPDATE_EVIDENCE_OUTPUT) {
  await fs.mkdir(path.dirname(process.env.UPDATE_EVIDENCE_OUTPUT), { recursive: true })
  await fs.writeFile(process.env.UPDATE_EVIDENCE_OUTPUT, `${JSON.stringify({
    schemaVersion: 1,
    platform: process.platform,
    arch: process.arch,
    artifactKind: process.platform === 'win32' ? 'nsis-fixture-installer' : 'dmg-fixture-installer',
    manifestVerified: verifyManifestSignature(manifest, publicKey.export({ type: 'spki', format: 'pem' }).toString()),
    artifactVerified: verifyArtifactSignature(artifact, bytes, publicKey.export({ type: 'spki', format: 'pem' }).toString()),
    migrationPreserved: validateMigrationSnapshot(snapshot) && rollback.launchable,
    rollbackLaunchable: rollback.launchable,
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8')
}
console.log('Signed update + N-1→N migration contract: 1 scenario passed')
