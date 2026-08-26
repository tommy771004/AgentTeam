import { isPiTurnSettlement, type PiTurnInterruptReason, type PiTurnSettlement } from '../src/agent/piHostRun.ts'
import type { TurnRecordEntry } from '../src/agent/turnRecord.ts'

/**
 * Host-owned attachment journal.  This is deliberately metadata, not a
 * second transcript: the Turn Record remains the only source of entries.
 * Renderer reloads can therefore observe a run without taking ownership of
 * execution or app finalization.
 */
export type PiHostAttachmentStatus = 'active' | 'terminal'

export type PiHostAttachment = {
  runId: string
  sessionId: string
  threadId?: string
  turn?: number
  status: PiHostAttachmentStatus
  latestSeq: number
  total: number
  settlement?: PiTurnSettlement
  interruptReason?: PiTurnInterruptReason
  summary?: string
  terminalAt?: number
  acknowledged?: boolean
}

export type PiHostAttachmentState = {
  records: PiHostAttachment[]
}

export type PiHostAttachmentPage = {
  attachment: PiHostAttachment
  entries: TurnRecordEntry[]
  latestSeq: number
  total: number
  availableFromSeq: number
  gap?: { missingBefore: number; earliestSeq: number }
}

export const PI_HOST_ATTACHMENT_TERMINAL_LIMIT = 256
export const PI_HOST_ATTACHMENT_MAX_SUMMARY_BYTES = 64 * 1024
export const PI_HOST_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000
export const PI_HOST_ATTACHMENT_PAGE_LIMIT = 200

const emptyState = (): PiHostAttachmentState => ({ records: [] })

function boundedSummary(summary: unknown): string | undefined {
  if (typeof summary !== 'string' || !summary) return undefined
  // UTF-8 byte length is the renderer-facing bound, not a JS code-unit bound.
  const bytes = new TextEncoder().encode(summary)
  if (bytes.byteLength <= PI_HOST_ATTACHMENT_MAX_SUMMARY_BYTES) return summary
  // Cut only at a UTF-8 code-point boundary. TextDecoder's replacement
  // character can itself exceed the byte budget when a multibyte character is
  // split exactly at the limit, so back up over continuation bytes first.
  let end = PI_HOST_ATTACHMENT_MAX_SUMMARY_BYTES
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1
  return new TextDecoder().decode(bytes.slice(0, end))
}

function boundedString(value: unknown, max = 160): string | undefined {
  return typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined
}

function boundedCount(value: unknown): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
  return Math.max(0, parsed)
}

/** Pick the attachment schema explicitly; never reflect persisted unknown fields. */
function normalizeRecord(record: PiHostAttachment): PiHostAttachment | undefined {
  if (!record || typeof record !== 'object') return undefined
  const runId = boundedString(record.runId)
  const sessionId = boundedString(record.sessionId)
  if (!runId || !sessionId || (record.status !== 'active' && record.status !== 'terminal')) return undefined
  const settlement = isPiTurnSettlement(record.settlement) ? record.settlement : undefined
  return {
    runId,
    sessionId,
    ...(boundedString(record.threadId) ? { threadId: boundedString(record.threadId) } : {}),
    ...(record.turn === undefined ? {} : { turn: boundedCount(record.turn) }),
    status: record.status,
    latestSeq: boundedCount(record.latestSeq),
    total: boundedCount(record.total),
    ...(settlement ? { settlement } : {}),
    ...(record.interruptReason === 'user' || record.interruptReason === 'timeout' ? { interruptReason: record.interruptReason } : {}),
    ...(boundedSummary(record.summary) ? { summary: boundedSummary(record.summary) } : {}),
    ...(typeof record.terminalAt === 'number' && Number.isFinite(record.terminalAt) ? { terminalAt: record.terminalAt } : {}),
    ...(record.acknowledged === true ? { acknowledged: true } : {}),
  }
}

/** Mutable Host-local journal backed by the parent snapshot persistence hook. */
export class PiHostAttachmentJournal {
  private state: PiHostAttachmentState
  private readonly onChange?: (state: PiHostAttachmentState) => void
  private readonly clock: () => number

  constructor(state?: Partial<PiHostAttachmentState>, onChange?: (state: PiHostAttachmentState) => void, clock: () => number = Date.now) {
    this.clock = clock
    this.state = {
      records: Array.isArray(state?.records) ? state.records.map(normalizeRecord).filter((record): record is PiHostAttachment => Boolean(record)) : [],
    }
    this.onChange = onChange
    this.prune(this.clock())
  }

  snapshot(): PiHostAttachmentState {
    return { records: this.state.records.map((record) => ({ ...record })) }
  }

  private changed(): void {
    this.onChange?.(this.snapshot())
  }

  private prune(now: number): void {
    const terminal = this.state.records.filter((record) => record.status === 'terminal')
    const kept = terminal.filter((record) => !record.acknowledged && !(record.terminalAt && now - record.terminalAt >= PI_HOST_ATTACHMENT_TTL_MS))
    const sorted = kept.sort((a, b) => (a.terminalAt || 0) - (b.terminalAt || 0)).slice(-PI_HOST_ATTACHMENT_TERMINAL_LIMIT)
    const active = this.state.records.filter((record) => record.status === 'active')
    this.state.records = [...active, ...sorted]
  }

