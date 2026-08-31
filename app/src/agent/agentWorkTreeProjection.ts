import type { AgentLifecycleState } from './agentLifecycle.ts'
import type { AgentAdmissionSnapshot, AgentCollaborationEvent } from './agentCollaboration.ts'
import type { TurnRecordEntry } from './turnRecord.ts'
import type { ReviewSnapshotRef } from './reviewContract.ts'

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
  reviewSnapshotRef?: ReviewSnapshotRef
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
  switch (event.type) {
    case 'mail': return mailActivity(base, event)
    case 'completion': return { ...base, label: `執行 ${event.result.settlement}`, detail: event.result.summary, tone: event.result.settlement === 'completed' ? 'success' : 'failure' }
    case 'conflict': return { ...base, label: '寫入範圍衝突', detail: `${event.conflict.resource} · owner ${event.conflict.ownerAgentId}`, tone: 'attention', conflictId: event.conflict.conflictId }
    case 'conflict-resolved': return { ...base, label: `衝突處理：${event.action}`, detail: `revision ${event.revision}`, tone: event.action === 'cancel' ? 'failure' : 'success' }
    case 'adoption': return adoptionActivity(base, event)
    case 'lease-acquired': return { ...base, label: '取得寫入 lease', detail: event.resource, tone: 'active' }
    case 'lease-released': return { ...base, label: '釋放寫入 lease', detail: event.resource, tone: 'neutral' }
    case 'follow-up-started': return { ...base, label: '開始後續任務', detail: event.runId, tone: 'active', messageId: event.messageId }
    case 'interrupt-requested': return { ...base, label: '要求安全中止', detail: event.reason, tone: 'attention' }
    case 'closed': return { ...base, label: '已關閉', detail: event.reason, tone: 'neutral' }
    case 'spawn-rejected': return { ...base, label: '建立子智慧體失敗', detail: event.reason, tone: 'failure' }
    case 'wait': return { ...base, label: `等待結束：${event.outcome}`, tone: event.outcome === 'timeout' ? 'attention' : 'neutral' }
    default: return undefined
  }
}

type ActivityBase = Pick<AgentWorkActivity, 'id' | 'seq'>

function mailActivity(base: ActivityBase, event: Extract<AgentCollaborationEvent, { type: 'mail' }>): AgentWorkActivity {
  const completion = event.message.kind === 'completion'
  const label = completion ? '回傳結果' : event.message.kind === 'follow-up' ? '收到後續任務' : '收到訊息'
  return { ...base, label, detail: event.message.content, tone: completion ? 'success' : 'neutral', messageId: event.message.messageId }
}

function adoptionActivity(base: ActivityBase, event: Extract<AgentCollaborationEvent, { type: 'adoption' }>): AgentWorkActivity {
  const tone = event.outcome === 'accepted' ? 'success' : event.outcome === 'pending' ? 'attention' : 'failure'
  return { ...base, label: `Checker ${event.outcome}`, detail: event.reason, tone }
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
      applyLifecycleEntry(rows, entry, originTurn)
      continue
    }
    if (entry.kind === 'agent-collaboration') applyCollaborationEntry(rows, entry, originTurn)
  }
  return [...rows.values()]
}

function applyLifecycleEntry(rows: Map<string, AgentWorkRow>, entry: Extract<TurnRecordEntry, { kind: 'agent-lifecycle' }>, originTurn: number): void {
  if (entry.turn !== originTurn) return
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
    reviewSnapshotRef: current?.reviewSnapshotRef,
    activities: current?.activities || [],
  })
}

function applyCollaborationEntry(rows: Map<string, AgentWorkRow>, entry: Extract<TurnRecordEntry, { kind: 'agent-collaboration' }>, originTurn: number): void {
  if (eventTurn(entry) !== originTurn) return
  const agentId = agentIdFor(entry.event)
  if (!agentId) return
  const current = rows.get(agentId)
  const spawned = entry.event.type === 'spawned' ? entry.event : undefined
  const item = activity(entry)
  rows.set(agentId, spawned
    ? rowFromSpawn(agentId, spawned, current, item, originTurn)
    : rowFromCollaboration(agentId, entry.event, current, item, originTurn))
}

function appendActivity(current: AgentWorkRow | undefined, item: AgentWorkActivity | undefined): AgentWorkActivity[] {
  const activities = current?.activities || []
  return item ? [...activities, item] : activities
}

function rowFromSpawn(agentId: string, spawned: Extract<AgentCollaborationEvent, { type: 'spawned' }>, current: AgentWorkRow | undefined, item: AgentWorkActivity | undefined, originTurn: number): AgentWorkRow {
  return {
    agentId,
    parentAgentId: spawned.admission.parentAgentId,
    title: spawned.admission.objective,
    role: spawned.admission.role,
    executionKind: spawned.admission.executionKind,
    lifecycle: current?.lifecycle || 'queued',
    originTurn,
    workspace: spawned.admission.workspace,
    reviewSnapshotRef: current?.reviewSnapshotRef,
    activities: appendActivity(current, item),
  }
}

function rowFromCollaboration(agentId: string, event: AgentCollaborationEvent, current: AgentWorkRow | undefined, item: AgentWorkActivity | undefined, originTurn: number): AgentWorkRow {
  const lifecycle = lifecycleFromCompletion(event) || current?.lifecycle || 'admitted'
  return {
    agentId,
    ...(current?.parentAgentId ? { parentAgentId: current.parentAgentId } : {}),
    title: current?.title || 'Agent task',
    role: current?.role || 'Agent',
    executionKind: current?.executionKind || 'builtin-agent',
    lifecycle,
    originTurn,
    workspace: current?.workspace,
    reviewSnapshotRef: event.type === 'completion' ? event.result.reviewSnapshotRef : current?.reviewSnapshotRef,
    activities: appendActivity(current, item),
  }
}

export function latestConversationTurn(entries: readonly TurnRecordEntry[]): number {
  return entries.reduce((highest, entry) => entry.kind === 'agent-lifecycle' || entry.kind === 'agent-collaboration'
    ? highest
    : Math.max(highest, entry.turn), 0)
}
