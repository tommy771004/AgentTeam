import { useEffect, useState } from 'react'
import type { SubDesignDirection } from '../../agent/subdesign/types.ts'
import { Icon } from '../Icon'

export function SubDesignDirectionApprovalCard({
  directions,
  selectedId,
  committedId,
  onSelect,
  onSubmit,
  onSubmitCustom,
}: {
  directions: readonly SubDesignDirection[]
  selectedId: string
  committedId?: string
  onSelect: (directionId: string) => void
  onSubmit: (directionId: string) => void
  onSubmitCustom: (title: string) => void
}) {
  const [custom, setCustom] = useState('')
  const selectedIndex = directions.findIndex((direction) => direction.id === selectedId)

  useEffect(() => {
    setCustom('')
  }, [committedId])

  const move = (delta: number) => {
    if (!directions.length) return
    const origin = selectedIndex >= 0 ? selectedIndex : 0
    const next = Math.min(directions.length - 1, Math.max(0, origin + delta))
    setCustom('')
    onSelect(directions[next].id)
  }
  const submit = () => {
    const value = custom.trim()
    if (value) {
      onSubmitCustom(value)
      return
    }
    if (selectedId) onSubmit(selectedId)
  }

  return (
    <div className="overflow-hidden rounded-xl bg-surface shadow-card" data-subdesign-direction-approval>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold text-ink">要採用哪個視覺方向？</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-ink-3">先選擇，再明確送出；不會因瀏覽選項就鎖定方向。</p>
          </div>
          {committedId ? <Icon name="lock" size={14} className="shrink-0 text-primary" /> : null}
        </div>

        <div className="mt-3 space-y-0.5" role="radiogroup" aria-label="Visual direction">
          {directions.map((direction) => {
            const selected = direction.id === selectedId && !custom
            return (
              <button
                key={direction.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => { setCustom(''); onSelect(direction.id) }}
                className="flex w-full items-start gap-2 rounded-lg px-1.5 py-2 text-left transition-colors hover:bg-hover"
              >
                <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${selected ? 'bg-ink text-canvas' : 'border border-line-strong text-transparent'}`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                </span>
                <span className="min-w-0">
                  <span className={`block text-[12px] font-medium ${selected ? 'text-ink' : 'text-ink-2'}`}>{direction.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-[10px] leading-relaxed text-ink-3">{direction.summary}</span>
                </span>
              </button>
            )
          })}
          <label className="flex items-center gap-2 rounded-lg px-1.5 py-2 transition-colors focus-within:bg-hover">
            <span className={`h-4 w-4 shrink-0 rounded-full ${custom ? 'bg-ink shadow-[inset_0_0_0_5px_var(--color-canvas)]' : 'border border-line-strong'}`} />
            <input
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              onFocus={() => onSelect('')}
              onKeyDown={(event) => { if (event.key === 'Enter' && custom.trim()) submit() }}
              placeholder="輸入自訂方向…"
              aria-label="自訂視覺方向"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-3"
            />
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line bg-inset px-3 py-2">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="上一個方向" disabled={selectedIndex <= 0} onClick={() => move(-1)} className="grid h-6 w-6 place-items-center rounded-md text-ink-3 hover:bg-hover disabled:opacity-30">
            <Icon name="chevron_left" size={14} />
          </button>
          <span className="flex items-center gap-1" aria-label={`${Math.max(selectedIndex + 1, 0)} / ${directions.length}`}>
            {directions.map((direction) => (
              <span key={direction.id} className={`rounded-full ${direction.id === selectedId && !custom ? 'h-2 w-2 border-2 border-ink' : 'h-1.5 w-1.5 border border-ink-3'}`} />
            ))}
          </span>
          <button type="button" aria-label="下一個方向" disabled={selectedIndex < 0 || selectedIndex >= directions.length - 1} onClick={() => move(1)} className="grid h-6 w-6 place-items-center rounded-md text-ink-3 hover:bg-hover disabled:opacity-30">
            <Icon name="chevron_right" size={14} />
          </button>
        </div>
        <button type="button" aria-label="採用此方向" disabled={!custom.trim() && !selectedId} onClick={submit} className="grid h-8 w-8 place-items-center rounded-lg bg-ink text-surface disabled:opacity-30">
          <Icon name="arrow_upward" size={15} />
        </button>
      </div>
    </div>
  )
}
