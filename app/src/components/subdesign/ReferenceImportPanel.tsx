import { useState } from 'react'
import type { SubDesignBrief, SubDesignReference } from '../../agent/subdesign/types'
import { useProjectStore } from '../../store/projectStore'
import { useSubDesignStore } from '../../store/subDesignStore'
import { Icon } from '../Icon'

export function ReferenceImportPanel({ brief }: { brief: SubDesignBrief | null }) {
  const projectRoot = useProjectStore((state) => state.root)
  const updateBrief = useSubDesignStore((state) => state.updateBrief)
  const [kind, setKind] = useState<'screenshot' | 'url'>('screenshot')
  const [source, setSource] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const importReference = async () => {
    if (!brief || !source.trim() || busy) return
    setBusy(true); setMessage(null); setError(null)
    try {
      const api = window.subagents?.subdesign?.importReference
      if (!api) throw new Error('reference import 需要 Electron desktop。')
      const result = await api({ briefId: brief.id, kind, source: source.trim(), suggestedTitle: title.trim() || undefined, projectRoot: projectRoot || undefined })
      if (!result.ok || !result.reference) throw new Error(result.error || 'reference import 失敗。')
      const reference = result.reference as SubDesignReference
      const next = updateBrief(brief.id, {
        references: [...(brief.references || []).filter((item) => item.id !== reference.id), reference],
      }, projectRoot || undefined)
      if (!next) throw new Error('brief 更新失敗。')
      setMessage(`已匯入參考：${reference.title || reference.storedPath}。可先在 direction 階段 review tokens 與 provenance。`)
      setSource(''); setTitle('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  return <section className="app-panel">
    <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-on-surface"><Icon name="import_export" size={16} className="text-primary" /> 匯入參考</div>
      <span className="text-[11px] text-outline">{brief?.references?.length || 0} refs</span>
    </div>
    {!brief ? <div className="px-4 py-5 text-[11px] text-outline">建立或選擇 brief 後匯入 Screenshot / URL。</div> : <div className="space-y-3 p-4">
      <div className="flex gap-2"><button type="button" onClick={() => setKind('screenshot')} className={`flex-1 rounded-lg border px-3 py-2 text-[11px] ${kind === 'screenshot' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-white/10 text-outline'}`}>Screenshot</button><button type="button" onClick={() => setKind('url')} className={`flex-1 rounded-lg border px-3 py-2 text-[11px] ${kind === 'url' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-white/10 text-outline'}`}>URL</button></div>
      <label className="block text-[11px] font-medium text-outline">{kind === 'url' ? '公開 http/https URL' : '專案內相對路徑或 image data URL'}<input value={source} onChange={(event) => setSource(event.target.value)} placeholder={kind === 'url' ? 'https://example.com' : 'references/landing.png'} className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/10 px-3 text-[12px] text-on-surface outline-none placeholder:text-outline/60 focus:border-primary/45" /></label>
      <label className="block text-[11px] font-medium text-outline">名稱（可選）<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：Marketing landing reference" className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/10 px-3 text-[12px] text-on-surface outline-none placeholder:text-outline/60 focus:border-primary/45" /></label>
      <button type="button" disabled={busy || !source.trim()} onClick={() => void importReference()} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-[12px] font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-40"><Icon name="auto_awesome" size={15} />{busy ? '分析並匯入中…' : '匯入參考'}</button>
      <p className="text-[10px] leading-relaxed text-outline">URL 只做 sandbox snapshot 與 token 摘要，不執行來源內容；Screenshot 會保留原檔與 SHA-256，視覺 token 需在 direction 階段確認。</p>
      {message ? <div className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2.5 text-[11px] leading-relaxed text-primary">{message}</div> : null}
      {error ? <div className="rounded-xl border border-error/30 bg-error/10 px-3 py-2.5 text-[11px] leading-relaxed text-error">{error}</div> : null}
    </div>}
  </section>
}
