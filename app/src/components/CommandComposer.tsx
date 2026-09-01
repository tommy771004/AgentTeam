import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react'
import { Icon } from './Icon'
import { SlashCommandMenu } from './SlashCommandMenu'
import { ComposerLoader } from './primitives/ComposerLoader'
import {
  filterSlashCommands,
  getAllSlashCommands,
  parseSlashLine,
  resolveSlashCommand,
  type SlashCommand,
} from '../commands/registry'
import { useLearningStore } from '../store/learningStore'
import {
  FOCUS_COMPOSER_EVENT,
  useCommandHistoryStore,
} from '../store/commandHistoryStore'
import type { ChatAttachment } from '../agent/types'
import type { FollowUpAction, PendingFollowUpProjection } from '../agent/interactiveFollowUp'
import {
  filesToAttachments,
  formatBytes,
  MAX_ATTACHMENTS,
} from '../lib/chatAttachments'
import {
  attachmentsForComposerScope,
  replaceComposerScopeAttachments,
  type ComposerAttachmentsByScope,
} from '../agent/composerRunControls'

type DictationRecognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: unknown) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

type DictationWindow = Window & {
  SpeechRecognition?: new () => DictationRecognition
  webkitSpeechRecognition?: new () => DictationRecognition
}

const DATA_SOURCES = [
  { key: 'project', name: '專案檔案', desc: '目前工作區與程式碼', icon: 'folder_open' },
  { key: 'memory', name: '工作記憶', desc: '已保存的偏好與上下文', icon: 'database' },
  { key: 'web', name: 'Web search', desc: '即時新聞與公開資訊', icon: 'language' },
  { key: 'skills', name: 'Skills', desc: '可載入的工作流程', icon: 'auto_awesome' },
] as const

export type ComposerMode = 'agent' | 'workspace'

export interface CommandComposerProps {
  /** Runtime conversation identity used to isolate unsent attachments. */
  scopeKey: string
  value: string
  onChange: (v: string) => void
  onSubmitLine: (line: string, attachments: ChatAttachment[]) => void | Promise<void>
  /** Called when a resolved slash command should run */
  onSlashCommand: (cmd: SlashCommand, args: string, raw: string) => void | Promise<void>
  placeholder?: string
  disabled?: boolean
  compact?: boolean
  /** agent = 主對話；workspace = 控制台 */
  mode?: ComposerMode
  /** Register as global Cmd+/ target */
  primary?: boolean
  /** Hide footer hint row */
  hideHints?: boolean
  autoFocus?: boolean
  /**
   * ChatGPT-style send shortcut:
   * - enter: Enter 送出、Shift+Enter 換行
   * - cmdEnter: ⌘/Ctrl+Enter 送出、Enter 換行
   */
  enterBehavior?: 'enter' | 'cmdEnter'
  /** 底部左側（如代我核准） */
  footerLeft?: ReactNode
  /** 底部右側（如模型/推理強度 pill） */
  footerRight?: ReactNode
  /** Replaces the default attachment button with a contextual + menu. */
  quickActions?: (controls: {
    openFilePicker: () => void
    disabled: boolean
  }) => ReactNode
  /** Enable file/image attachments (default true for agent mode) */
  allowAttachments?: boolean
  /** Show the ChatGPT-style stop action while a run is active. */
  running?: boolean
  onStop?: () => void
  /** Action used when this message is submitted while the thread is running. */
  followUpAction?: FollowUpAction
  /** Runner-specific immediate action offered alongside queue. */
  followUpImmediateAction?: Extract<FollowUpAction, 'steer' | 'takeover'>
  /** Changes only the current Composer submission mode. */
  onFollowUpActionChange?: (action: FollowUpAction) => void
  /** Disposable projection of Host-accepted interactive follow-ups. */
  pendingFollowUps?: readonly PendingFollowUpProjection[]
  onEditPendingFollowUp?: (item: PendingFollowUpProjection, text: string) => void | Promise<void>
  onCancelPendingFollowUp?: (item: PendingFollowUpProjection) => void | Promise<void>
  onMovePendingFollowUp?: (item: PendingFollowUpProjection, direction: 'up' | 'down') => void | Promise<void>
  onQueueRejectedFollowUp?: (item: PendingFollowUpProjection) => void | Promise<void>
}

function composerHasFooter(
  footerLeft: ReactNode,
  footerRight: ReactNode,
  quickActions: CommandComposerProps['quickActions'],
  hideHints: boolean,
): boolean {
  return Boolean(footerLeft || footerRight || quickActions) || !hideHints
}

function useComposerAttachments(scopeKey: string) {
  const [attachmentsByScope, setAttachmentsByScope] = useState<ComposerAttachmentsByScope>({})
  const attachments = attachmentsForComposerScope(attachmentsByScope, scopeKey)
  const setAttachments = useCallback((next: SetStateAction<ChatAttachment[]>) => {
    setAttachmentsByScope((current) => {
      const previous = attachmentsForComposerScope(current, scopeKey)
      const resolved = typeof next === 'function' ? next(previous) : next
      return replaceComposerScopeAttachments(current, scopeKey, resolved)
    })
  }, [scopeKey])
  return [attachments, setAttachments] as const
}

function isSkillSlashCommand(cmd: SlashCommand): boolean {
  return cmd.source === 'skill' && Boolean(cmd.skillName)
}

function hasComposerSubmission(
  line: string,
  attachmentCount: number,
  selectedSkill: SlashCommand | null,
): boolean {
  return Boolean(line || attachmentCount || selectedSkill)
}

function effectiveSubmissionLine(selectedSkill: SlashCommand | null, line: string): string {
  if (!selectedSkill) return line
  return `/${selectedSkill.name}${line ? ` ${line}` : ''}`
}

