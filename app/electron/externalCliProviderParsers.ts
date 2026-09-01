import type {
  LocalCliKind,
  LocalCliPlanItem,
  LocalCliStreamEvent,
} from './localCliRunner.ts'

type ParsedEvent = Omit<LocalCliStreamEvent, 'runId'>
type ParseResult = { handled: boolean; textDelta: string }
const handled = (textDelta = ''): ParseResult => ({ handled: true, textDelta })
const unhandled = (): ParseResult => ({ handled: false, textDelta: '' })

type ParserContext = {
  kind: LocalCliKind
  event: Record<string, unknown>
  assembledText: string
  appendText: (text: string) => string
  emit: (event: ParsedEvent) => void
  onProviderSession?: (providerSessionId: string) => void
  normalizePlanItems?: (raw: unknown) => LocalCliPlanItem[]
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((block) => {
    if (!block || typeof block !== 'object') return []
    const value = block as Record<string, unknown>
    return value.text == null ? [] : [String(value.text)]
  }).join('')
}

function parseWaitingEvent(ctx: ParserContext, lowerType: string): ParseResult {
  const { event, emit } = ctx
  if (lowerType.includes('question') || lowerType.includes('input_required') || lowerType.includes('ask_user') || lowerType.includes('user.wait')) {
    emit({ kind: 'status', title: '等待你的回覆', detail: String(event.message ?? event.reason ?? event.prompt ?? '').slice(0, 400), sessionPhase: 'waiting_for_user' })
    return handled()
  }
  if (lowerType.includes('permission') || lowerType.includes('approval_required') || lowerType.includes('approval.request')) {
    emit({ kind: 'error', title: '等待核准', detail: String(event.message ?? event.reason ?? event.permission ?? '').slice(0, 400), ok: false, sessionPhase: 'waiting_for_approval' })
    return handled()
  }
  return unhandled()
}

function parseThoughtEvent(ctx: ParserContext): ParseResult {
  const data = String(ctx.event.data ?? ctx.event.content ?? ctx.event.delta ?? '')
  if (data) ctx.emit({ kind: 'thought', channel: 'thought', delta: data })
  return handled()
}

function parseAssistantEvent(ctx: ParserContext): ParseResult {
  const message = ctx.event.message && typeof ctx.event.message === 'object'
    ? ctx.event.message as Record<string, unknown>
    : ctx.event
  const text = extractTextFromContent(message.content)
    || String(ctx.event.data ?? ctx.event.delta ?? ctx.event.text ?? message.text ?? '')
  return handled(text ? ctx.appendText(text) : '')
}

function parseResultEvent(ctx: ParserContext, subtype: string): ParseResult {
  const resultText = String(ctx.event.result ?? ctx.event.data ?? '')
  if (resultText && !ctx.assembledText.trim()) ctx.appendText(resultText)
  const isError = ctx.event.is_error === true || Boolean(ctx.event.error)
  ctx.emit({
    kind: isError ? 'error' : 'status',
    title: isError ? 'CLI 錯誤' : '回合結束',
    detail: isError
      ? String(ctx.event.error || ctx.event.result || subtype || '').slice(0, 400)
      : String(ctx.event.stop_reason ?? ctx.event.duration_ms ?? subtype ?? '').slice(0, 200),
    ok: !isError,
  })
  return handled()
}

