import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { designSystemPath, readDesignSystem, updateDesignSystemDocument } from '../agent/subdesign/designSystem'
import type { DesignSystemDocument } from '../agent/subdesign/types'
import { Icon } from '../components/Icon'
import { useProjectStore } from '../store/projectStore'
import { useSubDesignStore } from '../store/subDesignStore'

type ContractSection = { title: string; body: string }

function splitContract(content: string): ContractSection[] {
  const sections: ContractSection[] = []
  let current: ContractSection | null = null
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^#{2,3}\s+(.+)$/)
    if (heading) {
      if (current) sections.push({ ...current, body: current.body.trim() })
      current = { title: heading[1].trim(), body: '' }
    } else if (current) {
      current.body += `${line}\n`
    }
  }
  if (current) sections.push({ ...current, body: current.body.trim() })
  return sections.slice(0, 12)
}

function sectionIcon(title: string): string {
  const value = title.toLowerCase()
  if (value.includes('color') || value.includes('色')) return 'palette'
  if (value.includes('type') || value.includes('font') || value.includes('字')) return 'text_fields'
  if (value.includes('space') || value.includes('layout') || value.includes('間距') || value.includes('版')) return 'grid_view'
  if (value.includes('component') || value.includes('元件')) return 'widgets'
  if (value.includes('motion') || value.includes('動')) return 'animation'
  if (value.includes('voice') || value.includes('content') || value.includes('文案')) return 'notes'
  return 'rule'
}

