import { useState } from 'react'
import { Icon } from './Icon'
import type { AgentState } from '../agent/types'
import { useProjectStore } from '../store/projectStore'
import { MarkdownBody } from './MarkdownBody'

function formatDuration(ms: number) {
  if (!ms) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export function ReportModal({
  agent,
  open,
  onClose,
}: {
  agent: AgentState
  open: boolean
  onClose: () => void
}) {
  const [status, setStatus] = useState<string | null>(null)
  const projectRoot = useProjectStore((s) => s.root)

  if (!open) return null

  const title = agent.reportTitle || '最終輸出 Payload'
  const md = agent.result || '_尚無報告內容。_'
  const filename = `${(title || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'report'}.md`

  const download = () => {
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    setStatus(`已下載 ${filename}`)
  }

  const copy = async () => {
    await navigator.clipboard.writeText(md)
    setStatus('已複製報告全文')
  }

  /** 分享：複製可轉貼摘要（非公開網址服務） */
  const share = async () => {
    const summary = [
      `# ${title}`,
      ``,
      `狀態：${agent.status}`,
      `目標：${agent.objective || '—'}`,
      `tokens：${agent.tokensUsed || 0}`,
      `時間：${formatDuration(agent.metrics?.executionMs || 0)}`,
      ``,
      '---',
      '',
      md.slice(0, 8000),
    ].join('\n')
    try {
      if (navigator.share) {
        await navigator.share({ title, text: summary })
        setStatus('已開啟系統分享')
      } else {
        await navigator.clipboard.writeText(summary)
        setStatus('已複製分享摘要到剪貼簿')
      }
    } catch {
      await navigator.clipboard.writeText(summary)
      setStatus('已複製分享摘要到剪貼簿')
    }
  }

  /** 匯出到目前專案 reports/ */
  const exportToProject = async () => {
    if (!window.subagents?.tools?.workspaceWrite) {
      download()
      setStatus('非 Electron：改為本機下載')
      return
    }
    if (!projectRoot) {
      download()
      setStatus('未選專案目錄：改為本機下載')
      return
    }
    const r = await window.subagents.tools.workspaceWrite(`reports/${filename}`, md)
    setStatus(
      r.ok
        ? `已寫入 ${projectRoot}/reports/${filename}`
        : `寫入失敗，已改下載：${r.error || ''}`,
    )
    if (!r.ok) download()
  }

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-end md:justify-center p-4 md:p-8"
      onClick={onClose}
    >
      <div
        className="glass-panel rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-raised border border-line"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-9 w-5 items-center justify-center shrink-0">
              <Icon name="description" size={20} className="text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="font-[family-name:var(--font-sora)] font-semibold text-on-surface truncate">
                最終輸出 Payload
              </h2>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider uppercase text-secondary">
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
                  已生成報告
                </span>
                <span className="text-xs text-outline font-[family-name:var(--font-mono)] truncate">
                  {filename}
                </span>
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-outline hover:text-on-surface p-1">
            <Icon name="close" size={22} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-px bg-surface-container-low border-b border-line shrink-0">
          <Metric
            icon="memory"
            label="VRAM 用量"
            value={agent.metrics.vramLabel}
          />
          <Metric
            icon="token"
            label="API 用量"
            value={`${agent.metrics.apiCredits || agent.tokensUsed || 0} tokens`}
          />
          <Metric
            icon="schedule"
            label="執行時間"
            value={formatDuration(agent.metrics.executionMs)}
          />
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
          <MarkdownBody content={md} />
        </div>

        <div className="flex flex-col gap-2 px-5 py-3 border-t border-line shrink-0 bg-surface-container-low/50">
          {status && (
            <p className="text-[11px] text-primary font-[family-name:var(--font-mono)]">{status}</p>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void copy()}
                className="w-9 h-9 rounded-control border border-line flex items-center justify-center text-on-surface-variant hover:text-primary hover:border-line-strong"
                title="複製"
              >
                <Icon name="content_copy" size={18} />
              </button>
              <button
                type="button"
                onClick={download}
                className="w-9 h-9 rounded-control border border-line flex items-center justify-center text-on-surface-variant hover:text-primary hover:border-line-strong"
                title="下載 Markdown"
              >
                <Icon name="download" size={18} />
              </button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void share()}
                className="px-3 py-2 rounded-control border border-line text-xs font-semibold tracking-wider uppercase text-on-surface-variant hover:text-primary flex items-center gap-1"
              >
                <Icon name="share" size={14} />
                分享
              </button>
              <button
                type="button"
                onClick={() => void exportToProject()}
                className="px-3 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs font-semibold tracking-wider uppercase hover:brightness-110 flex items-center gap-1"
              >
                <Icon name="deployed_code" size={14} />
                匯出至專案
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Metric({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="bg-surface-container-low px-3 py-3 flex flex-col gap-0.5">
      <span className="text-[10px] tracking-widest uppercase text-outline font-semibold flex items-center gap-1">
        <Icon name={icon} size={12} />
        {label}
      </span>
      <span className="font-[family-name:var(--font-mono)] text-sm text-on-surface">{value}</span>
    </div>
  )
}
