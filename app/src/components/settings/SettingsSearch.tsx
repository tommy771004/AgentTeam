import { useEffect, useMemo, useRef, useState } from 'react'
import {
  searchSettingsFields,
  type SettingsSearchHit,
} from '../../settings/fieldRegistry'
import { Icon } from '../Icon'

const MAX_HITS = 20

/**
 * Settings registry restructure（spec 3/6 ticket 02）— 設定搜尋。
 *
 * 找一個開關不該靠記憶。輸入中文或英文都命中同一個欄位（registry 的 keywords
 * 兩種都宣告），選中後直接切到所屬節、捲到欄位並高亮。
 *
 * 刻意不看 tier：進階欄位在基礎檢視下仍搜得到，跳過去時再自動展開——否則使用者
 * 會以為那個設定不存在。
 */
export function SettingsSearch({
  policyAdminBuild,
  onJump,
}: {
  policyAdminBuild: boolean
  /** 跳到某個欄位：切節、必要時展開進階、捲動並高亮 */
  onJump: (hit: SettingsSearchHit) => void
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const hits = useMemo(
    () => searchSettingsFields(query, { policyAdminBuild }).slice(0, MAX_HITS),
    [query, policyAdminBuild],
  )

  useEffect(() => {
    setIndex(0)
  }, [query])

  // 清單可捲動且最多 20 筆：只把 index 移下去、畫面不跟著捲，
  // 純鍵盤的人就會「選到」一個看不見的項目。
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [index, query])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const jump = (hit: SettingsSearchHit | undefined) => {
    if (!hit) return
    onJump(hit)
    setOpen(false)
    setQuery('')
  }

  const showList = open && query.trim().length > 0

  return (
    <div className="relative" ref={rootRef}>
      <div className="flex items-center gap-2 rounded-control border border-line bg-surface-container-low px-2.5 py-1.5 focus-within:border-line-strong">
        <Icon aria-hidden name="search" size={16} className="shrink-0 text-outline" />
        <input
          type="search"
          value={query}
          role="combobox"
          aria-expanded={showList}
          aria-controls="settings-search-results"
          aria-activedescendant={
            showList && hits[index] ? `settings-hit-${hits[index].field.id}` : undefined
          }
          aria-label="搜尋設定"
          placeholder="搜尋設定（中英文皆可）"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (!showList) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setIndex((current) => (hits.length ? (current + 1) % hits.length : 0))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex((current) => (hits.length ? (current - 1 + hits.length) % hits.length : 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              jump(hits[index])
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setOpen(false)
            }
          }}
          className="w-full bg-transparent text-[12px] text-on-surface outline-none placeholder:text-outline"
        />
      </div>

      {showList ? (
        <div
          ref={listRef}
          id="settings-search-results"
          role="listbox"
          aria-label="設定搜尋結果"
          className="absolute left-0 right-0 top-full z-[80] mt-1 max-h-80 overflow-y-auto rounded-card border border-line bg-surface shadow-raised custom-scrollbar"
        >
          {hits.length === 0 ? (
            <p className="px-3 py-3 text-[11px] text-outline">沒有符合的設定。</p>
          ) : (
            hits.map((hit, i) => (
              <button
                key={hit.field.id}
                id={`settings-hit-${hit.field.id}`}
                type="button"
                role="option"
                aria-selected={i === index}
                onMouseEnter={() => setIndex(i)}
                onClick={() => jump(hit)}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left transition-colors ${
                  i === index ? 'bg-hover' : 'hover:bg-hover-2'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-on-surface">
                    {hit.field.label}
                    {hit.field.tier === 'advanced' ? (
                      <span className="ml-1.5 text-[10px] font-normal text-outline">進階</span>
                    ) : null}
                  </span>
                  <span className="block truncate text-[10px] text-outline">
                    {hit.field.summary}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] text-outline">{hit.sectionLabel}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
