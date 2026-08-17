import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { projectOutboundRunEvidence, type OutboundRunView as OutboundView } from '../agent/outbound/runEvidence'

export function OutboundRunView({ runId }: { runId?: string | null }) {
  const [view, setView] = useState<OutboundView | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!runId || !window.subagents?.outbound?.runEvidence) {
      setView(null)
      return () => { cancelled = true }
    }
    void window.subagents.outbound.runEvidence(runId).then((records) => {
      if (!cancelled) setView(projectOutboundRunEvidence(runId, records))
    }).catch(() => {
      if (!cancelled) setView(projectOutboundRunEvidence(runId, []))
    })
    return () => { cancelled = true }
  }, [runId])

  if (!runId) return null
  return (
    <section className="glass-panel rounded-xl p-5">
      <h2 className="font-semibold flex items-center gap-2 mb-3">
        <Icon name="policy" size={18} className="text-primary" />
        Outbound / DLP · {runId}
      </h2>
      {!view ? <p className="text-sm text-on-surface-variant">此環境沒有可讀取的 outbound metadata bridge。</p> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <Stat label="records" value={String(view.records.length)} />
            <Stat label="provider" value={view.providerIds.join(', ') || '—'} />
            <Stat label="redaction" value={String(view.redactionEvents)} />
            <Stat label="sealed" value={String(view.sealedRecords)} />
          </div>
          {view.records.length > 0 && (
            <div className="flex flex-col gap-1 text-[11px] font-[family-name:var(--font-mono)] text-on-surface-variant">
              {view.records.slice(-6).reverse().map((record) => (
                <div key={record.eventId} className="flex items-center justify-between gap-3 border-b border-line/30 py-1">
                  <span>{record.eventType} · {record.action || 'egress decision'}</span>
                  <span>{record.effectiveGuardMode || 'off'} · exclusions={record.exclusionCount}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-surface-container-high px-3 py-2"><p className="text-[10px] uppercase tracking-widest text-on-surface-variant">{label}</p><p className="text-xs mt-1 truncate">{value}</p></div>
}
