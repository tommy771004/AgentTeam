export type PiQueuedRun = { runId: string; sessionId: string; prompt: string; trigger: 'interactive' | 'time' | 'proactive'; evidence?: string; profile: Record<string, unknown>; status: 'queued' | 'running' | 'interrupted' | 'settled' }

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
  claim(runId?: string) {
    const item = runId ? this.items.find((candidate) => candidate.runId === runId && candidate.status === 'queued') : this.dequeue()
    if (item) item.status = 'running'
    return item
  }
  markInterrupted(runId: string) { const item = this.items.find((candidate) => candidate.runId === runId); if (item) item.status = 'interrupted' }
  settle(runId: string) { const item = this.items.find((candidate) => candidate.runId === runId && itemStatusCanSettle(candidate.status)); if (item) item.status = 'settled'; return item }
  snapshot() { return this.items.map((item) => ({ ...item, profile: { ...item.profile } })) }
}

function itemStatusCanSettle(status: PiQueuedRun['status']): boolean {
  return status === 'queued' || status === 'running'
}
