import { useMemo, useState } from 'react'
import type { SubDesignArtifact, SubDesignExportFormat } from '../../agent/subdesign/types'
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
]

export function ArtifactDeliveryPanel({
  artifact,
  critiquePassed,
}: {
  artifact: SubDesignArtifact | null
  critiquePassed: boolean
}) {
  const projectRoot = useProjectStore((state) => state.root)
  const requestAsk = usePermissionAskStore((state) => state.requestAsk)
  const records = useSubDesignExportStore((state) => state.records)
  const recordExport = useSubDesignExportStore((state) => state.record)
  const appendSubDesignExport = useThreadStore((state) => state.appendSubDesignExport)
  const brief = useSubDesignStore((state) => artifact ? state.findById(artifact.briefId) : null)
  const [busy, setBusy] = useState<SubDesignExportFormat | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recentRecords = useMemo(
    () => (artifact ? records.filter((record) => record.artifactId === artifact.id).slice(0, 3) : []),
    [artifact, records],
  )
  const exportAvailable = Boolean(window.subagents?.subdesign?.exportArtifact)

  const exportArtifact = async (format: SubDesignExportFormat) => {
    if (!artifact || !critiquePassed || !exportAvailable || busy) return
    setBusy(format)
    setMessage(null)
    setError(null)
    try {
      const decision = await requestAsk({
        tool: 'design_artifact_export',
        args: { artifactId: artifact.id, revision: artifact.revision, format },
        reason: `將 artifact「${artifact.title}」export 為 ${format.toUpperCase()}，並由你選擇輸出位置。`,
      })
      if (decision !== 'allow') {
        setMessage('Export 已取消或未獲核准。')
        return
      }
      const result = await window.subagents!.subdesign!.exportArtifact({
        artifact,
        format,
        projectRoot: projectRoot || undefined,
        suggestedName: artifact.title,
      })
      if (!result.ok) {
        if (result.cancelled) setMessage('使用者取消輸出位置選擇。')
        else setError(result.error || 'Export 失敗。')
        return
      }
      const record = recordExport({
        artifactId: artifact.id,
        revision: result.revision || artifact.revision,
        format,
        path: result.path || '',
        bytes: result.bytes || 0,
        sha256: result.sha256 || '',
      })
      if (brief?.threadId) {
        appendSubDesignExport(brief.threadId, {
          format: record.format,
          revision: record.revision,
          path: record.path,
          sha256: record.sha256,
        })
      }
      setMessage(`${format.toUpperCase()} 已輸出：${record.path} · sha256 ${record.sha256.slice(0, 16)}…`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-md border border-[#e7e3de] bg-white">
      <div className="flex items-center justify-between border-b border-[#efebe6] px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold"><Icon name="share" size={15} className="text-[#c96646]" /> Deliver / export</div>
        <span className="text-[9px] text-[#a39b93]">HITL required</span>
      </div>
      {!artifact ? <div className="px-3 py-5 text-center text-[10px] text-[#a39b93]">選擇 artifact 後才能交付。</div> : !critiquePassed ? (
        <div className="px-3 py-5 text-center text-[10px] leading-relaxed text-[#a24f36]">Critique 尚未 pass；修正 findings 後才可 export。</div>
      ) : !exportAvailable ? (
        <div className="px-3 py-5 text-center text-[10px] leading-relaxed text-[#a39b93]">HTML / ZIP / PDF export 需要 Electron desktop；browser preview 僅展示流程邊界。</div>
      ) : (
        <div className="space-y-2 p-3">
          <div className="grid grid-cols-3 gap-2">
            {FORMATS.map((item) => {
              const supported = artifact.exports.includes(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!supported || Boolean(busy)}
                  onClick={() => void exportArtifact(item.id)}
                  className="rounded-md border border-[#e6e1db] px-2 py-2 text-left transition-colors enabled:hover:border-[#c96646] disabled:cursor-not-allowed disabled:opacity-40"
                  title={supported ? item.description : `此 artifact 不支援 ${item.id}`}
                >
                  <span className="block text-[10px] font-semibold">{busy === item.id ? 'Exporting…' : item.label}</span>
                  <span className="mt-1 block text-[8px] leading-relaxed text-[#a19b93]">{item.description}</span>
                </button>
              )
            })}
          </div>
          {message ? <div className="rounded-md border border-[#d7e4d2] bg-[#f5faf3] px-2.5 py-2 text-[9px] leading-relaxed text-[#54724f]">{message}</div> : null}
          {error ? <div className="rounded-md border border-[#ead2c9] bg-[#fff7f3] px-2.5 py-2 text-[9px] leading-relaxed text-[#a24f36]">{error}</div> : null}
          {recentRecords.length ? <div className="border-t border-[#f0ece7] pt-2 text-[9px] text-[#817a73]">最近交付：{recentRecords.map((record) => `${record.format.toUpperCase()} r${record.revision}`).join(' · ')}</div> : null}
        </div>
      )}
    </section>
  )
}
