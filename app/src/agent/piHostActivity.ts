/**
 * Convert Pi Host protocol events into the renderer's disposable run feed.
 *
 * Pi Host remains the execution/history authority. This module only translates
 * its typed stream into the existing presentation vocabulary used by the
 * center process feed.
 *
 * Structured phase: whenever the Host names WHAT it is doing (orchestration
 * stage, tool execution, turn boundaries), the update carries the lifecycle
 * phase explicitly. `phaseFromStatusLine`'s regex over Chinese status copy is
 * then only a fallback for adapters that have no structured signal — copy
 * changes upstream can no longer derail the phase display.
 */
import type { RunLifecyclePhase } from './runLifecycle.ts'
import type { RunActivityStore, RunTaskSnapshotItem } from '../store/runActivityStore.ts'

export type PiHostEventLike = {
  event: string
  payload: unknown
}

export type PiHostActivityUpdate =
  | { kind: 'text'; runId: string; delta: string }
  | { kind: 'thought'; runId: string; delta: string }
  | { kind: 'plan'; runId: string; tasks: RunTaskSnapshotItem[] }
  | {
      kind: 'status' | 'tool' | 'error'
      runId: string
      title: string
      detail?: string
      tool?: string
      ok?: boolean
      eventId?: string
      callId?: string
      /** Structured lifecycle signal; wins over status-line regex derivation. */
      phase?: RunLifecyclePhase
    }

type PiHostActivitySink = Pick<RunActivityStore, 'appendText' | 'appendThought' | 'setTasks' | 'push' | 'setStatus'>

/** Apply one typed Host update to the disposable renderer presentation. */
export function applyPiHostActivityUpdate(activity: PiHostActivitySink, update: PiHostActivityUpdate): void {
  if (update.kind === 'text') {
    activity.appendText(update.delta, update.runId)
    return
  }
  if (update.kind === 'thought') {
    activity.appendThought(update.delta, update.runId)
    return
  }
  if (update.kind === 'plan') {
    activity.setTasks(update.tasks, update.runId)
    return
  }
  activity.push({
    id: update.eventId,
    runId: update.runId,
    kind: update.kind,
    title: update.title,
    detail: update.detail,
    tool: update.tool,
    callId: update.callId,
    ok: update.ok,
  })
  activity.setStatus(update.title, update.runId, update.phase)
}

type RecordValue = Record<string, unknown>

function asRecord(value: unknown): RecordValue | undefined {
  return value && typeof value === 'object' ? (value as RecordValue) : undefined
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function summarize(value: unknown): string | undefined {
  const record = asRecord(value)
  if (!record) return asText(value)

  for (const key of ['path', 'file', 'filePath', 'command', 'name', 'reason']) {
    const text = asText(record[key])
    if (text) return text.slice(0, 2_000)
  }

  const content = record.content
  if (typeof content === 'string') return content.slice(0, 2_000)
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        const item = asRecord(part)
        return asText(item?.text) || asText(item?.content) || ''
      })
      .filter(Boolean)
      .join('\n')
    if (text) return text.slice(0, 2_000)
  }

  try {
    return JSON.stringify(value).slice(0, 2_000)
  } catch {
    return undefined
  }
}

function callEventId(callId: unknown, phase: string): string | undefined {
  return typeof callId === 'string' && callId ? `pi-${callId}-${phase}` : undefined
}

function mapPlanUpdate(payload: RecordValue, runId: string): PiHostActivityUpdate | null {
  const steps = Array.isArray(payload.steps) ? payload.steps : []
  const tasks = steps.flatMap((value) => {
    const step = asRecord(value)
    const text = asText(step?.title)
    if (!text) return []
    const status = asText(step?.status)
    const id = asText(step?.id)?.slice(0, 80)
    const meta = asText(step?.meta)?.slice(0, 80)
    const details = Array.isArray(step?.details)
      ? step.details.slice(0, 8).flatMap((raw) => {
          const detail = asRecord(raw)
          const label = asText(detail?.label)?.slice(0, 200)
          if (!label) return []
          const detailMeta = asText(detail?.meta)?.slice(0, 80)
          return [{ label, ...(detailMeta ? { meta: detailMeta } : {}) }]
        })
      : []
    return [{
      ...(id ? { id } : {}),
      text: text.slice(0, 200),
      status: status === 'done' ? 'done' as const : status === 'in_progress' ? 'active' as const : status === 'failed' ? 'failed' as const : 'pending' as const,
      ...(meta ? { meta } : {}),
      ...(details.length ? { details } : {}),
    }]
  }).slice(0, 40)
  return tasks.length ? { kind: 'plan', runId, tasks } : null
}

function mapEarlyHostEvent(event: PiHostEventLike, payload: RecordValue, runId: string): PiHostActivityUpdate | null | undefined {
  if (event.event === 'host/turn-item') return mapTurnItem(runId, payload.item)
  if (event.event === 'host/plan-updated') return mapPlanUpdate(payload, runId)
  return undefined
}

