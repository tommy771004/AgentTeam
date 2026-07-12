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
            <div className="space-y-2">
              {current.options.map((option) => {
                const value = option.value || option.label
                const checked = selected.includes(value)
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggle(value)}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      checked
                        ? 'border-primary/50 bg-primary/10 text-on-surface'
                        : 'border-white/10 bg-surface/30 text-on-surface-variant hover:bg-white/5'
                    }`}
                  >
                    <Icon
                      name={checked ? (current.multiSelect ? 'check_box' : 'radio_button_checked') : current.multiSelect ? 'check_box_outline_blank' : 'radio_button_unchecked'}
                      size={18}
                      className="mt-0.5 shrink-0 text-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm">{option.label}</span>
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
