import { useEffect, useMemo, useState } from 'react'
import type { SubDesignArtifact, SubDesignCritique, SubDesignExportFormat } from '../../agent/subdesign/types'
import { usePermissionAskStore } from '../../store/permissionAskStore'
import { useProjectStore } from '../../store/projectStore'
import { useSubDesignExportStore } from '../../store/subDesignExportStore'
import { useSubDesignStore } from '../../store/subDesignStore'
import { useThreadStore } from '../../store/threadStore'
import { Icon } from '../Icon'

const FORMATS: ReadonlyArray<{ id: SubDesignExportFormat; label: string; description: string }> = [
  { id: 'html', label: 'HTML', description: '可直接開啟的 prototype' },
  { id: 'zip', label: 'ZIP', description: 'manifest + supporting files' },
  { id: 'pdf', label: 'PDF', description: '列印版交接文件' },
  { id: 'pptx', label: 'PPTX', description: '單頁摘要，不是逐頁 deck' },
  { id: 'mp4', label: 'MP4', description: '3 秒靜態縮圖，需要 ffmpeg' },
]

export function ArtifactDeliveryPanel({ artifact, critique, critiquePassed }: { artifact: SubDesignArtifact | null; critique: SubDesignCritique | null; critiquePassed: boolean }) {
  const projectRoot = useProjectStore((state) => state.root)
  const requestAsk = usePermissionAskStore((state) => state.requestAsk)
  const records = useSubDesignExportStore((state) => state.records)
  const recordExport = useSubDesignExportStore((state) => state.record)
  const appendSubDesignExport = useThreadStore((state) => state.appendSubDesignExport)
  const brief = useSubDesignStore((state) => artifact ? state.findById(artifact.briefId) : null)
  const [busy, setBusy] = useState<SubDesignExportFormat | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mp4Available, setMp4Available] = useState<boolean | null>(null)
  const recentRecords = useMemo(() => (artifact ? records.filter((record) => record.artifactId === artifact.id).slice(0, 3) : []), [artifact, records])
  const exportAvailable = Boolean(window.subagents?.subdesign?.exportArtifact)

  useEffect(() => {
    const capabilities = window.subagents?.subdesign?.exportCapabilities
    if (!capabilities) return
    void capabilities().then((result) => setMp4Available(result.mp4)).catch(() => setMp4Available(false))
  }, [])

  const exportArtifact = async (format: SubDesignExportFormat) => {
    if (!artifact || !critiquePassed || !exportAvailable || busy || (format === 'mp4' && mp4Available !== true)) return
    setBusy(format)
    setMessage(null)
    setError(null)
    try {
      const decision = await requestAsk({ tool: 'design_artifact_export', args: { artifactId: artifact.id, revision: artifact.revision, format }, reason: `將 artifact「${artifact.title}」export 為 ${format.toUpperCase()}，並由你選擇輸出位置。` })
      if (decision !== 'allow') {
        setMessage('Export 已取消或未獲核准。')
        return
      }
      const result = await window.subagents!.subdesign!.exportArtifact({ artifact, critique, format, projectRoot: projectRoot || undefined, suggestedName: artifact.title })
      if (!result.ok) {
        if (result.cancelled) setMessage('使用者取消輸出位置選擇.')
        else setError(result.error || 'Export 失敗。')
        return
      }
      const record = recordExport({ artifactId: artifact.id, revision: result.revision || artifact.revision, format, path: result.path || '', bytes: result.bytes || 0, sha256: result.sha256 || '', projectRoot: projectRoot || undefined })
      if (brief?.threadId) appendSubDesignExport(brief.threadId, { format: record.format, revision: record.revision, path: record.path, sha256: record.sha256 })
      setMessage(`${format.toUpperCase()} 已輸出：${record.path} · sha256 ${record.sha256.slice(0, 16)}…`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="app-panel">
      <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3"><div className="flex items-center gap-2 text-[12px] font-semibold text-on-surface"><Icon name="share" size={16} className="text-primary" /> Deliver / export</div><span className="text-[11px] text-outline">HITL required</span></div>
      {!artifact ? <div className="px-4 py-7 text-center text-[12px] text-outline">選擇 artifact 後才能交付。</div> : !critiquePassed ? <div className="px-4 py-7 text-center text-[12px] leading-relaxed text-error">Critique 尚未 pass；修正 findings 與 evidence 後才可 export。</div> : !exportAvailable ? <div className="px-4 py-7 text-center text-[12px] leading-relaxed text-outline">HTML / ZIP / PDF / PPTX / MP4 export 需要 Electron desktop；PPTX 是單頁摘要，MP4 是 3 秒靜態縮圖且需要 ffmpeg。</div> : (
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{FORMATS.map((item) => { const supported = artifact.exports.includes(item.id) && (item.id !== 'mp4' || mp4Available === true); const title = item.id === 'mp4' && mp4Available === null ? '正在檢查 ffmpeg…' : supported ? item.description : item.id === 'mp4' && mp4Available === false ? '找不到 ffmpeg' : `此 artifact 不支援 ${item.id}`; return <button key={item.id} type="button" disabled={!supported || Boolean(busy)} onClick={() => void exportArtifact(item.id)} className="rounded-xl border border-white/10 bg-surface-container-low px-2.5 py-2.5 text-left transition-colors enabled:hover:border-primary/40 enabled:hover:bg-primary/[0.07] disabled:cursor-not-allowed disabled:opacity-40" title={title}><span className="block text-[12px] font-semibold text-on-surface">{busy === item.id ? 'Exporting…' : item.label}</span><span className="mt-1 block text-[11px] leading-relaxed text-outline">{item.description}</span></button> })}</div>
          {message ? <div className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2.5 text-[11px] leading-relaxed text-primary">{message}</div> : null}
          {error ? <div className="rounded-xl border border-error/30 bg-error/10 px-3 py-2.5 text-[11px] leading-relaxed text-error">{error}</div> : null}
          {recentRecords.length ? <div className="border-t border-white/[0.08] pt-3 text-[11px] text-outline">最近交付：{recentRecords.map((record) => `${record.format.toUpperCase()} r${record.revision}`).join(' · ')}</div> : null}
        </div>
      )}
    </section>
  )
}
