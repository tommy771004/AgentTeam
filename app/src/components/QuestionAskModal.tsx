import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useQuestionAskStore } from '../store/questionAskStore'

export function QuestionAskModal() {
  const current = useQuestionAskStore((state) => state.current)
  const resolve = useQuestionAskStore((state) => state.resolve)
  const [selected, setSelected] = useState<string[]>([])
  const [freeform, setFreeform] = useState('')
  const [remainSec, setRemainSec] = useState(0)

  useEffect(() => {
    if (!current) return
    setSelected([])
    setFreeform('')
    const update = () => setRemainSec(Math.max(0, Math.ceil((current.expiresAt - Date.now()) / 1000)))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [current])

  if (!current) return null

  const toggle = (value: string) => {
    setSelected((previous) => {
      if (current.multiSelect) {
        return previous.includes(value)
          ? previous.filter((item) => item !== value)
          : [...previous, value]
      }
      return previous[0] === value ? [] : [value]
    })
  }

  const submit = () => {
    const text = freeform.trim()
    if (!selected.length && !text) return
    resolve({ answers: selected, freeform: text || undefined })
  }

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4 backdrop-blur-xl animate-macos-fade">
      <div className="w-full max-w-lg overflow-hidden rounded-[20px] liquid-glass border border-primary/25 shadow-[0_24px_80px_rgba(0,0,0,0.5)] animate-macos-sheet">
        <div className="flex items-start gap-3 border-b border-white/10 bg-primary/10 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15">
            <Icon name="question_mark" size={22} className="text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-on-surface">需要你的選擇</h2>
            <p className="mt-0.5 text-sm text-on-surface-variant">{current.reason || 'Agent 需要補充資訊才能繼續。'}</p>
            <p className="mt-1 font-[family-name:var(--font-mono)] text-[11px] text-outline">
              逾時 {remainSec}s 將取消這次回答
            </p>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-on-surface">{current.question}</p>
          {current.options.length ? (
            /* docs/ui「approve」: 選項不再各自是一張有框的卡，選取記號本身就是唯一
               的狀態訊號，問題因此保有閱讀重量，一次也只有一個東西在說話。 */
            <div className="flex flex-col gap-0.5">
              {current.options.map((option, i) => {
                const value = option.value || option.label
                const checked = selected.includes(value)
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggle(value)}
                    className="-mx-2 flex items-start gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/5"
                    style={{
                      animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${i * 45}ms both`,
                    }}
                  >
                    <span
                      className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center transition-colors duration-200 ${
                        current.multiSelect ? 'rounded-[6px]' : 'rounded-full'
                      } ${
                        checked
                          ? 'bg-primary-container text-on-primary-container'
                          : 'text-transparent shadow-[inset_0_0_0_1.5px_var(--color-outline-variant)]'
                      }`}
                    >
                      {current.multiSelect ? (
                        <Icon name="check" size={13} />
                      ) : (
                        <span
                          className="size-1.5 rounded-full bg-current transition-transform duration-200"
                          style={{ transform: checked ? 'scale(1)' : 'scale(0)' }}
                        />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={`block text-sm transition-colors duration-200 ${
                          checked ? 'text-on-surface' : 'text-on-surface-variant'
                        }`}
                      >
                        {option.label}
                      </span>
                      {option.description ? <span className="mt-0.5 block text-xs text-outline">{option.description}</span> : null}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}
          {current.allowFreeform ? (
            <textarea
              value={freeform}
              onChange={(event) => setFreeform(event.target.value)}
              placeholder="補充說明（可選）"
              rows={3}
              className="w-full resize-none rounded-xl border border-white/10 bg-surface/40 px-3 py-2 text-sm text-on-surface outline-none placeholder:text-outline focus:border-primary/50"
            />
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 bg-surface/40 px-5 py-4">
          <button
            type="button"
            onClick={() => resolve(null)}
            className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-white/5"
          >
            取消任務
          </button>
          <button
            type="button"
            disabled={!selected.length && !freeform.trim()}
            onClick={submit}
            className="rounded-xl bg-primary-container px-4 py-2 text-sm font-semibold text-on-primary-container hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            送出回答
          </button>
        </div>
      </div>
    </div>
  )
}
