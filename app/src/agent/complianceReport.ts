import { isRedactionEvent, type OutboundRunEvidenceRecord } from './outbound/runEvidence.ts'

/** Exportable, metadata-only compliance document assembled from existing evidence. */
export type ComplianceAuthorization = {
  actor?: string
  runId?: string
  threadId?: string
  objective?: string
  tool?: string
  decision: 'allow' | 'deny' | 'timeout'
  /** The mode in force when the decision was taken (`full` never bypasses deny). */
  approvalMode?: string
  /** Unattended runs downgrade `full` to `auto`; recorded so an audit sees it. */
  unattended?: boolean
  at?: string
  source?: string
}

/** entitlement.ts fails closed to `free`; a downgrade is an auditable event. */
export type ComplianceEntitlementDecision = {
  featureId: string
  granted: boolean
  tier?: string
  failedClosed?: boolean
  reason?: string
  runId?: string
  at?: string
}

/** The window or run set this document answers for. */
export type CompliancePeriod = {
  from?: string
  to?: string
  runIds?: string[]
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
  period?: CompliancePeriod
  authorizations?: ComplianceAuthorization[]
  credentialReferences?: ComplianceCredentialReference[]
  fileChanges?: ComplianceFileChange[]
  blockedTools?: ComplianceBlockedTool[]
  entitlementDecisions?: ComplianceEntitlementDecision[]
  outboundEvidence?: OutboundRunEvidenceRecord[]
  /** Provenance of each composed source; nothing here is newly collected. */
  sources?: string[]
}