function SelectedSkillChip({
  skill,
  onRemove,
}: {
  skill: SlashCommand | null
  onRemove: () => void
}) {
  if (!skill) return null
  return (
    <span className="mb-0.5 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control bg-accent-tint px-2 text-[13px] font-medium text-accent-ink shadow-hairline">
      <Icon name="deployed_code" size={16} />
      {skill.displayName || skill.skillName || skill.name}
      <button
        type="button"
        aria-label="移除技能"
        title="移除技能"
        onClick={onRemove}
        className="ml-0.5 flex size-4 items-center justify-center rounded-full text-current opacity-60 hover:bg-hover-2 hover:opacity-100"
      >
        <Icon name="close" size={12} />
      </button>
    </span>
  )
}

function ComposerActionButton({
  stopping,
  canSend,
  enterBehavior,
  actionLabel,
  onAction,
}: {
  stopping: boolean
  canSend: boolean
  enterBehavior: NonNullable<CommandComposerProps['enterBehavior']>
  actionLabel?: string
  onAction: () => void
}) {
  const title = stopping
    ? '停止執行'
    : enterBehavior === 'cmdEnter'
      ? '送出（⌘/Ctrl+Enter）'
      : '送出（Enter）'
  return (
    <button
      type="button"
      data-action={stopping ? 'stop' : 'send'}
      disabled={!stopping && !canSend}
      onClick={onAction}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-control ${stopping ? 'agent-composer-send agent-composer-stop' : 'agent-composer-send'}`}
      aria-label={stopping ? '停止執行' : actionLabel || '送出'}
      title={title}
    >
      <Icon name={stopping ? 'stop' : 'arrow_upward'} size={stopping ? 17 : 18} filled={stopping} />
    </button>
  )
}

const FOLLOW_UP_STATE_LABEL: Record<PendingFollowUpProjection['state'], string> = {
  submitting: '送出中',
  accepted: '已接受',
  queued: '排隊中',
  dispatching: '開始執行',
  rejected: '未接受',
  settled: '已完成',
  cancelled: '已取消',
}

type FollowUpCardHandlers = Pick<CommandComposerProps, 'onEditPendingFollowUp' | 'onCancelPendingFollowUp' | 'onMovePendingFollowUp' | 'onQueueRejectedFollowUp'>

function followUpActionLabel(action: PendingFollowUpProjection['action']): string {
  if (action === 'steer') return '引導'
  if (action === 'takeover') return '中止並接手'
  return '排隊'
}

function followUpSubmissionLabel(action: FollowUpAction): string {
  if (action === 'steer') return '引導目前任務'
  if (action === 'takeover') return '中止並接手'
  return '排到下一個任務'
}

const FOLLOW_UP_ACTION_DESCRIPTION: Record<FollowUpAction, string> = {
  steer: '加入目前執行，在下一個安全邊界套用',
  takeover: '停止目前 CLI，再以這則訊息接手',
  queue: '目前任務完成後，建立下一個 Task run',
}

function FollowUpActionMenu({
  action,
  immediateAction,
  onChange,
}: {
  action: FollowUpAction
  immediateAction: Extract<FollowUpAction, 'steer' | 'takeover'>
  onChange: (action: FollowUpAction) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const options: FollowUpAction[] = [immediateAction, 'queue']

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <span ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        data-follow-up-mode={action}
        aria-label={`送出模式：${followUpSubmissionLabel(action)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex min-h-8 max-w-[9.5rem] items-center gap-1 rounded-control px-2 text-[11px] text-ink-2 hover:bg-hover-1 hover:text-ink focus-visible:bg-hover-1"
      >
        <span className="truncate">{followUpSubmissionLabel(action)}</span>
        <Icon name="expand_more" size={14} />
      </button>
      {open ? (
        <span
          role="menu"
          aria-label="執行中送出模式"
          className="absolute bottom-[calc(100%+0.4rem)] right-0 z-50 w-64 overflow-hidden rounded-card border border-line bg-surface p-1 shadow-lg"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setOpen(false)
            }
          }}
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === action}
              onClick={() => {
                onChange(option)
                setOpen(false)
              }}
              className="flex w-full items-start gap-2 rounded-control px-2.5 py-2 text-left hover:bg-hover-1"
            >
              <Icon name={option === action ? 'check' : 'blank'} size={16} className={option === action ? 'text-accent-ink' : 'opacity-0'} />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{followUpSubmissionLabel(option)}</span>
                <span className="block text-[11px] leading-relaxed text-ink-3">{FOLLOW_UP_ACTION_DESCRIPTION[option]}</span>
              </span>
            </button>
          ))}
        </span>
      ) : null}
    </span>
  )
}

