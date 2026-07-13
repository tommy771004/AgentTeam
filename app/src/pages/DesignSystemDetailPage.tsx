import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { designSystemPath, readDesignSystem, updateDesignSystemDocument } from '../agent/subdesign/designSystem'
import type { DesignSystemDocument } from '../agent/subdesign/types'
import { Icon } from '../components/Icon'
import { useProjectStore } from '../store/projectStore'
import { useSubDesignStore } from '../store/subDesignStore'

export function DesignSystemDetailPage() {
  const navigate = useNavigate()
  const { id: routeId } = useParams<{ id?: string }>()
  const id = routeId ? decodeURIComponent(routeId) : ''
  const projectRoot = useProjectStore((state) => state.root)
  const systems = useSubDesignStore((state) => state.systems)
  const refreshSystems = useSubDesignStore((state) => state.refreshSystems)
  const summary = systems.find((system) => system.id === id) || null
  const [document, setDocument] = useState<DesignSystemDocument | null>(null)
  const [content, setContent] = useState('')
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setMessage('')
    if (!id || !projectRoot) {
      setDocument(null)
      setContent('')
      setLoading(false)
      return () => { active = false }
    }
    void readDesignSystem(id, projectRoot).then((next) => {
      if (!active) return
      setDocument(next)
      setContent(next?.content || '')
      setLoading(false)
    })
    return () => { active = false }
  }, [id, projectRoot])

  const metadata = document || summary
  const colorSwatches = useMemo(() => metadata?.colors || [], [metadata])

  const save = async () => {
    if (!id || !content.trim()) return
    setBusy(true)
    setMessage('正在更新 DESIGN.md…')
    try {
      const result = await updateDesignSystemDocument({ id, content, projectRoot: projectRoot || undefined })
      if (!result.ok) {
        setMessage(result.error || '更新失敗。')
        return
      }
      const next = await readDesignSystem(id, projectRoot || undefined)
      setDocument(next)
      setContent(next?.content || content)
      setEditing(false)
      await refreshSystems(projectRoot || undefined)
      setMessage(`已更新 ${result.path || designSystemPath(id)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full min-w-0 overflow-auto bg-background text-on-background">
      <main className="mx-auto w-full max-w-[1180px] px-5 pb-16 pt-8 md:px-8 lg:pt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => navigate('/design-systems')} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-outline hover:text-primary"><Icon name="arrow_back" size={15} />所有 Design Systems</button>
          {metadata && id !== 'project' ? <button type="button" onClick={() => setEditing((value) => !value)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-on-surface-variant hover:border-primary/30 hover:text-primary"><Icon name={editing ? 'close' : 'edit'} size={14} />{editing ? '取消編輯' : '編輯 DESIGN.md'}</button> : null}
        </div>

        {loading ? <div className="mt-8 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-12 text-center text-[12px] text-outline">正在讀取 Design.md…</div> : !metadata ? (
          <div className="mt-8 rounded-2xl border border-error/20 bg-error/10 px-5 py-10 text-center"><Icon name="error_outline" size={30} className="text-error" /><h1 className="mt-3 text-[15px] font-semibold text-on-surface">找不到這份 Design System</h1><p className="mt-2 text-[12px] text-outline">{id || '缺少 id'} 不存在，或目前沒有可用的 project root。</p><button type="button" onClick={() => navigate('/design-systems')} className="mt-5 rounded-lg border border-primary/30 px-3 py-2 text-[11px] font-semibold text-primary hover:bg-primary/10">回到列表</button></div>
        ) : (
          <>
            <section className="mt-5 overflow-hidden rounded-[26px] border border-primary/20 bg-[radial-gradient(circle_at_80%_15%,rgba(125,216,240,0.13),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] px-5 py-6 md:px-7 md:py-8">
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-primary/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">{id === 'project' ? 'Project contract' : metadata.category || 'Custom'}</span><span className="font-mono text-[10px] text-outline">{metadata.sourcePath}</span></div>
                  <h1 className="mt-4 truncate font-[family-name:var(--font-sora)] text-[30px] font-semibold tracking-tight text-on-surface md:text-[38px]">{metadata.title}</h1>
                  <p className="mt-3 max-w-[700px] text-[13px] leading-relaxed text-outline">{metadata.description || '這份 Design System 尚未提供 overview。'}</p>
                </div>
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary"><Icon name="palette" size={28} /></span>
              </div>
              <div className="mt-6 grid gap-3 border-t border-white/8 pt-4 sm:grid-cols-3"><div><p className="text-[10px] uppercase tracking-[0.14em] text-outline">Colors</p><p className="mt-1 text-[13px] font-semibold text-on-surface">{colorSwatches.length || 0} swatches</p></div><div><p className="text-[10px] uppercase tracking-[0.14em] text-outline">Sections</p><p className="mt-1 text-[13px] font-semibold text-on-surface">{metadata.sections.length} documented</p></div><div><p className="text-[10px] uppercase tracking-[0.14em] text-outline">Typography</p><p className="mt-1 truncate text-[13px] font-semibold text-on-surface">{metadata.typography || '未指定'}</p></div></div>
            </section>

            <section className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-surface-container-low/55">
                <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3"><div><h2 className="text-[12px] font-semibold text-on-surface">DESIGN.md</h2><p className="mt-0.5 text-[10px] text-outline">Source of truth · project-relative</p></div>{editing ? <button type="button" onClick={() => void save()} disabled={busy || !projectRoot} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-on-primary disabled:opacity-45"><Icon name="save" size={14} />{busy ? '儲存中…' : '儲存變更'}</button> : null}</div>
                {editing ? <textarea value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} className="min-h-[620px] w-full resize-y bg-transparent px-4 py-4 font-mono text-[11px] leading-relaxed text-on-surface outline-none" aria-label="DESIGN.md 內容" /> : <pre className="max-h-[680px] overflow-auto whitespace-pre-wrap break-words px-4 py-4 font-mono text-[11px] leading-relaxed text-on-surface-variant custom-scrollbar">{document?.content || 'Browser preview 沒有 workspace read API；請使用 Electron 查看原始 DESIGN.md。'}</pre>}
                {message ? <p className="border-t border-white/8 px-4 py-2.5 text-[11px] text-primary">{message}</p> : null}
              </div>
              <aside className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-surface-container-low/55 p-4"><h2 className="text-[12px] font-semibold text-on-surface">Color tokens</h2><div className="mt-3 space-y-2">{colorSwatches.length ? colorSwatches.map((color) => <div key={color} className="flex items-center gap-2 text-[11px] text-outline"><span className="h-7 w-7 rounded-lg border border-white/20" style={{ backgroundColor: color }} /><span className="font-mono">{color}</span></div>) : <p className="text-[11px] text-outline">尚未擷取色票。</p>}</div></div>
                <div className="rounded-2xl border border-white/10 bg-surface-container-low/55 p-4"><h2 className="text-[12px] font-semibold text-on-surface">Documented sections</h2><div className="mt-3 flex flex-wrap gap-1.5">{metadata.sections.length ? metadata.sections.map((section) => <span key={section} className="rounded-full border border-primary/20 bg-primary/5 px-2 py-1 text-[10px] text-primary">{section}</span>) : <span className="text-[11px] text-outline">尚未解析 headings。</span>}</div></div>
                <div className="rounded-2xl border border-secondary/20 bg-secondary/10 p-4 text-[11px] leading-relaxed text-secondary"><Icon name="info" size={14} className="mr-1 align-[-2px]" />SubDesign 會在每次 build 前讀取這份檔案；外部內容視為不可信資料，不會當作指令執行。</div>
              </aside>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