function mapTurnItem(runId: string, item: unknown): PiHostActivityUpdate | null {
  const record = asRecord(item)
  if (!record) return null
  const type = asText(record.type)

  if (type === 'message_update') {
    const assistantEvent = asRecord(record.assistantMessageEvent)
    const eventType = asText(assistantEvent?.type)
    if (eventType === 'text_delta') {
      const delta = asText(assistantEvent?.delta)
      return delta ? { kind: 'text', runId, delta } : null
    }
    if (eventType === 'thinking_delta') {
      const delta = asText(assistantEvent?.delta)
      return delta ? { kind: 'thought', runId, delta } : null
    }
    return null
  }

  if (type === 'tool_execution_start') {
    const tool = asText(record.toolName) || 'tool'
    return {
      kind: 'tool',
      runId,
      title: `執行 ${tool}…`,
      detail: summarize(record.args),
      tool,
      phase: 'executing',
      eventId: callEventId(record.toolCallId, 'start'),
      callId: asText(record.toolCallId),
    }
  }

  if (type === 'tool_execution_end') {
    const tool = asText(record.toolName) || 'tool'
    const isError = record.isError === true
    return {
      kind: isError ? 'error' : 'tool',
      runId,
      title: isError ? `${tool} 失敗` : `已執行 ${tool}`,
      detail: summarize(record.result),
      tool,
      ok: !isError,
      phase: 'executing',
      eventId: callEventId(record.toolCallId, 'result'),
      callId: asText(record.toolCallId),
    }
  }

  if (type === 'tool_execution_update') {
    const tool = asText(record.toolName) || 'tool'
    return {
      kind: 'status',
      runId,
      title: `${tool} 執行中…`,
      detail: summarize(record.partialResult),
      tool,
      phase: 'executing',
      callId: asText(record.toolCallId),
    }
  }

  if (type === 'agent_start') return { kind: 'status', runId, title: 'Pi Core 已啟動', phase: 'starting' }
  if (type === 'turn_start') return { kind: 'status', runId, title: '開始回合', phase: 'thinking' }
  if (type === 'turn_end') return { kind: 'status', runId, title: '回合完成', phase: 'finalizing' }
  if (type === 'agent_end') return { kind: 'status', runId, title: 'Pi Core 回合完成', phase: 'finalizing' }

  return null
}

