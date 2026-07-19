/** Fail-closed Paid Beta release qualification. */

export type ReleasePlatformEvidence = {
  platform: 'windows' | 'macos'
  architecture: string
  signed: boolean
  checksum: boolean
  cleanInstall: boolean
  firstRunTask: boolean
}

export type ReleaseQualificationInput = {
  releaseVersion: string
  owner: string
  platforms: ReleasePlatformEvidence[]
  recovery: {
    restart: boolean
    crash: boolean
    queueExactlyOnce: boolean
    schedulerOnceJob: boolean
  }
  update: {
    nMinusOneToN: boolean
    signatureVerified: boolean
    failedRecovery: boolean
    rollback: boolean
  }
  entitlement: {
    freeCore: boolean
    activePro: boolean
    offlineGrace: boolean
    expired: boolean
    cancelled: boolean
    packRollback: boolean
  }
  workflow: {
    spec: boolean
    tickets: boolean
    tdd: boolean
    review: boolean
    artifactIndex: boolean
    handoff: boolean
    userApprovalBeforeRelease: boolean
  }
  trust: {
    privacy: boolean
    security: boolean
    eula: boolean
    terms: boolean
    refund: boolean
    support: boolean
    releaseNotes: boolean
    checksums: boolean
    sbom: boolean
    provenance: boolean
  }
  warnings: Array<{ id: string; summary: string; owner: string; mitigation: string }>
}

export type ReleaseQualification = {
  releaseVersion: string
  evaluatedAt: string
  owner: string
  decision: 'GO' | 'NO-GO'
  ready: boolean
  failedCriteria: string[]
  warnings: ReleaseQualificationInput['warnings']
  report: string
}

type Criterion = { id: string; passed: boolean; detail: string }

function criteria(input: ReleaseQualificationInput): Criterion[] {
  const windows = input.platforms.find((item) => item.platform === 'windows')
  const macos = input.platforms.find((item) => item.platform === 'macos')
  const platformChecks = [
    ['windows-signed-x64', Boolean(windows?.signed), 'Windows signed artifact'],
    ['windows-checksum-x64', Boolean(windows?.checksum), 'Windows SHA-256 checksum'],
    ['windows-clean-install', Boolean(windows?.cleanInstall), 'Windows clean install'],
    ['windows-first-run', Boolean(windows?.firstRunTask), 'Windows first-run CLI doctor and task'],
    ['macos-signed', Boolean(macos?.signed), 'macOS signed/notarized artifact'],
    ['macos-checksum', Boolean(macos?.checksum), 'macOS SHA-256 checksum'],
    ['macos-clean-install', Boolean(macos?.cleanInstall), 'macOS clean install'],
    ['macos-first-run', Boolean(macos?.firstRunTask), 'macOS first-run CLI doctor and task'],
  ] as const
  const checks: Criterion[] = platformChecks.map(([id, passed, detail]) => ({ id, passed, detail }))
  const addGroup = (prefix: string, group: Record<string, boolean>, labels: Record<string, string>) => {
    for (const [id, passed] of Object.entries(group)) checks.push({ id: `${prefix}-${id}`, passed, detail: labels[id] || `${prefix} ${id}` })
  }
  addGroup('recovery', input.recovery, { restart: 'Restart recovery', crash: 'Forced crash recovery', queueExactlyOnce: 'Queue exactly-once', schedulerOnceJob: 'Scheduler once-job' })
  addGroup('update', input.update, { nMinusOneToN: 'N-1 to N migration', signatureVerified: 'Update signature verification', failedRecovery: 'Failed update recovery', rollback: 'Update rollback' })
  addGroup('entitlement', input.entitlement, { freeCore: 'Free Core', activePro: 'Active Pro', offlineGrace: 'Offline grace', expired: 'Expired entitlement', cancelled: 'Cancelled entitlement', packRollback: 'Feature-pack rollback' })
  addGroup('workflow', input.workflow, { spec: 'Spec', tickets: 'Tickets', tdd: 'TDD', review: 'Review', artifactIndex: 'Artifact Index', handoff: 'Handoff', userApprovalBeforeRelease: 'User approval before release action' })
  addGroup('trust', input.trust, { privacy: 'Privacy', security: 'Security', eula: 'EULA', terms: 'Terms', refund: 'Refund', support: 'Support', releaseNotes: 'Release notes', checksums: 'Checksums', sbom: 'SBOM', provenance: 'Provenance' })
  return checks
}

export function buildReleaseQualification(input: ReleaseQualificationInput, evaluatedAt = new Date().toISOString()): ReleaseQualification {
  const all = criteria(input)
  const failedCriteria = all.filter((criterion) => !criterion.passed).map((criterion) => `${criterion.id}: ${criterion.detail}`)
  const warningFailures = input.warnings.filter((warning) => !warning.owner.trim() || !warning.mitigation.trim())
  if (warningFailures.length) failedCriteria.push(...warningFailures.map((warning) => `${warning.id}: warning lacks owner or mitigation`))
  const ready = failedCriteria.length === 0
  const decision = ready ? 'GO' : 'NO-GO'
  const lines = [
    `# Paid Beta Release Qualification: ${decision}`,
    '',
    `- Version: ${input.releaseVersion}`,
    `- Evaluated: ${evaluatedAt}`,
    `- Owner: ${input.owner}`,
    `- Criteria: ${all.length - failedCriteria.length}/${all.length} passed`,
    '',
    '## Failed criteria',
    ...(failedCriteria.length ? failedCriteria.map((item) => `- ${item}`) : ['- None']),
    '',
    '## Warnings and mitigations',
    ...(input.warnings.length
      ? input.warnings.map((warning) => `- ${warning.id}: ${warning.summary} · owner=${warning.owner} · mitigation=${warning.mitigation}`)
      : ['- None']),
    '',
    ready
      ? 'Release actions may proceed only after this report is retained with the signed artifacts.'
      : 'Release remains No-Go. Do not publish or market Paid Beta as ready until every failed criterion has stored evidence.',
  ]
  return { releaseVersion: input.releaseVersion, evaluatedAt, owner: input.owner, decision, ready, failedCriteria, warnings: input.warnings, report: lines.join('\n') }
}
