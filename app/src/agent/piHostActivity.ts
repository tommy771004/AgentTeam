/**
 * Convert Pi Host protocol events into the renderer's disposable run feed.
 *
 * Pi Host remains the execution/history authority. This module only translates
 * its typed stream into the existing presentation vocabulary used by the
 * center process feed.
 */

export type PiHostEventLike = {
  event: string
  payload: unknown
}

export type PiHostActivityUpdate =
  | { kind: 'text'; runId: string; delta: string }
  | { kind: 'thought'; runId: string; delta: string }
  | {
      kind: 'status' | 'tool' | 'error'
      runId: string
      title: string
      detail?: string
      tool?: string
      ok?: boolean
      eventId?: string
      callId?: string
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
      callId: asText(record.toolCallId),
    }
  }

  if (type === 'agent_start') return { kind: 'status', runId, title: 'Pi Core 已啟動' }
  if (type === 'turn_start') return { kind: 'status', runId, title: '開始回合' }
  if (type === 'turn_end') return { kind: 'status', runId, title: '回合完成' }
  if (type === 'agent_end') return { kind: 'status', runId, title: 'Pi Core 回合完成' }

  return null
}

export function mapPiHostEventToActivity(event: PiHostEventLike): PiHostActivityUpdate | null {
  const payload = asRecord(event.payload)
  const runId = asText(payload?.runId)
  if (!runId) return null

  if (event.event === 'host/turn-item') return mapTurnItem(runId, payload?.item)

  const tool = asText(payload?.tool)
  const callId = asText(payload?.callId)
  if (event.event === 'host/tool-start' && tool) {
    return {
      kind: 'tool',
      runId,
      title: `執行 ${tool}…`,
      detail: summarize(payload?.item),
      tool,
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
      eventId: `pi-orchestration-${phase || 'unknown'}-${payload?.iteration ?? 0}`,
    }
  }

  return null
}