export function mapPiHostEventToActivity(event: PiHostEventLike): PiHostActivityUpdate | null {
  const payload = asRecord(event.payload)
  if (!payload) return null
  const runId = asText(payload.runId)
  if (!runId) return null

  const early = mapEarlyHostEvent(event, payload, runId)
  if (early !== undefined) return early

  if (event.event === 'host/pipeline-stage') {
    const stageId = asText(payload?.stageId) || 'stage'
    const providerId = asText(payload?.providerId) || 'provider'
    const state = asText(payload?.state)
    const failed = state === 'failed' || state === 'blocked' || state === 'cancelled'
    const stateLabel = state === 'queued'
      ? '已排入'
      : state === 'running'
        ? '執行中'
        : state === 'completed'
          ? '已完成'
          : state === 'blocked'
            ? '已阻擋'
            : state === 'cancelled'
              ? '已取消'
              : '失敗'
    return {
      kind: failed ? 'error' : state === 'completed' ? 'tool' : 'status',
      runId,
      title: `${providerId} / ${stageId} ${stateLabel}`,
      detail: asText(payload?.summary),
      tool: providerId,
      ok: !failed,
      phase: state === 'running' ? 'executing' : undefined,
      eventId: `pi-pipeline-${stageId}-${state || 'unknown'}`,
    }
  }

  if (event.event === 'host/pipeline-stream') {
    const stageId = asText(payload?.stageId) || 'stage'
    const providerId = asText(payload?.providerId) || 'provider'
    const update = asRecord(payload?.update)
    const kind = asText(update?.kind) || 'text-delta'
    // Collapse noisy text-delta bursts into the preview; keep control events in the feed
    if (kind === 'text-delta') return null
    const text = asText(update?.text) || asText(update?.content) || ''
    const titleMap: Record<string, string> = {
      'thinking': `思考中 · ${providerId}`,
      'tool-call': `呼叫 ${asText(update?.tool) || providerId}`,
      'tool-result': asText(update?.ok) === 'false' || update?.ok === false ? `${asText(update?.tool) || providerId} 失敗` : `${asText(update?.tool) || providerId} 完成`,
      'file-write': `寫入 ${asText(update?.path) || 'artifact'}`,
      'error': `串流錯誤 · ${providerId}`,
      'blocked': `已阻擋 · ${providerId}`,
      'cancelled': `已取消 · ${providerId}`,
      'done': `${providerId} 完成`,
    }
    const title = titleMap[kind] || `${providerId} / ${stageId} · ${kind}`
    const isError = kind === 'error' || kind === 'blocked' || kind === 'cancelled' || (kind === 'tool-result' && update?.ok === false)
    return {
      kind: isError ? 'error' : kind === 'done' ? 'tool' : 'status',
      runId,
      title,
      detail: text.slice(0, 2_000) || asText(update?.path),
      tool: providerId,
      ok: !isError,
      eventId: `pi-pipeline-stream-${stageId}-${String(update?.seq || '')}-${kind}`,
    }
  }

  const tool = asText(payload?.tool)
  const callId = asText(payload?.callId)
  if (event.event === 'host/tool-start' && tool) {
    return {
      kind: 'tool',
      runId,
      title: `執行 ${tool}…`,
      detail: summarize(payload?.item),
      tool,
      phase: 'executing',
      eventId: callEventId(callId, 'start'),
      callId,
    }
  }

  if (event.event === 'host/tool-update' && tool) {
    return {
      kind: 'status',
      runId,
      title: `${tool} 執行中…`,
      detail: summarize(payload?.item),
      tool,
      phase: 'executing',
      callId,
    }
  }

  if (event.event === 'host/tool-decision' && tool) {
    const decision = asText(payload?.decision)
    const title = decision === 'allow' ? `已核准 ${tool}` : decision === 'deny' ? `已拒絕 ${tool}` : `等待核准 ${tool}`
    return {
      kind: decision === 'deny' ? 'error' : 'status',
      runId,
      title,
      detail: asText(payload?.reason),
      tool,
      ok: decision !== 'deny',
      // A pending permission ask is the HITL phase, not just copy — this is
      // the same signal the approval surfaces key off.
      phase: decision === 'allow' ? 'executing' : decision === 'deny' ? undefined : 'manual_intervention',
      callId,
    }
  }

  if (event.event === 'host/tool-result' && tool) {
    const settlement = asText(payload?.settlement)
    const failed = settlement !== 'success'
    return {
      kind: failed ? 'error' : 'tool',
      runId,
      title: failed ? `${tool} ${settlement || '失敗'}` : `已執行 ${tool}`,
      detail: asText(payload?.reason) || summarize(payload?.item),
      tool,
      ok: !failed,
      phase: 'executing',
      eventId: callEventId(callId, 'result'),
      callId,
    }
  }

  if (event.event === 'host/orchestration') {
    const phase = asText(payload?.phase)
    const iteration = typeof payload?.iteration === 'number' ? ` · 第 ${payload.iteration} 輪` : ''
    const detail = asText(payload?.detail)
    const title = phase === 'parse'
      ? '解析任務…'
      : phase === 'iterate'
        ? `執行回合${iteration}`
        : phase === 'dod'
          ? detail === 'met' ? 'Definition of Done 已達成' : 'Definition of Done 尚未達成'
          : phase === 'replan'
            ? '重新規劃下一輪…'
            : phase === 'cancelled'
              ? '已取消'
              : phase === 'settlement'
                ? `任務結算：${detail || '完成'}`
                : `Pi Core：${phase || '處理中'}`
    return {
      kind: phase === 'cancelled' ? 'error' : 'status',
      runId,
      title,
      detail,
      ok: phase !== 'cancelled',
      // The Host literally names its orchestration stage here — trust it over
      // any wording heuristic.
      phase:
        phase === 'parse' || phase === 'replan'
          ? 'planning'
          : phase === 'iterate'
            ? 'executing'
            : phase === 'settlement'
              ? 'finalizing'
              : phase === 'cancelled'
                ? 'cancelled'
                : undefined,
      eventId: `pi-orchestration-${phase || 'unknown'}-${payload?.iteration ?? 0}`,
    }
  }

  if (event.event === 'host/context') {
    const phase = asText(payload?.phase)
    const contextWindow = typeof payload?.contextWindowTokens === 'number'
      ? `${payload.contextWindowTokens.toLocaleString()} tokens`
      : undefined
    if (phase === 'memory-recalled') {
      const recalled = typeof payload?.recalled === 'number' ? payload.recalled : 0
      return {
        kind: 'status',
        runId,
        title: `已載入 ${recalled} 筆相關記憶`,
        eventId: `pi-context-memory-${recalled}`,
      }
    }
    if (phase === 'memory-written') {
      const written = typeof payload?.written === 'number' ? payload.written : 1
      return {
        kind: 'status',
        runId,
        title: `已儲存 ${written} 筆長期記憶`,
        eventId: `pi-context-memory-written-${written}`,
      }
    }
    if (phase === 'compacted') {
      return {
        kind: 'status',
        runId,
        title: '已壓縮對話上下文',
        detail: contextWindow,
        eventId: 'pi-context-compacted',
      }
    }
    if (phase === 'model-switched') {
      const provider = asText(payload?.provider)
      const model = asText(payload?.model) || 'unknown model'
      return {
        kind: 'status',
        runId,
        title: `模型已切換為 ${provider ? `${provider}/` : ''}${model}`,
        detail: contextWindow,
        eventId: `pi-context-model-${provider || 'unknown'}-${model}`,
      }
    }
  }

  return null
}
