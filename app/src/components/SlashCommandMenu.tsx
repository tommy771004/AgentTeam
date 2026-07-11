import { useEffect, useRef } from 'react'
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

  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

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
      className={`absolute left-0 right-0 z-[80] mx-0 max-h-72 overflow-hidden rounded-2xl liquid-glass shadow-2xl animate-macos-scale ${
        anchor === 'bottom' ? 'bottom-full mb-2' : 'top-full mt-2'
      }`}
      role="listbox"
    >
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2 text-[10px] tracking-widest text-outline uppercase font-semibold">
        <Icon name="terminal" size={14} className="text-primary" />
        指令
        <span className="ml-auto normal-case tracking-normal font-normal">
          ↑↓ 選擇 · Enter 確認 · Esc 關閉
        </span>
      </div>
      <div ref={listRef} className="max-h-60 overflow-y-auto custom-scrollbar py-1">
        {items.length === 0 ? (
          <div className="px-3 py-4 text-xs text-outline text-center">
            無相符指令「/{query}」— 試試 /help
          </div>
        ) : (
          [...groups.entries()].map(([group, cmds]) => (
            <div key={group}>
              <div className="px-3 pt-2 pb-1 text-[10px] text-outline font-semibold tracking-wider">
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
                    className={`w-full text-left px-3 py-2 flex items-start gap-3 transition-colors ${
                      active ? 'bg-primary/15 text-primary' : 'text-on-surface hover:bg-white/5'
                    }`}
                  >
                    <code
                      className={`font-[family-name:var(--font-mono)] text-[13px] shrink-0 ${
                        active ? 'text-primary' : 'text-secondary'
                      }`}
                    >
                      /{cmd.name}
                    </code>
                    <span className="text-xs text-on-surface-variant flex-1 min-w-0">
                      {cmd.description}
                      {cmd.argsHint && (
                        <span className="text-outline ml-1 font-[family-name:var(--font-mono)]">
                          {cmd.argsHint}
                        </span>
                      )}
                    </span>
                    {cmd.aliases?.[0] && (
                      <span className="text-[10px] text-outline shrink-0 font-[family-name:var(--font-mono)]">
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
