import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { ApprovalMode } from '../agent/types'
import { APPROVAL_MODE_DEFS, approvalModeDef } from '../agent/approvalModes'

/**
 * ChatGPT-style「動作應如何核准？」composer pill + 上拉選單
 */
export function ApprovalModeMenu({
  mode,
  onChange,
}: {
  mode: ApprovalMode
  onChange: (m: ApprovalMode) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const active = approvalModeDef(mode)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-white/12 bg-surface-container/90 hover:bg-white/[0.06] text-[11px] text-on-surface-variant transition-colors"
        title="動作應如何核准？"
      >
        <Icon name={active.icon} size={13} className="shrink-0 opacity-80" />
        <span className="font-medium text-on-surface">{active.title}</span>
        <Icon name="expand_more" size={14} className="shrink-0 opacity-70" />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 z-[90] w-[300px] rounded-xl border border-white/12 bg-[#1c1c1e]/95 backdrop-blur-xl shadow-2xl py-1 overflow-hidden">
          <div className="px-3 py-2 text-[11px] text-white/50 font-medium">
            動作應如何核准？
          </div>
          {APPROVAL_MODE_DEFS.map((d) => {
            const selected = d.id === (mode || 'auto')
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  onChange(d.id)
                  setOpen(false)
                }}
                className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${
                  selected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.05]'
                }`}
              >
                <Icon
                  name={d.icon}
                  size={18}
                  className={`shrink-0 mt-0.5 ${
                    d.id === 'full' ? 'text-amber-300/90' : 'text-on-surface-variant'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-on-surface">
                    {d.title}
                  </span>
                  <span className="block text-[11px] text-on-surface-variant leading-snug mt-0.5">
                    {d.desc}
                  </span>
                </span>
                {selected && (
                  <Icon name="check" size={16} className="shrink-0 mt-1 text-primary" />
                )}
              </button>
            )
          })}
          {(mode || 'auto') === 'full' && (
            <div className="px-3 py-2 text-[11px] text-amber-300/80 border-t border-white/10">
              完整存取權會跳過人工核准與 safety 攔截（deny 規則仍生效），請小心使用。
            </div>
          )}
        </div>
      )}
    </div>
  )
}
