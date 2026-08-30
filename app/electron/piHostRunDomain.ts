import { PiRunQueue, type PiQueuedRun } from './piRunQueue.ts'
import type { PiTurnSettlement } from '../src/agent/piHostRun.ts'
import type { PiHostMessage } from './piHostProtocol.ts'
import { agentLifecycleFromTurnSettlement, type AgentLifecycleState } from '../src/agent/agentLifecycle.ts'

type RunDomainSnapshot = {
  queue: PiQueuedRun[]
}

type RunDomainInput = {
  method: string
  params?: Record<string, unknown>
  id: string | number
  snapshot: RunDomainSnapshot
  commitQueue: (queue: PiQueuedRun[]) => void
  isSettlement: (value: unknown) => value is PiTurnSettlement
  handleAttachment: () => PiHostMessage[] | Promise<PiHostMessage[]> | undefined
  recordLifecycle: (sessionId: string, state: AgentLifecycleState, runId?: string, reason?: string) => boolean
  onSettled?: (run: PiQueuedRun, settlement: PiTurnSettlement) => void
  canClaim?: (run: PiQueuedRun) => boolean
}

function errorResponse(id: string | number, message: string, code: 'invalid_request' | 'conflict' | 'busy' = 'invalid_request'): PiHostMessage {
  return { id, error: { code, message } }
}

/**
 * Owns every `runs/*` protocol method. Attachment/finalization remains a
 * Host-owned journal port, while queue validation and mutation live here.
 * Deleting this module removes the complete public run-management capability.
 */
export function handlePiHostRunDomain(input: RunDomainInput): PiHostMessage[] | Promise<PiHostMessage[]> | undefined {
  if (!input.method.startsWith('runs/')) return undefined

  const attachment = input.handleAttachment()
  if (attachment) return attachment
  const handler = RUN_METHODS[input.method]
  return handler ? handler(input) : [errorResponse(input.id, `Unknown run method: ${input.method}`)]
}

type RunMethodHandler = (input: RunDomainInput) => PiHostMessage[]

const RUN_METHODS: Record<string, RunMethodHandler> = {
  'runs/list': (input) => [{ id: input.id, result: { queue: input.snapshot.queue.map((item) => ({ ...item, profile: { ...item.profile } })) } }],
  'runs/claim': claimRun,
  'runs/settle': settleRun,
  'runs/enqueue': enqueueRun,
  'runs/cancel': cancelRun,
  'runs/update': updateRun,
  'runs/reorder': reorderRuns,
}

function commitQueue(input: RunDomainInput, queue: PiRunQueue): PiQueuedRun[] {
  const next = queue.snapshot()
  input.commitQueue(next)
  return next
}

function claimRun(input: RunDomainInput): PiHostMessage[] {
  const runId = typeof input.params?.runId === 'string' ? input.params.runId : undefined
  const queue = new PiRunQueue(24, input.snapshot.queue)
  const run = queue.claim(runId, input.canClaim || (() => true))
  if (!run) return [errorResponse(input.id, runId ? 'Queued Pi run is unavailable or its session is active' : 'No claimable queued Pi run available', 'busy')]
  if (!input.recordLifecycle(run.sessionId, 'running', run.runId)) return [errorResponse(input.id, 'Illegal agent lifecycle transition')]
  return [{ id: input.id, result: { run, queue: commitQueue(input, queue) } }]
}

function settleRun(input: RunDomainInput): PiHostMessage[] {
  const runId = typeof input.params?.runId === 'string' ? input.params.runId : ''
  const settlement = input.params?.settlement
  if (!runId || !input.isSettlement(settlement)) return [errorResponse(input.id, 'runId and settlement are required')]
  const queue = new PiRunQueue(24, input.snapshot.queue)
  const run = queue.settle(runId)
  if (!run) return [errorResponse(input.id, 'Unknown active Pi run')]
  if (!input.recordLifecycle(run.sessionId, agentLifecycleFromTurnSettlement(settlement), run.runId)) {
    return [errorResponse(input.id, 'Illegal agent lifecycle transition')]
  }
  input.onSettled?.(run, settlement)
  return [{ id: input.id, result: { run, queue: commitQueue(input, queue), settlement } }]
}

