import type { OutboundRunEvidenceRecord } from './outbound/runEvidence.ts'

/** Exportable, metadata-only compliance document assembled from existing evidence. */
export type ComplianceAuthorization = {
  actor?: string
  runId?: string
  threadId?: string
  objective?: string
  tool?: string
  decision: 'allow' | 'deny' | 'timeout'
  at?: string
  source?: string
}

export type ComplianceCredentialReference = {
  reference: string
  providerId?: string
  runId?: string
  source?: string
}

export type ComplianceFileChange = {
  path: string
  action: string
  added?: number
  removed?: number
  runId?: string
}

export type ComplianceBlockedTool = {
  tool: string
  reason: string
  fingerprint?: string
  packageId?: string
  at?: string
  runId?: string
}

export type ComplianceReportInput = {
  reportId?: string
  runId?: string
  generatedAt?: string
  authorizations?: ComplianceAuthorization[]
  credentialReferences?: ComplianceCredentialReference[]
  fileChanges?: ComplianceFileChange[]
  blockedTools?: ComplianceBlockedTool[]
  outboundEvidence?: OutboundRunEvidenceRecord[]
}

export type ComplianceReport = {
  schemaVersion: 1
  reportId: string
  runId?: string
  generatedAt: string
  redactionsApplied: true
  authorizations: ComplianceAuthorization[]
  credentialReferences: ComplianceCredentialReference[]
  fileChanges: ComplianceFileChange[]
  blockedTools: ComplianceBlockedTool[]
  outboundEvidence: OutboundRunEvidenceRecord[]
  summary: {
    authorizations: number
    credentialReferences: number
    fileChanges: number
    blockedTools: number
    outboundEvents: number
    redactionEvents: number
  }
}

const MAX_ITEMS = 200

function safe(value: unknown, max = 360): string {
  return String(value ?? '')
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0)
      return code < 32 || code === 127 ? ' ' : char
    })
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/(?:sk-(?:ant-|proj-|live-)?|gh[pousr]_)[A-Za-z0-9_-]{12,}/gi, '[REDACTED]')
    .replace(/(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .trim()
    .slice(0, max)
}

function safeCount(value: unknown): number | undefined {
  if (value == null) return undefined
  const count = Number(value)
  return Number.isFinite(count) ? Math.max(0, Math.min(1_000_000, Math.floor(count))) : 0
}

function bounded<T>(items: T[] | undefined): T[] {
  return (items || []).slice(-MAX_ITEMS)
}

function normalizeOutbound(record: OutboundRunEvidenceRecord): OutboundRunEvidenceRecord {
  return {
    eventId: safe(record.eventId, 180),
    eventType: safe(record.eventType, 80),
    timestampUtc: safe(record.timestampUtc, 40),
    runId: record.runId ? safe(record.runId, 120) : undefined,
    providerId: record.providerId ? safe(record.providerId, 120) : undefined,
    effectiveGuardMode: record.effectiveGuardMode ? safe(record.effectiveGuardMode, 40) : undefined,
    policySource: record.policySource ? safe(record.policySource, 80) : undefined,
    filesystemIsolation: record.filesystemIsolation ? safe(record.filesystemIsolation, 80) : undefined,
    action: record.action ? safe(record.action, 180) : undefined,
    exclusionCount: Math.max(0, Math.min(1_000, Math.floor(Number(record.exclusionCount) || 0))),
    sealed: record.sealed === true,
  }
}

export function buildComplianceReport(input: ComplianceReportInput): ComplianceReport {
  const generatedAt = safe(input.generatedAt || new Date().toISOString(), 40)
  const authorizations = bounded(input.authorizations).map((item) => ({
    actor: safe(item.actor || 'local-user', 120),
    runId: item.runId ? safe(item.runId, 120) : undefined,
    threadId: item.threadId ? safe(item.threadId, 120) : undefined,
    objective: item.objective ? safe(item.objective, 360) : undefined,
    tool: item.tool ? safe(item.tool, 120) : undefined,
    decision: item.decision,
    at: item.at ? safe(item.at, 40) : undefined,
    source: item.source ? safe(item.source, 120) : undefined,
  }))
  const credentialReferences = bounded(input.credentialReferences).map((item) => ({
    reference: safe(item.reference, 160),
    providerId: item.providerId ? safe(item.providerId, 120) : undefined,
    runId: item.runId ? safe(item.runId, 120) : undefined,
    source: item.source ? safe(item.source, 120) : undefined,
  }))
  const fileChanges = bounded(input.fileChanges).map((item) => ({
    path: safe(item.path, 600),
    action: safe(item.action, 60),
    added: safeCount(item.added),
    removed: safeCount(item.removed),
    runId: item.runId ? safe(item.runId, 120) : undefined,
  }))
  const blockedTools = bounded(input.blockedTools).map((item) => ({
    tool: safe(item.tool, 120),
    reason: safe(item.reason, 240),
    fingerprint: item.fingerprint ? safe(item.fingerprint, 120) : undefined,
    packageId: item.packageId ? safe(item.packageId, 120) : undefined,
    at: item.at ? safe(item.at, 40) : undefined,
    runId: item.runId ? safe(item.runId, 120) : undefined,
  }))
  const outboundEvidence = bounded(input.outboundEvidence).map(normalizeOutbound)
  const redactionEvents = outboundEvidence.filter(
    (item) => item.exclusionCount > 0 || /redact|sanitize|exclusion/i.test(item.eventType),
  ).length
  return {
    schemaVersion: 1,
    reportId: safe(input.reportId || `compliance:${Date.now().toString(36)}`, 160),
    runId: input.runId ? safe(input.runId, 120) : undefined,
    generatedAt,
    redactionsApplied: true,
    authorizations,
    credentialReferences,
    fileChanges,
    blockedTools,
    outboundEvidence,
    summary: {
      authorizations: authorizations.length,
      credentialReferences: credentialReferences.length,
      fileChanges: fileChanges.length,
      blockedTools: blockedTools.length,
      outboundEvents: outboundEvidence.length,
      redactionEvents,
    },
  }
}

export function renderComplianceReportJson(report: ComplianceReport): string {
  return JSON.stringify(report, null, 2)
}

export function renderComplianceReportMarkdown(report: ComplianceReport): string {
  const lines = [
    '# Compliance report',
    '',
    `- Report: \`${report.reportId}\``,
    `- Generated: ${report.generatedAt}`,
    `- Run: ${report.runId || 'all selected evidence'}`,
    '- Raw credentials and content: not included',
    '',
    '## Summary',
    '',
    `- Authorisations: ${report.summary.authorizations}`,
    `- Credential references: ${report.summary.credentialReferences}`,
    `- File changes: ${report.summary.fileChanges}`,
    `- Blocked tools: ${report.summary.blockedTools}`,
    `- Outbound events: ${report.summary.outboundEvents}`,
    `- Redaction events: ${report.summary.redactionEvents}`,
    '',
    '## Evidence',
    '',
    '```json',
    renderComplianceReportJson(report),
    '```',
    '',
  ]
  return lines.join('\n')
}
