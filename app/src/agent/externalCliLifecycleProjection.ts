import type {
  ExternalCliLifecycleEvent,
  ExternalCliRunPhase,
  ExternalCliSessionSnapshot,
  ExternalCliTerminalClassification,
} from './externalCliRunSession.ts'

export type ExternalCliStreamKind =
  | 'status'
  | 'thought'
  | 'text'
  | 'tool'
  | 'file'
  | 'log'
  | 'error'
  | 'done'
  | 'chunk'
  | 'plan'

export type ExternalCliStreamProjection = {
  runId: string
  kind: ExternalCliStreamKind
  title?: string
  detail?: string
  tool?: string
  ok?: boolean
  channel?: 'thought' | 'text' | 'stdout' | 'stderr'
  sessionPhase?: ExternalCliRunPhase
  terminalClassification?: ExternalCliTerminalClassification
  providerSessionId?: string
}

export function externalLifecycleToStream(event: ExternalCliLifecycleEvent): ExternalCliStreamProjection {
  const providerSessionId = 'providerSessionId' in event && typeof event.providerSessionId === 'string'
    ? event.providerSessionId
    : undefined
  const base = { runId: event.runId, sessionPhase: event.phase, providerSessionId }
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
    case 'cancellation_requested':
      return { ...base, kind: 'status', title: '正在取消 CLI', detail: event.detail }
    case 'cancellation_confirmed':
      return { ...base, kind: 'status', title: 'CLI 程序樹已確認終止', detail: event.detail, ok: true }
    case 'cancellation_unconfirmed':
      return { ...base, kind: 'error', title: 'CLI 程序終止狀態無法確認', detail: event.detail, ok: false }
    case 'operation_timeout':
      return { ...base, kind: 'error', title: 'CLI 工具操作逾時', detail: event.detail, ok: false, terminalClassification: 'operation-timeout' }
    case 'process_exit': {
      const classification = event.detail as ExternalCliTerminalClassification | undefined
      const ok = classification === 'success' || (event.code === 0 && !event.signal)
      return { ...base, kind: ok ? 'done' : 'error', title: ok ? 'CLI 完成' : 'CLI 結束', detail: event.detail, ok, terminalClassification: classification }
    }
  }
}

export function externalTerminalStatus(snapshot: ExternalCliSessionSnapshot): {
  status: string
  externalStatus: 'starting' | 'running' | 'success' | 'failed' | 'aborted' | 'interrupted'
} {
  if (!snapshot.terminal) {
    return {
      status: snapshot.phase === 'waiting_for_user' ? '等待你的回覆' : snapshot.phase === 'waiting_for_approval' ? '等待核准' : snapshot.phase === 'starting' ? '外部 CLI 啟動中' : '外部 CLI 執行中',
      externalStatus: snapshot.phase === 'starting' ? 'starting' : 'running',
    }
  }
  const classification = snapshot.terminal.classification
  return {
    status: classification === 'success' ? 'CLI 完成' : classification === 'user-cancelled' ? 'CLI 已取消' : classification === 'interrupted' ? 'CLI 已中斷，需要恢復判定' : `CLI ${classification}`,
    externalStatus: classification === 'success' ? 'success' : classification === 'user-cancelled' ? 'aborted' : classification === 'interrupted' ? 'interrupted' : 'failed',
  }
}
