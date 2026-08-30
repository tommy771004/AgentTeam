import type { RunnerId } from './runners/types.ts'
import type { FollowUpMode } from './types.ts'
import type { ChatAttachment } from './types.ts'
import type { QueuedExternalRun } from './runQueue.ts'

export type FollowUpAction = 'steer' | 'queue' | 'takeover'
export type PendingFollowUpState = 'submitting' | 'accepted' | 'queued' | 'dispatching' | 'rejected' | 'settled' | 'cancelled'

export type PendingFollowUpProjection = {
  id: string
  runId: string
  sessionId: string
  threadId: string
  text: string
  action: FollowUpAction
  state: PendingFollowUpState
  revision: number
  queueRevision: number
  editable: boolean
  cancellable: boolean
  reorderable: boolean
  targetRunId?: string
  reason?: string
  attachmentCount?: number
}

type HostQueueItem = {
  runId: string
  sessionId: string
  prompt: string
  trigger: string
  profile: Record<string, unknown>
  status: string
  action?: string
  clientMessageId?: string
  targetRunId?: string
  revision?: number
}

export function followUpActionForRunner(runner: RunnerId, mode: FollowUpMode): FollowUpAction {
  if (mode === 'queue') return 'queue'
  return runner === 'builtin' ? 'steer' : 'takeover'
}

