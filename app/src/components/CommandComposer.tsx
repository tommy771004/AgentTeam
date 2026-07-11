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
} from 'react'
import { Icon } from './Icon'
import { SlashCommandMenu } from './SlashCommandMenu'
import {
  filterSlashCommands,
  parseSlashLine,
  resolveSlashCommand,
  type SlashCommand,
  getLiveSlashCommands,
} from '../commands/registry'
import {
  FOCUS_COMPOSER_EVENT,
  useCommandHistoryStore,
} from '../store/commandHistoryStore'
import type { ChatAttachment } from '../agent/types'
import {
  filesToAttachments,
  formatBytes,
  MAX_ATTACHMENTS,
} from '../lib/chatAttachments'

export type ComposerMode = 'agent' | 'workspace'

export interface CommandComposerProps {
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
}

/**
 * Codex / Claude Code 風格輸入列：/ 指令、↑ 歷史、Cmd+/ 聚焦、貼圖/上傳
 */
export function CommandComposer({
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
}: CommandComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [attaching, setAttaching] = useState(false)
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
    return filterSlashCommands(slashQuery)
  }, [slashQuery])

  const showMenu = menuOpen && slashQuery !== null
  const safeIndex =
    filtered.length === 0 ? 0 : Math.min(activeIndex, Math.max(0, filtered.length - 1))

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
    [attachments.length, canAttach],
  )

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const applyCommand = useCallback(
    (cmd: SlashCommand) => {
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
    [onChange, onSlashCommand, pushHistory],
  )

  const submit = useCallback(async () => {
    const line = value.trim()
    if (disabled || attaching) return
    if (!line && !attachments.length) return
    // Slash commands ignore attachments for now
    if (line.startsWith('/')) {
      pushHistory(line)
      histIdx.current = -1
      const parsed = parseSlashLine(line)
      if (parsed) {
        const cmd = resolveSlashCommand(parsed.cmd)
        if (cmd) {
          setMenuOpen(false)
          await onSlashCommand(cmd, parsed.args, parsed.raw)
          onChange('')
          return
        }
        await onSlashCommand(
          { name: parsed.cmd, description: '', category: 'session' },
          parsed.args,
          parsed.raw,
        )
        onChange('')
        return
      }
    }
    pushHistory(line || `（${attachments.length} 個附件）`)
    histIdx.current = -1
    const toSend = attachments
    setAttachments([])
    setAttachError(null)
    await onSubmitLine(line, toSend)
    onChange('')
  }, [
    value,
    disabled,
    attaching,
    attachments,
    onChange,
    onSlashCommand,
    onSubmitLine,
    pushHistory,
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
    if (showMenu && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(filtered.length - 1, i + 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(0, i - 1))
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        const cmd = filtered[safeIndex]
        if (cmd) applyCommand(cmd)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMenuOpen(false)
        return
      }
    } else if (showMenu && e.key === 'Escape') {
      e.preventDefault()
      setMenuOpen(false)
      return
    }

    // History: ↑ when menu closed, cursor at start (or empty)
    if (!showMenu && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const el = taRef.current
      const atStart = !el || el.selectionStart === 0
      const atEnd = !el || el.selectionStart === value.length
      if (e.key === 'ArrowUp' && (atStart || !value.includes('\n'))) {
        e.preventDefault()
        browseHistory('up')
        return
      }
      if (e.key === 'ArrowDown' && (atEnd || histIdx.current >= 0 || !value.includes('\n'))) {
        if (histIdx.current >= 0 || !value) {
          e.preventDefault()
          browseHistory('down')
          return
        }
      }
    }

    if (e.key === 'Enter') {
      const mod = e.metaKey || e.ctrlKey
      if (enterBehavior === 'cmdEnter') {
        // ChatGPT: ⌘/Ctrl+Enter sends; bare Enter inserts newline
        if (mod && !e.shiftKey) {
          e.preventDefault()
          void submit()
        }
        return
      }
      // Default: Enter sends; Shift+Enter newline
      if (!e.shiftKey && !mod) {
        e.preventDefault()
        void submit()
      }
      return
    }
  }

  const onInput = (v: string) => {
    // User is editing → exit history browse mode
    if (histIdx.current >= 0 && v !== history[histIdx.current]) {
      histIdx.current = -1
    }
    onChange(v)
    if (v.startsWith('/')) {
      setMenuOpen(true)
      setActiveIndex(0)
    } else {
      setMenuOpen(false)
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

  return (
    <div
      className={`relative w-full max-w-full min-w-0 box-border border bg-surface-container/95 backdrop-blur-md transition-shadow focus-within:border-primary/35 focus-within:shadow-[0_0_0_1px_rgba(34,211,238,0.15),0_12px_40px_rgba(0,0,0,0.35)] ${
        compact ? 'rounded-xl' : 'rounded-2xl'
      } ${
        dragOver
          ? 'border-primary/50 bg-primary/5'
          : 'border-white/12'
      }`}
      data-composer={primary ? 'primary' : mode}
      onDragEnter={(e) => {
        if (!canAttach) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragOver={(e) => {
        if (!canAttach) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <SlashCommandMenu
        open={showMenu}
        items={filtered}
        activeIndex={safeIndex}
        onSelect={applyCommand}
        onHover={setActiveIndex}
        anchor="bottom"
        query={slashQuery ?? ''}
      />

      {canAttach && attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="relative group flex items-center gap-2 rounded-xl border border-white/10 bg-surface/60 pl-1.5 pr-2 py-1.5 max-w-[220px]"
            >
              {a.kind === 'image' && a.dataUrl ? (
                <img
                  src={a.dataUrl}
                  alt={a.name}
                  className="w-10 h-10 rounded-lg object-cover shrink-0 bg-black/20"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                  <Icon name={a.kind === 'text' ? 'description' : 'draft'} size={18} className="text-outline" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-on-surface truncate" title={a.name}>
                  {a.name}
                </p>
                <p className="text-[10px] text-outline">
                  {a.kind === 'image' ? '圖片' : a.kind === 'text' ? '文字' : '檔案'} ·{' '}
                  {formatBytes(a.size)}
                </p>
              </div>
              <button
                type="button"
                title="移除"
                onClick={() => removeAttachment(a.id)}
                className="w-6 h-6 rounded-md text-outline hover:text-error hover:bg-error/10 flex items-center justify-center shrink-0"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {(attachError || dragOver) && (
        <p
          className={`px-3 pt-2 text-[11px] ${
            attachError ? 'text-error' : 'text-primary'
          }`}
        >
          {attachError || '放開以加入附件'}
        </p>
      )}

      {canAttach && (
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          multiple
          accept="image/*,.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.log,.yml,.yaml,.xml,.html,.css,.sql"
          onChange={(e) => {
            void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      )}

      <div className={`flex items-end gap-2 ${compact ? 'p-2' : 'px-3 pt-3 md:px-3.5 md:pt-3.5'}`}>
        <textarea
          ref={taRef}
          value={value}
          disabled={disabled}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => {
            if (value.startsWith('/')) setMenuOpen(true)
          }}
          rows={compact ? 2 : 3}
          placeholder={
            canAttach
              ? placeholder || '輸入任務，或貼上／拖放圖片…'
              : placeholder
          }
          className="composer-field flex-1 min-w-0 self-stretch border-0 bg-transparent shadow-none resize-none outline-none ring-0 focus:outline-none focus-visible:outline-none focus:ring-0 text-[15px] text-on-surface placeholder:text-outline/80 leading-relaxed font-[family-name:var(--font-inter)]"
          spellCheck={false}
        />
        <div className="flex shrink-0 pb-0.5">
          <button
            type="button"
            disabled={!canSend}
            onClick={() => void submit()}
            className="w-9 h-9 rounded-lg bg-primary-container text-on-primary-container hover:brightness-110 disabled:opacity-40 flex items-center justify-center"
            title={enterBehavior === 'cmdEnter' ? '送出（⌘/Ctrl+Enter）' : '送出（Enter）'}
          >
            <Icon name="arrow_upward" size={18} />
          </button>
        </div>
      </div>
      {/* 附圖風格底欄：左操作 · 右模型/推理 */}
      {(footerLeft || footerRight || !hideHints) && (
        <div className="px-3 pb-2.5 flex items-center justify-between gap-2 min-h-[32px]">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            {quickActions?.({
              openFilePicker: () => fileRef.current?.click(),
              disabled: Boolean(disabled || attaching || attachments.length >= MAX_ATTACHMENTS),
            })}
            {footerLeft}
            {!hideHints && !footerLeft && (
              <span className="text-[10px] text-outline flex items-center gap-1.5">
                <kbd className="px-1 py-0.5 rounded bg-white/5 border border-white/10 font-[family-name:var(--font-mono)]">
                  ⌘/
                </kbd>
                <span>指令</span>
                {canAttach && (
                  <>
                    <span className="opacity-40">·</span>
                    <span>📎 貼圖/拖放</span>
                  </>
                )}
                <span className="opacity-40">·</span>
                <span>↑ 歷史</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {footerRight}
            {!footerRight && !hideHints && (
              <span className="text-[10px] text-primary/70">{getLiveSlashCommands().length} 指令</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
