/** Pure mapping helpers for OpenCode session APIs -> Thread-owned state. */

export type MappedOpenCodeTodo = {
  id: string
  text: string
  status: 'pending' | 'active' | 'done' | 'failed'
}

export type MappedOpenCodeChild = {
  id: string
  title: string
  parentId?: string
  status?: string
  time?: string
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function listPayload(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value
  const root = record(value)
  if (!root) return []
  for (const key of ['value', 'data', 'result', ...keys]) {
    const candidate = root[key]
    if (Array.isArray(candidate)) return candidate
    if (candidate && candidate !== value) {
      const nested = listPayload(candidate, keys)
      if (nested.length) return nested
    }
  }
  return []
}

function normalizedStatus(value: unknown): MappedOpenCodeTodo['status'] {
  const status = String(value || '').trim().toLowerCase().replace(/[- ]/g, '_')
  if (/done|complete|completed|success|succeeded|closed/.test(status)) return 'done'
  if (/fail|error|cancel|aborted|rejected/.test(status)) return 'failed'
  if (/active|progress|doing|running|started|in_progress/.test(status)) return 'active'
  return 'pending'
}

/** Accepts both the documented Todo[] response and IPC envelopes. */
export function normalizeOpenCodeTodo(value: unknown): MappedOpenCodeTodo[] {
  return listPayload(value, ['todos', 'items']).flatMap((raw, index) => {
    const item = record(raw)
    const text = String(item?.content ?? item?.text ?? item?.title ?? item?.name ?? raw ?? '')
      .trim()
      .slice(0, 200)
    if (!text) return []
    const id = String(item?.id ?? item?.todoId ?? item?.taskId ?? `todo_${index + 1}`).trim()
    return [{
      id: id || `todo_${index + 1}`,
      text,
      status: normalizedStatus(item?.status ?? item?.state ?? (item?.completed ? 'done' : undefined)),
    }]
  })
}

/** Maps documented Session[] children without exposing raw server payloads to the UI. */
export function normalizeOpenCodeChildren(value: unknown): MappedOpenCodeChild[] {
  return listPayload(value, ['children', 'sessions', 'items']).flatMap((raw) => {
    const item = record(raw)
    const id = String(item?.id ?? item?.sessionID ?? item?.sessionId ?? '').trim()
    if (!id) return []
    const title = String(item?.title ?? item?.name ?? `OpenCode child ${id.slice(0, 8)}`)
      .trim()
      .slice(0, 100)
    return [{
      id,
      title: title || `OpenCode child ${id.slice(0, 8)}`,
      parentId: String(item?.parentID ?? item?.parentId ?? '').trim() || undefined,
      status: String(item?.status ?? item?.state ?? '').trim() || undefined,
      time: String(item?.time ?? item?.updatedAt ?? item?.updated_at ?? '').trim() || undefined,
    }]
  })
}

/** Extracts the Session object returned by POST /session/:id/fork. */
export function extractOpenCodeSessionId(value: unknown): string | undefined {
  const queue: unknown[] = [value]
  const seen = new Set<unknown>()
  while (queue.length) {
    const current = queue.shift()
    if (!current || seen.has(current)) continue
    seen.add(current)
    if (typeof current === 'object') {
      const item = current as Record<string, unknown>
      const id = String(item.id ?? item.sessionID ?? item.sessionId ?? '').trim()
      if (id) return id
      for (const key of ['value', 'data', 'result', 'session']) {
        if (item[key]) queue.push(item[key])
      }
    }
  }
  return undefined
}

export function mapOpenCodeTodoToThreadPlan(value: unknown) {
  return normalizeOpenCodeTodo(value).map((item) => ({
    id: `opencode_${item.id}`,
    text: item.text,
    status: item.status,
  }))
}
