import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DESIGN_SYSTEM_ROOT } from '../agent/subdesign/designSystem'
import type { DesignSystemSummary } from '../agent/subdesign/types'
import { Icon } from '../components/Icon'
import { SubDesignStudioNav } from '../components/subdesign/SubDesignStudioNav'
import { useProjectStore } from '../store/projectStore'
import { useSubDesignStore } from '../store/subDesignStore'

function safeStudioPath(value: string | null): string {
  return value?.startsWith('/subdesign') ? value : '/subdesign'
}

function withContext(path: string, returnTo: string, briefId: string): string {
  const params = new URLSearchParams({ returnTo })
  if (briefId) params.set('briefId', briefId)
  return `${path}?${params.toString()}`
}

function SystemSwatches({ system }: { system: DesignSystemSummary }) {
  const colors = system.colors.slice(0, 4)
  return (
    <span className="flex h-8 w-[74px] shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]" aria-label={`${system.title} color palette`}>
      {colors.length ? colors.map((color, index) => <span key={`${color}-${index}`} className="h-full flex-1" style={{ backgroundColor: color }} />) : <span className="grid h-full w-full place-items-center text-[9px] font-semibold text-outline">Aa</span>}
    </span>
  )
}

export function DesignSystemsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const projectRoot = useProjectStore((state) => state.root)
  const systems = useSubDesignStore((state) => state.systems)
  const systemsLoading = useSubDesignStore((state) => state.systemsLoading)
  const systemsError = useSubDesignStore((state) => state.systemsError)
  const refreshSystems = useSubDesignStore((state) => state.refreshSystems)
  const briefs = useSubDesignStore((state) => state.briefs)
  const updateBrief = useSubDesignStore((state) => state.updateBrief)
  const selectBrief = useSubDesignStore((state) => state.selectBrief)
  const returnTo = safeStudioPath(searchParams.get('returnTo'))
  const briefId = searchParams.get('briefId') || ''
  const targetBrief = briefs.find((brief) => brief.id === briefId) || null
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(targetBrief?.designSystemId || '')

  useEffect(() => {
    void refreshSystems(projectRoot || undefined)
  }, [projectRoot, refreshSystems])

  useEffect(() => {
    setSelectedId(targetBrief?.designSystemId || '')
  }, [targetBrief?.designSystemId])

  const visibleSystems = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return systems
    return systems.filter((system) => `${system.title} ${system.id} ${system.description || ''} ${system.category || ''}`.toLowerCase().includes(needle))
  }, [query, systems])

  const selectedSystem = systems.find((system) => system.id === selectedId) || null
  const hasChanged = selectedId !== (targetBrief?.designSystemId || '')

  const applySelection = () => {
    if (targetBrief) {
      updateBrief(targetBrief.id, { designSystemId: selectedId }, projectRoot || undefined)
      selectBrief(targetBrief.id)
      navigate(returnTo)
      return
    }
    navigate(selectedId ? `/subdesign?designSystemId=${encodeURIComponent(selectedId)}` : '/subdesign')
  }

  return (
    <div className="h-full min-w-0 overflow-auto bg-background text-on-background">
      <main className="mx-auto w-full max-w-[1080px] px-5 pb-16 pt-8 md:px-8 lg:pt-10">
        <SubDesignStudioNav
          active="systems"
          studioHref={returnTo}
          systemsHref={withContext('/design-systems', returnTo, briefId)}
          contextLabel={targetBrief ? `New design · ${targetBrief.objective}` : 'New design · choose the brand contract for this project'}
          onNavigate={navigate}
        />

        <section className="mx-auto mt-10 max-w-[760px]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-outline">New design / setup</p>
              <h1 className="mt-2 font-[family-name:var(--font-sora)] text-[28px] font-semibold tracking-tight text-on-surface">Choose a Design System</h1>
              <p className="mt-2 max-w-[560px] text-[12px] leading-relaxed text-outline">這份品牌契約會和 brief、skill 一起帶進 Project Studio，並約束後續的 prototype、deck 與 revision。</p>
            </div>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[10px] font-semibold text-outline"><Icon name="radio_button_checked" size={12} />Single</span>
          </div>

          <div className="mt-7 overflow-hidden rounded-[18px] border border-white/10 bg-surface-container-low/55 shadow-[0_18px_55px_rgba(0,0,0,0.18)]">
            {targetBrief ? (
              <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
                <span className="grid h-8 w-5 shrink-0 place-items-center text-primary"><Icon name="description" size={16} /></span>
                <div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-outline">Project brief</p><p className="mt-0.5 truncate text-[11px] font-semibold text-on-surface">{targetBrief.objective}</p></div>
              </div>
            ) : null}

            <div className="border-b border-white/8 p-3">
              <div className="relative">
                <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
                <label htmlFor="design-system-search" className="sr-only">搜尋 Design System</label>
                <input id="design-system-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search design systems…" className="h-10 w-full rounded-xl border border-white/10 bg-black/10 pl-9 pr-3 text-[11px] text-on-surface outline-none placeholder:text-outline/65 focus:border-primary/45" />
              </div>
            </div>

            <div className="max-h-[430px] overflow-auto p-2 custom-scrollbar" role="radiogroup" aria-label="Design system options">
              <button type="button" role="radio" aria-checked={selectedId === ''} onClick={() => setSelectedId('')} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${selectedId === '' ? 'border-primary/45 bg-primary/[0.07]' : 'border-transparent hover:bg-white/[0.04]'}`}>
                <span className="grid h-8 w-[74px] shrink-0 place-items-center rounded-lg border border-dashed border-white/15 bg-white/[0.025] text-[9px] font-semibold text-outline">DEFAULT</span>
                <span className="min-w-0 flex-1"><span className="block text-[12px] font-semibold text-on-surface">Project default</span><span className="mt-0.5 block text-[10px] text-outline">不綁定額外品牌契約，使用目前專案與 brief 的方向。</span></span>
                <Icon name={selectedId === '' ? 'radio_button_checked' : 'radio_button_unchecked'} size={18} className={selectedId === '' ? 'text-primary' : 'text-outline/60'} />
              </button>

              {visibleSystems.map((system) => {
                const selected = selectedId === system.id
                return (
                  <div key={system.id} className={`group mt-1 flex items-center gap-1 rounded-xl border transition-colors ${selected ? 'border-primary/45 bg-primary/[0.07]' : 'border-transparent hover:bg-white/[0.04]'}`}>
                    <button type="button" role="radio" aria-checked={selected} onClick={() => setSelectedId(system.id)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left">
                      <SystemSwatches system={system} />
                      <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-[12px] font-semibold text-on-surface">{system.title}</span>{system.category ? <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-outline">{system.category}</span> : null}</span><span className="mt-0.5 block truncate text-[10px] text-outline">{system.description || `${system.sections.length} sections · ${system.colors.length} colors`}</span></span>
                      <Icon name={selected ? 'radio_button_checked' : 'radio_button_unchecked'} size={18} className={selected ? 'text-primary' : 'text-outline/60'} />
                    </button>
                    <button type="button" onClick={() => navigate(withContext(`/design-systems/${encodeURIComponent(system.id)}`, returnTo, briefId))} className="mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-outline opacity-70 hover:bg-white/[0.06] hover:text-on-surface group-hover:opacity-100" aria-label={`查看 ${system.title} 契約`}><Icon name="arrow_forward" size={15} /></button>
                  </div>
                )
              })}

              {!systemsLoading && visibleSystems.length === 0 ? <div className="px-4 py-9 text-center"><Icon name={query ? 'search_off' : 'palette'} size={22} className="text-outline/70" /><p className="mt-2 text-[11px] font-semibold text-on-surface">{query ? '找不到符合的 Design System' : '尚未建立 Design System'}</p><p className="mt-1 text-[10px] text-outline">{query ? '試著搜尋名稱、分類或 id。' : `建立後會儲存在 ${DESIGN_SYSTEM_ROOT}`}</p></div> : null}
              {systemsLoading ? <div className="px-4 py-8 text-center text-[10px] text-outline">正在掃描 DESIGN.md…</div> : null}
            </div>

            {systemsError ? <div className="border-t border-error/20 bg-error/[0.06] px-4 py-2.5 text-[10px] text-error">讀取失敗：{systemsError}</div> : null}
            <div className="flex flex-col gap-3 border-t border-white/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={() => navigate(withContext('/design-systems/create', returnTo, briefId))} disabled={!projectRoot} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-outline hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"><Icon name="add" size={14} />Create Design System</button>
              <button type="button" onClick={applySelection} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-[11px] font-semibold text-on-primary"><Icon name={targetBrief ? (hasChanged ? 'check' : 'arrow_back') : 'arrow_forward'} size={14} />{targetBrief ? (hasChanged ? 'Apply and return to Studio' : 'Return to Studio') : 'Use in new design'}</button>
            </div>
          </div>

          <p className="mt-3 text-center text-[9px] text-outline/70">Selected: {selectedSystem?.title || 'Project default'} · source of truth: DESIGN.md</p>
        </section>
      </main>
    </div>
  )
}
