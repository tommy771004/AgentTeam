import { useState } from 'react'
import { Icon } from './Icon'
import type { WorkflowStageDeliverable } from '../agent/paidWorkflow.ts'

/**
 * Inspect / reject surface for paid-workflow stage artifacts (ticket 17).
 * The value of the workflow is its deliverables, so each stage can be opened
 * and read, and sent back with a reason rather than only forward. Merge, push
 * and deploy are never actions here — they stay explicitly outside.
 */
export function WorkflowDeliverablesPanel({
  deliverables,
  onReject,
}: {
  deliverables: WorkflowStageDeliverable[]
  onReject?: (deliverable: WorkflowStageDeliverable, reason: string) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  // The blocking gate is the first stage that is not ready.
  const blocking = deliverables.find((item) => item.status !== 'ready')

  return (
    <section className="glass-panel rounded-xl p-5">
      <h2 className="font-semibold flex items-center gap-2 mb-1">
        <Icon name="inventory_2" size={18} className="text-primary" />
        Workflow stage deliverables
      </h2>
      <p className="text-xs text-on-surface-variant mb-3">
        {blocking
          ? `目前卡在：${blocking.title}（${blocking.status}）`
          : '所有階段皆已就緒，等待使用者核准。'}
        {' · '}merge／push／deploy 僅能由使用者明確核准後執行。
      </p>
      <div className="flex flex-col divide-y divide-line/50">
        {deliverables.length === 0 ? <p className="text-sm text-on-surface-variant py-3">尚未產生 workflow deliverable。</p> : deliverables.map((deliverable) => (
          <div key={deliverable.id} className="py-3 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm">{deliverable.title}</p>
                <p className="text-[11px] text-on-surface-variant font-[family-name:var(--font-mono)]">
                  {deliverable.id} · revision {deliverable.revision} · {deliverable.evidence.length} evidence
                </p>
                {deliverable.rejectionReason && (
                  <p className="text-xs text-error mt-1">
                    退回：{deliverable.rejectionReason}
                    {deliverable.rejectedAt ? `（${deliverable.rejectedAt}）` : ''}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[10px] px-2 py-1 rounded border ${deliverable.status === 'ready' ? 'border-success/30 text-success' : deliverable.status === 'rejected' ? 'border-error/30 text-error' : 'border-warning/30 text-warning'}`}>
                  {deliverable.status}
                </span>
                <button
                  type="button"
                  className="text-[11px] text-on-surface-variant hover:underline"
                  onClick={() => setOpenId(openId === deliverable.id ? null : deliverable.id)}
                >
                  {openId === deliverable.id ? '收合' : '開啟'}
                </button>
                {onReject && deliverable.status !== 'rejected' && (
                  <button
                    type="button"
                    className="text-[11px] text-error hover:underline"
                    onClick={() => {
                      setRejectingId(deliverable.id)
                      setReason('')
                    }}
                  >
                    退回
                  </button>
                )}
              </div>
            </div>

            {openId === deliverable.id && (
              <div className="rounded-lg border border-line bg-surface-container p-3 flex flex-col gap-1.5">
                {deliverable.evidence.map((item, index) => (
                  <div key={`${item.type}-${item.source}-${index}`} className="text-[11px]">
                    <span className="font-semibold">{item.title || item.type}</span>
                    <span className="text-on-surface-variant"> · {item.status}</span>
                    <div className="font-[family-name:var(--font-mono)] text-on-surface-variant break-all">
                      {item.source}
                    </div>
                    {item.detail && <div className="text-on-surface-variant">{item.detail}</div>}
                  </div>
                ))}
              </div>
            )}

            {rejectingId === deliverable.id && onReject && (
              <div className="flex items-center gap-2">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="退回原因（必填）"
                  className="flex-1 px-3 py-2 rounded-control text-xs bg-surface-container-high border border-line"
                />
                <button
                  type="button"
                  disabled={!reason.trim()}
                  className="px-3 py-2 rounded-control text-xs font-semibold bg-error/10 text-error disabled:opacity-50"
                  onClick={() => {
                    onReject(deliverable, reason.trim())
                    setRejectingId(null)
                    setReason('')
                  }}
                >
                  送出退回
                </button>
                <button
                  type="button"
                  className="px-2 py-2 text-xs text-on-surface-variant"
                  onClick={() => setRejectingId(null)}
                >
                  取消
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
