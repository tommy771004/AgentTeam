import type { AgentLifecycleState } from './agentLifecycle.ts'

export const AGENT_COLLABORATION_CAPABILITY = 'agent-collaboration-v1' as const
export const AGENT_MESSAGE_MAX_BYTES = 8 * 1024
export const AGENT_RESULT_MAX_BYTES = 16 * 1024
export const AGENT_MAILBOX_MAX_MESSAGES = 128

export type AgentWorkspaceMode = 'shared-readonly' | 'shared-leased-write' | 'isolated-worktree'

export type AgentEffectivePolicy = {
  provider?: string
  model?: string
  approvalMode?: 'full' | 'auto' | 'always'
  unattended?: boolean
  sandbox?: 'none' | 'workspace-write' | 'read-only'
  outbound?: 'off' | 'demo' | 'optional' | 'required'
  capabilities: string[]
  mcpServers: string[]
}

export type AgentAdmissionSnapshot = {
  version: 1
  spawnId: string
  parentAgentId: string
  rootAgentId: string
  originTurn: number
  originRunId?: string
  objective: string
  role: string
  depth: number
  detached: boolean
  executionKind: 'builtin-agent' | 'external-cli-process'
  policy: AgentEffectivePolicy
  workspace: {
    mode: AgentWorkspaceMode
    projectRoot?: string
    scopes: string[]
    revision: number
    worktreePath?: string
    branch?: string
    baseline?: string
    verified?: boolean
  }
  createdAt: number
}

export type AgentMessageKind = 'information' | 'follow-up' | 'completion' | 'conflict' | 'adoption' | 'relay'
export type AgentDeliveryState = 'queued' | 'delivered' | 'consumed' | 'acknowledged'

export type AgentMessageEnvelope = {
  version: 1
  messageId: string
  rootAgentId: string
  senderAgentId: string
  receiverAgentId: string
  originTurn: number
  originRunId?: string
  kind: AgentMessageKind
  content: string
  createdAt: number
  deliveryState: AgentDeliveryState
  resultRef?: string
}

export type AgentTerminalResult = {
  version: 1
  resultId: string
  agentId: string
  parentAgentId: string
  rootAgentId: string
  runId: string
  originTurn: number
  settlement: Extract<AgentLifecycleState, 'completed' | 'failed' | 'cancelled' | 'interrupted'>
  summary: string
  observationOnly: true
  createdAt: number
}

export type AgentConflictEvent = {
  conflictId: string
  rootAgentId: string
  resource: string
  requesterAgentId: string
  ownerAgentId: string
  parentAgentId?: string
  revision: number
  choices: Array<'serialize' | 'narrow-scope' | 'transfer-lease' | 'release-lease' | 'isolate-worktree' | 'cancel'>
}

export type AgentCollaborationEvent =
  | { type: 'spawned'; agentId: string; runId: string; admission: AgentAdmissionSnapshot }
  | { type: 'spawn-rejected'; parentAgentId: string; spawnId: string; reason: string }
  | { type: 'mail'; message: AgentMessageEnvelope }
  | { type: 'mail-consumed' | 'mail-acked'; messageId: string; agentId: string }
  | { type: 'follow-up-started'; messageId: string; agentId: string; runId: string }
  | { type: 'wait'; agentId: string; outcome: 'message' | 'terminal' | 'steer' | 'timeout' | 'cancelled'; messageId?: string }
  | { type: 'completion'; result: AgentTerminalResult; messageId: string }
  | { type: 'interrupt-requested' | 'closed'; agentId: string; requestedBy: string; reason?: string }
  | { type: 'lease-acquired' | 'lease-released'; agentId: string; resource: string; revision: number }
  | { type: 'conflict'; conflict: AgentConflictEvent }
  | { type: 'conflict-resolved'; conflictId: string; action: AgentConflictEvent['choices'][number]; requestedBy: string; agentId: string; revision: number }
  | { type: 'adoption'; agentId: string; resultId: string; outcome: 'pending' | 'accepted' | 'stale' | 'rejected'; reason: string }

const encodedBytes = (value: string) => new TextEncoder().encode(value).byteLength
const ID_MAX = 512
const PATH_MAX = 2_048

