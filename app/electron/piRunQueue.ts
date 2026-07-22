export type PiQueuedRun = { runId: string; sessionId: string; prompt: string; trigger: 'interactive' | 'time' | 'proactive'; evidence?: string; profile: Record<string, unknown>; status: 'queued' | 'interrupted' | 'settled' }

export class PiRunQueue {
  private readonly items: PiQueuedRun[]
  private readonly max: number
  constructor(max = 24, initial: PiQueuedRun[] = []) { this.max = max; this.items = [...initial] }
  enqueue(run: PiQueuedRun): { ok: true } | { ok: false; code: 'queue_full' | 'duplicate' } {
    if (this.items.some((item) => item.runId === run.runId)) return { ok: false, code: 'duplicate' }
    if (this.items.length >= this.max) return { ok: false, code: 'queue_full' }
    this.items.push({ ...run })
    return { ok: true }
  }
  dequeue() { return this.items.find((item) => item.status === 'queued') }
  markInterrupted(runId: string) { const item = this.items.find((candidate) => candidate.runId === runId); if (item) item.status = 'interrupted' }
  snapshot() { return this.items.map((item) => ({ ...item, profile: { ...item.profile } })) }
}
