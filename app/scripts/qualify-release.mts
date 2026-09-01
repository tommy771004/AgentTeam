import path from 'node:path'
import { buildQualificationInputFromEvidence, writeQualificationReport } from './release-qualification-input.mts'

function argument(name: string, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

const evidenceRoot = argument('--evidence-root', argument('--evidence-dir', 'release-evidence'))
const reportPath = argument('--report', path.join(evidenceRoot, 'paid-beta-qualification.md'))
const input = await buildQualificationInputFromEvidence({
  evidenceRoot,
  releaseVersion: argument('--version', process.env.RELEASE_VERSION || ''),
  owner: argument('--owner', process.env.RELEASE_OWNER || 'release-engineering'),
  repoRoot: path.resolve(process.cwd(), '..'),
  hardeningTrust: {
    publicKeyPem: String(process.env.RELEASE_HARDENING_PUBLIC_KEY ?? ''),
    keyId: String(process.env.RELEASE_HARDENING_KEY_ID ?? ''),
  },
})
const qualification = await writeQualificationReport(input, reportPath)
console.log(qualification.report)
if (qualification.decision !== 'GO') process.exitCode = 1