export function boundedAgentText(value: string, maxBytes: number): string {
  const redacted = value
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]')
    .replace(/\b(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
  if (encodedBytes(redacted) <= maxBytes) return redacted
  let result = ''
  let used = 0
  for (const point of redacted) {
    const bytes = encodedBytes(point)
    if (used + bytes > maxBytes) break
    result += point
    used += bytes
  }
  return result
}

const isBoundedString = (value: unknown, max = ID_MAX): value is string => (
  typeof value === 'string' && value.length > 0 && encodedBytes(value) <= max
)
const isOptionalBoundedString = (value: unknown, max = ID_MAX) => value === undefined || isBoundedString(value, max)
const isStringList = (value: unknown, maxItems = 64) => Array.isArray(value)
  && value.length <= maxItems
  && value.every((item) => isBoundedString(item, PATH_MAX))

export function normalizeAgentPolicy(value: unknown): AgentEffectivePolicy | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const policy = value as Record<string, unknown>
  if (!isOptionalBoundedString(policy.provider) || !isOptionalBoundedString(policy.model)) return undefined
  if (policy.approvalMode !== undefined && !['full', 'auto', 'always'].includes(String(policy.approvalMode))) return undefined
  if (policy.sandbox !== undefined && !['none', 'workspace-write', 'read-only'].includes(String(policy.sandbox))) return undefined
  if (policy.outbound !== undefined && !['off', 'demo', 'optional', 'required'].includes(String(policy.outbound))) return undefined
  if (policy.unattended !== undefined && typeof policy.unattended !== 'boolean') return undefined
  if (!isStringList(policy.capabilities || []) || !isStringList(policy.mcpServers || [])) return undefined
  return {
    ...(policy.provider ? { provider: String(policy.provider) } : {}),
    ...(policy.model ? { model: String(policy.model) } : {}),
    ...(policy.approvalMode ? { approvalMode: policy.approvalMode as AgentEffectivePolicy['approvalMode'] } : {}),
    ...(typeof policy.unattended === 'boolean' ? { unattended: policy.unattended } : {}),
    ...(policy.sandbox ? { sandbox: policy.sandbox as AgentEffectivePolicy['sandbox'] } : {}),
    ...(policy.outbound ? { outbound: policy.outbound as AgentEffectivePolicy['outbound'] } : {}),
    capabilities: [...(policy.capabilities as string[] || [])],
    mcpServers: [...(policy.mcpServers as string[] || [])],
  }
}

const APPROVAL_RANK = { full: 0, auto: 1, always: 2 } as const
const SANDBOX_RANK = { none: 0, 'workspace-write': 1, 'read-only': 2 } as const
const OUTBOUND_RANK = { off: 0, demo: 1, optional: 2, required: 3 } as const
const subset = (child: readonly string[], parent: readonly string[]) => child.every((item) => parent.includes(item))

/** Child policy may stay equal or become stricter; it can never widen parent authority. */
export function isRestrictiveAgentPolicy(parent: AgentEffectivePolicy, child: AgentEffectivePolicy): boolean {
  if (parent.provider && child.provider !== parent.provider) return false
  if (parent.model && child.model !== parent.model) return false
  if (APPROVAL_RANK[child.approvalMode || 'auto'] < APPROVAL_RANK[parent.approvalMode || 'auto']) return false
  if (SANDBOX_RANK[child.sandbox || 'workspace-write'] < SANDBOX_RANK[parent.sandbox || 'workspace-write']) return false
  if (OUTBOUND_RANK[child.outbound || 'off'] < OUTBOUND_RANK[parent.outbound || 'off']) return false
  if (child.unattended === true && parent.unattended !== true) return false
  return subset(child.capabilities, parent.capabilities) && subset(child.mcpServers, parent.mcpServers)
}

function isAgentAdmissionSnapshot(value: unknown): value is AgentAdmissionSnapshot {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  const workspace = item.workspace as Record<string, unknown> | undefined
  return item.version === 1
    && isBoundedString(item.spawnId)
    && isBoundedString(item.parentAgentId)
    && isBoundedString(item.rootAgentId)
    && Number.isSafeInteger(item.originTurn) && Number(item.originTurn) >= 1
    && isOptionalBoundedString(item.originRunId)
    && isBoundedString(item.objective, AGENT_MESSAGE_MAX_BYTES)
    && isBoundedString(item.role)
    && Number.isSafeInteger(item.depth) && Number(item.depth) >= 1 && Number(item.depth) <= 8
    && typeof item.detached === 'boolean'
    && ['builtin-agent', 'external-cli-process'].includes(String(item.executionKind))
    && Boolean(normalizeAgentPolicy(item.policy))
    && Boolean(workspace) && ['shared-readonly', 'shared-leased-write', 'isolated-worktree'].includes(String(workspace?.mode))
    && isStringList(workspace?.scopes || [])
    && Number.isSafeInteger(workspace?.revision) && Number(workspace?.revision) >= 0
    && Number.isSafeInteger(item.createdAt) && Number(item.createdAt) > 0
}

