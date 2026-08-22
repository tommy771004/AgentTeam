/**
 * Renderer-only projection bridge for Host-owned external CLI sessions.
 *
 * This module deliberately contains no process, filesystem, provider, or
 * Electron implementation imports. It asks the feature-detected preload API
 * for a bounded snapshot/replay and folds public lifecycle events into the
 * disposable activity/thread projections.
 */

import type {
  ExternalCliLifecycleEvent,
  ExternalCliSessionSnapshot,
} from './externalCliRunSession.ts'
import type { CliStreamPayload } from '../store/runActivityStore.ts'

type ReconnectedCliStream = {
  runId: string
  kind: CliStreamPayload['kind']
  title?: string
  detail?: string
  tool?: string
  ok?: boolean
  channel?: 'thought' | 'text' | 'stdout' | 'stderr'
  sessionPhase?: string
  terminalClassification?: string
}

const reconnectedExternalSessionCursors = new Map<string, number>()

function externalLifecycleToStream(event: ExternalCliLifecycleEvent): ReconnectedCliStream {
  const base = { runId: event.runId, sessionPhase: event.phase }
  switch (event.type) {
    case 'process_started':
      return { ...base, kind: 'status', title: 'CLI 程序已啟動', detail: event.detail }
    case 'model_activity':
      return { ...base, kind: 'status', title: 'CLI 模型活動', detail: event.detail || event.delta }
    case 'provider_activity':
      return { ...base, kind: 'status', title: 'CLI session activity', detail: event.detail }
    case 'tool_started':
      return { ...base, kind: 'tool', title: `開始 ${event.tool || event.operation || '工具操作'}`, tool: event.tool, detail: event.detail }
    case 'tool_completed':
      return { ...base, kind: 'tool', title: `完成 ${event.tool || event.operation || '工具操作'}`, tool: event.tool, detail: event.detail, ok: event.ok !== false }
    case 'process_output':
      return { ...base, kind: 'chunk', title: event.channel === 'stderr' ? 'stderr' : 'stdout', detail: event.detail, channel: event.channel }
    case 'diagnostic':
      return { ...base, kind: event.severity === 'error' ? 'error' : 'log', title: 'CLI 診斷', detail: event.detail, ok: event.severity !== 'error' }
    case 'connector_authentication_required':
      return { ...base, kind: event.required ? 'error' : 'log', title: event.required ? 'Connector 驗證阻擋執行' : 'Connector 驗證提醒', detail: event.detail, ok: !event.required }
    case 'waiting_for_user':
      return { ...base, kind: 'status', title: '等待你的回覆', detail: event.detail }
    case 'waiting_for_approval':
      return { ...base, kind: 'status', title: '等待核准', detail: event.detail }
    case 'input_received':
      return { ...base, kind: 'status', title: '已收到使用者回覆', detail: event.detail }
    case 'approval_received':
      return { ...base, kind: 'status', title: event.approved ? '已核准' : '已拒絕', detail: event.detail, ok: event.approved }
    case 'operation_timeout':
      return { ...base, kind: 'error', title: 'CLI 工具操作逾時', detail: event.detail, ok: false, terminalClassification: 'operation-timeout' }
    case 'process_exit': {
      const classification = event.detail || undefined
      const ok = classification === 'success' || (event.code === 0 && !event.signal)
      return { ...base, kind: ok ? 'done' : 'error', title: ok ? 'CLI 完成' : 'CLI 結束', detail: event.detail, ok, terminalClassification: classification }
    }
  }
}

function isExternalCliSessionSnapshot(value: unknown): value is ExternalCliSessionSnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ExternalCliSessionSnapshot>
  return typeof candidate.runId === 'string' && typeof candidate.conversationId === 'string' && typeof candidate.phase === 'string'
}

/** Rebuild live external CLI projections from Host state after renderer reload. */
export async function reconnectExternalCliSessions(): Promise<number> {
  const api = window.subagents?.cli
  if (!api?.sessionSnapshots) return 0
  let rawSnapshots: unknown[]
  try {
    const result = await api.sessionSnapshots()
    rawSnapshots = Array.isArray(result) ? result : []
  } catch {
    return 0
  }
  if (!rawSnapshots.length) return 0

  const [{ useRunActivityStore }, { useThreadStore }] = await Promise.all([
    import('../store/runActivityStore.ts'),
    import('../store/threadStore.ts'),
  ])
  let restored = 0
  for (const raw of rawSnapshots) {
    if (!isExternalCliSessionSnapshot(raw)) continue
    const previousCursor = reconnectedExternalSessionCursors.get(raw.runId) || 0
    let snapshot = raw
    let events = raw.events || []
    if (api.sessionEvents) {
      try {
        const response = await api.sessionEvents({ runId: raw.runId, cursor: previousCursor }) as { snapshot?: unknown; events?: unknown[]; replayGap?: boolean } | null
        if (isExternalCliSessionSnapshot(response?.snapshot)) snapshot = response.snapshot
        const replay = response?.replayGap && isExternalCliSessionSnapshot(response?.snapshot)
          ? response.snapshot.events
          : response?.events
        if (Array.isArray(replay)) events = replay.filter((event): event is ExternalCliLifecycleEvent => Boolean(event && typeof event === 'object' && typeof (event as { type?: unknown }).type === 'string'))
      } catch {
        /* The bounded snapshot remains usable when replay is unavailable. */
      }
    }
    const activity = useRunActivityStore.getState()
    if (previousCursor === 0) activity.begin(snapshot.runId)
    for (const event of events) {
      if (!event || typeof event !== 'object' || typeof event.type !== 'string') continue
      activity.handleCliStream(externalLifecycleToStream(event))
    }
    const status = snapshot.phase === 'waiting_for_user'
      ? '等待你的回覆'
      : snapshot.phase === 'waiting_for_approval'
        ? '等待核准'
        : '外部 CLI 執行中'
    activity.setStatus(status, snapshot.runId)
    useThreadStore.getState().setExternalRun(snapshot.conversationId, {
      provider: snapshot.adapter,
      adapter: snapshot.adapter,
      runId: snapshot.runId,
      conversationId: snapshot.conversationId,
      processId: snapshot.processId,
      sessionId: snapshot.providerSessionId,
      status: 'running',
      eventCursor: snapshot.eventCursor,
      lastActivityAt: snapshot.lastMeaningfulActivityAt !== undefined
        ? new Date(snapshot.lastMeaningfulActivityAt).toISOString()
        : undefined,
      outputOmittedBytes: snapshot.output.omittedBytes,
      startedAt: new Date(snapshot.startedAt).toISOString(),
    })
    reconnectedExternalSessionCursors.set(snapshot.runId, snapshot.eventCursor)
    restored += 1
  }
  return restored
}
