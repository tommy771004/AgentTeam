/**
 * Evidence background upload + device lifecycle (ticket 12).
 */

import type { EvidenceRecord } from './evidenceLedger.ts'

export type UploadAck = {
  highestContiguousSequence: number
  eventIds: string[]
}

export type QueuedEvidence = {
  record: EvidenceRecord
  attempts: number
  lastError?: string
}

export class EvidenceUploadQueue {
  private q: QueuedEvidence[] = []
  private ackedSeq = 0
  private ackedIds = new Set<string>()

  enqueue(record: EvidenceRecord): void {
    if (this.ackedIds.has(record.eventId)) return
    if (this.q.some((x) => x.record.eventId === record.eventId)) return
    this.q.push({ record, attempts: 0 })
    this.q.sort((a, b) => a.record.sequence - b.record.sequence)
  }

  pending(): QueuedEvidence[] {
    return [...this.q]
  }

  /** Local-first: records stay until ack; failures do not drop. */
  async flush(upload: (batch: EvidenceRecord[]) => Promise<UploadAck | { error: string }>): Promise<{
    uploaded: number
    remaining: number
    error?: string
  }> {
    if (!this.q.length) return { uploaded: 0, remaining: 0 }
    const batch = this.q.slice(0, 20).map((x) => x.record)
    const res = await upload(batch)
    if ('error' in res) {
      for (const item of this.q.slice(0, batch.length)) {
        item.attempts++
        item.lastError = res.error
      }
      return { uploaded: 0, remaining: this.q.length, error: res.error }
    }
    this.ackedSeq = Math.max(this.ackedSeq, res.highestContiguousSequence)
    for (const id of res.eventIds) this.ackedIds.add(id)
    this.q = this.q.filter(
      (x) =>
        !this.ackedIds.has(x.record.eventId) &&
        x.record.sequence > this.ackedSeq,
    )
    return { uploaded: batch.length, remaining: this.q.length }
  }

  /**
   * Retention: never delete unacked. retentionWeeks=0 means forever.
   */
  retainableForDeletion(opts: {
    records: EvidenceRecord[]
    retentionWeeks: number
    nowMs?: number
  }): EvidenceRecord[] {
    if (opts.retentionWeeks === 0) return []
    const now = opts.nowMs ?? Date.now()
    const maxAge = opts.retentionWeeks * 7 * 24 * 3_600_000
    return opts.records.filter((r) => {
      if (!this.ackedIds.has(r.eventId) && this.q.some((q) => q.record.eventId === r.eventId)) {
        return false
      }
      if (!this.ackedIds.has(r.eventId)) return false
      const t = Date.parse(r.timestampUtc)
      return Number.isFinite(t) && now - t > maxAge
    })
  }
}

export type DeviceLifecycleEvent =
  | {
      type: 'device-retired'
      deviceId: string
      atUtc: string
      reason: string
    }
  | {
      type: 'device-replaced'
      oldDeviceId: string
      newDeviceId: string
      atUtc: string
      /** Explicit gap when pending evidence cannot be recovered */
      unrecoverablePendingGap: boolean
    }

export function retireDevice(deviceId: string, reason: string): DeviceLifecycleEvent {
  return {
    type: 'device-retired',
    deviceId,
    atUtc: new Date().toISOString(),
    reason: reason.slice(0, 200),
  }
}

export function replaceDevice(opts: {
  oldDeviceId: string
  newDeviceId: string
  hadUnrecoverablePending: boolean
}): DeviceLifecycleEvent {
  return {
    type: 'device-replaced',
    oldDeviceId: opts.oldDeviceId,
    newDeviceId: opts.newDeviceId,
    atUtc: new Date().toISOString(),
    unrecoverablePendingGap: opts.hadUnrecoverablePending,
  }
}
