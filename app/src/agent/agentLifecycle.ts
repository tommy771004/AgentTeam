/** Host-owned lifecycle vocabulary shared by protocol, Turn Record, and UI projections. */
import type { PiTurnSettlement } from './piHostRun.ts'

export const AGENT_LIFECYCLE_STATES = [
  'queued',
  'admitted',
  'running',
  'waiting-approval',
  'blocked',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
  'unknown',
] as const

export type AgentLifecycleState = (typeof AGENT_LIFECYCLE_STATES)[number]

export type AgentLifecycleEvent = {
  agentId: string
  rootAgentId: string
  parentAgentId?: string
  taskPath: string
  state: AgentLifecycleState
  runId?: string
  reason?: string
}

const MAX_ID_BYTES = 512
const MAX_PATH_BYTES = 2_048
const MAX_REASON_BYTES = 2_048
const encodedBytes = (value: string) => new TextEncoder().encode(value).byteLength

function truncateUtf8(value: string, limit: number): string {
  if (encodedBytes(value) <= limit) return value
  let result = ''
  let bytes = 0
  for (const point of value) {
    const pointBytes = encodedBytes(point)
    if (bytes + pointBytes > limit) break
    result += point
    bytes += pointBytes
  }
  return result
}

export function isAgentLifecycleState(value: unknown): value is AgentLifecycleState {
  return typeof value === 'string' && (AGENT_LIFECYCLE_STATES as readonly string[]).includes(value)
}

const AGENT_LIFECYCLE_EVENT_KEYS = new Set(['agentId', 'rootAgentId', 'parentAgentId', 'taskPath', 'state', 'runId', 'reason'])
const isRequiredBoundedText = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && encodedBytes(value) <= max
const isOptionalBoundedText = (value: unknown, max: number) => value === undefined || isRequiredBoundedText(value, max)

export function isAgentLifecycleEvent(value: unknown): value is AgentLifecycleEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  if (Object.keys(event).some((key) => !AGENT_LIFECYCLE_EVENT_KEYS.has(key))) return false
  if (!isRequiredBoundedText(event.agentId, MAX_ID_BYTES)) return false
  if (!isRequiredBoundedText(event.rootAgentId, MAX_ID_BYTES)) return false
  if (!isOptionalBoundedText(event.parentAgentId, MAX_ID_BYTES)) return false
  if (!isRequiredBoundedText(event.taskPath, MAX_PATH_BYTES) || !(event.taskPath as string).startsWith('/')) return false
  if (!isAgentLifecycleState(event.state)) return false
  if (!isOptionalBoundedText(event.runId, MAX_ID_BYTES)) return false
  return event.reason === undefined || (typeof event.reason === 'string' && encodedBytes(event.reason) <= MAX_REASON_BYTES)
}

export function isTerminalAgentLifecycle(state: AgentLifecycleState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'interrupted'
}

/** One exhaustive mapping shared by queue settlement and tree replay. */
export function agentLifecycleFromTurnSettlement(settlement: PiTurnSettlement): AgentLifecycleState {
  switch (settlement) {
    case 'answered': return 'completed'
    case 'empty':
    case 'truncated':
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    case 'interrupted': return 'interrupted'
  }
}

/** Host writers use the same byte-bounded constructor as replay validation. */
export function createAgentLifecycleEvent(input: AgentLifecycleEvent): AgentLifecycleEvent | undefined {
  const reason = input.reason?.trim() ? truncateUtf8(input.reason, MAX_REASON_BYTES) : undefined
  const event: AgentLifecycleEvent = {
    agentId: input.agentId,
    rootAgentId: input.rootAgentId,
    ...(input.parentAgentId ? { parentAgentId: input.parentAgentId } : {}),
    taskPath: input.taskPath,
    state: input.state,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(reason ? { reason } : {}),
  }
  return isAgentLifecycleEvent(event) ? event : undefined
}

const SAME_RUN_TRANSITIONS: Record<AgentLifecycleState, ReadonlySet<AgentLifecycleState>> = {
  admitted: new Set(['queued', 'running', 'blocked', 'cancelled', 'interrupted', 'failed']),
  queued: new Set(['running', 'cancelled', 'interrupted', 'failed']),
  running: new Set(['waiting-approval', 'blocked', 'completed', 'failed', 'cancelled', 'interrupted']),
  'waiting-approval': new Set(['running', 'blocked', 'failed', 'cancelled', 'interrupted']),
  blocked: new Set(['queued', 'running', 'failed', 'cancelled', 'interrupted']),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  interrupted: new Set(),
  unknown: new Set(),
}

/** Rejects lifecycle regression while allowing an explicitly identified next run to queue. */
export function isLegalAgentLifecycleTransition(previous: AgentLifecycleEvent | undefined, next: AgentLifecycleEvent): boolean {
  if (next.state === 'unknown') return false
  if (!previous) return next.state === 'admitted'
    || next.state === 'queued'
    || next.state === 'running'
  if (previous.state === next.state && previous.runId === next.runId) return false
  if (next.runId && previous.runId && next.runId !== previous.runId) {
    return next.state === 'queued' || (next.state === 'running' && isTerminalAgentLifecycle(previous.state))
  }
  if (next.runId && !previous.runId && previous.state === 'admitted') {
    return next.state === 'queued' || next.state === 'running'
  }
  return SAME_RUN_TRANSITIONS[previous.state].has(next.state)
}
