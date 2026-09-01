import fs from 'node:fs/promises'
import path from 'node:path'
import {
  buildReleaseQualification,
  type ReleaseQualificationInput,
  type ReleasePlatformEvidence,
} from '../src/agent/releaseQualification.ts'
import { validatePackagedInstallEvidence } from './packaged-install-evidence.mjs'
import {
  RELEASE_HARDENING_CHECK_IDS,
  validateReleaseHardeningReceipt,
  type ReleaseHardeningCheckId,
  type ReleaseHardeningIdentity,
  type ReleaseHardeningTrust,
} from './release-hardening-receipt.mts'

type EvidenceBundle = {
  directory: string
  manifest: Record<string, any>
  smoke: string
  trustDocs: string
}

async function readText(filePath: string) {
  return fs.readFile(filePath, 'utf8').catch(() => '')
}

async function readJson(filePath: string): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch {
    return null
  }
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function nonEmptyFile(filePath: string) {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

async function findManifestDirectories(root: string): Promise<string[]> {
  if (await fileExists(path.join(root, 'release-manifest.json'))) return [root]
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const directories: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const nested = path.join(root, entry.name)
    if (await fileExists(path.join(nested, 'release-manifest.json'))) directories.push(nested)
  }
  return directories.sort()
}

function warningInput(): ReleaseQualificationInput['warnings'] {
  try {
    const parsed = JSON.parse(process.env.RELEASE_WARNINGS_JSON || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return [{
      id: 'release-warnings-json',
      summary: 'RELEASE_WARNINGS_JSON 無法解析',
      owner: 'release-engineering',
      mitigation: '修正 warning payload 後重新執行 qualification',
    }]
  }
}

async function loadBundle(directory: string, repoRoot: string): Promise<EvidenceBundle | null> {
  const manifest = await readJson(path.join(directory, 'release-manifest.json'))
  if (!manifest) return null
  return {
    directory,
    manifest,
    smoke: await readText(path.join(directory, 'smoke.log')),
    trustDocs: await readText(path.join(repoRoot, 'website', 'app', 'siteContent.ts')),
  }
}

function platformEvidence(bundle: EvidenceBundle): ReleasePlatformEvidence {
  const { directory, manifest } = bundle
  const platform = manifest.platform === 'macos' ? 'macos' : 'windows'
  const signedByPlatformLog = platform === 'windows'
    ? Boolean(manifest) && Boolean(manifest.artifacts?.length) && Boolean(manifest.checksums)
    : false
  const windowsSignature = path.join(directory, 'windows-signature-verification.json')
  const macSignature = path.join(directory, 'codesign-mounted.log')
  const macGatekeeper = path.join(directory, 'gatekeeper-mounted.log')
  const macStapler = path.join(directory, 'stapler-dmg-validate.log')
  const installEvidencePath = path.join(directory, 'install-launch-restart-uninstall.json')

  return {
    platform,
    architecture: String(manifest.arch || 'unknown'),
    signed: platform === 'windows' ? signedByPlatformLog && Boolean(manifest.provenance) : false,
    checksum: Boolean(manifest.checksums) && Array.isArray(manifest.artifacts) && manifest.artifacts.length > 0,
    cleanInstall: false,
    firstRunTask: false,
    // These paths are evaluated asynchronously by buildQualificationInputFromEvidence.
    _paths: { windowsSignature, macSignature, macGatekeeper, macStapler, installEvidencePath },
  } as ReleasePlatformEvidence & { _paths: Record<string, string> }
}

export async function buildQualificationInputFromEvidence({
  evidenceRoot,
  releaseVersion = '',
  owner = 'release-engineering',
  repoRoot = path.resolve(process.cwd(), '..'),
  hardeningTrust,
}: {
  evidenceRoot: string
  releaseVersion?: string
  owner?: string
  repoRoot?: string
  hardeningTrust?: ReleaseHardeningTrust
}): Promise<ReleaseQualificationInput> {
  const directories = await findManifestDirectories(path.resolve(evidenceRoot))
  const bundles = (await Promise.all(directories.map((directory) => loadBundle(directory, repoRoot)))).filter(Boolean) as EvidenceBundle[]
  const platforms: ReleasePlatformEvidence[] = []
  for (const bundle of bundles) {
    const evidence = platformEvidence(bundle) as ReleasePlatformEvidence & { _paths: Record<string, string> }
    const install = await readJson(evidence._paths.installEvidencePath)
    const firstTask = validatePackagedInstallEvidence(install, evidence.platform).ok
    const cleanInstall = Boolean(install?.uninstall?.removed && firstTask)
    const windowsVerified = evidence.platform === 'windows' && await fileExists(evidence._paths.windowsSignature)
    const macVerified = evidence.platform === 'macos'
      && await fileExists(evidence._paths.macSignature)
      && await fileExists(evidence._paths.macGatekeeper)
      && await fileExists(evidence._paths.macStapler)
    evidence.signed = evidence.platform === 'windows' ? windowsVerified : macVerified
    evidence.checksum = evidence.checksum && await fileExists(path.join(bundle.directory, 'checksums.txt'))
    evidence.cleanInstall = cleanInstall
    evidence.firstRunTask = firstTask
    delete (evidence as ReleasePlatformEvidence & { _paths?: unknown })._paths
    platforms.push(evidence)
  }

  const smoke = bundles.map((bundle) => bundle.smoke).join('\n')
  const trustDocs = bundles.map((bundle) => bundle.trustDocs).find(Boolean) || ''
  const allBundlesHave = async (fileName: string) => bundles.length > 0
    && (await Promise.all(bundles.map((bundle) => fileExists(path.join(bundle.directory, fileName))))).every(Boolean)
  const piHostEvidence = await Promise.all(bundles.map((bundle) => readJson(path.join(bundle.directory, 'pi-host-qualification.json'))))
  const piHost = {
    protocol: piHostEvidence.length > 0 && piHostEvidence.every((evidence) => evidence?.protocol === true),
    utilityProcess: piHostEvidence.length > 0 && piHostEvidence.every((evidence) => evidence?.utilityProcess === true),
    sessions: piHostEvidence.length > 0 && piHostEvidence.every((evidence) => evidence?.sessions === true),
    extensions: piHostEvidence.length > 0 && piHostEvidence.every((evidence) => evidence?.extensions === true),
  }
  const workflowEvidence = /paid-workflow smoke:|artifact-index-handoff smoke:|composer selection overrides/i.test(smoke)
  const entitlementEvidence = /Entitlement boundary smoke:|Subscription lifecycle smoke:|Feature pack smoke:/i.test(smoke)
  const releaseVersionFromManifest = String(releaseVersion || bundles[0]?.manifest.version || 'unknown')
  const trustDocsComplete = /privacy|security|EULA|terms|refund|support|release notes|checksum|SBOM|provenance/i.test(trustDocs)
  const bundleEvidence = {
    recovery: await allBundlesHave('recovery-e2e.log'),
    updateRollback: await allBundlesHave('update-rollback-evidence.json'),
    updateKey: await allBundlesHave('update-key-verification.log'),
    security: await allBundlesHave('security-gates.log'),
    releaseNotes: await allBundlesHave('release-notes.md'),
    checksums: await allBundlesHave('checksums.txt'),
    sbom: await allBundlesHave('sbom.cdx.json'),
  }
  const hardeningReceipts = await Promise.all(bundles.map(async (bundle) => {
    const provenance = bundle.manifest.provenance || {}
    const expected: ReleaseHardeningIdentity = {
      commit: String(provenance.commit || ''),
      runId: String(provenance.runId || ''),
      runAttempt: String(provenance.runAttempt || ''),
      version: String(bundle.manifest.version || releaseVersionFromManifest),
      platform: bundle.manifest.platform === 'macos' ? 'macos' : 'windows',
      arch: String(bundle.manifest.arch || 'unknown'),
    }
    const receipt = await readJson(path.join(bundle.directory, 'release-hardening-receipt.json'))
    if (!validateReleaseHardeningReceipt(receipt, expected, hardeningTrust)) return null
    const evidencePresent = await Promise.all(receipt.checks.map((check) => nonEmptyFile(path.join(bundle.directory, check.evidenceFile))))
    return evidencePresent.every(Boolean) ? receipt : null
  }))
  const hardeningPassed = (id: ReleaseHardeningCheckId) => hardeningReceipts.length > 0
    && hardeningReceipts.every((receipt) => receipt?.checks.some((check) => check.id === id && check.passed))
  const hardening = Object.fromEntries(
    RELEASE_HARDENING_CHECK_IDS.map((id) => [id, hardeningPassed(id)]),
  ) as ReleaseQualificationInput['hardening']

  return {
    releaseVersion: releaseVersionFromManifest,
    owner,
    platforms,
    recovery: {
      restart: bundleEvidence.recovery,
      crash: bundleEvidence.recovery,
      queueExactlyOnce: bundleEvidence.recovery,
      schedulerOnceJob: bundleEvidence.recovery,
    },
    piHost,
    update: {
      nMinusOneToN: bundleEvidence.updateRollback,
      signatureVerified: bundleEvidence.updateKey,
      failedRecovery: bundleEvidence.updateRollback,
      rollback: bundleEvidence.updateRollback,
    },
    entitlement: {
      freeCore: entitlementEvidence,
      activePro: entitlementEvidence,
      offlineGrace: entitlementEvidence,
      expired: entitlementEvidence,
      cancelled: entitlementEvidence,
      packRollback: entitlementEvidence,
    },
    workflow: {
      spec: workflowEvidence,
      tickets: workflowEvidence,
      tdd: workflowEvidence,
      review: workflowEvidence,
      artifactIndex: workflowEvidence,
      handoff: workflowEvidence,
      userApprovalBeforeRelease: workflowEvidence,
    },
    trust: {
      privacy: trustDocsComplete,
      security: trustDocsComplete && bundleEvidence.security,
      eula: trustDocsComplete,
      terms: trustDocsComplete,
      refund: trustDocsComplete,
      support: trustDocsComplete,
      releaseNotes: bundleEvidence.releaseNotes,
      checksums: bundleEvidence.checksums,
      sbom: bundleEvidence.sbom,
      provenance: bundles.length > 0 && bundles.every((bundle) => Boolean(bundle.manifest.provenance)),
    },
    hardening,
    warnings: warningInput(),
  }
}

export async function writeQualificationReport(input: ReleaseQualificationInput, reportPath: string) {
  const qualification = buildReleaseQualification(input)
  const resolvedReportPath = path.resolve(reportPath)
  await fs.mkdir(path.dirname(resolvedReportPath), { recursive: true })
  await fs.writeFile(resolvedReportPath, `${qualification.report}\n`, 'utf8')
  await fs.writeFile(resolvedReportPath.replace(/\.md$/i, '.json'), `${JSON.stringify(qualification, null, 2)}\n`, 'utf8')
  return qualification
}
