import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import type { InterventionState } from '../agent/types'

export function InterventionPanel({
  intervention,
  onApprove,
  onReject,
}: {
  intervention: InterventionState
  onApprove: (payloadJson: string) => void
  onReject: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [payload, setPayload] = useState(intervention.payloadJson)
  const [remaining, setRemaining] = useState(intervention.timeoutSec || 900)

  useEffect(() => {
    setPayload(intervention.payloadJson)
    setEditing(false)
  }, [intervention.payloadJson])

  useEffect(() => {
    setRemaining(intervention.timeoutSec || 900)
    const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000)
    return () => clearInterval(t)
  }, [intervention.timeoutSec, intervention.active])

  if (!intervention.active) return null

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')

  return (
    <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl glass-panel rounded-xl border border-error/30 overflow-hidden shadow-[0_0_40px_rgba(255,180,171,0.12)]">
        <div className="px-5 py-4 border-b border-error/20 bg-error/5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-error/15 border border-error/30 flex items-center justify-center shrink-0">
              <Icon name="warning" size={22} className="text-error" filled />
            </div>
            <div>
              <h2 className="font-[family-name:var(--font-sora)] text-xl font-semibold text-error tracking-tight">
                需要人工介入
              </h2>
              <p className="text-sm text-on-surface-variant mt-1 max-w-2xl">
                代理執行已暫停。{intervention.reason}
              </p>
            </div>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-container text-error text-[10px] font-semibold tracking-wider uppercase border border-error/20">
            <span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse" />
            狀態：已暫停
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-white/10">
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[10px] font-semibold tracking-widest uppercase text-on-surface-variant flex items-center gap-1">
                <Icon name="data_object" size={14} />
                提議的動作 Payload
              </h3>
              {editing && (
                <span className="text-[10px] text-primary font-semibold tracking-wider">編輯中</span>
              )}
            </div>
            {editing ? (
              <textarea
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                rows={14}
                className="w-full bg-[#0b1326] border border-primary/30 rounded-lg p-3 font-[family-name:var(--font-mono)] text-[12px] text-on-surface outline-none resize-none"
              />
            ) : (
              <pre className="bg-[#0b1326] border border-white/10 rounded-lg p-3 font-[family-name:var(--font-mono)] text-[12px] text-on-surface-variant overflow-x-auto max-h-72 custom-scrollbar whitespace-pre-wrap">
                {payload}
              </pre>
            )}
          </div>

          <div className="p-5">
            <h3 className="text-[10px] font-semibold tracking-widest uppercase text-on-surface-variant flex items-center gap-1 mb-3">
              <Icon name="shield" size={14} />
              安全約束評估
            </h3>
            <div className="flex flex-col gap-3">
              {(intervention.safety?.evaluations || []).map((ev) => (
                <div
                  key={ev.name}
                  className={`rounded-lg p-3 border ${
                    ev.passed
                      ? 'border-primary/20 bg-primary/5'
                      : 'border-error/30 bg-error/10'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon
                      name={ev.passed ? 'check_circle' : 'cancel'}
                      size={18}
                      className={ev.passed ? 'text-primary' : 'text-error'}
                      filled
                    />
                    <span className="font-semibold text-sm text-on-surface">{ev.name}</span>
                  </div>
                  <p className="text-sm text-on-surface-variant pl-7">{ev.detail}</p>
                  {!ev.passed && intervention.safety?.recommendation && (
                    <p className="text-sm text-error/90 pl-7 mt-2">
                      建議：{intervention.safety.recommendation}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 bg-surface-container-low/40">
          <p className="text-xs text-on-surface-variant flex items-center gap-1.5">
            <Icon name="timer" size={16} className="text-outline" />
            工作階段將於以下時間自動逾時{' '}
            <span className="font-[family-name:var(--font-mono)] text-error font-semibold">
              {mm}:{ss}
            </span>
          </p>
          <div className="flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              onClick={onReject}
              className="px-4 py-2 rounded-lg border border-error/40 text-error text-xs font-semibold tracking-wider uppercase hover:bg-error/10"
            >
              Reject &amp; Abort
            </button>
            {editing ? (
              <button
                type="button"
                onClick={() => onApprove(payload)}
                className="px-4 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs font-semibold tracking-wider uppercase hover:brightness-110 flex items-center gap-1"
              >
                <Icon name="verified" size={14} />
                核准已編輯 Payload
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="px-4 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs font-semibold tracking-wider uppercase hover:brightness-110 flex items-center gap-1"
                >
                  <Icon name="edit" size={14} />
                  編輯 Payload
                </button>
                <button
                  type="button"
                  onClick={() => onApprove(payload)}
                  className="px-4 py-2 rounded-lg border border-primary/40 text-primary text-xs font-semibold tracking-wider uppercase hover:bg-primary/10"
                >
                  原樣核准
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
