import { PiRunQueue, type PiQueuedRun } from './piRunQueue.ts'
import type { PiTurnSettlement } from '../src/agent/piHostRun.ts'
import type { PiHostMessage } from './piHostProtocol.ts'

type RunDomainSnapshot = {
  queue: PiQueuedRun[]
}

function errorResponse(id: string | number, message: string): PiHostMessage {
  return { id, error: { code: 'invalid_request', message } }
}

/**
 * Owns every `runs/*` protocol method. Attachment/finalization remains a
 * Host-owned journal port, while queue validation and mutation live here.
 * Deleting this module removes the complete public run-management capability.
 */
export function handlePiHostRunDomain(input: {
  method: string
  params?: Record<string, unknown>
  id: string | number
  snapshot: RunDomainSnapshot
  commitQueue: (queue: PiQueuedRun[]) => void
  isSettlement: (value: unknown) => value is PiTurnSettlement
  handleAttachment: () => PiHostMessage[] | Promise<PiHostMessage[]> | undefined
}): PiHostMessage[] | Promise<PiHostMessage[]> | undefined {
  if (!input.method.startsWith('runs/')) return undefined

  const attachment = input.handleAttachment()
  if (attachment) return attachment

  if (input.method === 'runs/list') {
    return [{ id: input.id, result: { queue: input.snapshot.queue.map((item) => ({ ...item, profile: { ...item.profile } })) } }]
  }

  const queue = new PiRunQueue(24, input.snapshot.queue)
  if (input.method === 'runs/claim') {
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : undefined
    const run = queue.claim(runId)
    if (!run) return [errorResponse(input.id, runId ? 'Unknown queued Pi run' : 'No queued Pi run available')]
    const next = queue.snapshot()
    input.commitQueue(next)
    return [{ id: input.id, result: { run, queue: next } }]
  }
  if (input.method === 'runs/settle') {
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : ''
    const settlement = input.params?.settlement
    if (!runId || !input.isSettlement(settlement)) return [errorResponse(input.id, 'runId and settlement are required')]
    const run = queue.settle(runId)
    if (!run) return [errorResponse(input.id, 'Unknown active Pi run')]
    const next = queue.snapshot()
    input.commitQueue(next)
    return [{ id: input.id, result: { run, queue: next, settlement } }]
  }
  if (input.method === 'runs/enqueue') {
    const params = input.params || {}
    if (typeof params.runId !== 'string' || typeof params.sessionId !== 'string' || typeof params.prompt !== 'string'
      || !['interactive', 'time', 'proactive'].includes(String(params.trigger))
      || !params.profile || typeof params.profile !== 'object') {
      return [errorResponse(input.id, 'runId, sessionId, prompt, trigger, and profile are required')]
    }
    const outcome = queue.enqueue({
      runId: params.runId,
      sessionId: params.sessionId,
      prompt: params.prompt,
      trigger: params.trigger as PiQueuedRun['trigger'],
      evidence: typeof params.evidence === 'string' ? params.evidence : undefined,
      profile: { ...(params.profile as Record<string, unknown>) },
      status: 'queued',
    })
    if (!outcome.ok) return [errorResponse(input.id, `Pi run queue ${outcome.code}`)]
    const next = queue.snapshot()
    input.commitQueue(next)
    return [{ id: input.id, result: { queue: next } }]
  }
  if (input.method === 'runs/cancel') {
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : ''
    if (!runId) return [errorResponse(input.id, 'runId is required')]
    if (!queue.snapshot().some((item) => item.runId === runId)) return [errorResponse(input.id, 'Unknown queued Pi run')]
    queue.markInterrupted(runId)
    const next = queue.snapshot()
    input.commitQueue(next)
    return [{ id: input.id, result: { queue: next } }]
  }
  return [errorResponse(input.id, `Unknown run method: ${input.method}`)]
}