function FollowUpCardControls({ item, movable, movableIndex, handlers }: {
  item: PendingFollowUpProjection; movable: readonly PendingFollowUpProjection[]; movableIndex: number; handlers: FollowUpCardHandlers
}) {
  const { onEditPendingFollowUp: onEdit, onCancelPendingFollowUp: onCancel, onMovePendingFollowUp: onMove, onQueueRejectedFollowUp: onQueueRejected } = handlers
  const edit = () => {
    const next = window.prompt('編輯排隊指令', item.text)
    if (next?.trim() && next.trim() !== item.text) void onEdit?.(item, next.trim())
  }
  return <>
    {item.reorderable && onMove ? <span className="flex shrink-0 items-center">
      <button type="button" disabled={movableIndex <= 0} onClick={() => void onMove(item, 'up')} className="flex size-8 items-center justify-center text-ink-3 hover:text-ink disabled:opacity-25" aria-label={`上移：${item.text}`} title="上移"><Icon name="keyboard_arrow_up" size={16} /></button>
      <button type="button" disabled={movableIndex < 0 || movableIndex === movable.length - 1} onClick={() => void onMove(item, 'down')} className="flex size-8 items-center justify-center text-ink-3 hover:text-ink disabled:opacity-25" aria-label={`下移：${item.text}`} title="下移"><Icon name="keyboard_arrow_down" size={16} /></button>
    </span> : null}
    {item.state === 'rejected' && item.action !== 'queue' && onQueueRejected ? <button type="button" onClick={() => void onQueueRejected(item)} className="min-h-8 shrink-0 px-2 text-[12px] text-accent-ink hover:bg-hover-1" aria-label={`改為排隊：${item.text}`} title="改為排隊">改排隊</button> : null}
    {item.editable && onEdit ? <button type="button" onClick={edit} className="flex size-8 shrink-0 items-center justify-center text-ink-3 hover:text-ink" aria-label={`編輯：${item.text}`} title="編輯"><Icon name="edit" size={14} /></button> : null}
    {item.cancellable && onCancel ? <button type="button" onClick={() => void onCancel(item)} className="flex size-8 shrink-0 items-center justify-center text-ink-3 hover:text-red" aria-label={`刪除：${item.text}`} title="刪除"><Icon name="delete" size={14} /></button> : null}
  </>
}

function PendingFollowUpCard({ item, items, expanded, onToggle, handlers }: {
  item: PendingFollowUpProjection; items: readonly PendingFollowUpProjection[]; expanded: boolean; onToggle: () => void; handlers: FollowUpCardHandlers
}) {
  const movable = items.filter((candidate) => candidate.reorderable && candidate.sessionId === item.sessionId)
  const movableIndex = movable.findIndex((candidate) => candidate.id === item.id)
  const queuePosition = item.action === 'queue' && movableIndex >= 0 ? movableIndex + 1 : undefined
  const title = item.reason ? `${item.text}\n${item.reason}` : item.text
  return <div className="group flex min-w-0 max-w-full flex-wrap items-center gap-2 rounded-control px-2 py-1.5 hover:bg-hover-1">
    <Icon name={item.action === 'steer' ? 'alt_route' : 'subdirectory_arrow_right'} size={15} className="shrink-0 text-ink-3" />
    <button type="button" aria-expanded={expanded} onClick={onToggle} className={`min-h-8 min-w-0 flex-1 basis-40 text-left text-[13px] text-ink ${expanded ? 'basis-full whitespace-pre-wrap break-words' : 'truncate'}`} title={title}>{item.text}</button>
    <span className={`shrink-0 text-[11px] ${item.action === 'steer' ? 'text-accent-ink' : 'text-ink-3'}`}>
      {followUpActionLabel(item.action)}{queuePosition ? ` · 第 ${queuePosition} 位` : ''} · {FOLLOW_UP_STATE_LABEL[item.state]}{item.attachmentCount ? ` · 附件 ${item.attachmentCount}` : ''}
    </span>
    <FollowUpCardControls item={item} movable={movable} movableIndex={movableIndex} handlers={handlers} />
  </div>
}

function PendingFollowUpCards({
  items,
  onEdit,
  onCancel,
  onMove,
  onQueueRejected,
}: {
  items: readonly PendingFollowUpProjection[]
  onEdit?: CommandComposerProps['onEditPendingFollowUp']
  onCancel?: CommandComposerProps['onCancelPendingFollowUp']
  onMove?: CommandComposerProps['onMovePendingFollowUp']
  onQueueRejected?: CommandComposerProps['onQueueRejectedFollowUp']
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const toggleExpanded = (id: string) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  if (items.length === 0) return null
  return (
    <div className="min-w-0 max-w-full border-b border-line px-2.5 py-2" aria-label="待處理的後續指令">
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        待處理後續指令 {items.length} 筆；最新狀態 {FOLLOW_UP_STATE_LABEL[items.at(-1)?.state || 'queued']}
      </span>
      <div className="space-y-1">
        {items.map((item) => <PendingFollowUpCard key={item.id} item={item} items={items} expanded={expanded.has(item.id)} onToggle={() => toggleExpanded(item.id)} handlers={{ onEditPendingFollowUp: onEdit, onCancelPendingFollowUp: onCancel, onMovePendingFollowUp: onMove, onQueueRejectedFollowUp: onQueueRejected }} />)}
      </div>
    </div>
  )
}

function ComposerActions({
  running,
  canSend,
  enterBehavior,
  followUpAction,
  followUpImmediateAction,
  onFollowUpActionChange,
  onSend,
  onStop,
}: {
  running: boolean
  canSend: boolean
  enterBehavior: NonNullable<CommandComposerProps['enterBehavior']>
  followUpAction?: FollowUpAction
  followUpImmediateAction?: Extract<FollowUpAction, 'steer' | 'takeover'>
  onFollowUpActionChange?: (action: FollowUpAction) => void
  onSend: () => void
  onStop?: () => void
}) {
  const actionLabel = followUpAction ? followUpSubmissionLabel(followUpAction) : undefined
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {followUpAction && followUpImmediateAction && onFollowUpActionChange ? (
        <FollowUpActionMenu action={followUpAction} immediateAction={followUpImmediateAction} onChange={onFollowUpActionChange} />
      ) : null}
      <ComposerActionButton stopping={false} canSend={canSend} enterBehavior={enterBehavior} actionLabel={actionLabel} onAction={onSend} />
      {running && onStop ? (
        <ComposerActionButton stopping canSend enterBehavior={enterBehavior} onAction={onStop} />
      ) : null}
    </span>
  )
}

type ComposerKeyEvent = KeyboardEvent<HTMLTextAreaElement>