  begin(input: { runId: string; sessionId: string; threadId?: string; turn?: number }): PiHostAttachment {
    const existing = this.state.records.find((record) => record.runId === input.runId)
    if (existing) return { ...existing }
    const record: PiHostAttachment = {
      runId: input.runId,
      sessionId: input.sessionId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.turn === undefined ? {} : { turn: input.turn }),
      status: 'active',
      latestSeq: 0,
      total: 0,
    }
    this.state.records.push(record)
    this.changed()
    return { ...record }
  }

  append(runId: string, entries: readonly TurnRecordEntry[], latestSeq?: number): void {
    const record = this.state.records.find((candidate) => candidate.runId === runId)
    if (!record || record.status !== 'active') return
    const previousLatest = record.latestSeq
    const highest = entries.reduce((value, entry) => Math.max(value, entry.seq), 0)
    record.latestSeq = Math.max(record.latestSeq, latestSeq || 0, highest)
    const newlyObserved = entries.filter((entry) => entry.seq > previousLatest).length
    record.total = Math.max(record.total, record.total + newlyObserved, record.latestSeq)
    this.changed()
  }

  settle(runId: string, settlement: PiTurnSettlement, summary?: string, latestSeq?: number, interruptReason?: PiTurnInterruptReason): PiHostAttachment | undefined {
    const record = this.state.records.find((candidate) => candidate.runId === runId)
    if (!record) return undefined
    // Terminal state is immutable: a late provider response cannot resurrect
    // cancellation or failure.
    if (record.status === 'terminal') return { ...record }
    record.status = 'terminal'
    record.settlement = settlement
    record.terminalAt = this.clock()
    record.acknowledged = false
    record.latestSeq = Math.max(record.latestSeq, latestSeq || 0)
    record.total = Math.max(record.total, record.latestSeq)
    record.summary = boundedSummary(summary)
    if (interruptReason) record.interruptReason = interruptReason
    this.prune(record.terminalAt)
    this.changed()
    return { ...record }
  }

  acknowledge(runId: string): boolean {
    const record = this.state.records.find((candidate) => candidate.runId === runId)
    // Acknowledging an already-pruned/expired record is intentionally a
    // successful no-op. The renderer may retry after a transport reconnect;
    // ack must never turn that retry into an error or a second release.
    if (!record) return true
    if (record.status !== 'terminal') return false
    if (record.acknowledged) return true
    record.acknowledged = true
    this.prune(this.clock())
    this.changed()
    return true
  }

  get(runId: string): PiHostAttachment | undefined {
    const record = this.state.records.find((candidate) => candidate.runId === runId)
    return record ? { ...record } : undefined
  }

  active(): PiHostAttachment[] {
    this.prune(this.clock())
    return this.state.records.filter((record) => record.status === 'active').map((record) => ({ ...record }))
  }

  pendingTerminal(): PiHostAttachment[] {
    this.prune(this.clock())
    return this.state.records.filter((record) => record.status === 'terminal' && !record.acknowledged).map((record) => ({ ...record }))
  }

  /** A Host child restart has no live execution witness; active turns end honestly. */
  recoverOrphanedActive(): PiHostAttachment[] {
    const recovered: PiHostAttachment[] = []
    for (const record of this.state.records) {
      if (record.status !== 'active') continue
      record.status = 'terminal'
      record.settlement = 'interrupted'
      record.terminalAt = this.clock()
      record.acknowledged = false
      recovered.push({ ...record })
    }
    if (recovered.length) {
      this.prune(this.clock())
      this.changed()
    }
    return recovered
  }

  attach(runId: string, entries: readonly TurnRecordEntry[], before?: number, limit = PI_HOST_ATTACHMENT_PAGE_LIMIT): PiHostAttachmentPage | undefined {
    const attachment = this.get(runId)
    if (!attachment) return undefined
    const bounded = Math.min(PI_HOST_ATTACHMENT_PAGE_LIMIT, Math.max(1, Math.floor(limit || PI_HOST_ATTACHMENT_PAGE_LIMIT)))
    const ordered = [...entries].sort((a, b) => a.seq - b.seq)
    const cursor = typeof before === 'number' && Number.isFinite(before) ? before : Number.POSITIVE_INFINITY
    const page = ordered.filter((entry) => entry.seq < cursor).slice(-bounded)
    const availableFromSeq = ordered[0]?.seq || 0
    const missingBefore = availableFromSeq > 1 ? availableFromSeq - 1 : 0
    return {
      attachment,
      entries: page,
      latestSeq: Math.max(attachment.latestSeq, ordered.at(-1)?.seq || 0),
      total: Math.max(attachment.total, ordered.length),
      availableFromSeq,
      ...(missingBefore > 0 && page.length ? { gap: { missingBefore, earliestSeq: page[0].seq } } : {}),
    }
  }
}

export function emptyPiHostAttachmentState(): PiHostAttachmentState {
  return emptyState()
}