function parseNarrativeEvent(ctx: ParserContext, type: string, subtype: string): ParseResult {
  if (['thought', 'reasoning', 'thinking'].includes(type)) return parseThoughtEvent(ctx)
  if (type === 'text' || type === 'content') {
    return handled(ctx.appendText(String(ctx.event.data ?? ctx.event.content ?? ctx.event.delta ?? ctx.event.text ?? '')))
  }
  if (ctx.kind === 'gemini' && (ctx.event.response || ctx.event.text || ctx.event.output)) {
    return handled(ctx.appendText(String(ctx.event.response ?? ctx.event.text ?? ctx.event.output ?? '')))
  }
  if (type === 'assistant' || type === 'message') return parseAssistantEvent(ctx)
  return type === 'result' ? parseResultEvent(ctx, subtype) : unhandled()
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function fileAction(value: unknown): 'create' | 'delete' | 'edit' {
  const action = String(value || '')
  if (action.includes('create')) return 'create'
  if (action.includes('delete')) return 'delete'
  return 'edit'
}

function emitCodexFileChange(ctx: ParserContext, change: Record<string, unknown>): boolean {
  const path = String(change.path ?? change.file ?? change.filename ?? '')
  if (!path) return false
  ctx.emit({
    kind: 'file', title: `已編輯 ${path.split(/[\\/]/).pop()}`, detail: path,
    path, paths: [path],
    added: numeric(change.additions) ?? numeric(change.added),
    removed: numeric(change.deletions) ?? numeric(change.removed),
    action: fileAction(change.kind ?? change.action),
  })
  return true
}

function emitCodexFileChanges(ctx: ParserContext, item: Record<string, unknown>): ParseResult {
  const changes = Array.isArray(item.changes)
    ? item.changes as Array<Record<string, unknown>>
    : Array.isArray(item.files) ? item.files as Array<Record<string, unknown>> : []
  if (changes.length) {
    for (const change of changes) emitCodexFileChange(ctx, change)
    return handled()
  }
  emitCodexFileChange(ctx, item)
  return handled()
}

type CodexItemHandler = (ctx: ParserContext, item: Record<string, unknown>, eventType: string) => ParseResult

const codexMessage: CodexItemHandler = (ctx, item) =>
  handled(ctx.appendText(String(item.text ?? item.message ?? item.content ?? '')))

const codexThought: CodexItemHandler = (ctx, item) => {
  const text = String(item.text ?? item.content ?? '')
  if (text) ctx.emit({ kind: 'thought', channel: 'thought', delta: text })
  return handled()
}

const codexCommand: CodexItemHandler = (ctx, item, eventType) => {
  ctx.emit({
    kind: 'tool', title: eventType === 'item.started' ? '執行指令…' : '已執行指令', tool: 'bash',
    detail: String(item.command ?? item.cmd ?? item.text ?? 'command').slice(0, 400),
    ok: item.exit_code === undefined || item.exit_code === 0,
  })
  return handled()
}

const codexError: CodexItemHandler = (ctx, item) => {
  ctx.emit({ kind: 'error', title: 'Codex 錯誤', detail: String(item.message ?? item.text ?? '').slice(0, 400), ok: false })
  return handled()
}

const codexPlan: CodexItemHandler = (ctx, item) => {
  const todos = ctx.normalizePlanItems?.(item.items ?? item.plan ?? item.todos) ?? []
  if (todos.length) ctx.emit({ kind: 'plan', title: '任務清單更新', todos })
  return handled()
}

const CODEX_ITEM_HANDLERS: Readonly<Record<string, CodexItemHandler>> = {
  agent_message: codexMessage,
  message: codexMessage,
  assistant_message: codexMessage,
  reasoning: codexThought,
  thought: codexThought,
  command_execution: codexCommand,
  command: codexCommand,
  shell: codexCommand,
  file_change: emitCodexFileChanges,
  file_edit: emitCodexFileChanges,
  patch: emitCodexFileChanges,
  file_change_set: emitCodexFileChanges,
  error: codexError,
  todo_list: codexPlan,
  plan: codexPlan,
  update_plan: codexPlan,
}

function parseCodexItem(ctx: ParserContext, type: string): ParseResult {
  if (!['item.completed', 'item.started', 'item.updated'].includes(type)) return unhandled()
  const item = ctx.event.item && typeof ctx.event.item === 'object'
    ? ctx.event.item as Record<string, unknown>
    : {}
  const itemType = String(item.type || '')
  const handler = CODEX_ITEM_HANDLERS[itemType]
  if (handler) return handler(ctx, item, type)
  if (itemType) ctx.emit({ kind: 'status', title: itemType, detail: String(item.message ?? item.text ?? '').slice(0, 200) })
  return handled()
}

function parseCodexTurnSettlement(ctx: ParserContext, type: string): ParseResult {
  const error = ctx.event.error as { message?: string } | undefined
  const failed = type === 'turn.failed'
  ctx.emit({
    kind: failed ? 'error' : 'status',
    title: failed ? '回合失敗' : '回合完成',
    detail: String(error?.message ?? ctx.event.message ?? '').slice(0, 300),
    ok: !failed,
  })
  return handled()
}

function parseCodexError(ctx: ParserContext, type: string): ParseResult {
  const rate = ctx.event.rate_limit_info as { status?: string } | undefined
  const message = typeof ctx.event.message === 'string'
    ? ctx.event.message
    : String(rate?.status || ctx.event.error || 'error')
  ctx.emit({ kind: 'error', title: type === 'rate_limit_event' ? '用量限制' : '錯誤', detail: message.slice(0, 400), ok: false })
  return handled()
}

function parseCodexLifecycle(ctx: ParserContext, type: string, subtype: string): ParseResult {
  const item = parseCodexItem(ctx, type)
  if (item.handled) return item
  if (type === 'turn.started') {
    ctx.emit({ kind: 'status', title: '回合開始' })
    return handled()
  }
  if (type === 'turn.completed' || type === 'turn.failed') return parseCodexTurnSettlement(ctx, type)
  if (type === 'error' || type === 'rate_limit_event') return parseCodexError(ctx, type)
  if (type === 'thread.started' || type === 'system') {
    if (subtype === 'init') ctx.emit({ kind: 'status', title: 'CLI 就緒', detail: String(ctx.event.model || ctx.event.cwd || '').slice(0, 120) })
    return handled()
  }
  return unhandled()
}

export function parseProviderJsonEvent(ctx: ParserContext): ParseResult {
  const type = String(ctx.event.type || ctx.event.event || '')
  const subtype = String(ctx.event.subtype || '')
  const providerSessionId = String(
    ctx.event.session_id ?? ctx.event.sessionId ?? ctx.event.thread_id
      ?? ctx.event.threadId ?? ctx.event.conversation_id ?? '',
  ).trim()
  if (providerSessionId) ctx.onProviderSession?.(providerSessionId.slice(0, 200))

  const waiting = parseWaitingEvent(ctx, type.toLowerCase())
  if (waiting.handled) return waiting
  const narrative = parseNarrativeEvent(ctx, type, subtype)
  if (narrative.handled) return narrative
  return parseCodexLifecycle(ctx, type, subtype)
}
