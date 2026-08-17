import { Icon } from './Icon'
import type { WorkflowStageDeliverable } from '../agent/paidWorkflow.ts'

/** Reusable inspect/reject surface for paid workflow stage artifacts. */
export function WorkflowDeliverablesPanel({
  deliverables,
  onReject,
}: {
  deliverables: WorkflowStageDeliverable[]
  onReject?: (deliverable: WorkflowStageDeliverable) => void
}) {
  return (
    <section className="glass-panel rounded-xl p-5">
      <h2 className="font-semibold flex items-center gap-2 mb-3">
        <Icon name="inventory_2" size={18} className="text-primary" />
        Workflow stage deliverables
      </h2>
      <div className="flex flex-col divide-y divide-line/50">
        {deliverables.length === 0 ? <p className="text-sm text-on-surface-variant py-3">尚未產生 workflow deliverable。</p> : deliverables.map((deliverable) => (
          <div key={deliverable.id} className="py-3 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm">{deliverable.title}</p>
              <p className="text-[11px] text-on-surface-variant font-[family-name:var(--font-mono)]">
                {deliverable.stage} · revision {deliverable.revision} · {deliverable.evidence.length} evidence
              </p>
              {deliverable.rejectionReason && <p className="text-xs text-error mt-1">退回：{deliverable.rejectionReason}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-[10px] px-2 py-1 rounded border ${deliverable.status === 'ready' ? 'border-success/30 text-success' : deliverable.status === 'rejected' ? 'border-error/30 text-error' : 'border-warning/30 text-warning'}`}>
                {deliverable.status}
              </span>
              {onReject && deliverable.rejectable && deliverable.status !== 'rejected' && (
                <button type="button" className="text-[11px] text-error hover:underline" onClick={() => onReject(deliverable)}>
                  Reject
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
