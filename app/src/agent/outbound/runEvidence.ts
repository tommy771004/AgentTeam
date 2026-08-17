/** Metadata-only outbound/DLP projection for one run. */
export type OutboundRunEvidenceRecord = {
  eventId: string
  eventType: string
  timestampUtc: string
  runId?: string
  providerId?: string
  effectiveGuardMode?: string
  policySource?: string
  filesystemIsolation?: string
  action?: string
  exclusionCount: number
  sealed: boolean
}

export type OutboundRunView = {
  runId: string
  records: OutboundRunEvidenceRecord[]
  providerIds: string[]
  exclusionCount: number
  redactionEvents: number
  sealedRecords: number
}

/** One definition of "this record involved redaction" — shared with the report. */
export function isRedactionEvent(record: Pick<OutboundRunEvidenceRecord, 'exclusionCount' | 'eventType'>): boolean {
  return record.exclusionCount > 0 || /redact|sanitize|exclusion/i.test(record.eventType)
}

export function projectOutboundRunEvidence(
  runId: string,
  records: OutboundRunEvidenceRecord[],
): OutboundRunView {
  const bounded = records.slice(-100).map((record) => ({
    ...record,
    eventId: String(record.eventId || '').slice(0, 180),
    eventType: String(record.eventType || '').slice(0, 80),
    providerId: record.providerId?.slice(0, 120),
    policySource: record.policySource?.slice(0, 120),
    action: record.action?.slice(0, 180),
    exclusionCount: Math.max(0, Math.min(1000, Number(record.exclusionCount) || 0)),
  }))
  return {
    runId,
    records: bounded,
    providerIds: [...new Set(bounded.map((record) => record.providerId).filter(Boolean) as string[])],
    exclusionCount: bounded.reduce((sum, record) => sum + record.exclusionCount, 0),
    redactionEvents: bounded.filter(isRedactionEvent).length,
    sealedRecords: bounded.filter((record) => record.sealed).length,
  }
}
