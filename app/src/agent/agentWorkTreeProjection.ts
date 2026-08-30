import type { AgentLifecycleState } from './agentLifecycle.ts'
import type { AgentAdmissionSnapshot, AgentCollaborationEvent } from './agentCollaboration.ts'
import type { TurnRecordEntry } from './turnRecord.ts'

export type AgentWorkActivity = {
  id: string
  seq: number
  label: string
  detail?: string
  tone: 'neutral' | 'active' | 'attention' | 'success' | 'failure'
  messageId?: string
  conflictId?: string
}

export type AgentWorkRow = {
  agentId: string
  parentAgentId?: string
  title: string
  role: string
  executionKind: AgentAdmissionSnapshot['executionKind']
  lifecycle: AgentLifecycleState
  originTurn: number
  workspace?: AgentAdmissionSnapshot['workspace']
  activities: AgentWorkActivity[]
}

function eventTurn(entry: Extract<TurnRecordEntry, { kind: 'agent-collaboration' }>): number {
  const event = entry.event
  if (event.type === 'spawned') return event.admission.originTurn
  if (event.type === 'mail') return event.message.originTurn
  if (event.type === 'completion') return event.result.originTurn
  return entry.turn
}

function activity(entry: Extract<TurnRecordEntry, { kind: 'agent-collaboration' }>): AgentWorkActivity | undefined {
  const event = entry.event
  const base = { id: `agent-work-${entry.seq}`, seq: entry.seq }
  if (event.type === 'mail') return {
    ...base,
    label: event.message.kind === 'completion' ? '回傳結果' : event.message.kind === 'follow-up' ? '收到後續任務' : '收到訊息',
    detail: event.message.content,
    tone: event.message.kind === 'completion' ? 'success' : 'neutral',
    messageId: event.message.messageId,
  }
  if (event.type === 'completion') return { ...base, label: `執行 ${event.result.settlement}`, detail: event.result.summary, tone: event.result.settlement === 'completed' ? 'success' : 'failure' }
  if (event.type === 'conflict') return { ...base, label: '寫入範圍衝突', detail: `${event.conflict.resource} · owner ${event.conflict.ownerAgentId}`, tone: 'attention', conflictId: event.conflict.conflictId }
  if (event.type === 'conflict-resolved') return { ...base, label: `衝突處理：${event.action}`, detail: `revision ${event.revision}`, tone: event.action === 'cancel' ? 'failure' : 'success' }
  if (event.type === 'adoption') return { ...base, label: `Checker ${event.outcome}`, detail: event.reason, tone: event.outcome === 'accepted' ? 'success' : event.outcome === 'pending' ? 'attention' : 'failure' }
  if (event.type === 'lease-acquired') return { ...base, label: '取得寫入 lease', detail: event.resource, tone: 'active' }
  if (event.type === 'lease-released') return { ...base, label: '釋放寫入 lease', detail: event.resource, tone: 'neutral' }
  if (event.type === 'follow-up-started') return { ...base, label: '開始後續任務', detail: event.runId, tone: 'active', messageId: event.messageId }
  if (event.type === 'interrupt-requested') return { ...base, label: '要求安全中止', detail: event.reason, tone: 'attention' }
  if (event.type === 'closed') return { ...base, label: '已關閉', detail: event.reason, tone: 'neutral' }
  if (event.type === 'spawn-rejected') return { ...base, label: '建立子智慧體失敗', detail: event.reason, tone: 'failure' }
  if (event.type === 'wait') return { ...base, label: `等待結束：${event.outcome}`, tone: event.outcome === 'timeout' ? 'attention' : 'neutral' }
  return undefined
}

function agentIdFor(event: AgentCollaborationEvent): string | undefined {
  if (event.type === 'spawned') return event.agentId
  if (event.type === 'mail') return event.message.kind === 'completion' ? event.message.senderAgentId : event.message.receiverAgentId
  if (event.type === 'completion') return event.result.agentId
  if (event.type === 'conflict') return event.conflict.requesterAgentId
  if ('agentId' in event) return event.agentId
  return undefined
}

function lifecycleFromCompletion(event: AgentCollaborationEvent): AgentLifecycleState | undefined {
  if (event.type !== 'completion') return undefined
  return event.result.settlement
}

/** Pure per-Chat-turn projection. Late events use their immutable originTurn. */
export function projectAgentWorkTree(entries: readonly TurnRecordEntry[], originTurn: number): AgentWorkRow[] {
  const rows = new Map<string, AgentWorkRow>()
  for (const entry of [...entries].sort((left, right) => left.seq - right.seq)) {
    if (entry.kind === 'agent-lifecycle') {
      if (entry.turn !== originTurn) continue
      const current = rows.get(entry.event.agentId)
      rows.set(entry.event.agentId, {
        agentId: entry.event.agentId,
        ...(entry.event.parentAgentId ? { parentAgentId: entry.event.parentAgentId } : {}),
        title: current?.title || entry.event.taskPath.split('/').at(-1) || 'Agent task',
        role: current?.role || 'Agent',
        executionKind: current?.executionKind || 'builtin-agent',
        lifecycle: entry.event.state,
        originTurn,
        workspace: current?.workspace,
        activities: current?.activities || [],
      })
      continue
    }
    if (entry.kind !== 'agent-collaboration' || eventTurn(entry) !== originTurn) continue
    const agentId = agentIdFor(entry.event)
    if (!agentId) continue
    const current = rows.get(agentId)
    const spawned = entry.event.type === 'spawned' ? entry.event : undefined
    const item = activity(entry)
    rows.set(agentId, {
      agentId,
      ...(spawned ? { parentAgentId: spawned.admission.parentAgentId } : current?.parentAgentId ? { parentAgentId: current.parentAgentId } : {}),
      title: spawned?.admission.objective || current?.title || 'Agent task',
      role: spawned?.admission.role || current?.role || 'Agent',
      executionKind: spawned?.admission.executionKind || current?.executionKind || 'builtin-agent',
      lifecycle: lifecycleFromCompletion(entry.event) || current?.lifecycle || (spawned ? 'queued' : 'admitted'),
      originTurn,
      workspace: spawned?.admission.workspace || current?.workspace,
      activities: item ? [...(current?.activities || []), item] : current?.activities || [],
    })
  }
  return [...rows.values()]
}

export function latestConversationTurn(entries: readonly TurnRecordEntry[]): number {
  return entries.reduce((highest, entry) => entry.kind === 'agent-lifecycle' || entry.kind === 'agent-collaboration'
    ? highest
    : Math.max(highest, entry.turn), 0)
}
