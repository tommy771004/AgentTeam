import { useEffect, useRef, useState } from 'react'
import type { DodPreview } from '../agent/dodPreview'
import { Icon } from './Icon'

/**
 * Composer new-task flow（ticket 06）— 送出前的驗收標準卡。
 *
 * DoD 是這個產品最深的差異化：Goal-based run 會迭代到它滿足為止。以前它只在
 * 任務結束後以「還剩 N 個 gaps」出現，價值完全後置；這張卡把它提前到按下送出
 * 之前，可看、可改、可略過。
 *
 * 不編輯就什麼都沒變——送出的仍是 auto-parse 的原文。
 */
export function DodPreviewCard({
  preview,
  value,
  onChange,
  onSkip,
}: {
  /** null = 這次任務不是 Goal-based，不出現 */
  preview: DodPreview | null
  /** 使用者編輯過的文字；undefined = 尚未編輯 */
  value: string | undefined
  onChange: (next: string) => void
  onSkip: () => void
}) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  if (!preview) return null

  const text = value ?? preview.definitionOfDone
  const edited = value !== undefined && value.trim() !== preview.definitionOfDone.trim()

  return (
    <section
      data-testid="dod-preview-card"
      aria-label="驗收標準"
      className="rounded-card border border-line bg-surface-container-low px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <Icon aria-hidden name="task_alt" size={16} className="mt-0.5 shrink-0 text-ink-3" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="text-[11px] font-semibold text-ink-2">驗收標準</h3>
            {edited ? <span className="text-[10px] text-accent-ink">已編輯</span> : null}
          </div>
          <p className="mt-0.5 text-[10px] leading-relaxed text-ink-3">{preview.reason}</p>

          {editing ? (
            <textarea
              ref={inputRef}
              rows={2}
              value={text}
              aria-label="編輯驗收標準"
              onChange={(event) => onChange(event.target.value)}
              onBlur={() => setEditing(false)}
              className="mt-1.5 w-full resize-y rounded-control border border-line bg-inset px-2 py-1.5 text-[12px] leading-relaxed text-ink outline-none focus:border-line-strong"
            />
          ) : (
            <p className="mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink">
              {text}
            </p>
          )}
        </div>

        <span className="flex shrink-0 gap-1">
          {!editing ? (
            <button
              type="button"
              onClick={() => {
                onChange(text)
                setEditing(true)
              }}
              className="rounded-control px-2 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:bg-hover-2"
            >
              編輯
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSkip}
            title="這次不看驗收標準；任務仍會依 auto-parse 的標準驗收"
            className="rounded-control px-2 py-1 text-[11px] font-medium text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink-2"
          >
            略過
          </button>
        </span>
      </div>
    </section>
  )
}