function consumeMentionKey(event: ComposerKeyEvent, input: {
  open: boolean; items: readonly (typeof DATA_SOURCES)[number][]; index: number
  setIndex: (next: SetStateAction<number>) => void; close: () => void
  select: (source: (typeof DATA_SOURCES)[number]) => void
}): boolean {
  if (!input.open) return false
  if (event.key === 'Escape') { event.preventDefault(); input.close(); return true }
  if (input.items.length === 0) return false
  if (event.key === 'ArrowDown') { event.preventDefault(); input.setIndex((index) => Math.min(input.items.length - 1, index + 1)); return true }
  if (event.key === 'ArrowUp') { event.preventDefault(); input.setIndex((index) => Math.max(0, index - 1)); return true }
  if (event.key !== 'Tab' && (event.key !== 'Enter' || event.shiftKey)) return false
  event.preventDefault()
  const source = input.items[Math.min(input.index, input.items.length - 1)]
  if (source) input.select(source)
  return true
}

function consumeSlashKey(event: ComposerKeyEvent, input: {
  open: boolean; items: readonly SlashCommand[]; index: number
  setIndex: (next: SetStateAction<number>) => void; close: () => void
  select: (command: SlashCommand) => void
}): boolean {
  if (!input.open) return false
  if (event.key === 'Escape') { event.preventDefault(); input.close(); return true }
  if (input.items.length === 0) return false
  if (event.key === 'ArrowDown') { event.preventDefault(); input.setIndex((index) => Math.min(input.items.length - 1, index + 1)); return true }
  if (event.key === 'ArrowUp') { event.preventDefault(); input.setIndex((index) => Math.max(0, index - 1)); return true }
  if (event.key !== 'Tab' && (event.key !== 'Enter' || event.shiftKey)) return false
  event.preventDefault()
  const command = input.items[input.index]
  if (command) input.select(command)
  return true
}

