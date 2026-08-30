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
}

function errorResponse(id: string | number, message: string): PiHostMessage {
  return { id, error: { code: 'invalid_request', message } }
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
}

function commitQueue(input: RunDomainInput, queue: PiRunQueue): PiQueuedRun[] {
  const next = queue.snapshot()
  input.commitQueue(next)
  return next
}

function claimRun(input: RunDomainInput): PiHostMessage[] {
  const runId = typeof input.params?.runId === 'string' ? input.params.runId : undefined
  const queue = new PiRunQueue(24, input.snapshot.queue)
  const run = queue.claim(runId)
  if (!run) return [errorResponse(input.id, runId ? 'Unknown queued Pi run' : 'No queued Pi run available')]
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
  if (!queue.snapshot().some((item) => item.runId === runId)) return [errorResponse(input.id, 'Unknown queued Pi run')]
  const run = queue.snapshot().find((item) => item.runId === runId)!
  queue.markInterrupted(runId)
  if (!input.recordLifecycle(run.sessionId, 'interrupted', runId)) return [errorResponse(input.id, 'Illegal agent lifecycle transition')]
  return [{ id: input.id, result: { queue: commitQueue(input, queue) } }]
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
