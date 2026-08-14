import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import {
  categoryLabel,
  type SlashCommand,
} from '../commands/registry'

/**
 * Claude Code 風格：輸入 / 後浮出指令列表
 */
export function SlashCommandMenu({
  open,
  items,
  activeIndex,
  onSelect,
  onHover,
  anchor = 'bottom',
  query = '',
}: {
  open: boolean
  items: SlashCommand[]
  activeIndex: number
  onSelect: (cmd: SlashCommand) => void
  onHover: (index: number) => void
  anchor?: 'bottom' | 'top'
  query?: string
}) {
  const listRef = useRef<HTMLDivElement>(null)
  /**
   * docs/ui「Prompt Bar」的滑動選取：整份選單只有一塊高亮，會滑到目前這一列，
   * 而不是每列各自開關自己的底色。鍵盤與滑鼠因此共用同一個「現在在這裡」。
   */
  const [highlight, setHighlight] = useState<{ top: number; height: number } | null>(null)

  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  useLayoutEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`)
    setHighlight(el ? { top: el.offsetTop, height: el.offsetHeight } : null)
  }, [activeIndex, open, items])

  if (!open) return null

  // group by category for display order
  const groups = new Map<string, SlashCommand[]>()
  for (const item of items) {
    const g = categoryLabel(item.category)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(item)
  }

  let flatIdx = -1

  return (
    <div
      className={`absolute left-0 right-0 z-[80] mx-0 max-h-72 overflow-hidden rounded-card border border-line bg-surface shadow-raised animate-macos-scale ${
        anchor === 'bottom' ? 'bottom-full mb-2' : 'top-full mt-2'
      }`}
      role="listbox"
    >
      <div className="px-3 py-2 border-b border-line flex items-center gap-2 text-[10px] tracking-widest text-ink-3 uppercase font-semibold">
        <Icon name="terminal" size={14} className="text-accent-ink" />
        指令
        <span className="ml-auto normal-case tracking-normal font-normal">
          ↑↓ 選擇 · Enter 確認 · Esc 關閉
        </span>
      </div>
      <div ref={listRef} className="relative max-h-60 overflow-y-auto custom-scrollbar py-1">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1 rounded-control bg-hover-2"
          style={{
            top: highlight?.top ?? 0,
            height: highlight?.height ?? 0,
            opacity: highlight && items.length > 0 ? 1 : 0,
            transition:
              'top 200ms cubic-bezier(0.23,1,0.32,1), height 200ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease',
          }}
        />
        {items.length === 0 ? (
          <div className="px-3 py-4 text-xs text-ink-3 text-center">
            無相符指令「/{query}」— 試試 /help
          </div>
        ) : (
          [...groups.entries()].map(([group, cmds]) => (
            <div key={group}>
              <div className="px-3 pt-2 pb-1 text-[10px] text-ink-3 font-semibold tracking-wider">
                {group}
              </div>
              {cmds.map((cmd) => {
                flatIdx += 1
                const idx = flatIdx
                const active = idx === activeIndex
                return (
                  <button
                    key={cmd.name}
                    type="button"
                    data-idx={idx}
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => onHover(idx)}
                    onClick={() => onSelect(cmd)}
                    className={`relative z-10 w-full text-left px-3 py-2 flex items-start gap-3 transition-colors ${
                      active ? 'text-accent-ink' : 'text-ink'
                    }`}
                  >
                    <code
                      className={`font-[family-name:var(--font-mono)] text-[13px] shrink-0 ${
                        active ? 'text-accent-ink' : 'text-ink-2'
                      }`}
                    >
                      /{cmd.name}
                    </code>
                    <span className="text-xs text-ink-2 flex-1 min-w-0">
                      {cmd.description}
                      {cmd.argsHint && (
                        <span className="text-ink-3 ml-1 font-[family-name:var(--font-mono)]">
                          {cmd.argsHint}
                        </span>
                      )}
                    </span>
                    {cmd.aliases?.[0] && (
                      <span className="text-[10px] text-ink-3 shrink-0 font-[family-name:var(--font-mono)]">
                        /{cmd.aliases[0]}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
