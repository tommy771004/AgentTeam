import { useEffect, useMemo, useState } from 'react'
import type { SubDesignArtifact, SubDesignCritique, SubDesignExportFormat } from '../../agent/subdesign/types'
import { usePermissionAskStore } from '../../store/permissionAskStore'
import { useProjectStore } from '../../store/projectStore'
import { useSubDesignExportStore } from '../../store/subDesignExportStore'
import { useSubDesignStore } from '../../store/subDesignStore'
import { useThreadStore } from '../../store/threadStore'
import { Icon } from '../Icon'
import { ArtifactRevisionDiff } from './ArtifactRevisionDiff'

const FORMATS: ReadonlyArray<{ id: SubDesignExportFormat; label: string; description: string }> = [
  { id: 'html', label: 'HTML', description: '可直接開啟的 prototype' },
  { id: 'zip', label: 'ZIP', description: 'manifest + supporting files' },
  { id: 'pdf', label: 'PDF', description: '列印版交接文件' },
  { id: 'pptx', label: 'PPTX', description: '單頁摘要，不是逐頁 deck' },
  { id: 'mp4', label: 'MP4', description: '3 秒靜態縮圖，需要 ffmpeg' },
]

function defaultFormat(artifact: SubDesignArtifact, supported: typeof FORMATS): SubDesignExportFormat | null {
  if (artifact.kind === 'deck' && supported.some((format) => format.id === 'pptx')) return 'pptx'
  return supported.find((format) => format.id === 'html')?.id
    || supported.find((format) => format.id === 'zip')?.id
    || supported[0]?.id
    || null
}

function recommendationCopy(format: SubDesignExportFormat): string {
  if (format === 'pptx') return '建議以 PPTX 單頁摘要交付供快速 review；需要完整互動內容時，另保留 HTML。'
  if (format === 'html') return '建議以 HTML 保留目前 artifact 的完整互動與版面，適合作為主要交付。'
  if (format === 'zip') return '建議以 ZIP 一併交付 manifest 與 supporting files，方便接手與封存。'
  if (format === 'pdf') return '建議以 PDF 提供穩定的列印與審閱版本。'
  return '建議以 MP4 靜態預覽分享目前畫面；此輸出需要本機 ffmpeg。'
}

