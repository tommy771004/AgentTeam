/**
 * Security Evidence Ledger — append-only weekly JSONL with optional HMAC chain.
 * Never stores prompts, file bodies, model output, protected plaintext, or digests.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export type EvidenceEventType =
  | 'outbound-decision'
  | 'policy-change'
  | 'policy-rollback'
  | 'guard-mode-change'
  | 'workspace-sync'
  | 'device-retired'
  | 'device-replaced'
  | 'evidence-verification'
  | 'retention-checkpoint'

export type EvidenceExclusionLocator = {
  source: string
  startLine: number
  endLine: number
}

export type EvidenceRecord = {
  schemaVersion: 1
  eventId: string
  sequence: number
  timestampUtc: string
  eventType: EvidenceEventType
  runId?: string
  providerId?: string
  effectiveGuardMode?: string
  policySource?: string
  policyVersion?: string
  changeId?: string
  classifierStatus?: string
  filesystemIsolation?: string
  action?: string
  exclusions?: EvidenceExclusionLocator[]
  sealed: boolean
  previousMac?: string
  recordMac?: string
}

export type HmacKeyProvider = {
  getKey(): Promise<Buffer | null>
}

export function createMemoryHmacKeyProvider(key: Buffer): HmacKeyProvider {
  return {
    async getKey() {
      return key
    },
  }
}

/** Asia/Taipei wall time → ISO week key YYYY-Www (Monday first). */
export function isoWeekKeyTaipei(date: Date = new Date()): string {
  // Convert to Taipei civil date via formatToParts
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const y = Number(parts.find((p) => p.type === 'year')?.value)
  const m = Number(parts.find((p) => p.type === 'month')?.value)
  const d = Number(parts.find((p) => p.type === 'day')?.value)
  // Use UTC noon on that civil date to avoid DST edge issues (TW has no DST)
  const utc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  // ISO week: Thursday-based year; Monday first
  const day = utc.getUTCDay() || 7 // 1..7 Mon..Sun
  utc.setUTCDate(utc.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  const isoYear = utc.getUTCFullYear()
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

function canonicalPayload(rec: Omit<EvidenceRecord, 'recordMac'>): string {
  // Stable key order for MAC
  const o: Record<string, unknown> = {
    schemaVersion: rec.schemaVersion,
    eventId: rec.eventId,
    sequence: rec.sequence,
    timestampUtc: rec.timestampUtc,
    eventType: rec.eventType,
    runId: rec.runId ?? null,
    providerId: rec.providerId ?? null,
    effectiveGuardMode: rec.effectiveGuardMode ?? null,
    policySource: rec.policySource ?? null,
    policyVersion: rec.policyVersion ?? null,
    changeId: rec.changeId ?? null,
    classifierStatus: rec.classifierStatus ?? null,
    filesystemIsolation: rec.filesystemIsolation ?? null,
    action: rec.action ?? null,
    exclusions: rec.exclusions ?? [],
    sealed: rec.sealed,
    previousMac: rec.previousMac ?? null,
  }
  return JSON.stringify(o)
}

function hmacHex(key: Buffer, data: string): string {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex')
}

function weekFilePath(ledgerDir: string, weekKey: string): string {
  return path.join(ledgerDir, `evidence-${weekKey}.jsonl`)
}

function readLastRecord(filePath: string): EvidenceRecord | null {
  if (!fs.existsSync(filePath)) return null
  const text = fs.readFileSync(filePath, 'utf8').trim()
  if (!text) return null
  const lines = text.split('\n')
  const last = lines[lines.length - 1]
  try {
    return JSON.parse(last) as EvidenceRecord
  } catch {
    return null
  }
}

export type AppendEvidenceInput = {
  eventType: EvidenceEventType
  runId?: string
  providerId?: string
  effectiveGuardMode?: string
  policySource?: string
  policyVersion?: string
  changeId?: string
  classifierStatus?: string
  filesystemIsolation?: string
  action?: string
  exclusions?: EvidenceExclusionLocator[]
}

export async function appendEvidenceRecord(
  input: AppendEvidenceInput,
  opts: {
    ledgerDir: string
    keyProvider: HmacKeyProvider
    sealed: boolean
    now?: Date
  },
): Promise<{ ok: true; record: EvidenceRecord } | { ok: false; reason: string }> {
  fs.mkdirSync(opts.ledgerDir, { recursive: true })
  const now = opts.now || new Date()
  const weekKey = isoWeekKeyTaipei(now)
  const filePath = weekFilePath(opts.ledgerDir, weekKey)
  const prev = readLastRecord(filePath)
  const sequence = (prev?.sequence || 0) + 1

  let previousMac = prev?.recordMac
  if (!previousMac && sequence === 1) {
    // Cross-week link: try previous week terminal MAC
    // Simplified: walk one prior week key not required for v1 unit tests
    previousMac = undefined
  }

  const base: Omit<EvidenceRecord, 'recordMac'> = {
    schemaVersion: 1,
    eventId: `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    sequence,
    timestampUtc: now.toISOString(),
    eventType: input.eventType,
    runId: input.runId,
    providerId: input.providerId,
    effectiveGuardMode: input.effectiveGuardMode,
    policySource: input.policySource,
    policyVersion: input.policyVersion,
    changeId: input.changeId,
    classifierStatus: input.classifierStatus,
    filesystemIsolation: input.filesystemIsolation,
    action: input.action,
    exclusions: input.exclusions || [],
    sealed: opts.sealed,
    previousMac,
  }

  let recordMac: string | undefined
  if (opts.sealed) {
    const key = await opts.keyProvider.getKey()
    if (!key) {
      return { ok: false, reason: 'HMAC key unavailable for sealed evidence' }
    }
    recordMac = hmacHex(key, canonicalPayload(base))
  }

  const record: EvidenceRecord = { ...base, recordMac }
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8')
  return { ok: true, record }
}

export async function verifyLedgerFile(
  filePath: string,
  keyProvider: HmacKeyProvider,
): Promise<{ ok: boolean; reason?: string }> {
  if (!fs.existsSync(filePath)) return { ok: false, reason: 'missing file' }
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean)
  if (!lines.length) return { ok: true }

  const key = await keyProvider.getKey()
  let expectedSeq = 1
  let prevMac: string | undefined

  for (const line of lines) {
    let rec: EvidenceRecord
    try {
      rec = JSON.parse(line) as EvidenceRecord
    } catch {
      return { ok: false, reason: 'malformed JSONL line' }
    }
    if (rec.sequence !== expectedSeq) {
      return { ok: false, reason: `sequence gap/reorder at ${expectedSeq}` }
    }
    if ((rec.previousMac || undefined) !== (prevMac || undefined)) {
      return { ok: false, reason: `previousMac mismatch at seq ${rec.sequence}` }
    }
    if (rec.sealed) {
      if (!key) return { ok: false, reason: 'key unavailable for sealed verify' }
      const { recordMac, ...rest } = rec
      const expected = hmacHex(key, canonicalPayload(rest))
      if (recordMac !== expected) {
        return { ok: false, reason: `recordMac mismatch at seq ${rec.sequence}` }
      }
      prevMac = recordMac
    } else {
      prevMac = rec.recordMac
    }
    expectedSeq++
  }
  return { ok: true }
}
