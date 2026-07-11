import type { ReactNode } from 'react'
import { Icon } from './Icon'

export type SectionItem = {
  id: string
  label: string
  icon?: string
  description?: string
  /** Optional group key for ChatGPT-style sidebar sections */
  group?: string
}

/**
 * 頁面內左側區塊選單 — ChatGPT 風格：圖示 + 名稱、可選分組
 */
export function SectionNav({
  title,
  items,
  activeId,
  onChange,
  groups,
  hideDescriptions = true,
}: {
  title?: string
  items: SectionItem[]
  activeId: string
  onChange: (id: string) => void
  /** Ordered group labels; items.group matches key */
  groups?: Array<{ id: string; label: string }>
  hideDescriptions?: boolean
}) {
  const renderItem = (item: SectionItem) => {
    const active = item.id === activeId
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onChange(item.id)}
        className={`w-full text-left rounded-xl px-2.5 py-2 transition-colors ${
          active
            ? 'bg-white/[0.1] text-on-surface'
            : 'text-on-surface-variant hover:bg-white/[0.05] hover:text-on-surface'
        }`}
      >
        <div className="flex items-center gap-2.5">
          {item.icon && (
            <Icon
              name={item.icon}
              size={18}
              className={active ? 'text-on-surface' : 'text-outline'}
            />
          )}
          <span className={`text-[13px] truncate ${active ? 'font-semibold' : 'font-medium'}`}>
            {item.label}
          </span>
        </div>
        {!hideDescriptions && item.description && (
          <p className="text-[10px] mt-0.5 pl-7 text-outline line-clamp-1">{item.description}</p>
        )}
      </button>
    )
  }

  if (groups?.length) {
    return (
      <aside className="w-full lg:w-[220px] shrink-0 flex flex-col gap-4">
        {title && (
          <p className="text-[10px] font-semibold tracking-widest uppercase text-outline px-2.5">
            {title}
          </p>
        )}
        {groups.map((g) => {
          const groupItems = items.filter((i) => (i.group || 'other') === g.id)
          if (!groupItems.length) return null
          return (
            <div key={g.id}>
              <p className="px-2.5 mb-1 text-[10px] font-semibold tracking-[0.12em] text-outline/80 uppercase">
                {g.label}
              </p>
              <div className="space-y-0.5">{groupItems.map(renderItem)}</div>
            </div>
          )
        })}
      </aside>
    )
  }

  return (
    <aside className="w-full lg:w-[220px] shrink-0 flex flex-col gap-0.5">
      {title && (
        <p className="text-[10px] font-semibold tracking-widest uppercase text-outline px-2.5 mb-1">
          {title}
        </p>
      )}
      {items.map(renderItem)}
    </aside>
  )
}

/** 主題頁外殼 — 與設定頁一致：左區塊選單 + 右內容列式版面 */
export function ThemePage({
  title,
  subtitle,
  sections,
  activeId,
  onChange,
  children,
  groups,
  hideNavTitle = true,
  contentClassName,
  /** false = 全寬（知識圖譜等）；預設與設定頁同寬 */
  narrow = true,
  /**
   * Codex 式沉浸：隱藏左側區塊選單，內容置中全寬欄
   *（外掛市集用，貼近參考圖主欄節奏）
   */
  immersive = false,
}: {
  title: string
  subtitle?: string
  sections: SectionItem[]
  activeId: string
  onChange: (id: string) => void
  children: ReactNode
  groups?: Array<{ id: string; label: string }>
  hideNavTitle?: boolean
  contentClassName?: string
  narrow?: boolean
  immersive?: boolean
}) {
  return (
    <div className="h-full flex flex-col min-h-0 bg-background">
      <div className="px-5 md:px-8 pt-5 pb-2 shrink-0 lg:hidden">
        <h1 className="font-[family-name:var(--font-sora)] text-xl font-semibold text-on-surface">
          {title}
        </h1>
        {subtitle && <p className="text-on-surface-variant text-sm mt-1">{subtitle}</p>}
      </div>
      <div
        className={`flex-1 min-h-0 flex flex-col gap-0 pb-4 ${
          immersive
            ? 'px-0 md:px-0'
            : 'lg:flex-row lg:gap-2 px-3 md:px-5'
        }`}
      >
        {!immersive && (
          <div className="lg:overflow-y-auto custom-scrollbar shrink-0 lg:py-4 lg:pr-2 border-b lg:border-b-0 border-white/8 pb-2 mb-2 lg:mb-0 lg:pb-0 px-3 md:px-0">
            <SectionNav
              items={sections}
              activeId={activeId}
              onChange={onChange}
              groups={groups}
              title={hideNavTitle ? undefined : title}
              hideDescriptions
            />
          </div>
        )}
        {immersive && (
          <div className="w-full shrink-0 flex items-center gap-2 px-4 md:px-8 pt-3 pb-2 overflow-x-auto custom-scrollbar border-b border-white/[0.06]">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onChange(s.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  activeId === s.id
                    ? 'bg-white/[0.1] text-on-surface'
                    : 'text-outline hover:text-on-surface-variant hover:bg-white/[0.04]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        <div
          className={`flex-1 min-h-0 min-w-0 overflow-y-auto custom-scrollbar ${
            immersive ? 'lg:px-0 lg:py-2' : 'lg:pl-6 lg:pr-4 lg:py-6'
          }`}
        >
          <div
            className={`flex flex-col pb-10 w-full ${
              immersive
                ? 'max-w-[720px] mx-auto px-5 md:px-8 pt-6'
                : narrow
                  ? 'max-w-[820px]'
                  : 'max-w-none'
            } ${contentClassName || ''}`}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
