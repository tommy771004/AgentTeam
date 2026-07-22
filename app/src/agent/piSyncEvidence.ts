export type PiSyncArtifact = { path: string; sha256: string }

export type PiSyncEvidenceInput = {
  fromCommit: string
  toCommit: string
  ledgerReconciled: boolean
  upstreamTests: boolean
  protocolCompatibility: boolean
  equivalentToolParity: boolean
  settingsSessionMigration: boolean
  electronSmoke: boolean
  recovery: boolean
  security: boolean
  packaging: boolean
  removedPatches: string[]
  survivingPatches: string[]
  artifacts: PiSyncArtifact[]
}

export type PiSyncEvidence = PiSyncEvidenceInput & {
  decision: 'GO' | 'NO-GO'
  ready: boolean
  failedCriteria: string[]
}

const commitPattern = /^[0-9a-f]{40}$/
const sha256Pattern = /^[0-9a-f]{64}$/

export function buildPiSyncEvidence(input: PiSyncEvidenceInput): PiSyncEvidence {
  const failedCriteria: string[] = []
  if (!commitPattern.test(input.fromCommit)) failedCriteria.push('fromCommit is not a full SHA-1')
  if (!commitPattern.test(input.toCommit)) failedCriteria.push('toCommit is not a full SHA-1')
  if (input.fromCommit === input.toCommit) failedCriteria.push('synchronization must advance to a different commit')
  const gates: Array<[keyof Pick<PiSyncEvidenceInput, 'ledgerReconciled' | 'upstreamTests' | 'protocolCompatibility' | 'equivalentToolParity' | 'settingsSessionMigration' | 'electronSmoke' | 'recovery' | 'security' | 'packaging'>, string]> = [
    ['ledgerReconciled', 'Core Patch Ledger reconciliation'],
    ['upstreamTests', 'Pi upstream tests'],
    ['protocolCompatibility', 'Host protocol compatibility'],
    ['equivalentToolParity', 'Equivalent Tool parity'],
    ['settingsSessionMigration', 'Settings/session migration'],
    ['electronSmoke', 'Electron smoke'],
    ['recovery', 'Restart and recovery'],
    ['security', 'Security qualification'],
    ['packaging', 'Packaged artifact qualification'],
  ]
  for (const [key, label] of gates) if (!input[key]) failedCriteria.push(label)
  if (input.removedPatches.some((patch) => !patch.trim())) failedCriteria.push('removed patch entries require a rationale')
  if (input.survivingPatches.some((patch) => !patch.trim())) failedCriteria.push('surviving patch entries require a rationale')
  if (!input.artifacts.length) failedCriteria.push('at least one reproducible artifact is required')
  for (const artifact of input.artifacts) {
    if (!artifact.path.trim()) failedCriteria.push('artifact path is required')
    if (!sha256Pattern.test(artifact.sha256)) failedCriteria.push(`invalid SHA-256 for ${artifact.path || 'artifact'}`)
  }
  return { ...input, decision: failedCriteria.length ? 'NO-GO' : 'GO', ready: failedCriteria.length === 0, failedCriteria }
}