export function DesignSystemDetailPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { id: routeId } = useParams<{ id?: string }>()
  const id = routeId ? decodeURIComponent(routeId) : ''
  const projectRoot = useProjectStore((state) => state.root)
  const systems = useSubDesignStore((state) => state.systems)
  const refreshSystems = useSubDesignStore((state) => state.refreshSystems)
  const briefs = useSubDesignStore((state) => state.briefs)
  const updateBrief = useSubDesignStore((state) => state.updateBrief)
  const selectBrief = useSubDesignStore((state) => state.selectBrief)
  const returnToValue = searchParams.get('returnTo')
  const returnTo = returnToValue?.startsWith('/subdesign') ? returnToValue : '/subdesign'
  const briefId = searchParams.get('briefId') || ''
  const targetBrief = briefs.find((brief) => brief.id === briefId) || null
  const libraryParams = new URLSearchParams({ returnTo })
  if (briefId) libraryParams.set('briefId', briefId)
  const systemsHref = `/design-systems?${libraryParams.toString()}`
  const summary = systems.find((system) => system.id === id) || null
  const [document, setDocument] = useState<DesignSystemDocument | null>(null)
  const [content, setContent] = useState('')
  const [tab, setTab] = useState<'system' | 'source'>('system')
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
  const contractSections = useMemo(() => splitContract(document?.content || ''), [document?.content])
  const visibleSections = contractSections.length ? contractSections : (metadata?.sections || []).map((title) => ({ title, body: '此區段已記錄在 DESIGN.md。切換至 Source 可查看完整規則。' }))

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

  const applyToStudio = () => {
    if (targetBrief) {
      updateBrief(targetBrief.id, { designSystemId: id }, projectRoot || undefined)
      selectBrief(targetBrief.id)
      navigate(returnTo)
      return
    }
    navigate(`/subdesign?designSystemId=${encodeURIComponent(id)}`)
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background text-on-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => navigate(systemsHref)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-outline hover:bg-white/[0.05] hover:text-on-surface" aria-label="Back to Design Systems"><Icon name="arrow_back" size={17} /></button>
          <div className="min-w-0"><p className="truncate text-[12px] font-semibold text-on-surface">{metadata?.title || 'Design System'}</p><p className="mt-0.5 truncate text-[9px] text-outline">Project Studio / Design System</p></div>
          {metadata ? <span className="hidden rounded-full border border-primary/20 bg-primary/[0.06] px-2 py-1 text-[9px] font-semibold text-primary sm:inline">ACTIVE CONTRACT</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setTab('source'); setEditing((value) => !value) }} disabled={!metadata || id === 'project'} className="hidden h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[10px] font-semibold text-outline hover:border-primary/30 hover:text-primary disabled:opacity-35 sm:inline-flex"><Icon name={editing ? 'close' : 'edit'} size={13} />{editing ? 'Cancel' : 'Edit source'}</button>
          <button type="button" onClick={applyToStudio} disabled={!metadata} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-semibold text-on-primary disabled:opacity-40"><Icon name="arrow_forward" size={13} />{targetBrief?.designSystemId === id ? 'Return to Studio' : 'Use in Studio'}</button>
        </div>
      </header>

      {loading ? <div className="grid flex-1 place-items-center text-[11px] text-outline">正在讀取 Design System…</div> : !metadata ? (
        <div className="grid flex-1 place-items-center px-5 text-center"><div><Icon name="error_outline" size={28} className="text-error" /><h1 className="mt-3 text-[14px] font-semibold text-on-surface">找不到這份 Design System</h1><p className="mt-2 text-[11px] text-outline">{id || '缺少 id'} 不存在，或目前沒有可用的 project root。</p><button type="button" onClick={() => navigate(systemsHref)} className="mt-4 rounded-lg border border-primary/30 px-3 py-2 text-[10px] font-semibold text-primary">Back to picker</button></div></div>
      ) : (
        <div className="grid min-h-0 flex-1 md:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-white/10 bg-surface-container-low/35 md:border-b-0 md:border-r">
            <div className="border-b border-white/8 px-4 py-4">
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-outline">Design agent</p>
              <h1 className="mt-2 text-[18px] font-semibold tracking-tight text-on-surface">{metadata.title}</h1>
              <p className="mt-2 text-[11px] leading-relaxed text-outline">{metadata.description || '這份 DESIGN.md 是生成與 critique 共用的品牌契約。'}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-3 py-3 custom-scrollbar">
              <div className="rounded-xl border border-white/8 bg-white/[0.025] p-3"><div className="flex items-center gap-2"><Icon name="check_circle" size={15} className="text-primary" /><p className="text-[10px] font-semibold text-on-surface">Contract loaded</p></div><p className="mt-2 text-[10px] leading-relaxed text-outline">{metadata.sections.length} sections、{metadata.colors.length} colors 已綁定。產物會沿用這份規則並在 Critique 階段檢查一致性。</p></div>
              <div className="mt-3 rounded-xl border border-white/8 p-3"><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-outline">Typography</p><p className="mt-2 truncate text-[11px] font-semibold text-on-surface">{metadata.typography || 'Not specified'}</p></div>
              <div className="mt-3 rounded-xl border border-white/8 p-3"><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-outline">Source</p><p className="mt-2 break-all font-mono text-[9px] leading-relaxed text-outline">{metadata.sourcePath}</p></div>
            </div>
            <div className="border-t border-white/8 p-3">
              <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2.5"><p className="text-[10px] text-outline">Ask for a change to this system…</p><div className="mt-3 flex items-center justify-between"><span className="text-[9px] text-outline/65">Edits update DESIGN.md</span><Icon name="arrow_upward" size={14} className="text-outline/55" /></div></div>
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col">
            <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4">
              <div className="flex h-full items-center gap-1">
                <button type="button" onClick={() => setTab('system')} className={`h-full border-b-2 px-3 text-[10px] font-semibold ${tab === 'system' ? 'border-primary text-on-surface' : 'border-transparent text-outline hover:text-on-surface'}`}>Design System</button>
                <button type="button" onClick={() => setTab('source')} className={`h-full border-b-2 px-3 text-[10px] font-semibold ${tab === 'source' ? 'border-primary text-on-surface' : 'border-transparent text-outline hover:text-on-surface'}`}>DESIGN.md</button>
              </div>
              <div className="flex items-center gap-2 text-[9px] text-outline"><Icon name="visibility" size={13} />Live contract</div>
            </div>

            {tab === 'system' ? (
              <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6 custom-scrollbar">
                <div className="mx-auto max-w-[920px]">
                  <div className="flex flex-col gap-4 border-b border-white/8 pb-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-primary">Brand contract</p><h2 className="mt-2 text-[22px] font-semibold text-on-surface">System foundations</h2><p className="mt-1 text-[11px] text-outline">檢查並維護 Agent 生成產物時必須遵守的基礎規則。</p></div><p className="font-mono text-[9px] text-outline">{metadata.updatedAt ? `Updated ${new Date(metadata.updatedAt).toLocaleDateString()}` : 'Project source'}</p></div>

                  <div className="mt-5 rounded-2xl border border-white/10 bg-surface-container-low/45 p-4">
                    <div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="grid h-8 w-5 place-items-center text-primary"><Icon name="palette" size={16} /></span><div><h3 className="text-[11px] font-semibold text-on-surface">Colors</h3><p className="mt-0.5 text-[9px] text-outline">{metadata.colors.length} extracted tokens</p></div></div></div>
                    {metadata.colors.length ? <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">{metadata.colors.map((color) => <div key={color} className="overflow-hidden rounded-lg border border-white/10"><span className="block h-12" style={{ backgroundColor: color }} /><span className="block truncate bg-black/10 px-2 py-1.5 font-mono text-[8px] text-outline">{color}</span></div>)}</div> : <p className="mt-4 text-[10px] text-outline">尚未從文件擷取色票。</p>}
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {visibleSections.filter((section) => !section.title.toLowerCase().includes('color')).map((section) => <article key={section.title} className="rounded-2xl border border-white/10 bg-surface-container-low/45 p-4"><div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-outline"><Icon name={sectionIcon(section.title)} size={16} /></span><div className="min-w-0"><h3 className="text-[11px] font-semibold text-on-surface">{section.title}</h3><p className="mt-2 line-clamp-5 whitespace-pre-line text-[9px] leading-relaxed text-outline">{section.body || '規則已記錄在 DESIGN.md。'}</p></div></div></article>)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-2.5"><div><p className="text-[10px] font-semibold text-on-surface">Source of truth</p><p className="mt-0.5 text-[9px] text-outline">Project-relative Markdown</p></div>{editing ? <button type="button" onClick={() => void save()} disabled={busy || !projectRoot || !content.trim()} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-semibold text-on-primary disabled:opacity-40"><Icon name="save" size={13} />{busy ? 'Saving…' : 'Save changes'}</button> : <button type="button" onClick={() => setEditing(true)} disabled={id === 'project'} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-[10px] font-semibold text-outline hover:text-primary disabled:opacity-35"><Icon name="edit" size={13} />Edit</button>}</div>
                {editing ? <textarea value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} className="min-h-0 flex-1 resize-none bg-transparent px-5 py-4 font-mono text-[10px] leading-relaxed text-on-surface outline-none" aria-label="DESIGN.md content" /> : <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-[10px] leading-relaxed text-on-surface-variant custom-scrollbar">{document?.content || 'Browser preview 沒有 workspace read API；請使用 Electron 查看原始 DESIGN.md。'}</pre>}
                {message ? <p className="shrink-0 border-t border-white/8 px-4 py-2 text-[9px] text-primary">{message}</p> : null}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
