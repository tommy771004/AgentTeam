import { isAgentLifecycleState, type AgentLifecycleState } from './agentLifecycle.ts'
import type { AgentTreeNode, AgentTreeSnapshot } from './agentTree.ts'

export type AgentTreeRow = {
  key: string
  parentKey?: string
  label: string
  detail: string
  taskPath: string
  depth: number
  lifecycle: AgentLifecycleState
  archived: boolean
  legacy: boolean
}

function isAgentTreeNode(value: unknown): value is AgentTreeNode {
  if (!value || typeof value !== 'object') return false
  const node = value as Record<string, unknown>
  return typeof node.agentId === 'string'
    && typeof node.rootAgentId === 'string'
    && (node.parentAgentId === undefined || typeof node.parentAgentId === 'string')
    && typeof node.taskPath === 'string' && node.taskPath.startsWith('/')
    && typeof node.title === 'string'
    && (node.role === undefined || typeof node.role === 'string')
    && Number.isSafeInteger(node.depth) && Number(node.depth) >= 0
    && isAgentLifecycleState(node.lifecycle)
    && typeof node.archived === 'boolean'
    && typeof node.legacy === 'boolean'
}

function asAgentTreeSnapshot(value: unknown): AgentTreeSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined
  const snapshot = value as Record<string, unknown>
  if (typeof snapshot.rootAgentId !== 'string' || !Array.isArray(snapshot.agents) || !snapshot.agents.every(isAgentTreeNode)) return undefined
  if (!snapshot.agents.some((agent) => agent.agentId === snapshot.rootAgentId)) return undefined
  if (snapshot.agents.some((agent) => agent.rootAgentId !== snapshot.rootAgentId)) return undefined
  return snapshot as AgentTreeSnapshot
}

/** Disposable renderer projection; malformed or legacy IPC payloads fail closed. */
export function projectAgentTreeSnapshot(value: unknown): AgentTreeRow[] {
  const snapshot = asAgentTreeSnapshot(value)
  if (!snapshot) return []
  return snapshot.agents.map((agent) => ({
    key: agent.agentId,
    ...(agent.parentAgentId ? { parentKey: agent.parentAgentId } : {}),
    label: agent.title,
    detail: agent.role || (agent.depth === 0 ? 'Root agent' : 'Agent'),
    taskPath: agent.taskPath,
    depth: agent.depth,
    lifecycle: agent.lifecycle,
    archived: agent.archived,
    legacy: agent.legacy,
  }))
}

export function hasAgentTreeApi(value: unknown): value is { list: (scope: { rootAgentId?: string; agentId?: string }) => Promise<unknown> } {
  return Boolean(value && typeof value === 'object' && typeof (value as { list?: unknown }).list === 'function')
}

export function hasAgentTreeCapability(capabilities: unknown): boolean {
  return Array.isArray(capabilities) && capabilities.includes('agent-tree-v1')
}