function consumeHistoryKey(event: ComposerKeyEvent, input: {
  menuOpen: boolean; element: HTMLTextAreaElement | null; value: string; historyIndex: number
  browse: (direction: 'up' | 'down') => void
}): boolean {
  if (input.menuOpen || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return false
  const atStart = !input.element || input.element.selectionStart === 0
  const atEnd = !input.element || input.element.selectionStart === input.value.length
  if (event.key === 'ArrowUp' && (atStart || !input.value.includes('\n'))) {
    event.preventDefault(); input.browse('up'); return true
  }
  const canBrowseDown = atEnd || input.historyIndex >= 0 || !input.value.includes('\n')
  if (event.key === 'ArrowDown' && canBrowseDown && (input.historyIndex >= 0 || !input.value)) {
    event.preventDefault(); input.browse('down'); return true
  }
  return false
}

function consumeSubmitKey(event: ComposerKeyEvent, behavior: NonNullable<CommandComposerProps['enterBehavior']>, submit: () => void): boolean {
  if (event.key !== 'Enter') return false
  const modified = event.metaKey || event.ctrlKey
  const shouldSubmit = behavior === 'cmdEnter' ? modified && !event.shiftKey : !event.shiftKey && !modified
  if (shouldSubmit) { event.preventDefault(); submit() }
  return true
}

function ComposerMentionMenu({ open, items, index, onIndex, onSelect }: {
  open: boolean; items: readonly (typeof DATA_SOURCES)[number][]; index: number
  onIndex: (index: number) => void; onSelect: (source: (typeof DATA_SOURCES)[number]) => void
}) {
  if (!open) return null
  return <div className="absolute bottom-full left-0 right-0 z-[80] mb-2 overflow-hidden rounded-card bg-surface p-1 shadow-raised" role="listbox" aria-label="資料來源" style={{ animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both' }}>
    <div className="flex items-center gap-2 border-b border-line px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
      <Icon name="alternate_email" size={13} className="text-accent-ink" />資料來源
      <span className="ml-auto normal-case tracking-normal font-normal">↑↓ 選擇 · Enter 插入</span>
    </div>
    <div className="relative py-1">
      {items.length === 0 ? <div className="px-2 py-3 text-center text-[12px] text-ink-3">沒有相符的來源</div> : items.map((source, itemIndex) => {
        const selected = itemIndex === Math.min(index, items.length - 1)
        return <button key={source.key} type="button" role="option" aria-selected={selected} onMouseEnter={() => onIndex(itemIndex)} onClick={() => onSelect(source)} className={`relative z-10 flex h-9 w-full items-center gap-2.5 rounded-control px-2 text-left transition-colors ${selected ? 'bg-hover-2' : 'hover:bg-hover-2'}`}>
          <span className="flex size-5.5 shrink-0 items-center justify-center rounded-[6px] bg-inset text-ink-2 shadow-hairline"><Icon name={source.icon} size={14} /></span>
          <span className="shrink-0 text-[12.5px] font-medium text-ink">{source.name}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{source.desc}</span>
        </button>
      })}
    </div>
  </div>
}

function ComposerAttachments({ enabled, attachments, error, dragOver, fileRef, onAdd, onRemove }: {
  enabled: boolean; attachments: readonly ChatAttachment[]; error: string | null; dragOver: boolean
  fileRef: RefObject<HTMLInputElement | null>; onAdd: (files: FileList | null) => void; onRemove: (id: string) => void
}) {
  return <>
    {enabled && attachments.length > 0 ? <div className="flex flex-wrap gap-2 px-3 pt-3">{attachments.map((attachment) => <ComposerAttachment key={attachment.id} attachment={attachment} onRemove={onRemove} />)}</div> : null}
    {error || dragOver ? <p className={`px-3 pt-2 text-[11px] ${error ? 'text-red' : 'text-accent-ink'}`}>{error || '放開以加入附件'}</p> : null}
    {enabled ? <input ref={fileRef} type="file" className="hidden" multiple accept="image/*,.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.log,.yml,.yaml,.xml,.html,.css,.sql" onChange={(event) => { onAdd(event.target.files); event.target.value = '' }} /> : null}
  </>
}

function ComposerAttachment({ attachment, onRemove }: { attachment: ChatAttachment; onRemove: (id: string) => void }) {
  const kind = attachment.kind === 'image' ? '圖片' : attachment.kind === 'text' ? '文字' : '檔案'
  return <div className="relative group flex items-center gap-2 rounded-chip border border-line bg-field pl-1.5 pr-2 py-1.5 max-w-[220px] shadow-hairline">
    {attachment.kind === 'image' && attachment.dataUrl
      ? <img src={attachment.dataUrl} alt={attachment.name} className="w-10 h-10 rounded-control object-cover shrink-0 bg-inset" />
      : <div className="w-10 h-10 rounded-control bg-inset flex items-center justify-center shrink-0"><Icon name={attachment.kind === 'text' ? 'description' : 'draft'} size={18} className="text-ink-3" /></div>}
    <div className="min-w-0 flex-1"><p className="text-[11px] font-medium text-ink truncate" title={attachment.name}>{attachment.name}</p><p className="text-[10px] text-ink-3">{kind} · {formatBytes(attachment.size)}</p></div>
    <button type="button" title="移除" onClick={() => onRemove(attachment.id)} className="w-6 h-6 rounded-control text-ink-3 hover:text-red hover:bg-red-tint flex items-center justify-center shrink-0"><Icon name="close" size={14} /></button>
  </div>
}

function ComposerFooter({ quickActions, fileRef, disabled, attaching, attachmentCount, listening, onDictation, footerLeft, footerRight, hideHints, canAttach, commandCount, actionButton }: {
  quickActions: CommandComposerProps['quickActions']; fileRef: RefObject<HTMLInputElement | null>; disabled?: boolean; attaching: boolean; attachmentCount: number
  listening: boolean; onDictation: () => void; footerLeft: ReactNode; footerRight: ReactNode; hideHints: boolean; canAttach: boolean; commandCount: number; actionButton: ReactNode
}) {
  const quick = quickActions?.({ openFilePicker: () => fileRef.current?.click(), disabled: Boolean(disabled || attaching || attachmentCount >= MAX_ATTACHMENTS) })
  return <div className="px-3 pb-2.5 flex items-center justify-between gap-2 min-h-[32px]">
    <div className="flex items-center gap-2 min-w-0 flex-wrap">
      {quick}
      <button type="button" aria-label={listening ? '停止語音輸入' : '開始語音輸入'} aria-pressed={listening} onClick={onDictation} className={`flex size-7 items-center justify-center rounded-control transition-colors ${listening ? 'bg-accent-tint text-accent-ink' : 'text-ink-3 hover:bg-hover-2 hover:text-ink'}`} title={listening ? '停止語音輸入' : '語音輸入'}>
        {listening ? <span className="flex h-3.5 items-center gap-[2.5px]">{[0, 1, 2].map((index) => <span key={index} className="w-[2.5px] rounded-full bg-current" style={{ height: '100%', animation: `eq-bounce 900ms ease-in-out ${index * 150}ms infinite` }} />)}</span> : <Icon name="mic" size={15} />}
      </button>
      {footerLeft}
      {!hideHints && !footerLeft ? <ComposerHints canAttach={canAttach} /> : null}
    </div>
    <div className="flex items-center gap-2 shrink-0">{footerRight}{!footerRight && !hideHints ? <span className="text-[10px] text-accent-ink">{commandCount} 指令</span> : null}{actionButton}</div>
  </div>
}

function ComposerHints({ canAttach }: { canAttach: boolean }) {
  return <span className="text-[10px] text-ink-3 flex items-center gap-1.5"><kbd className="px-1 py-0.5 rounded bg-inset border border-line font-[family-name:var(--font-mono)]">⌘/</kbd><span>指令</span>{canAttach ? <><span className="opacity-40">·</span><Icon name="attach_file" size={12} /><span>貼圖/拖放</span></> : null}<span className="opacity-40">·</span><span>↑ 歷史</span></span>
}

type ComposerSurfaceProps = FollowUpCardHandlers & {
  compact?: boolean; dragOver: boolean; primary: boolean; mode: ComposerMode; canAttach: boolean; running: boolean
  pendingFollowUps: readonly PendingFollowUpProjection[]; showMentionMenu: boolean; mentionItems: readonly (typeof DATA_SOURCES)[number][]; mentionIndex: number
  setMentionIndex: (index: number) => void; pickMention: (source: (typeof DATA_SOURCES)[number]) => void
  showMenu: boolean; filtered: SlashCommand[]; safeIndex: number; applyCommand: (command: SlashCommand) => void; setActiveIndex: (index: number) => void; slashQuery: string | null
  attachments: readonly ChatAttachment[]; attachError: string | null; fileRef: RefObject<HTMLInputElement | null>; addFiles: (files: FileList | null) => void; removeAttachment: (id: string) => void
  selectedSkill: SlashCommand | null; setSelectedSkill: (skill: SlashCommand | null) => void; taRef: RefObject<HTMLTextAreaElement | null>; value: string; disabled?: boolean
  onInput: (value: string) => void; onKeyDown: (event: ComposerKeyEvent) => void; onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void; onFocus: () => void
  placeholder: string; hasFooter: boolean; actionButton: ReactNode; quickActions: CommandComposerProps['quickActions']; attaching: boolean; listening: boolean
  toggleDictation: () => void; footerLeft: ReactNode; footerRight: ReactNode; hideHints: boolean; commandCount: number
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void; onDragOver: (event: DragEvent<HTMLDivElement>) => void; onDrop: (event: DragEvent<HTMLDivElement>) => void; onDragLeave: () => void
}

function ComposerSurface(props: ComposerSurfaceProps) {
  return <div className={`agent-composer relative w-full max-w-full min-w-0 box-border border bg-surface ${props.compact ? 'rounded-control' : 'rounded-card'} ${props.dragOver ? 'border-accent/60 bg-accent-tint' : 'border-line'}`} data-composer={props.primary ? 'primary' : props.mode} onDragEnter={props.onDragEnter} onDragOver={props.onDragOver} onDragLeave={props.onDragLeave} onDrop={props.onDrop}>
    <ComposerLoader active={props.running} />
    <PendingFollowUpCards items={props.pendingFollowUps} onEdit={props.onEditPendingFollowUp} onCancel={props.onCancelPendingFollowUp} onMove={props.onMovePendingFollowUp} onQueueRejected={props.onQueueRejectedFollowUp} />
    <ComposerMentionMenu open={props.showMentionMenu} items={props.mentionItems} index={props.mentionIndex} onIndex={props.setMentionIndex} onSelect={props.pickMention} />
    <SlashCommandMenu open={props.showMenu} items={props.filtered} activeIndex={props.safeIndex} onSelect={props.applyCommand} onHover={props.setActiveIndex} anchor="bottom" query={props.slashQuery ?? ''} />
    <ComposerAttachments enabled={props.canAttach} attachments={props.attachments} error={props.attachError} dragOver={props.dragOver} fileRef={props.fileRef} onAdd={props.addFiles} onRemove={props.removeAttachment} />
    <div className={`flex items-end gap-2 ${props.compact ? 'p-2' : 'px-3 py-3 md:px-3.5'}`}>
      <SelectedSkillChip skill={props.selectedSkill} onRemove={() => props.setSelectedSkill(null)} />
      <textarea ref={props.taRef} value={props.value} disabled={props.disabled} onChange={(event) => props.onInput(event.target.value)} onKeyDown={props.onKeyDown} onPaste={props.onPaste} onFocus={props.onFocus} rows={2} placeholder={props.canAttach ? props.placeholder || '輸入任務，或貼上／拖放圖片…' : props.placeholder} className="composer-field flex-1 min-w-0 self-stretch border-0 bg-transparent shadow-none resize-none overflow-y-auto outline-none ring-0 focus:outline-none focus-visible:outline-none focus:ring-0 text-[14px] text-ink placeholder:text-ink-3 leading-relaxed font-[family-name:var(--font-inter)]" spellCheck={false} />
      {!props.hasFooter ? <div className="flex shrink-0 pb-0.5">{props.actionButton}</div> : null}
    </div>
    {props.hasFooter ? <ComposerFooter quickActions={props.quickActions} fileRef={props.fileRef} disabled={props.disabled} attaching={props.attaching} attachmentCount={props.attachments.length} listening={props.listening} onDictation={props.toggleDictation} footerLeft={props.footerLeft} footerRight={props.footerRight} hideHints={props.hideHints} canAttach={props.canAttach} commandCount={props.commandCount} actionButton={props.actionButton} /> : null}
  </div>
}

/**
 * Codex / Claude Code 風格輸入列：/ 指令、↑ 歷史、Cmd+/ 聚焦、貼圖/上傳
 */
export function CommandComposer({
  scopeKey,
  value,
  onChange,
  onSubmitLine,
  onSlashCommand,
  placeholder = '詢問任何事，或輸入 / 開啟指令…',
  disabled,
  compact,
  mode = 'workspace',
  primary = false,
  hideHints = false,
  autoFocus = false,
  enterBehavior = 'enter',
  footerLeft,
  footerRight,
  quickActions,
  allowAttachments,
  running = false,
  onStop,
  followUpAction,
  followUpImmediateAction,
  onFollowUpActionChange,
  pendingFollowUps = [],
  onEditPendingFollowUp,
  onCancelPendingFollowUp,
  onMovePendingFollowUp,
  onQueueRejectedFollowUp,
}: CommandComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // React state cannot close the same-event-loop double-click/Enter window:
  // both handlers can retain the same non-empty value before a re-render.
  // This imperative lease spans the caller's whole admission promise.
  const submitInFlightRef = useRef(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedSkill, setSelectedSkill] = useState<SlashCommand | null>(null)
  const skillCatalog = useLearningStore((state) => state.skillCatalog)
  const [attachments, setAttachments] = useComposerAttachments(scopeKey)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<DictationRecognition | null>(null)

  useEffect(() => {
    return () => recognitionRef.current?.stop()
  }, [])

  useEffect(() => {
    setSelectedSkill(null)
  }, [scopeKey])
  /** -1 = not browsing history */
  const histIdx = useRef(-1)
  const draftBeforeHist = useRef('')
  const history = useCommandHistoryStore((s) => s.items)
  const pushHistory = useCommandHistoryStore((s) => s.push)

  const canAttach = allowAttachments ?? mode === 'agent'

  const slashQuery = useMemo(() => {
    const line = value
    if (!line.startsWith('/')) return null
    const after = line.slice(1)
    if (after.includes(' ') || after.includes('\n')) return null
    return after
  }, [value])

  const filtered = useMemo(() => {
    if (slashQuery === null) return []
    return filterSlashCommands(slashQuery, [], skillCatalog)
  }, [skillCatalog, slashQuery])
  const commandCount = useMemo(
    () => getAllSlashCommands([], skillCatalog).length,
    [skillCatalog],
  )

  const showMenu = menuOpen && slashQuery !== null
  const safeIndex =
    filtered.length === 0 ? 0 : Math.min(activeIndex, Math.max(0, filtered.length - 1))

  const mentionToken = useMemo(() => {
    const match = /(^|\s)@([\w-]*)$/.exec(value)
    if (!match) return null
    return { query: match[2].toLowerCase(), start: match.index + match[1].length }
  }, [value])

  const mentionItems = useMemo(() => {
    if (!mentionToken) return []
    return DATA_SOURCES.filter(
      (source) =>
        source.name.toLowerCase().includes(mentionToken.query) ||
        source.key.includes(mentionToken.query),
    )
  }, [mentionToken])

  const showMentionMenu = mentionOpen && mentionToken !== null

  const focusSelf = useCallback(
    (openSlash?: boolean) => {
      const el = taRef.current
      if (!el) return
      el.focus()
      if (openSlash) {
        if (!value.startsWith('/')) onChange('/')
        setMenuOpen(true)
        setActiveIndex(0)
        requestAnimationFrame(() => {
          const t = taRef.current
          if (t) {
            const len = t.value.length
            t.setSelectionRange(len, len)
          }
        })
      }
    },
    [onChange, value],
  )

  useEffect(() => {
    if (!primary && !autoFocus) return
    if (autoFocus) {
      requestAnimationFrame(() => taRef.current?.focus())
    }
  }, [autoFocus, primary])

  useEffect(() => {
    if (!primary) return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ openSlash?: boolean }>).detail
      focusSelf(detail?.openSlash !== false)
    }
    window.addEventListener(FOCUS_COMPOSER_EVENT, handler)
    return () => window.removeEventListener(FOCUS_COMPOSER_EVENT, handler)
  }, [primary, focusSelf])

  const addFiles = useCallback(
    async (files: FileList | File[] | null | undefined) => {
      if (!canAttach || !files || (files as FileList).length === 0) return
      setAttaching(true)
      setAttachError(null)
      try {
        const { ok, errors } = await filesToAttachments(files, attachments.length)
        if (ok.length) {
          setAttachments((prev) => [...prev, ...ok].slice(0, MAX_ATTACHMENTS))
        }
        if (errors.length) setAttachError(errors[0] || null)
      } catch (e) {
        setAttachError(e instanceof Error ? e.message : String(e))
      } finally {
        setAttaching(false)
      }
    },
    [attachments.length, canAttach, setAttachments],
  )

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [setAttachments])

  const applyCommand = useCallback(
    (cmd: SlashCommand) => {
      if (attachments.length > 0) {
        setAttachError('斜線指令不會使用附件；請先移除附件，或改用一般訊息送出。')
        return
      }
      if (isSkillSlashCommand(cmd)) {
        setSelectedSkill(cmd)
        onChange('')
        setMenuOpen(false)
        histIdx.current = -1
        taRef.current?.focus()
        return
      }
      setSelectedSkill(null)
      const next = cmd.needsArgs || cmd.argsHint ? `/${cmd.name} ` : `/${cmd.name}`
      onChange(next)
      setMenuOpen(false)
      histIdx.current = -1
      taRef.current?.focus()
      if (!cmd.needsArgs && !cmd.argsHint) {
        pushHistory(`/${cmd.name}`)
        void onSlashCommand(cmd, '', `/${cmd.name}`)
        onChange('')
      }
    },
    [attachments.length, onChange, onSlashCommand, pushHistory],
  )

  const pickMention = useCallback(
    (source: (typeof DATA_SOURCES)[number]) => {
      const token = mentionToken
      const next = token
        ? `${value.slice(0, token.start)}@${source.name} `
        : `${value}@${source.name} `
      onChange(next)
      setMentionOpen(false)
      setMentionIndex(0)
      taRef.current?.focus()
    },
    [mentionToken, onChange, value],
  )

  const toggleDictation = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }

    const speechWindow = window as DictationWindow
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!Recognition) {
      setAttachError('此環境不支援語音輸入，請改用鍵盤輸入。')
      window.setTimeout(() => setAttachError(null), 2400)
      return
    }

    const recognition = new Recognition()
    recognition.lang = 'zh-TW'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = (event) => {
      const results = (event as { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }).results
      const transcript = results
        ? Array.from(results)
            .map((result) => result?.[0]?.transcript || '')
            .join(' ')
            .trim()
        : ''
      if (transcript) onChange(value ? `${value.trimEnd()} ${transcript}` : transcript)
    }
    recognition.onend = () => {
      setListening(false)
      recognitionRef.current = null
    }
    recognition.onerror = () => {
      setListening(false)
      recognitionRef.current = null
      setAttachError('語音輸入沒有收到內容，請再試一次。')
      window.setTimeout(() => setAttachError(null), 2400)
    }
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }, [listening, onChange, value])

  const submit = useCallback(async () => {
    const line = value.trim()
    if (disabled || attaching) return
    if (!hasComposerSubmission(line, attachments.length, selectedSkill)) return
    if (submitInFlightRef.current) return
    submitInFlightRef.current = true
    try {
      const submissionLine = effectiveSubmissionLine(selectedSkill, line)
      if (submissionLine.startsWith('/')) {
        if (attachments.length > 0) {
          setAttachError('斜線指令不會使用附件；請先移除附件，或改用一般訊息送出。')
          return
        }
        pushHistory(submissionLine)
        setMentionOpen(false)
        const parsed = parseSlashLine(submissionLine)
        setSelectedSkill(null)
        onChange('')
        if (parsed) {
          const cmd = resolveSlashCommand(parsed.cmd, [], skillCatalog)
          if (cmd) {
            setMenuOpen(false)
            await onSlashCommand(cmd, parsed.args, parsed.raw)
            return
          }
          await onSlashCommand(
            { name: parsed.cmd, description: '', category: 'session' },
            parsed.args,
            parsed.raw,
          )
          return
        }
      }
      // 先清輸入再送出：送出管線再慢或拋錯，都不該把已送出的字留在框裡。
      const toSend = attachments
      setAttachments([])
      setAttachError(null)
      histIdx.current = -1
      pushHistory(line || `（${attachments.length} 個附件）`)
      setMenuOpen(false)
      onChange('')
      await onSubmitLine(line, toSend)
    } finally {
      submitInFlightRef.current = false
    }
  }, [
    value,
    disabled,
    attaching,
    attachments,
    selectedSkill,
    skillCatalog,
    onChange,
    onSlashCommand,
    onSubmitLine,
    pushHistory,
    setAttachments,
  ])

  const browseHistory = (dir: 'up' | 'down') => {
    if (!history.length) return
    if (histIdx.current === -1 && dir === 'up') {
      draftBeforeHist.current = value
      histIdx.current = 0
      onChange(history[0] || '')
      setMenuOpen(false)
      return
    }
    if (dir === 'up') {
      const next = Math.min(history.length - 1, histIdx.current + 1)
      histIdx.current = next
      onChange(history[next] || '')
      setMenuOpen(false)
      return
    }
    // down
    if (histIdx.current <= 0) {
      histIdx.current = -1
      onChange(draftBeforeHist.current)
      return
    }
    const next = histIdx.current - 1
    histIdx.current = next
    onChange(history[next] || '')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 組字中（注音/中文確認、keyCode 229）：Enter 是「確認組字」不是送出，
    // 方向鍵與 Escape 也屬於組字操作，一律不觸發編輯器的快捷行為。
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (consumeMentionKey(e, { open: showMentionMenu, items: mentionItems, index: mentionIndex, setIndex: setMentionIndex, close: () => setMentionOpen(false), select: pickMention })) return
    if (consumeSlashKey(e, { open: showMenu, items: filtered, index: safeIndex, setIndex: setActiveIndex, close: () => { setMenuOpen(false); setMentionOpen(false) }, select: applyCommand })) return
    if (consumeHistoryKey(e, { menuOpen: showMenu, element: taRef.current, value, historyIndex: histIdx.current, browse: browseHistory })) return
    consumeSubmitKey(e, enterBehavior, () => void submit())
  }

  const onInput = (v: string) => {
    // User is editing → exit history browse mode
    if (histIdx.current >= 0 && v !== history[histIdx.current]) {
      histIdx.current = -1
    }
    onChange(v)
    if (v.startsWith('/')) {
      setMenuOpen(true)
      setMentionOpen(false)
      setActiveIndex(0)
    } else if (/(^|\s)@[\w-]*$/.test(v)) {
      setMenuOpen(false)
      setMentionOpen(true)
      setMentionIndex(0)
    } else {
      setMenuOpen(false)
      setMentionOpen(false)
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!canAttach) return
    const items = e.clipboardData?.items
    if (!items?.length) return
    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    }
    if (!files.length) return
    // Prefer attaching files over pasting binary garbage into textarea
    e.preventDefault()
    void addFiles(files)
  }

  const onDrop = (e: DragEvent) => {
    if (!canAttach) return
    e.preventDefault()
    setDragOver(false)
    void addFiles(e.dataTransfer?.files)
  }

  const canSend = !disabled && !attaching && (Boolean(value.trim()) || attachments.length > 0)

  // textarea 隨內容長高（上限 10 行），超過後內部捲動。
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    const style = window.getComputedStyle(el)
    const lineHeight = parseFloat(style.lineHeight) || 22
    const padY =
      (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
    const minHeight = lineHeight * 2 + padY
    const maxHeight = lineHeight * 10 + padY
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minHeight), maxHeight)}px`
  }, [value, compact])

  const actionButton = <ComposerActions
    running={running}
    canSend={canSend}
    enterBehavior={enterBehavior}
    followUpAction={followUpAction}
    followUpImmediateAction={followUpImmediateAction}
    onFollowUpActionChange={onFollowUpActionChange}
    onSend={() => void submit()}
    onStop={onStop}
  />

  /** 底欄是否存在（模型選擇器等 footer 內容會渲染） */
  const hasFooter = composerHasFooter(footerLeft, footerRight, quickActions, hideHints)

  const allowDrag = (event: DragEvent<HTMLDivElement>) => {
    if (!canAttach) return
    event.preventDefault()
    setDragOver(true)
  }
  const focusInput = () => {
    if (value.startsWith('/')) setMenuOpen(true)
    if (/(^|\s)@[\w-]*$/.test(value)) setMentionOpen(true)
  }
  return <ComposerSurface
    compact={compact} dragOver={dragOver} primary={primary} mode={mode} canAttach={canAttach} running={running}
    pendingFollowUps={pendingFollowUps} onEditPendingFollowUp={onEditPendingFollowUp} onCancelPendingFollowUp={onCancelPendingFollowUp} onMovePendingFollowUp={onMovePendingFollowUp} onQueueRejectedFollowUp={onQueueRejectedFollowUp}
    showMentionMenu={showMentionMenu} mentionItems={mentionItems} mentionIndex={mentionIndex} setMentionIndex={setMentionIndex} pickMention={pickMention}
    showMenu={showMenu} filtered={filtered} safeIndex={safeIndex} applyCommand={applyCommand} setActiveIndex={setActiveIndex} slashQuery={slashQuery}
    attachments={attachments} attachError={attachError} fileRef={fileRef} addFiles={(files) => void addFiles(files)} removeAttachment={removeAttachment}
    selectedSkill={selectedSkill} setSelectedSkill={setSelectedSkill} taRef={taRef} value={value} disabled={disabled} onInput={onInput} onKeyDown={onKeyDown} onPaste={onPaste} onFocus={focusInput}
    placeholder={placeholder} hasFooter={hasFooter} actionButton={actionButton} quickActions={quickActions} attaching={attaching} listening={listening} toggleDictation={toggleDictation}
    footerLeft={footerLeft} footerRight={footerRight} hideHints={hideHints} commandCount={commandCount}
    onDragEnter={allowDrag} onDragOver={allowDrag} onDragLeave={() => setDragOver(false)} onDrop={onDrop}
  />
}
