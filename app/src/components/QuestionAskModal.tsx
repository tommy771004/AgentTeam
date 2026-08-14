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
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/45 p-4 backdrop-blur-md animate-macos-fade">
      <div className="agent-question-card w-full max-w-sm overflow-hidden rounded-card border animate-macos-sheet">
        <div className="primitive-card-pad">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                <Icon name="question_mark" size={13} className="text-accent-ink" />
                需要你的選擇
              </div>
              <h2 className="whitespace-pre-wrap text-[13px] font-medium leading-relaxed text-ink">{current.question}</h2>
              {current.reason ? <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{current.reason}</p> : null}
            </div>
            <button
              type="button"
              aria-label="關閉問題"
              onClick={() => resolve(null)}
              className="primitive-icon-button shrink-0 text-ink-3 transition-colors hover:bg-hover hover:text-ink"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        </div>

        <div className="border-t border-line px-3 py-2">
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
                    className="agent-question-option -mx-1.5 flex items-start gap-2.5 rounded-control px-1.5 py-1.5 text-left transition-colors"
                    data-selected={checked}
                    style={{
                      animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${i * 45}ms both`,
                    }}
                  >
                    <span
                      className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center transition-colors duration-200 ${
                        current.multiSelect ? 'rounded-[6px]' : 'rounded-full'
                      } ${
                        checked
                          ? 'bg-ink text-canvas'
                          : 'text-transparent shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]'
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
                          checked ? 'text-ink' : 'text-ink-2'
                        }`}
                      >
                        {option.label}
                      </span>
                      {option.description ? <span className="mt-0.5 block text-xs text-ink-3">{option.description}</span> : null}
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
              className="w-full resize-none rounded-control border border-line bg-inset px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
            />
          ) : null}
        </div>

        <div className="primitive-card-footer flex items-center justify-between gap-3 border-t border-line bg-inset">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1" aria-label="目前問題">
              <span className="size-2 rounded-full border-2 border-ink" />
            </span>
            <span className="font-[family-name:var(--font-mono)] text-[10px] text-ink-3">{remainSec}s</span>
          </div>
          <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => resolve(null)}
            className="rounded-control px-2.5 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-hover"
          >
            取消任務
          </button>
          <button
            type="button"
            disabled={!selected.length && !freeform.trim()}
            onClick={submit}
            className="flex size-7 items-center justify-center rounded-control bg-ink text-canvas shadow-btn transition-transform enabled:active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-field disabled:text-ink-3"
            aria-label="送出回答"
          >
            <Icon name="arrow_upward" size={14} />
          </button>
          </div>
        </div>
      </div>
    </div>
  )
}