export function isAgentMessageEnvelope(value: unknown): value is AgentMessageEnvelope {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return item.version === 1
    && isBoundedString(item.messageId)
    && isBoundedString(item.rootAgentId)
    && isBoundedString(item.senderAgentId)
    && isBoundedString(item.receiverAgentId)
    && Number.isSafeInteger(item.originTurn) && Number(item.originTurn) >= 1
    && isOptionalBoundedString(item.originRunId)
    && ['information', 'follow-up', 'completion', 'conflict', 'adoption', 'relay'].includes(String(item.kind))
    && isBoundedString(item.content, AGENT_RESULT_MAX_BYTES)
    && Number.isSafeInteger(item.createdAt) && Number(item.createdAt) > 0
    && ['queued', 'delivered', 'consumed', 'acknowledged'].includes(String(item.deliveryState))
    && isOptionalBoundedString(item.resultRef)
}

function isAgentTerminalResult(value: unknown): value is AgentTerminalResult {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return item.version === 1
    && [item.resultId, item.agentId, item.parentAgentId, item.rootAgentId, item.runId].every((field) => isBoundedString(field))
    && Number.isSafeInteger(item.originTurn) && Number(item.originTurn) >= 1
    && ['completed', 'failed', 'cancelled', 'interrupted'].includes(String(item.settlement))
    && isBoundedString(item.summary, AGENT_RESULT_MAX_BYTES)
    && item.observationOnly === true
    && Number.isSafeInteger(item.createdAt) && Number(item.createdAt) > 0
}

function isSimpleAgentEvent(event: Record<string, unknown>): boolean | undefined {
  if (event.type === 'spawned') return isBoundedString(event.agentId) && isBoundedString(event.runId) && isAgentAdmissionSnapshot(event.admission)
  if (event.type === 'spawn-rejected') return isBoundedString(event.parentAgentId) && isBoundedString(event.spawnId) && isBoundedString(event.reason, 2_048)
  if (event.type === 'mail') return isAgentMessageEnvelope(event.message)
  if (event.type === 'mail-consumed' || event.type === 'mail-acked') return isBoundedString(event.messageId) && isBoundedString(event.agentId)
  if (event.type === 'follow-up-started') return isBoundedString(event.messageId) && isBoundedString(event.agentId) && isBoundedString(event.runId)
  if (event.type === 'completion') return isAgentTerminalResult(event.result) && isBoundedString(event.messageId)
  return undefined
}

export function isAgentCollaborationEvent(value: unknown): value is AgentCollaborationEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  const simple = isSimpleAgentEvent(event)
  if (simple !== undefined) return simple
  if (event.type === 'wait') return isBoundedString(event.agentId) && ['message', 'terminal', 'steer', 'timeout', 'cancelled'].includes(String(event.outcome)) && isOptionalBoundedString(event.messageId)
  if (event.type === 'interrupt-requested' || event.type === 'closed') return isBoundedString(event.agentId) && isBoundedString(event.requestedBy) && isOptionalBoundedString(event.reason, 2_048)
  if (event.type === 'lease-acquired' || event.type === 'lease-released') return isBoundedString(event.agentId) && isBoundedString(event.resource, PATH_MAX) && Number.isSafeInteger(event.revision)
  if (event.type === 'adoption') return isBoundedString(event.agentId) && isBoundedString(event.resultId) && ['pending', 'accepted', 'stale', 'rejected'].includes(String(event.outcome)) && isBoundedString(event.reason, 2_048)
  if (event.type === 'conflict-resolved') return isBoundedString(event.conflictId)
    && ['serialize', 'narrow-scope', 'transfer-lease', 'release-lease', 'isolate-worktree', 'cancel'].includes(String(event.action))
    && isBoundedString(event.requestedBy) && isBoundedString(event.agentId) && Number.isSafeInteger(event.revision)
  return event.type === 'conflict' && isAgentConflictEvent(event.conflict)
}

function isAgentConflictEvent(value: unknown): value is AgentConflictEvent {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return [item.conflictId, item.rootAgentId, item.resource, item.requesterAgentId, item.ownerAgentId].every((field) => isBoundedString(field, PATH_MAX))
    && isOptionalBoundedString(item.parentAgentId)
    && Number.isSafeInteger(item.revision)
    && Array.isArray(item.choices) && item.choices.length > 0 && item.choices.length <= 6
    && item.choices.every((choice) => ['serialize', 'narrow-scope', 'transfer-lease', 'release-lease', 'isolate-worktree', 'cancel'].includes(String(choice)))
}
