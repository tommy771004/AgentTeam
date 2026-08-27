/**
 * Ticket 16: one export producing the compliance document for a chosen period
 * or run set. It composes existing evidence via complianceReportSources and
 * writes through the same scoped project path used by learning export.
 */
import { useState } from 'react'
import { Icon } from './Icon'
import { useAgentStore } from '../store/agentStore'
import { useSubscriptionStore } from '../store/subscriptionStore'
import { collectComplianceReport } from '../agent/complianceReportSources'
import {
  renderComplianceReportJson,
  renderComplianceReportMarkdown,
} from '../agent/complianceReport'
import type { OutboundRunEvidenceRecord } from '../agent/outbound/runEvidence'
import { PAID_WORKFLOW_FEATURE_ID } from '../agent/paidWorkflow'

type Scope = 'all' | 'active-runs' | 'last-7-days'

export function ComplianceReportExport({ activeRunIds = [] }: { activeRunIds?: string[] }) {
  const archive = useAgentStore((state) => state.archive)
  const entitlement = useSubscriptionStore((state) => state.entitlement)
  const [scope, setScope] = useState<Scope>('all')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const run = async (format: 'md' | 'json') => {
    if (busy) return
    setBusy(true)
    setNotice('')
    try {
      const runIds =
        scope === 'active-runs'
          ? activeRunIds
          : scope === 'last-7-days'
            ? archive
                .filter((record) => Date.parse(record.timestamp) >= Date.now() - 7 * 86_400_000)
                .map((record) => record.id)
            : undefined
      const from =
        scope === 'last-7-days' ? new Date(Date.now() - 7 * 86_400_000).toISOString() : undefined

      // Outbound evidence is read from the main-process ledger; nothing new is
      // collected here, and the renderer never sees credential material.
      let outboundEvidence: OutboundRunEvidenceRecord[] = []
      const reader = window.subagents?.outbound?.runEvidence
      if (reader) {
        const targets = runIds?.length ? runIds : activeRunIds
        const batches = await Promise.all(targets.map((runId) => reader(runId).catch(() => [])))
        outboundEvidence = batches.flat() as OutboundRunEvidenceRecord[]
      }

      const report = collectComplianceReport({
        archive,
        outboundEvidence,
        entitlement,
        entitledFeatureIds: [String(PAID_WORKFLOW_FEATURE_ID)],
        period: { from, runIds },
      })
      const content =
        format === 'md'
          ? renderComplianceReportMarkdown(report)
          : renderComplianceReportJson(report)
      const relativePath = `.subagents/compliance/${report.reportId.replace(/[^a-zA-Z0-9._-]+/g, '-')}.${format}`

      const write = window.subagents?.learning?.export
      if (write) {
        const result = await write({ relativePath, content, overwrite: true })
        setNotice(result.ok ? `已輸出 ${result.path}` : result.error || '匯出失敗')
      } else {
        // Plain-browser development has no project bridge; hand the file over.
        const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
        const link = document.createElement('a')
        link.href = url
        link.download = relativePath.split('/').pop() || `compliance.${format}`
        link.click()
        URL.revokeObjectURL(url)
        setNotice('已於瀏覽器下載（Electron 會寫入專案 .subagents/）')
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="glass-panel rounded-xl p-5">
      <h2 className="font-semibold flex items-center gap-2 mb-3">
        <Icon name="verified_user" size={18} className="text-primary" />
        合規報告匯出
      </h2>
      <p className="text-xs text-on-surface-variant mb-3">
        彙整既有證據：授權決策、憑證引用（僅 metadata）、檔案變更、因 fingerprint 變更被封鎖的工具、
        entitlement 決策與 outbound 外送紀錄。不會新增任何蒐集，也不含原始憑證。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as Scope)}
          aria-label="合規報告範圍"
          className="min-h-8 cursor-pointer rounded-control bg-transparent px-3 py-2 text-xs text-on-surface-variant outline-none transition-colors hover:bg-hover-2 hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary/35"
        >
          <option value="all">全部既有證據</option>
          <option value="last-7-days">最近 7 天</option>
          <option value="active-runs">目前執行中的 run</option>
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run('md')}
          className="px-3 py-2 rounded-control text-xs font-semibold bg-primary-container text-on-primary-container disabled:opacity-50"
        >
          匯出 Markdown
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run('json')}
          className="px-3 py-2 rounded-control text-xs font-semibold border border-line disabled:opacity-50"
        >
          匯出 JSON
        </button>
      </div>
      {notice && <p className="text-[11px] text-on-surface-variant mt-2">{notice}</p>}
    </section>
  )
}
