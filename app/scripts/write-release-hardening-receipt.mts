import fs from 'node:fs/promises'
import path from 'node:path'
import {
  RELEASE_HARDENING_EVIDENCE_FILES,
  buildReleaseHardeningReceipt,
  type ReleaseHardeningIdentity,
} from './release-hardening-receipt.mts'

function argument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : ''
  if (!value) throw new Error(`${name} is required`)
  return value
}

const output = path.resolve(argument('--output'))
const platform = argument('--platform')
if (platform !== 'windows' && platform !== 'macos') throw new Error(`unsupported release platform: ${platform}`)

const identity: ReleaseHardeningIdentity = {
  commit: argument('--commit'),
  runId: argument('--run-id'),
  runAttempt: argument('--run-attempt'),
  version: argument('--version'),
  platform,
  arch: argument('--arch'),
}
if (!/^[a-f0-9]{40}$/i.test(identity.commit)) throw new Error('release hardening commit must be a full Git SHA')
if (!/^\d+$/.test(identity.runId) || !/^[1-9]\d*$/.test(identity.runAttempt)) throw new Error('release hardening run identity is invalid')

const evidenceRoot = path.dirname(output)
for (const fileName of new Set(Object.values(RELEASE_HARDENING_EVIDENCE_FILES))) {
  const stat = await fs.stat(path.join(evidenceRoot, fileName)).catch(() => null)
  if (!stat?.isFile() || stat.size === 0) throw new Error(`release hardening owner evidence is missing: ${fileName}`)
}

const privateKeyPem = process.env.RELEASE_HARDENING_SIGNING_PRIVATE_KEY || ''
const keyId = process.env.RELEASE_HARDENING_KEY_ID || ''
if (!privateKeyPem.trim() || !keyId.trim()) throw new Error('trusted release hardening signing key and key id are required')
const receipt = buildReleaseHardeningReceipt(identity, { privateKeyPem, keyId })
await fs.writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
console.log(`release hardening receipt: ${receipt.receiptId}`)
