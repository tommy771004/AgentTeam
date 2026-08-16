import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  categoryLabel,
  commandEntryPath,
  filterCommandEntries,
  getAllCommandEntries,
} from '../commands/registry'
import { usePaletteStore } from '../store/paletteStore'
import { requestFocusComposer } from '../store/commandHistoryStore'
import { useWorkspaceUiStore } from '../store/workspaceUiStore'
import { Icon } from './Icon'

/**
 * Command Palette（first-run honesty ticket 10）。
 *
 * 全域 overlay：資料來自共用指令註冊表（slash 指令＋頁面導航＋設定節錨點），
 * 模糊過濾、鍵盤全程可用（↑↓ 選擇、Enter 執行、Esc 關閉）。
 * 命中 slash 條目 → 帶 /name 到 composer；navigate/settings → 直接跳轉。
 */
export function CommandPalette() {
  const open = usePaletteStore((s) => s.open)
  const setOpen = usePaletteStore((s) => s.setOpen)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const setComposer = useWorkspaceUiStore((s) => s.setComposer)

  const entries = useMemo(
    () => (open ? filterCommandEntries(query, getAllCommandEntries()) : []),
    [open, query],
  )

  // 開啟時聚焦輸入並記住原焦點；關閉時還原
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null
      setQuery('')
      setIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    if (!open && restoreFocusRef.current) {
      restoreFocusRef.current.focus?.()
      restoreFocusRef.current = null
    }
  }, [open])

  // 查詢變更後選擇重置
  useEffect(() => {
    setIndex(0)
  }, [query])

  if (!open) return null

  const close = () => setOpen(false)

  const execute = (i: number) => {
    const entry = entries[i]
    if (!entry) return
    const target = commandEntryPath(entry)
    close()
    if (target) {
      navigate(target)
      return
    }
    // slash 條目：回主對話並帶入 /name
    navigate('/')
    setComposer(`/${entry.name} `)
    requestAnimationFrame(() => requestFocusComposer({ openSlash: false }))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((v) => (entries.length ? (v + 1) % entries.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((v) => (entries.length ? (v - 1 + entries.length) % entries.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      execute(index)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[14vh] p-6"
      onClick={close}
      data-testid="command-palette"
    >
      <section
        className="app-panel no-drag w-full max-w-xl overflow-hidden rounded-2xl shadow-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="指令面板"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Icon name="search" size={18} className="shrink-0 text-outline" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜尋指令、頁面或設定…"
            aria-label="搜尋指令"
            className="w-full bg-transparent text-sm outline-none placeholder:text-outline"
          />
          <kbd className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-outline">
            Esc
          </kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto custom-scrollbar py-1.5">
          {entries.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-outline">沒有符合的項目</p>
          )}
          {entries.slice(0, 40).map((entry, i) => (
            <button
              key={entry.name}
              type="button"
              onMouseEnter={() => setIndex(i)}
              onClick={() => execute(i)}
              className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
                i === index ? 'bg-primary/10' : ''
              }`}
              data-testid={`palette-entry-${entry.name}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {entry.action?.kind === 'slash' ? `/${entry.name}` : entry.name}
                </span>
                <span className="block truncate text-[11px] text-outline">{entry.description}</span>
              </span>
              <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-outline">
                {entry.action?.kind === 'settings'
                  ? '設定'
                  : entry.action?.kind === 'navigate'
                    ? '導覽'
                    : categoryLabel(entry.category)}
              </span>
              {entry.argsHint && (
                <span className="shrink-0 font-[family-name:var(--font-mono)] text-[10px] text-outline">
                  {entry.argsHint}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
