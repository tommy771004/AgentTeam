import { useState } from 'react'
import { Icon } from './Icon'
import type { WorkflowStageDeliverable } from '../agent/paidWorkflow.ts'

/**
 * Inspect / approve / reject surface for paid-workflow stage artifacts
 * (ticket 17). The value of the workflow is its deliverables, so each stage
 * can be opened and read, and sent back with a reason rather than only
 * forward. Merge, push and deploy are never actions here — they stay
 * explicitly outside. Once every stage is approved the panel collapses to a
 * single settled line; the artifacts stay addressable underneath it.
 */

const STATUS_LABEL: Record<WorkflowStageDeliverable['status'], string> = {
  pending: '進行中',
  ready: '已就緒',
  failed: '失敗',
  rejected: '已退回',
}

const STATUS_STYLE: Record<WorkflowStageDeliverable['status'], string> = {
  pending: 'border-warning/30 text-warning',
  ready: 'border-success/30 text-success',
  failed: 'border-error/30 text-error',
  rejected: 'border-error/30 text-error',
}

const TYPE_LABEL: Record<string, string> = {
  spec: '規格',
  ticket: '票券',
  test: '測試',
  diff: '變更',
  review: '審查',
  decision: '決策',
  'final-output': '最終產出',
}

function statusBadge(deliverable: WorkflowStageDeliverable) {
  if (deliverable.approvedAt) {
    return <span className="text-[10px] px-2 py-1 rounded border border-success/30 text-success">已核准</span>
  }
  return (
    <span className={`text-[10px] px-2 py-1 rounded border ${STATUS_STYLE[deliverable.status]}`}>
      {STATUS_LABEL[deliverable.status]}
    </span>
  )
}

export function WorkflowDeliverablesPanel({
  deliverables,
  onApprove,
  onReject,
}: {
  deliverables: WorkflowStageDeliverable[]
  onApprove?: (deliverable: WorkflowStageDeliverable) => void
  onReject?: (deliverable: WorkflowStageDeliverable, reason: string) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [showSettled, setShowSettled] = useState(false)

  const blocking = deliverables.find((item) => item.status !== 'ready')
  const allApproved = deliverables.length > 0 && deliverables.every((item) => item.approvedAt)
  const collapsed = allApproved && !showSettled

  const summary = allApproved
    ? `Workflow 產出已全部核准（${deliverables.length} 個階段）。`
    : blocking
      ? `目前卡在：${blocking.title}（${STATUS_LABEL[blocking.status]}）`
      : '所有階段皆已就緒，等待使用者核准。'

  return (
    <section className="glass-panel rounded-xl p-5">
      <h2 className="font-semibold flex items-center gap-2 mb-1">
        <Icon name="inventory_2" size={18} className="text-primary" />
        Workflow 階段產出
      </h2>
      <p className="text-xs text-on-surface-variant mb-3">
        {summary}
        {' · '}merge／push／deploy 僅能由使用者明確核准後執行。
        {allApproved && (
          <button
            type="button"
            className="ml-2 text-primary hover:underline"
            onClick={() => setShowSettled(!showSettled)}
          >
            {showSettled ? '收合' : '展開'}
          </button>
        )}
      </p>
      <div className="flex flex-col divide-y divide-line/50">
        {deliverables.length === 0 ? (
          <p className="text-sm text-on-surface-variant py-3">尚未產生 workflow 產出。</p>
        ) : collapsed ? null : deliverables.map((deliverable) => (
          <div key={deliverable.id} className="py-3 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm">
                  {deliverable.title}
                  {deliverable.approvedAt ? <span className="text-on-surface-variant"> · 已核准</span> : null}
                </p>
                <p className="text-[11px] text-on-surface-variant">
                  第 {deliverable.revision} 版 · {deliverable.evidence.length} 項證據
                </p>
                {deliverable.rejectionReason && (
                  <p className="text-xs text-error mt-1">
                    退回：{deliverable.rejectionReason}
                    {deliverable.rejectedAt ? `（${deliverable.rejectedAt}）` : ''}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {statusBadge(deliverable)}
                <button
                  type="button"
                  className="text-[11px] text-on-surface-variant hover:underline"
                  onClick={() => setOpenId(openId === deliverable.id ? null : deliverable.id)}
                >
                  {openId === deliverable.id ? '收合' : '開啟'}
                </button>
                {onApprove && deliverable.status === 'ready' && !deliverable.approvedAt && (
                  <button
                    type="button"
                    className="text-[11px] text-success hover:underline"
                    onClick={() => onApprove(deliverable)}
                  >
                    核准
                  </button>
                )}
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
                    <span className="font-semibold">{item.title || TYPE_LABEL[item.type] || item.type}</span>
                    <span className="text-on-surface-variant"> · {item.status === 'complete' ? '完成' : item.status === 'pending' ? '進行中' : item.status === 'failed' ? '失敗' : item.status === 'stale' ? '已過時' : '遺失'}</span>
                    {item.detail && !item.detail.startsWith('退回：') && !item.detail.startsWith('核准：') && (
                      <div className="text-on-surface-variant">{item.detail}</div>
                    )}
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
