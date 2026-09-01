import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildReleaseHardeningReceipt } from './release-hardening-receipt.mts'
import { buildQualificationInputFromEvidence } from './release-qualification-input.mts'
import { buildReleaseQualification } from '../src/agent/releaseQualification.ts'

const identity = {
  commit: 'a'.repeat(40),
  runId: '4242',
  runAttempt: '3',
  version: '1.2.3-beta.1',
  platform: 'macos' as const,
  arch: 'arm64',
}

const trustedKeys = generateKeyPairSync('ed25519')
const attackerKeys = generateKeyPairSync('ed25519')
const keyId = 'release-hardening-test-2026'
const signingAuthority = {
  privateKeyPem: trustedKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  keyId,
}
const hardeningTrust = {
  publicKeyPem: trustedKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  keyId,
}

async function fixture(receipt: unknown): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-hardening-'))
  const bundle = path.join(root, 'macos-arm64')
  await fs.mkdir(bundle)
  await fs.writeFile(path.join(bundle, 'release-manifest.json'), JSON.stringify({
    platform: identity.platform,
    arch: identity.arch,
    version: identity.version,
    artifacts: [{ name: 'AgentStudio.dmg' }],
    checksums: 'checksums.txt',
    provenance: { commit: identity.commit, runId: identity.runId, runAttempt: identity.runAttempt },
  }))
  await fs.writeFile(path.join(bundle, 'release-hardening-owners.log'), 'release promotion and credential contracts passed\n')
  await fs.writeFile(path.join(bundle, 'deterministic-qualification.log'), 'deterministic qualification passed\n')
  if (receipt) await fs.writeFile(path.join(bundle, 'release-hardening-receipt.json'), JSON.stringify(receipt))
  return root
}

const validReceipt = buildReleaseHardeningReceipt(identity, signingAuthority, '2026-09-01T03:00:00.000Z')
const validRoot = await fixture(validReceipt)
try {
  const input = await buildQualificationInputFromEvidence({ evidenceRoot: validRoot, hardeningTrust })
  assert.deepEqual(input.hardening, {
    releasePromotion: true,
    credentialBoundary: true,
    settingsRecovery: true,
    deterministicGuards: true,
    mergeBaseComplexity: true,
    shippedRuntimeCiCoverage: true,
  })
  assert.deepEqual(input.recovery, { restart: false, crash: false, queueExactlyOnce: false, schedulerOnceJob: false })
  assert.deepEqual(input.update, { nMinusOneToN: false, signatureVerified: false, failedRecovery: false, rollback: false })
  assert.equal(input.trust.releaseNotes, false)
  const qualification = buildReleaseQualification(input, '2026-09-01T03:01:00.000Z')
  assert.equal(qualification.decision, 'NO-GO', 'automated green cannot replace missing signed-platform evidence')
  assert.match(qualification.report, /Automated repository hardening: PASS \(6\/6\)/)
  assert.match(qualification.report, /External release evidence: BLOCKED/)
  assert.ok(qualification.report.length < 16_384, 'aggregate report stays bounded')
} finally {
  await fs.rm(validRoot, { recursive: true, force: true })
}

for (const [label, mutate] of [
  ['missing', () => null],
  ['stale commit', () => ({ ...validReceipt, commit: 'b'.repeat(40) })],
  ['mixed attempt', () => ({ ...validReceipt, runAttempt: '2' })],
  ['model-authored', () => ({ ...validReceipt, authority: { kind: 'model' } })],
  ['unsigned', () => ({ ...validReceipt, signature: '' })],
  ['attacker-signed', () => buildReleaseHardeningReceipt(identity, {
    privateKeyPem: attackerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    keyId,
  }, '2026-09-01T03:00:00.000Z')],
] as const) {
  const root = await fixture(mutate())
  try {
    const input = await buildQualificationInputFromEvidence({ evidenceRoot: root, hardeningTrust })
    assert.ok(Object.values(input.hardening).every((passed) => !passed), `${label} receipt must fail closed`)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

console.log('release hardening qualification accepts only coherent workflow-owned receipts')

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const workflow = await fs.readFile(path.join(repositoryRoot, '.github/workflows/release.yml'), 'utf8')
const packageJson = JSON.parse(await fs.readFile(path.join(import.meta.dirname, '../package.json'), 'utf8')) as { scripts?: Record<string, string> }
assert.equal(
  packageJson.scripts?.['smoke:release-hardening-owners'],
  'node scripts/smoke-release-promotion.mjs && npm run smoke:credential-vault',
)
assert.match(
  workflow,
  /npm run qualify:deterministic[\s\S]*npm run smoke:release-hardening-owners[\s\S]*write-release-hardening-receipt\.mts[\s\S]*npm run build/,
  'blocking owner seams run before the workflow-owned receipt and compilation',
)
assert.match(workflow, /RELEASE_HARDENING_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.RELEASE_HARDENING_SIGNING_PRIVATE_KEY \}\}/)
assert.match(workflow, /release-qualification:[\s\S]*RELEASE_HARDENING_PUBLIC_KEY: \$\{\{ vars\.RELEASE_HARDENING_PUBLIC_KEY \}\}/)
