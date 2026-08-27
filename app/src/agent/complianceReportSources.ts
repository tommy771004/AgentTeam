/**
 * Compose a compliance report from evidence the product already produces.
 *
 * This module collects nothing new. Every field is a projection of
 * an existing source — the run archive, `outbound/evidenceLedger.ts`,
 * `tools/toolPackage.ts` fingerprints and `entitlement.ts` — reshaped into the
 * exportable document. Raw credentials and payloads never enter it.
 */
import {
  buildComplianceReport,
  type ComplianceAuthorization,
  type ComplianceBlockedTool,
  type ComplianceCredentialReference,
  type ComplianceEntitlementDecision,
  type ComplianceFileChange,
  type ComplianceReport,
  type CompliancePeriod,
} from './complianceReport.ts'
import { isFailClosed, type EntitlementSnapshot } from './entitlement.ts'
import { packageFingerprint, compileToolPackage, type ToolPackageManifest, type PackageReview } from './tools/toolPackage.ts'
import type { OutboundRunEvidenceRecord } from './outbound/runEvidence.ts'
import type { ArchiveRecord } from './types.ts'

const FILE_TOOLS = new Set([
  'workspace_write',
  'workspace_delete',
  'workspace_move',
  'workspace_mkdir',
  'workspace_download',
])

function withinPeriod(at: string | undefined, period?: CompliancePeriod): boolean {
  if (!period) return true
  if (!at) return true
  const time = Date.parse(at)
  if (Number.isNaN(time)) return true
  if (period.from && time < Date.parse(period.from)) return false
  if (period.to && time > Date.parse(period.to)) return false
  return true
}

/** HITL decisions and tool authorisations already recorded on each archived run. */
export function authorizationsFromArchive(
  archive: ArchiveRecord[],
  period?: CompliancePeriod,
): ComplianceAuthorization[] {
  const rows: ComplianceAuthorization[] = []
  for (const record of archive) {
    if (period?.runIds?.length && !period.runIds.includes(record.id)) continue
    if (!withinPeriod(record.timestamp, period)) continue
    for (const call of record.toolCalls || []) {
      rows.push({
        actor: 'local-user',
        runId: record.id,
        objective: record.objective,
        tool: call.tool,
        decision: call.ok ? 'allow' : 'deny',
        at: call.timestamp,
        source: 'archive.toolCalls',
      })
    }
    for (const tool of record.hitl?.toolsTimedOut || []) {
      rows.push({
        actor: 'local-user',
        runId: record.id,
        objective: record.objective,
        tool,
        decision: 'timeout',
        at: record.timestamp,
        source: 'archive.hitl',
      })
    }
  }
  return rows
}

/** Which files a run touched, derived from the recorded workspace tool calls. */
export function fileChangesFromArchive(
  archive: ArchiveRecord[],
  period?: CompliancePeriod,
): ComplianceFileChange[] {
  const rows: ComplianceFileChange[] = []
  for (const record of archive) {
    if (period?.runIds?.length && !period.runIds.includes(record.id)) continue
    if (!withinPeriod(record.timestamp, period)) continue
    for (const call of record.toolCalls || []) {
      if (!FILE_TOOLS.has(call.tool)) continue
      const input = call.input || {}
      const target = String(input.path || input.to || input.dest || input.file || '')
      if (!target) continue
      rows.push({ path: target, action: call.tool, runId: record.id })
    }
  }
  return rows
}

/** Credential *references* only — the vault never exposes material to this path. */
export function credentialReferencesFromOutbound(
  records: OutboundRunEvidenceRecord[],
): ComplianceCredentialReference[] {
  const seen = new Set<string>()
  const rows: ComplianceCredentialReference[] = []
  for (const record of records) {
    if (!record.providerId) continue
    const reference = `provider:${record.providerId}`
    const key = `${reference}:${record.runId || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      reference,
      providerId: record.providerId,
      runId: record.runId,
      source: 'outbound/evidenceLedger',
    })
  }
  return rows
}

/** Tools compiled out because the package fingerprint is not approved. */
export function blockedToolsFromPackages(
  packages: Array<{ manifest: ToolPackageManifest; ownerId: string; review?: PackageReview | null }>,
  at = new Date().toISOString(),
): ComplianceBlockedTool[] {
  const rows: ComplianceBlockedTool[] = []
  for (const entry of packages) {
    const compiled = compileToolPackage(entry.manifest, entry.ownerId, entry.review)
    if (!compiled.needsReview) continue
    const fingerprint = packageFingerprint(entry.manifest)
    const escalated = entry.review?.approvedFingerprint && entry.review.approvedFingerprint !== fingerprint
    for (const tool of compiled.withheld) {
      rows.push({
        tool,
        packageId: entry.manifest.id,
        fingerprint,
        reason: escalated
          ? 'fingerprint changed since approval — awaiting re-approval'
          : 'privilege surface not yet approved — compiled read-only',
        at,
      })
    }
  }
  return rows
}

/** Entitlement outcome, including the fail-closed downgrade to `free`. */
export function entitlementDecisionsFromSnapshot(
  snapshot: EntitlementSnapshot,
  featureIds: string[],
  at = new Date().toISOString(),
): ComplianceEntitlementDecision[] {
  const failedClosed = isFailClosed(snapshot)
  return featureIds.map((featureId) => ({
    featureId,
    granted: snapshot.grantedFeatures.has(featureId as never),
    tier: snapshot.tier,
    failedClosed: failedClosed || undefined,
    reason: snapshot.reason || (failedClosed ? `entitlement source=${snapshot.source}` : undefined),
    at,
  }))
}

/**
 * One call that assembles the whole document. Callers pass the state they
 * already hold; this function performs no I/O of its own.
 */
export function collectComplianceReport(input: {
  archive: ArchiveRecord[]
  outboundEvidence: OutboundRunEvidenceRecord[]
  entitlement: EntitlementSnapshot
  entitledFeatureIds?: string[]
  toolPackages?: Array<{ manifest: ToolPackageManifest; ownerId: string; review?: PackageReview | null }>
  period?: CompliancePeriod
  runId?: string
  generatedAt?: string
}): ComplianceReport {
  const generatedAt = input.generatedAt || new Date().toISOString()
  const outbound = input.period?.runIds?.length
    ? input.outboundEvidence.filter((record) => !record.runId || input.period!.runIds!.includes(record.runId))
    : input.outboundEvidence
  return buildComplianceReport({
    runId: input.runId,
    generatedAt,
    period: input.period || {},
    authorizations: authorizationsFromArchive(input.archive, input.period),
    fileChanges: fileChangesFromArchive(input.archive, input.period),
    credentialReferences: credentialReferencesFromOutbound(outbound),
    blockedTools: blockedToolsFromPackages(input.toolPackages || [], generatedAt),
    entitlementDecisions: entitlementDecisionsFromSnapshot(
      input.entitlement,
      input.entitledFeatureIds || [],
      generatedAt,
    ),
    outboundEvidence: outbound,
    sources: [
      'archive.toolCalls',
      'archive.hitl',
      'outbound/evidenceLedger',
      'tools/toolPackage',
      'entitlement',
    ],
  })
}
