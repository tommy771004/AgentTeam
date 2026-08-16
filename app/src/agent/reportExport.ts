/**
 * Run report 匯出動作（dod-verified-reports 票 08）。
 *
 * 組 ReportSourceBundle（journal list + archive + thread 摘要）→ 文件模型 →
 * 序列化 → 落地。落地重用 ReportModal 縫隙：Electron 且有專案根目錄時
 * workspaceWrite 到 reports/；否則 Blob 下載降級。檔名含 runId＋日期。
 */
import { listJournal } from './runJournal'
import { resolveReportSource, type ReportSourceBundle } from './reportSource'
import { buildRunReportModel, renderRunReportHtml, renderRunReportMarkdown, renderTranscriptMarkdown } from './runReport'
import type { ArchiveRecord } from './types'
import type { ThreadRunSummary } from '../store/threadStore'

export type ReportFormat = 'md' | 'html'

/** 從渲染器 stores 組單一 run 的來源束（journal/archive/threads 全為參數注入的 store 讀取） */
export function collectReportSource(args: {
  runId?: string
  threadId?: string
  journal?: ReturnType<typeof listJournal>
  archive?: ArchiveRecord[]
  threadSummaries?: Record<string, ThreadRunSummary | undefined>
}): ReportSourceBundle {
  const runId = args.runId || `thread_${args.threadId || 'unknown'}`
  return resolveReportSource({
    runId,
    journal: args.journal ?? listJournal(),
    archive: args.archive ?? [],
    threadSummaries: args.threadSummaries ?? {},
  })
}

export function reportFileName(runId: string, format: ReportFormat, generatedAt = new Date()): string {
  const stamp = `${generatedAt.getFullYear()}${String(generatedAt.getMonth() + 1).padStart(2, '0')}${String(
    generatedAt.getDate(),
  ).padStart(2, '0')}-${String(generatedAt.getHours()).padStart(2, '0')}${String(generatedAt.getMinutes()).padStart(2, '0')}`
  return `report-${runId}-${stamp}.${format}`
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export async function exportRunReport(args: {
  bundle: ReportSourceBundle
  format: ReportFormat
  projectRoot?: string
}): Promise<{ ok: boolean; message: string }> {
  const { bundle, format, projectRoot } = args
  const model = buildRunReportModel(bundle, { generatedAt: new Date().toISOString() })
  const content =
    format === 'html' ? renderRunReportHtml(model) : renderRunReportMarkdown(model)
  const filename = reportFileName(bundle.runId, format)
  const mime = format === 'html' ? 'text/html' : 'text/markdown'

  const workspaceWrite = window.subagents?.tools?.workspaceWrite
  if (workspaceWrite && projectRoot) {
    try {
      const result = await workspaceWrite(`reports/${filename}`, content)
      if (result.ok) {
        return { ok: true, message: `已寫入 ${projectRoot}/reports/${filename}` }
      }
      downloadBlob(content, filename, mime)
      return { ok: false, message: `寫入失敗，已改下載：${result.error || ''}` }
    } catch (e) {
      downloadBlob(content, filename, mime)
      return { ok: false, message: `寫入例外，已改下載：${e instanceof Error ? e.message : String(e)}` }
    }
  }
  downloadBlob(content, filename, mime)
  return {
    ok: true,
    message: workspaceWrite ? '未選專案目錄：已改本機下載' : '非 Electron：已改本機下載',
  }
}
