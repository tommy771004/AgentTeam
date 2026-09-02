export type PiFollowUpAction = 'steer' | 'queue'

export type PiQueuedRun = {
  runId: string
  sessionId: string
  prompt: string
  trigger: 'interactive' | 'time' | 'proactive'
  evidence?: string
  profile: Record<string, unknown>
  status: 'queued' | 'running' | 'interrupted' | 'settled'
  /** Stable renderer submission identity; retries with the same id are idempotent. */
  clientMessageId?: string
  /** Interactive follow-up semantics. Absent on legacy/automation queue entries. */
  action?: PiFollowUpAction
  /** The active run a steer receipt was accepted into. */
  targetRunId?: string
  /** Monotonic queue mutation revision. */
  revision?: number
  /** Automatic draining is paused after the active turn was interrupted. */
  autoStartPaused?: boolean
  /** One explicitly selected paused item should be claimed before FIFO resumes. */
  manualStartRequested?: boolean
  createdAt?: number
  updatedAt?: number
}

export class PiRunQueue {
  private readonly items: PiQueuedRun[]
  private readonly max: number
  constructor(max = 24, initial: PiQueuedRun[] = []) { this.max = max; this.items = [...initial] }
  revision() { return this.items.reduce((latest, item) => Math.max(latest, item.revision || 0), 0) }
  enqueue(run: PiQueuedRun): { ok: true } | { ok: false; code: 'queue_full' | 'duplicate' } {
    if (this.items.some((item) => item.runId === run.runId)) return { ok: false, code: 'duplicate' }
    if (run.clientMessageId && this.items.some((item) => item.clientMessageId === run.clientMessageId)) return { ok: false, code: 'duplicate' }
    if (this.items.filter((item) => item.status === 'queued' || item.status === 'running').length >= this.max) return { ok: false, code: 'queue_full' }
    if (this.items.length >= this.max * 4) {
      const terminalToDrop = this.items.length - (this.max * 3)
      let dropped = 0
      for (let index = 0; index < this.items.length && dropped < terminalToDrop;) {
        if (this.items[index].status === 'settled' || this.items[index].status === 'interrupted') {
          this.items.splice(index, 1)
          dropped += 1
        } else index += 1
      }
    }
    const now = Date.now()
    this.items.push({ ...run, revision: this.revision() + 1, createdAt: run.createdAt || now, updatedAt: now })
    return { ok: true }
  }
  dequeue(canClaim: (item: PiQueuedRun) => boolean = () => true) {
    return this.items.find((item) => item.status === 'queued' && item.manualStartRequested === true && item.autoStartPaused !== true && canClaim(item))
      || this.items.find((item) => item.status === 'queued' && item.autoStartPaused !== true && canClaim(item))
  }
  claim(runId?: string, canClaim: (item: PiQueuedRun) => boolean = () => true) {
    const item = runId ? this.items.find((candidate) => candidate.runId === runId && candidate.status === 'queued' && candidate.autoStartPaused !== true && canClaim(candidate)) : this.dequeue(canClaim)
    if (item) { item.status = 'running'; item.autoStartPaused = false; item.manualStartRequested = false }
    return item
  }
  pauseSession(sessionId: string) {
    const paused = this.items.filter((item) => item.sessionId === sessionId && item.status === 'queued' && item.autoStartPaused !== true)
    if (paused.length === 0) return false
    const nextRevision = this.revision() + 1
    const now = Date.now()
    for (const item of paused) {
      item.autoStartPaused = true
      item.manualStartRequested = false
      item.revision = nextRevision
      item.updatedAt = now
    }
    return true
  }
  start(runId: string, expectedRevision: number) {
    if (expectedRevision !== this.revision()) return { ok: false as const, code: 'conflict' as const }
    const item = this.items.find((candidate) => candidate.runId === runId && candidate.status === 'queued' && candidate.autoStartPaused === true)
    if (!item) return { ok: false as const, code: 'immutable' as const }
    const nextRevision = expectedRevision + 1
    const now = Date.now()
    for (const candidate of this.items) {
      if (candidate.sessionId !== item.sessionId || candidate.status !== 'queued') continue
      candidate.autoStartPaused = false
      candidate.manualStartRequested = candidate.runId === runId
      candidate.revision = nextRevision
      candidate.updatedAt = now
    }
    return { ok: true as const, item }
  }
  markInterrupted(runId: string) {
    const item = this.items.find((candidate) => candidate.runId === runId)
    if (item) { item.status = 'interrupted'; item.revision = this.revision() + 1; item.updatedAt = Date.now() }
    return item
  }
  settle(runId: string) {
    const item = this.items.find((candidate) => candidate.runId === runId && itemStatusCanSettle(candidate.status))
    if (item) { item.status = 'settled'; item.revision = this.revision() + 1; item.updatedAt = Date.now() }
    return item
  }
  update(runId: string, prompt: string, expectedRevision: number) {
    if (expectedRevision !== this.revision()) return { ok: false as const, code: 'conflict' as const }
    const item = this.items.find((candidate) => candidate.runId === runId && candidate.status === 'queued')
    if (!item) return { ok: false as const, code: 'immutable' as const }
    item.prompt = prompt
    item.revision = expectedRevision + 1
    item.updatedAt = Date.now()
    return { ok: true as const, item }
  }
  reorder(sessionId: string, runIds: readonly string[], expectedRevision: number) {
    if (expectedRevision !== this.revision()) return { ok: false as const, code: 'conflict' as const }
    const mutable = this.items.filter((item) => item.sessionId === sessionId && item.status === 'queued')
    if (mutable.length !== runIds.length || new Set(runIds).size !== runIds.length
      || mutable.some((item) => !runIds.includes(item.runId))) {
      return { ok: false as const, code: 'invalid_order' as const }
    }
    const byId = new Map(mutable.map((item) => [item.runId, item]))
    const ordered = runIds.map((runId) => byId.get(runId)!)
    let nextIndex = 0
    const nextRevision = expectedRevision + 1
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index]
      if (item.sessionId !== sessionId || item.status !== 'queued') continue
      const replacement = ordered[nextIndex++]
      replacement.revision = nextRevision
      replacement.updatedAt = Date.now()
      this.items[index] = replacement
    }
    return { ok: true as const }
  }
  findByClientMessageId(clientMessageId: string) { return this.items.find((item) => item.clientMessageId === clientMessageId) }
  recordAcceptedSteer(run: Omit<PiQueuedRun, 'status'>) {
    const duplicate = run.clientMessageId ? this.findByClientMessageId(run.clientMessageId) : undefined
    if (duplicate) return duplicate
    const now = Date.now()
    const receipt: PiQueuedRun = {
      ...run,
      action: 'steer',
      status: 'settled',
      revision: this.revision() + 1,
      createdAt: run.createdAt || now,
      updatedAt: now,
    }
    this.items.push(receipt)
    return receipt
  }
  snapshot() { return this.items.map((item) => ({ ...item, profile: { ...item.profile } })) }
}

function itemStatusCanSettle(status: PiQueuedRun['status']): boolean {
  return status === 'queued' || status === 'running'
}
