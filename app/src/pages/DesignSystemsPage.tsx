import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { DESIGN_SYSTEM_ROOT } from '../agent/subdesign/designSystem'
import { useProjectStore } from '../store/projectStore'
import { useSubDesignStore } from '../store/subDesignStore'

export function DesignSystemsPage() {
  const navigate = useNavigate()
  const projectRoot = useProjectStore((state) => state.root)
  const systems = useSubDesignStore((state) => state.systems)
  const systemsLoading = useSubDesignStore((state) => state.systemsLoading)
  const systemsError = useSubDesignStore((state) => state.systemsError)
  const refreshSystems = useSubDesignStore((state) => state.refreshSystems)
  const [query, setQuery] = useState('')

  useEffect(() => {
    void refreshSystems(projectRoot || undefined)
  }, [projectRoot, refreshSystems])

  const visibleSystems = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return systems
    return systems.filter((system) => `${system.title} ${system.id} ${system.description || ''} ${system.category || ''}`.toLowerCase().includes(needle))
  }, [query, systems])

  return (
    <div className="h-full min-w-0 overflow-auto bg-background text-on-background">
      <main className="mx-auto w-full max-w-[1180px] px-5 pb-16 pt-8 md:px-8 lg:pt-10">
        <section className="relative overflow-hidden rounded-[26px] border border-primary/20 bg-[radial-gradient(circle_at_85%_15%,rgba(125,216,240,0.14),transparent_35%),linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] px-5 py-6 md:px-7 md:py-8">
          <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-[680px]">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary"><Icon name="palette" size={16} />Brand contract</div>
              <h1 className="font-[family-name:var(--font-sora)] text-[30px] font-semibold tracking-tight text-on-surface md:text-[38px]">Design Systems</h1>
              <p className="mt-3 max-w-[620px] text-[13px] leading-relaxed text-outline">把色彩、字體、元件與語氣整理成可被每次 SubDesign build 讀取的 DESIGN.md。這裡是專案品牌規則的入口，不是一次性的 artifact 設定。</p>
            </div>
            <button type="button" onClick={() => navigate('/design-systems/create')} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[12px] font-semibold text-on-primary shadow-[0_8px_24px_rgba(43,184,217,0.18)] hover:bg-primary-container focus:outline-none focus:ring-2 focus:ring-primary/50"><Icon name="add" size={16} />建立 Design System</button>
          </div>
          <div className="relative z-10 mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/8 pt-4 text-[11px] text-outline">
            <span className="inline-flex items-center gap-1.5"><Icon name="folder" size={14} />{projectRoot ? projectRoot.split(/[\\/]/).filter(Boolean).pop() : '尚未選擇工作目錄'}</span>
            <span className="h-3.5 w-px bg-white/10" aria-hidden />
            <span>{systems.length} 個可用 system</span>
            <span className="font-mono text-outline/80">{DESIGN_SYSTEM_ROOT}</span>
          </div>
        </section>

        <section className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[14px] font-semibold text-on-surface">本機品牌資源</h2>
            <p className="mt-1 text-[11px] text-outline">專案根目錄的 DESIGN.md 與 `.subagents/subdesign/design-systems/*` 都會出現在這裡。</p>
          </div>
          <div className="relative sm:w-[280px]">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
            <label htmlFor="design-system-search" className="sr-only">搜尋 Design System</label>
            <input id="design-system-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋名稱、類別或 id" className="h-10 w-full rounded-xl border border-white/10 bg-surface-container-low pl-9 pr-3 text-[12px] text-on-surface outline-none placeholder:text-outline/70 focus:border-primary/40" />
          </div>
        </section>

        {systemsError ? <div className="mt-4 rounded-xl border border-error/25 bg-error/10 px-3 py-2 text-[11px] text-error">讀取失敗：{systemsError}</div> : null}
        {!projectRoot ? <div className="mt-4 flex items-start gap-2 rounded-xl border border-secondary/20 bg-secondary/10 px-3 py-2.5 text-[11px] text-secondary"><Icon name="info" size={15} />請先從左下角選擇 project root，才能讀取與建立 Design.md。</div> : null}

        {systemsLoading ? <div className="mt-6 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-10 text-center text-[12px] text-outline">正在掃描 DESIGN.md…</div> : visibleSystems.length ? (
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleSystems.map((system) => (
              <button key={system.id} type="button" onClick={() => navigate(`/design-systems/${encodeURIComponent(system.id)}`)} className="group min-h-[218px] rounded-2xl border border-white/10 bg-surface-container-low/65 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-white/[0.045] focus:outline-none focus:ring-2 focus:ring-primary/45">
                <div className="flex items-start justify-between gap-3">
                  <span className={`grid h-10 w-10 place-items-center rounded-xl ${system.id === 'project' ? 'bg-primary/15 text-primary' : 'bg-secondary/15 text-secondary'}`}><Icon name={system.id === 'project' ? 'home_work' : 'palette'} size={20} /></span>
                  <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-outline">{system.id === 'project' ? 'Project' : system.category || 'Custom'}</span>
                </div>
                <h3 className="mt-4 truncate text-[15px] font-semibold text-on-surface">{system.title}</h3>
                <p className="mt-1 min-h-[34px] text-[11px] leading-relaxed text-outline">{system.description || '尚未提供 overview。'}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {system.colors.slice(0, 5).map((color) => <span key={color} className="h-4 w-4 rounded-full border border-white/20" style={{ backgroundColor: color }} title={color} />)}
                  {!system.colors.length ? <span className="text-[10px] text-outline">尚未擷取色票</span> : null}
                </div>
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/8 pt-3 text-[10px] text-outline"><span className="truncate font-mono">{system.sourcePath}</span><Icon name="chevron_right" size={15} className="shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" /></div>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-white/12 bg-white/[0.025] px-5 py-12 text-center">
            <Icon name="palette" size={30} className="text-outline/70" />
            <h3 className="mt-3 text-[14px] font-semibold text-on-surface">還沒有可用的 Design System</h3>
            <p className="mx-auto mt-2 max-w-[440px] text-[12px] leading-relaxed text-outline">建立第一份品牌契約，讓之後的 SubDesign brief 能直接讀取相同的 colors、typography 與元件規則。</p>
            <button type="button" onClick={() => navigate('/design-systems/create')} className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-primary/30 px-3 py-2 text-[11px] font-semibold text-primary hover:bg-primary/10"><Icon name="add" size={14} />建立第一份</button>
          </div>
        )}
      </main>
    </div>
  )
}
