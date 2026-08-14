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
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="intervention-title" className="agent-intervention-card w-full max-w-3xl overflow-hidden rounded-card border border-error/30 bg-surface">
        <div className="flex items-start justify-between gap-4 border-b border-error/20 bg-error/5 px-5 py-4">
          <div className="flex items-start gap-3">
            <Icon name="warning" size={20} className="mt-0.5 shrink-0 text-error" filled />
            <div>
              <h2 id="intervention-title" className="text-[16px] font-semibold tracking-tight text-error">
                需要你的核准
              </h2>
              <p className="mt-1 max-w-2xl text-[13px] text-ink-2">
                執行已暫停。{intervention.reason}
              </p>
            </div>
          </div>
          <span className="agent-intervention-status shrink-0 text-[10px] font-medium text-error">已暫停</span>
        </div>

        <div className="grid grid-cols-1 gap-0 divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="flex items-center gap-1 text-[11px] font-medium text-ink-2">
                <Icon name="data_object" size={14} />
                提議的動作
              </h3>
              {editing && (
                <span className="text-[10px] font-medium text-accent-ink">編輯中</span>
              )}
            </div>
            {editing ? (
              <textarea
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                rows={14}
                className="w-full resize-none rounded-control border border-accent/30 bg-inset p-3 text-[12px] text-ink outline-none font-[family-name:var(--font-mono)]"
              />
            ) : (
              <pre className="max-h-72 overflow-x-auto whitespace-pre-wrap rounded-control border border-line bg-inset p-3 text-[12px] text-ink-2 font-[family-name:var(--font-mono)] custom-scrollbar">
                {payload}
              </pre>
            )}
          </div>

          <div className="p-5">
            <h3 className="mb-3 flex items-center gap-1 text-[11px] font-medium text-ink-2">
              <Icon name="shield" size={14} />
              安全約束評估
            </h3>
            <div className="flex flex-col gap-3">
              {(intervention.safety?.evaluations || []).map((ev) => (
                <div
                  key={ev.name}
                  className={`agent-intervention-evaluation rounded-control border p-3 ${
                    ev.passed
                      ? 'border-accent/20 bg-accent-tint'
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
                    <span className="text-sm font-semibold text-ink">{ev.name}</span>
                  </div>
                  <p className="pl-7 text-[13px] text-ink-2">{ev.detail}</p>
                  {!ev.passed && intervention.safety?.recommendation && (
                    <p className="mt-2 pl-7 text-[13px] text-error/90">
                      建議：{intervention.safety.recommendation}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-3 border-t border-line bg-inset px-5 py-4 sm:flex-row">
          <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
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
              className="agent-intervention-secondary rounded-control px-4 py-2 text-[12px] font-semibold text-error"
            >
              Reject &amp; Abort
            </button>
            {editing ? (
              <button
                type="button"
                onClick={() => onApprove(payload)}
                className="agent-intervention-primary flex items-center gap-1 rounded-control bg-ink px-4 py-2 text-[12px] font-semibold text-canvas"
              >
                <Icon name="verified" size={14} />
                核准已編輯 Payload
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="agent-intervention-primary flex items-center gap-1 rounded-control bg-ink px-4 py-2 text-[12px] font-semibold text-canvas"
                >
                  <Icon name="edit" size={14} />
                  編輯 Payload
                </button>
                <button
                  type="button"
                  onClick={() => onApprove(payload)}
                  className="agent-intervention-secondary rounded-control px-4 py-2 text-[12px] font-semibold text-accent-ink"
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