export function createFollowUpClientMessageId(): string {
  return globalThis.crypto?.randomUUID?.() || `follow-up-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export type HostFollowUpSubmission = {
  action: 'steer' | 'queue'
  threadId: string
  runId: string
  expectedActiveRunId: string
  prompt: string
  runner: RunnerId
  projectRoot?: string
  attachments: ChatAttachment[]
  profile: Record<string, unknown>
}

export type HostFollowUpApi = {
  sessions: { list: () => Promise<{ sessions: unknown[] }> }
  turn: { submit: (input: {
    sessionId: string
    prompt: string
    runId?: string
    cwd?: string
    mode?: 'steer' | 'queue'
    clientMessageId?: string
    expectedActiveRunId?: string
    profile?: Record<string, unknown>
  }) => Promise<unknown> }
}

function sessionIdForThread(sessions: readonly unknown[], threadId: string): string | undefined {
  for (const value of sessions) {
    if (!value || typeof value !== 'object') continue
    const session = value as Record<string, unknown>
    if (session.threadId === threadId && session.archived !== true && typeof session.id === 'string') return session.id
  }
  return undefined
}

function frozenAttachmentRefs(attachments: readonly ChatAttachment[]) {
  return attachments.map((attachment) => ({
    id: attachment.id,
    kind: attachment.kind,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    ...(attachment.filePath ? { filePath: attachment.filePath } : {}),
  }))
}

export async function submitHostInteractiveFollowUp(api: HostFollowUpApi, input: HostFollowUpSubmission) {
  const sessions = await api.sessions.list()
  const sessionId = sessionIdForThread(Array.isArray(sessions.sessions) ? sessions.sessions : [], input.threadId)
  if (!sessionId) throw new Error('目前對話沒有可用的 Pi Host session，後續指令尚未接受。')
  const clientMessageId = input.runId
  const profile = {
      ...input.profile,
      runner: input.runner,
      threadId: input.threadId,
      projectRoot: input.projectRoot,
      attachments: frozenAttachmentRefs(input.attachments),
      followUpAction: input.action,
  }
  const submit = (expectedActiveRunId: string) => api.turn.submit({
    sessionId,
    prompt: input.prompt,
    runId: input.runId,
    cwd: input.projectRoot,
    mode: input.action,
    clientMessageId,
    expectedActiveRunId,
    profile,
  })
  let submitted: unknown
  try {
    submitted = await submit(input.expectedActiveRunId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const latest = /Active Pi run changed:\s*([^\s]+)/.exec(message)?.[1]
    if (input.action !== 'steer' || !latest || latest === input.expectedActiveRunId) throw error
    // One bounded retry only. Host supplied the current identity and the
    // unchanged client identity makes the retry idempotent.
    submitted = await submit(latest)
  }
  if (!submitted || typeof submitted !== 'object') throw new Error('Pi Host follow-up acknowledgement is malformed.')
  const result = submitted as Record<string, unknown>
  if (result.queued !== input.action) throw new Error('Pi Host 未確認後續指令的動作語意。')
  return result
}

function asHostQueueItem(value: unknown): HostQueueItem | undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as Record<string, unknown>
  if (typeof item.runId !== 'string' || typeof item.sessionId !== 'string' || typeof item.prompt !== 'string'
    || typeof item.trigger !== 'string' || !item.profile || typeof item.profile !== 'object' || typeof item.status !== 'string') return undefined
  return {
    runId: item.runId,
    sessionId: item.sessionId,
    prompt: item.prompt,
    trigger: item.trigger,
    profile: item.profile as Record<string, unknown>,
    status: item.status,
    action: typeof item.action === 'string' ? item.action : undefined,
    clientMessageId: typeof item.clientMessageId === 'string' ? item.clientMessageId : undefined,
    targetRunId: typeof item.targetRunId === 'string' ? item.targetRunId : undefined,
    revision: typeof item.revision === 'number' ? item.revision : undefined,
  }
}

function projectedState(item: HostQueueItem): PendingFollowUpState {
  if (item.action === 'steer') return 'accepted'
  if (item.status === 'queued') return 'queued'
  if (item.status === 'running') return 'dispatching'
  if (item.status === 'interrupted') return 'cancelled'
  return 'settled'
}

export function projectPendingFollowUps(queue: readonly unknown[], threadId: string): PendingFollowUpProjection[] {
  const items = queue.map(asHostQueueItem).filter((item): item is HostQueueItem => Boolean(item))
  const queueRevision = items.reduce((latest, item) => Math.max(latest, item.revision || 0), 0)
  const seen = new Set<string>()
  const projected: PendingFollowUpProjection[] = []
  for (const item of items) {
    if (item.trigger !== 'interactive' || (item.action !== 'steer' && item.action !== 'queue')) continue
    const itemThreadId = typeof item.profile.threadId === 'string' ? item.profile.threadId : ''
    if (itemThreadId !== threadId) continue
    const id = item.clientMessageId || item.runId
    if (seen.has(id)) continue
    seen.add(id)
    const state = projectedState(item)
    const mutable = item.action === 'queue' && state === 'queued'
    const attachments = Array.isArray(item.profile.attachments) ? item.profile.attachments : []
    projected.push({
      id,
      runId: item.runId,
      sessionId: item.sessionId,
      threadId: itemThreadId,
      text: item.prompt,
      action: item.action,
      state,
      revision: item.revision || 0,
      queueRevision,
      editable: mutable,
      cancellable: mutable,
      reorderable: mutable,
      attachmentCount: attachments.length,
      ...(item.targetRunId ? { targetRunId: item.targetRunId } : {}),
    })
  }
  return projected
}

/** Read-only compatibility projection for External CLI/plain-browser queue ownership. */
export function projectRendererQueuedFollowUps(queue: readonly QueuedExternalRun[], threadId: string): PendingFollowUpProjection[] {
  return queue
    .filter((item) => item.reuseThreadId === threadId && (item.followUpAction === 'queue' || item.followUpAction === 'takeover'))
    .map((item, index) => ({
      id: item.id,
      runId: item.runId || item.id,
      sessionId: 'renderer-compatibility',
      threadId,
      text: item.objective,
      action: item.followUpAction === 'takeover' ? 'takeover' : 'queue',
      state: 'queued',
      revision: index + 1,
      queueRevision: queue.length,
      editable: false,
      cancellable: true,
      reorderable: true,
      attachmentCount: item.attachments?.length || 0,
    }))
}
