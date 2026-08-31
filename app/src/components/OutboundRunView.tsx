import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { projectOutboundRunEvidence, type OutboundRunView as OutboundView } from '../agent/outbound/runEvidence'

const GUARD_MODE_COPY: Record<string, string> = {
  off: '未啟用 outbound gate；僅顯示可用的 metadata。',
  demo: '僅記錄判斷，不阻擋 outbound。',
  optional: '依目前政策允許或限制 outbound。',
  required: '必須通過 outbound policy 與必要證據才允許送出。',
}

const REDACTION_LABELS: Record<string, string> = {
  credential: '憑證與金鑰',
  'personal-data': '個人資料',
  financial: '財務資料',
  filesystem: '敏感路徑',
  'company-policy': '公司政策',
  classifier: '公司分類器',
  other: '其他',
}

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
  const guardModes = view
    ? [...new Set(view.records.map((record) => record.effectiveGuardMode).filter(Boolean) as string[])]
    : []
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
          <div className="mb-3 rounded-lg border border-line/40 bg-surface-container-high/45 px-3 py-2 text-[10px] text-on-surface-variant">
            {guardModes.length ? guardModes.map((mode) => (
              <p key={mode}><span className="font-semibold text-on-surface">{mode}</span>：{GUARD_MODE_COPY[mode] || '依該次 evidence 記錄判定 outbound。'}</p>
            )) : <p>本次沒有 guard mode evidence。</p>}
          </div>
          <div className="mb-3 rounded-lg border border-line/40 bg-surface-container-high/45 px-3 py-2">
            <p className="text-[10px] font-semibold text-on-surface">遮罩類別</p>
            <p className="mt-0.5 text-[10px] text-on-surface-variant">僅顯示分類與數量，不保留命中的敏感內容。</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {view.redactionSummary.length ? view.redactionSummary.map((entry) => (
                <span key={entry.category} className="rounded-full bg-primary/10 px-2 py-1 text-[10px] text-primary">
                  {REDACTION_LABELS[entry.category] || REDACTION_LABELS.other} · {entry.count}
                </span>
              )) : <span className="text-[10px] text-on-surface-variant">本次執行沒有分類遮罩紀錄。</span>}
            </div>
          </div>
          {view.records.length > 0 && (
            <div className="flex flex-col gap-1 text-[11px] font-[family-name:var(--font-mono)] text-on-surface-variant">
              {view.records.slice(-6).reverse().map((record) => (
                <div key={record.eventId} className="flex items-center justify-between gap-3 border-b border-line/30 py-1">
                  <span>{record.eventType} · {record.action || 'egress decision'}</span>
                  <span>{record.effectiveGuardMode || 'off'} · exclusions={record.exclusionCount}{record.redactionSummary?.length ? ` · ${record.redactionSummary.map((entry) => `${REDACTION_LABELS[entry.category] || REDACTION_LABELS.other} ${entry.count}`).join(' / ')}` : ''}</span>
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