function ConfidenceMeter({ signal }: { signal: number }) {
  return (
    <span className="flex items-end gap-0.5" aria-label={`${signal} of 3 confidence`}>
      {[0, 1, 2].map((bar) => (
        <span key={bar} className={`w-1 rounded-full ${bar < signal ? 'bg-primary' : 'bg-white/[0.12]'}`} style={{ height: 7 + bar * 2 }} />
      ))}
    </span>
  )
}

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
  const [alternativesOpen, setAlternativesOpen] = useState(false)
  const [selectedFormat, setSelectedFormat] = useState<SubDesignExportFormat | null>(null)
  const recentRecords = useMemo(() => (artifact ? records.filter((record) => record.artifactId === artifact.id).slice(0, 3) : []), [artifact, records])
  const exportAvailable = Boolean(window.subagents?.subdesign?.exportArtifact)
  const supportedFormats = useMemo(
    () => artifact ? FORMATS.filter((format) => artifact.exports.includes(format.id) && (format.id !== 'mp4' || mp4Available === true)) : [],
    [artifact, mp4Available],
  )
  const recommendedFormat = artifact
    ? supportedFormats.find((format) => format.id === selectedFormat)?.id || defaultFormat(artifact, supportedFormats)
    : null
  const recommendedOption = FORMATS.find((format) => format.id === recommendedFormat) || null
  const score = critique
    ? Math.round((critique.briefCoverage + critique.brandConformance + critique.accessibility + critique.implementationReadiness) / 4)
    : 0
  const confidenceSignal = score >= 85 ? 3 : score >= 70 ? 2 : 1
  const confidenceLabel = confidenceSignal === 3 ? '高信心' : confidenceSignal === 2 ? '需確認' : '低信號'

  useEffect(() => {
    const capabilities = window.subagents?.subdesign?.exportCapabilities
    if (!capabilities) return
    void capabilities().then((result) => setMp4Available(result.mp4)).catch(() => setMp4Available(false))
  }, [])

  useEffect(() => {
    setSelectedFormat(null)
    setAlternativesOpen(false)
  }, [artifact?.id, artifact?.revision])

  const exportArtifact = async (format: SubDesignExportFormat) => {
    if (!artifact || !critiquePassed || !exportAvailable || busy || (format === 'mp4' && mp4Available !== true)) return
    setBusy(format)
    setMessage(null)
    setError(null)
    try {
      const decision = await requestAsk({ tool: 'design_artifact_export', args: { artifactId: artifact.id, revision: artifact.revision, format }, reason: `將 artifact「${artifact.title}」export 為 ${format.toUpperCase()}，並由你選擇輸出位置。` })
      if (decision.decision !== 'allow') {
        setMessage('Export 已取消或未獲核准。')
        return
      }
      const result = await window.subagents!.subdesign!.exportArtifact({ artifact, critique, format, projectRoot: projectRoot || undefined, suggestedName: artifact.title })
      if (!result.ok) {
        if (result.cancelled) setMessage('使用者取消輸出位置選擇。')
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
      <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-on-surface"><Icon name="share" size={16} className="text-primary" /> Deliver / export</div>
        <span className="text-[11px] text-outline">HITL required</span>
      </div>

      {!artifact ? (
        <div className="px-4 py-7 text-center text-[12px] text-outline">選擇 artifact 後才能交付。</div>
      ) : (
        <div className="space-y-4 p-4">
          {!critiquePassed ? (
            <div className="rounded-xl border border-error/25 bg-error/[0.07] px-3 py-3 text-[11px] leading-relaxed text-error">
              Critique 尚未 pass；修正 findings 與 evidence 後才可 export。Revision diff 仍可在下方檢查。
            </div>
          ) : recommendedOption ? (
            <section className="overflow-hidden rounded-xl border border-white/[0.1] bg-surface-container-low shadow-card" aria-label="Recommendation Card">
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-semibold text-on-surface">要以 {recommendedOption.label} 交付嗎？</p>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-on-surface-variant">{recommendationCopy(recommendedOption.id)}</p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-[9px] font-medium text-primary">
                    <ConfidenceMeter signal={confidenceSignal} />{confidenceLabel} · {score}
                  </span>
                </div>
              </div>

              {alternativesOpen ? (
                <div className="border-t border-white/[0.08] bg-white/[0.025] p-2">
                  <p className="px-2 pb-1 text-[9px] font-semibold text-outline">其他格式</p>
                  {supportedFormats.filter((format) => format.id !== recommendedOption.id).map((format) => (
                    <button
                      key={format.id}
                      type="button"
                      onClick={() => {
                        setSelectedFormat(format.id)
                        setAlternativesOpen(false)
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.06]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[10px] font-semibold text-on-surface">{format.label}</span>
                        <span className="block truncate text-[9px] text-outline">{format.description}</span>
                      </span>
                      <span className="text-[9px] text-primary">採用</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
                <button type="button" aria-expanded={alternativesOpen} onClick={() => setAlternativesOpen((value) => !value)} className="h-7 rounded-lg px-2 text-[10px] font-medium text-outline transition-colors hover:bg-white/[0.06] hover:text-on-surface">
                  其他選項
                </button>
                <button
                  type="button"
                  disabled={!exportAvailable || Boolean(busy)}
                  onClick={() => void exportArtifact(recommendedOption.id)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon name={busy === recommendedOption.id ? 'progress_activity' : 'check'} size={13} className={busy === recommendedOption.id ? 'animate-spin' : ''} />
                  {busy === recommendedOption.id ? 'Exporting…' : `採用 ${recommendedOption.label}`}
                </button>
              </div>
            </section>
          ) : (
            <div className="text-[11px] text-outline">此 artifact 尚未宣告可交付格式。</div>
          )}

          {critiquePassed ? (
            <section aria-label="Export formats">
              {!exportAvailable ? (
                <div className="mb-3 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-3 text-[11px] leading-relaxed text-outline">
                  Export 需要 Electron desktop；PPTX 是單頁摘要，MP4 是 3 秒靜態縮圖且需要 ffmpeg。
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {FORMATS.map((item) => {
                  const supported = artifact.exports.includes(item.id) && (item.id !== 'mp4' || mp4Available === true)
                  const title = item.id === 'mp4' && mp4Available === null ? '正在檢查 ffmpeg…' : supported ? item.description : item.id === 'mp4' && mp4Available === false ? '找不到 ffmpeg' : `此 artifact 不支援 ${item.id}`
                  return (
                    <button key={item.id} type="button" disabled={!supported || !exportAvailable || Boolean(busy)} onClick={() => void exportArtifact(item.id)} className="rounded-xl border border-white/10 bg-surface-container-low px-2.5 py-2.5 text-left transition-colors enabled:hover:border-primary/40 enabled:hover:bg-primary/[0.07] disabled:cursor-not-allowed disabled:opacity-40" title={title}>
                      <span className="block text-[12px] font-semibold text-on-surface">{busy === item.id ? 'Exporting…' : item.label}</span>
                      <span className="mt-1 block text-[11px] leading-relaxed text-outline">{item.description}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ) : null}

          {message ? <div className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2.5 text-[11px] leading-relaxed text-primary">{message}</div> : null}
          {error ? <div className="rounded-xl border border-error/30 bg-error/10 px-3 py-2.5 text-[11px] leading-relaxed text-error">{error}</div> : null}
          {recentRecords.length ? <div className="border-t border-white/[0.08] pt-3 text-[11px] text-outline">最近交付：{recentRecords.map((record) => `${record.format.toUpperCase()} r${record.revision}`).join(' · ')}</div> : null}

          <section className="overflow-hidden rounded-xl border border-white/[0.08]" aria-label="Diff Table">
            <ArtifactRevisionDiff artifactId={artifact.id} projectRoot={projectRoot || undefined} />
          </section>
        </div>
      )}
    </section>
  )
}
