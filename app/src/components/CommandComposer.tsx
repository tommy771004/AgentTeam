import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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

export type ComposerMode = 'agent' | 'workspace'

export interface CommandComposerProps {
  value: string
  onChange: (v: string) => void
  onSubmitLine: (line: string) => void | Promise<void>
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
}

/**
 * Codex / Claude Code 風格輸入列：/ 指令、↑ 歷史、Cmd+/ 聚焦
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
}: CommandComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  /** -1 = not browsing history */
  const histIdx = useRef(-1)
  const draftBeforeHist = useRef('')
  const history = useCommandHistoryStore((s) => s.items)
  const pushHistory = useCommandHistoryStore((s) => s.push)

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
    if (!line || disabled) return
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
    await onSubmitLine(line)
    onChange('')
  }, [value, disabled, onChange, onSlashCommand, onSubmitLine, pushHistory])

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

  return (
    <div
      className={`relative w-full max-w-full min-w-0 box-border border border-white/12 bg-surface-container/95 backdrop-blur-md transition-shadow focus-within:border-primary/35 focus-within:shadow-[0_0_0_1px_rgba(34,211,238,0.15),0_12px_40px_rgba(0,0,0,0.35)] ${
        compact ? 'rounded-xl' : 'rounded-2xl'
      }`}
      data-composer={primary ? 'primary' : mode}
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

      <div className={`flex items-end gap-2 ${compact ? 'p-2' : 'p-3 md:p-3.5'}`}>
        <div className="flex items-center gap-1 shrink-0 pb-2 pl-0.5 text-outline">
          <Icon
            name={mode === 'agent' ? 'auto_awesome' : 'terminal'}
            size={18}
            className="text-primary"
          />
        </div>
        <textarea
          ref={taRef}
          value={value}
          disabled={disabled}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (value.startsWith('/')) setMenuOpen(true)
          }}
          rows={compact ? 2 : 3}
          placeholder={placeholder}
          className="composer-field flex-1 min-w-0 self-stretch border-0 bg-transparent shadow-none resize-none outline-none ring-0 focus:outline-none focus-visible:outline-none focus:ring-0 text-[15px] text-on-surface placeholder:text-outline/80 leading-relaxed font-[family-name:var(--font-inter)]"
          spellCheck={false}
        />
        <div className="flex flex-col gap-1 shrink-0 pb-0.5">
          <button
            type="button"
            title="指令列表（/ 或 ⌘/）"
            onClick={() => focusSelf(true)}
            className="w-9 h-9 rounded-lg border border-white/10 text-on-surface-variant hover:text-primary hover:border-primary/40 flex items-center justify-center text-sm font-[family-name:var(--font-mono)]"
          >
            /
          </button>
          <button
            type="button"
            disabled={disabled || !value.trim()}
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
            {footerLeft}
            {!hideHints && !footerLeft && (
              <span className="text-[10px] text-outline flex items-center gap-1.5">
                <kbd className="px-1 py-0.5 rounded bg-white/5 border border-white/10 font-[family-name:var(--font-mono)]">
                  ⌘/
                </kbd>
                <span>指令</span>
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