export type ComplianceReport = {
  schemaVersion: 1
  reportId: string
  runId?: string
  generatedAt: string
  period: CompliancePeriod
  sources: string[]
  redactionsApplied: true
  authorizations: ComplianceAuthorization[]
  credentialReferences: ComplianceCredentialReference[]
  fileChanges: ComplianceFileChange[]
  blockedTools: ComplianceBlockedTool[]
  entitlementDecisions: ComplianceEntitlementDecision[]
  outboundEvidence: OutboundRunEvidenceRecord[]
  summary: {
    authorizations: number
    credentialReferences: number
    fileChanges: number
    blockedTools: number
    entitlementDecisions: number
    entitlementFailClosed: number
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
    approvalMode: item.approvalMode ? safe(item.approvalMode, 40) : undefined,
    unattended: item.unattended === true ? true : undefined,
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
  const entitlementDecisions = bounded(input.entitlementDecisions).map((item) => ({
    featureId: safe(item.featureId, 160),
    granted: item.granted === true,
    tier: item.tier ? safe(item.tier, 40) : undefined,
    failedClosed: item.failedClosed === true ? true : undefined,
    reason: item.reason ? safe(item.reason, 240) : undefined,
    runId: item.runId ? safe(item.runId, 120) : undefined,
    at: item.at ? safe(item.at, 40) : undefined,
  }))
  const outboundEvidence = bounded(input.outboundEvidence).map(normalizeOutbound)
  const redactionEvents = outboundEvidence.filter(isRedactionEvent).length
  return {
    schemaVersion: 1,
    reportId: safe(input.reportId || `compliance:${Date.now().toString(36)}`, 160),
    runId: input.runId ? safe(input.runId, 120) : undefined,
    generatedAt,
    period: {
      from: input.period?.from ? safe(input.period.from, 40) : undefined,
      to: input.period?.to ? safe(input.period.to, 40) : undefined,
      runIds: input.period?.runIds?.slice(0, MAX_ITEMS).map((id) => safe(id, 120)),
    },
    sources: (input.sources || []).slice(0, 24).map((item) => safe(item, 120)),
    redactionsApplied: true,
    authorizations,
    credentialReferences,
    fileChanges,
    blockedTools,
    entitlementDecisions,
    outboundEvidence,
    summary: {
      authorizations: authorizations.length,
      credentialReferences: credentialReferences.length,
      fileChanges: fileChanges.length,
      blockedTools: blockedTools.length,
      entitlementDecisions: entitlementDecisions.length,
      entitlementFailClosed: entitlementDecisions.filter((item) => item.failedClosed).length,
      outboundEvents: outboundEvidence.length,
      redactionEvents,
    },
  }
}

export function renderComplianceReportJson(report: ComplianceReport): string {
  return JSON.stringify(report, null, 2)
}

function table(header: string[], rows: string[][]): string[] {
  if (rows.length === 0) return ['（無記錄）', '']
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((cell) => cell || '—').join(' | ')} |`),
    '',
  ]
}

/**
 * A reviewer who has never read the source must be able to answer, from this
 * document alone: who was authorised to run what, under which approval mode,
 * which credentials were referenced, which files changed, which tools were
 * blocked pending re-approval, and what left the machine.
 */
export function renderComplianceReportMarkdown(report: ComplianceReport): string {
  const scope = report.period.runIds?.length
    ? `${report.period.runIds.length} 個指定 run`
    : [report.period.from, report.period.to].filter(Boolean).join(' → ') || '全部既有證據'
  return [
    '# Compliance report',
    '',
    `- 報告編號：\`${report.reportId}\``,
    `- 產生時間：${report.generatedAt}`,
    `- 涵蓋範圍：${scope}`,
    `- 單一 run：${report.runId || '（不限）'}`,
    `- 證據來源：${report.sources.length ? report.sources.join('、') : '（未標示）'}`,
    '- 原始憑證與內容：一律不含（僅 metadata）',
    '',
    '## Summary',
    '',
    `- 授權決策：${report.summary.authorizations}`,
    `- 憑證引用：${report.summary.credentialReferences}`,
    `- 檔案變更：${report.summary.fileChanges}`,
    `- 被封鎖工具：${report.summary.blockedTools}`,
    `- Entitlement 決策：${report.summary.entitlementDecisions}（fail-closed ${report.summary.entitlementFailClosed}）`,
    `- Outbound 事件：${report.summary.outboundEvents}`,
    `- 遮蔽事件：${report.summary.redactionEvents}`,
    '',
    '## 1. 誰被授權執行什麼',
    '',
    ...table(
      ['Actor', 'Run', '工具／目標', '決策', 'Approval mode', 'Unattended', '時間'],
      report.authorizations.map((item) => [
        item.actor || '',
        item.runId || '',
        item.tool || item.objective || '',
        item.decision,
        item.approvalMode || '',
        item.unattended ? 'yes' : 'no',
        item.at || '',
      ]),
    ),
    '## 2. 引用了哪些憑證（僅 metadata）',
    '',
    ...table(
      ['Reference', 'Provider', 'Run', 'Source'],
      report.credentialReferences.map((item) => [
        item.reference,
        item.providerId || '',
        item.runId || '',
        item.source || '',
      ]),
    ),
    '## 3. 變更了哪些檔案',
    '',
    ...table(
      ['Path', 'Action', '+', '-', 'Run'],
      report.fileChanges.map((item) => [
        item.path,
        item.action,
        item.added == null ? '' : String(item.added),
        item.removed == null ? '' : String(item.removed),
        item.runId || '',
      ]),
    ),
    '## 4. 哪些工具因 fingerprint 變更被封鎖並等待重新核准',
    '',
    ...table(
      ['Tool', 'Package', 'Fingerprint', 'Reason', '時間'],
      report.blockedTools.map((item) => [
        item.tool,
        item.packageId || '',
        item.fingerprint || '',
        item.reason,
        item.at || '',
      ]),
    ),
    '## 5. Entitlement 決策（含 fail-closed 降級）',
    '',
    ...table(
      ['Feature', 'Granted', 'Tier', 'Fail-closed', 'Reason'],
      report.entitlementDecisions.map((item) => [
        item.featureId,
        item.granted ? 'yes' : 'no',
        item.tier || '',
        item.failedClosed ? 'yes' : 'no',
        item.reason || '',
      ]),
    ),
    '## 6. 資料外送證據',
    '',
    ...table(
      ['Event', 'Type', 'Provider', 'Guard mode', '排除數', 'Sealed', '時間'],
      report.outboundEvidence.map((item) => [
        item.eventId,
        item.eventType,
        item.providerId || '',
        item.effectiveGuardMode || '',
        String(item.exclusionCount),
        item.sealed ? 'yes' : 'no',
        item.timestampUtc,
      ]),
    ),
    '## Appendix — machine-readable evidence',
    '',
    '```json',
    renderComplianceReportJson(report),
    '```',
    '',
  ].join('\n')
}
