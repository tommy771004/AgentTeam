import type { ReactNode } from 'react'

/**
 * docs/ui 共用的展開語彙（Thinking / Task Rows / Tool Chips / Streaming Text
 * 都用同一招）：以 grid-template-rows 0fr → 1fr 讓細節在原位長出來。
 * 不需要量測高度，收合時也不會留下捲動殘影。
 *
 * 內容維持掛載，所以只放非互動的細節（trace、diff、log）；需要收合時真正
 * 移除焦點目標的區塊，請照舊用條件渲染。
 */
export function Reveal({
  open,
  children,
  className = '',
  durationMs = 300,
}: {
  open: boolean
  children: ReactNode
  className?: string
  durationMs?: number
}) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] ${className}`}
      style={{
        gridTemplateRows: open ? '1fr' : '0fr',
        opacity: open ? 1 : 0,
        transitionDuration: `${durationMs}ms`,
        transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
      }}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