function enqueueRun(input: RunDomainInput): PiHostMessage[] {
  const params = input.params || {}
  if (typeof params.runId !== 'string' || typeof params.sessionId !== 'string' || typeof params.prompt !== 'string'
    || !['interactive', 'time', 'proactive'].includes(String(params.trigger))
    || !params.profile || typeof params.profile !== 'object') {
    return [errorResponse(input.id, 'runId, sessionId, prompt, trigger, and profile are required')]
  }
  const outcome = enqueuePiHostRun({
    queue: input.snapshot.queue,
    run: {
    runId: params.runId,
    sessionId: params.sessionId,
    prompt: params.prompt,
    trigger: params.trigger as PiQueuedRun['trigger'],
    evidence: typeof params.evidence === 'string' ? params.evidence : undefined,
    profile: { ...(params.profile as Record<string, unknown>) },
    status: 'queued',
    },
    recordLifecycle: input.recordLifecycle,
  })
  if (!outcome.ok) return [errorResponse(input.id, outcome.message)]
  input.commitQueue(outcome.queue)
  return [{ id: input.id, result: { queue: outcome.queue } }]
}

function cancelRun(input: RunDomainInput): PiHostMessage[] {
  const runId = typeof input.params?.runId === 'string' ? input.params.runId : ''
  if (!runId) return [errorResponse(input.id, 'runId is required')]
  const queue = new PiRunQueue(24, input.snapshot.queue)
  const existing = queue.snapshot().find((item) => item.runId === runId)
  if (existing?.status === 'interrupted' && existing.action === 'queue') {
    return [{ id: input.id, result: { queue: queue.snapshot(), followUp: existing, queueRevision: queue.revision() } }]
  }
  const expectedRevision = input.params?.expectedRevision
  if (expectedRevision !== undefined && expectedRevision !== queue.revision()) return [errorResponse(input.id, 'Pi queue revision changed', 'conflict')]
  const run = existing?.status === 'queued' ? existing : undefined
  if (!run) return [errorResponse(input.id, 'Queued follow-up is immutable or unknown')]
  const cancelled = queue.markInterrupted(runId)
  if (!input.recordLifecycle(run.sessionId, 'interrupted', runId)) return [errorResponse(input.id, 'Illegal agent lifecycle transition')]
  return [{ id: input.id, result: { queue: commitQueue(input, queue), followUp: cancelled, queueRevision: queue.revision() } }]
}

function updateRun(input: RunDomainInput): PiHostMessage[] {
  const runId = typeof input.params?.runId === 'string' ? input.params.runId : ''
  const prompt = typeof input.params?.prompt === 'string' ? input.params.prompt.trim() : ''
  const expectedRevision = input.params?.expectedRevision
  if (!runId || !prompt || !Number.isSafeInteger(expectedRevision)) return [errorResponse(input.id, 'runId, prompt, and expectedRevision are required')]
  const queue = new PiRunQueue(24, input.snapshot.queue)
  const outcome = queue.update(runId, prompt, Number(expectedRevision))
  if (!outcome.ok) return [errorResponse(input.id, outcome.code === 'conflict' ? 'Pi queue revision changed' : 'Queued follow-up is immutable', outcome.code === 'conflict' ? 'conflict' : 'invalid_request')]
  return [{ id: input.id, result: { queue: commitQueue(input, queue), followUp: outcome.item, queueRevision: queue.revision() } }]
}

function reorderRuns(input: RunDomainInput): PiHostMessage[] {
  const sessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : ''
  const runIds = Array.isArray(input.params?.runIds) ? input.params.runIds.filter((item): item is string => typeof item === 'string') : []
  const expectedRevision = input.params?.expectedRevision
  if (!sessionId || runIds.length === 0 || !Number.isSafeInteger(expectedRevision)) return [errorResponse(input.id, 'sessionId, runIds, and expectedRevision are required')]
  const queue = new PiRunQueue(24, input.snapshot.queue)
  const outcome = queue.reorder(sessionId, runIds, Number(expectedRevision))
  if (!outcome.ok) return [errorResponse(input.id, outcome.code === 'conflict' ? 'Pi queue revision changed' : 'Queue order does not match mutable session items', outcome.code === 'conflict' ? 'conflict' : 'invalid_request')]
  return [{ id: input.id, result: { queue: commitQueue(input, queue), queueRevision: queue.revision() } }]
}

/** One admission port used by public runs, follow-ups, and delegated children. */
export function enqueuePiHostRun(input: {
  queue: readonly PiQueuedRun[]
  run: PiQueuedRun
  recordLifecycle: (sessionId: string, state: AgentLifecycleState, runId?: string, reason?: string) => boolean
}): { ok: true; queue: PiQueuedRun[] } | { ok: false; message: string } {
  const queue = new PiRunQueue(24, [...input.queue])
  const outcome = queue.enqueue(input.run)
  if (!outcome.ok) return { ok: false, message: `Pi run queue ${outcome.code}` }
  if (!input.recordLifecycle(input.run.sessionId, 'queued', input.run.runId)) {
    return { ok: false, message: 'Illegal or malformed agent lifecycle transition' }
  }
  return { ok: true, queue: queue.snapshot() }
}
