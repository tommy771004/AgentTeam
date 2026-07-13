import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ArtifactPreview } from '../components/subdesign/ArtifactPreview'
import { ArtifactRail } from '../components/subdesign/ArtifactRail'
import { ArtifactDeliveryPanel } from '../components/subdesign/ArtifactDeliveryPanel'
import { CritiquePanel } from '../components/subdesign/CritiquePanel'
import { critiqueAllowsDeliver } from '../agent/subdesign/critique'
import { buildSubDesignPrompt } from '../agent/subdesign/prompt'
import type { SubDesignPlatform, SubDesignStage } from '../agent/subdesign/types'
import { stageLabel } from '../agent/subdesign/types'
import { useAgentStore } from '../store/agentStore'
import { useProjectStore } from '../store/projectStore'
import { useSubDesignStore } from '../store/subDesignStore'
import { useSubDesignArtifactStore } from '../store/subDesignArtifactStore'
import { useSubDesignCritiqueStore } from '../store/subDesignCritiqueStore'
import { useThreadStore } from '../store/threadStore'

type DesignSurface = {
  id: 'prototype' | 'dashboard' | 'design-system' | 'deck'
  title: string
  description: string
  icon: string
  deliverable: string
  lastEdited: string
}

type Fidelity = 'wireframe' | 'high-fidelity'
type TabId = 'recent' | 'templates' | 'systems'

const SURFACES: readonly DesignSurface[] = [
  {
    id: 'prototype',
    title: '產品原型',
    description: '網站、桌面或行動介面的可執行設計稿。',
    icon: 'web',
    deliverable: 'HTML / CSS 原型與元件規格',
    lastEdited: '準備建立',
  },
  {
    id: 'dashboard',
    title: '資料儀表板',
    description: '指標、流程與資料視覺化的單頁工作台。',
    icon: 'dashboard',
    deliverable: 'Dashboard 規格、狀態與資料欄位',
    lastEdited: '準備建立',
  },
  {
    id: 'design-system',
    title: 'Design System',
    description: '將品牌語言整理為可套用的設計契約。',
    icon: 'palette',
    deliverable: 'DESIGN.md、tokens 與元件規範',
    lastEdited: '準備建立',
  },
  {
    id: 'deck',
    title: '簡報與報告',
    description: '可導出為 HTML、PDF、PPTX 的敘事型內容。',
    icon: 'slideshow',
    deliverable: '頁面大綱、投影片結構與講稿',
    lastEdited: '準備建立',
  },
]

const FIDELITIES: ReadonlyArray<{ id: Fidelity; title: string; description: string; icon: string }> = [
  { id: 'wireframe', title: 'Wireframe', description: '先確認架構', icon: 'view_quilt' },
  { id: 'high-fidelity', title: 'High fidelity', description: '建立完整視覺', icon: 'dashboard_customize' },
]

const PLATFORMS: ReadonlyArray<{ id: SubDesignPlatform; label: string }> = [
  { id: 'responsive', label: 'Responsive web' },
  { id: 'web-desktop', label: 'Web desktop' },
  { id: 'mobile-ios', label: 'Mobile iOS' },
  { id: 'desktop-app', label: 'Desktop app' },
]

const STAGES: readonly SubDesignStage[] = ['brief', 'direction', 'build', 'critique', 'deliver']

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n|,|，/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20)
}

function formatRelativeTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '最近'
  const minutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60_000))
  if (minutes < 60) return `${minutes} 分鐘前`
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小時前`
  return `${Math.round(minutes / 1440)} 天前`
}

export function SubDesignPage() {
  const navigate = useNavigate()
  const createThread = useThreadStore((state) => state.createThread)
  const setSubDesignBriefId = useThreadStore((state) => state.setSubDesignBriefId)
  const setDraftInput = useAgentStore((state) => state.setDraftInput)
  const projectRoot = useProjectStore((state) => state.root)
  const briefs = useSubDesignStore((state) => state.briefs)
  const artifacts = useSubDesignArtifactStore((state) => state.artifacts)
  const systems = useSubDesignStore((state) => state.systems)
  const systemsLoading = useSubDesignStore((state) => state.systemsLoading)
  const systemsError = useSubDesignStore((state) => state.systemsError)
  const refreshSystems = useSubDesignStore((state) => state.refreshSystems)
  const createBrief = useSubDesignStore((state) => state.createBrief)
  const [surfaceId, setSurfaceId] = useState<DesignSurface['id']>(SURFACES[0].id)
  const [fidelity, setFidelity] = useState<Fidelity>('high-fidelity')
  const [platform, setPlatform] = useState<SubDesignPlatform>('responsive')
  const [brief, setBrief] = useState('')
  const [audience, setAudience] = useState('')
  const [constraints, setConstraints] = useState('')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [designSystemId, setDesignSystemId] = useState('')
  const [activeTab, setActiveTab] = useState<TabId>('recent')
  const [query, setQuery] = useState('')
  const [selectedArtifactKey, setSelectedArtifactKey] = useState<string | null>(null)
  const activeSurface = useMemo(
    () => SURFACES.find((surface) => surface.id === surfaceId) || SURFACES[0],
    [surfaceId],
  )
  const selectedSystem = systems.find((system) => system.id === designSystemId)
  const normalizedQuery = query.trim().toLowerCase()
  const filteredSurfaces = SURFACES.filter((surface) =>
    !normalizedQuery
      ? true
      : `${surface.title} ${surface.description} ${surface.deliverable}`.toLowerCase().includes(normalizedQuery),
  )
  const filteredSystems = systems.filter((system) =>
    !normalizedQuery
      ? true
      : `${system.title} ${system.id} ${system.description || ''} ${system.colors.join(' ')}`
          .toLowerCase()
          .includes(normalizedQuery),
  )
  const filteredBriefs = briefs.filter((item) =>
    !normalizedQuery
      ? true
      : `${item.objective} ${item.surface} ${item.stage}`.toLowerCase().includes(normalizedQuery),
  )
  const selectedArtifact = artifacts.find((artifact) => `${artifact.id}:${artifact.revision}` === selectedArtifactKey) || artifacts[0] || null
  const latestCritique = useSubDesignCritiqueStore((state) => selectedArtifact ? state.latestForArtifact(selectedArtifact.id) : null)

  useEffect(() => {
    void refreshSystems(projectRoot || undefined)
  }, [projectRoot, refreshSystems])

  const startSubDesign = () => {
    const threadId = createThread({
      title: `SubDesign · ${activeSurface.title}`,
      agentMode: 'plan',
      thinkingDepth: 'deep',
    })
    const created = createBrief({
      threadId,
      surface: activeSurface.id,
      objective: brief,
      audience,
      platform,
      fidelity,
      designSystemId: designSystemId || undefined,
      constraints: splitLines(constraints),
      acceptanceCriteria: splitLines(acceptanceCriteria),
    })
    setSubDesignBriefId(threadId, created.id)
    setDraftInput(buildSubDesignPrompt(created, selectedSystem))
    navigate(`/?thread=${threadId}`)
  }

  const resumeBrief = (item: (typeof briefs)[number]) => {
    setSurfaceId(item.surface)
    setDesignSystemId(item.designSystemId || '')
    navigate(`/?thread=${item.threadId}`)
  }

  return (
    <div className="h-full min-w-0 overflow-auto bg-[#f8f7f4] text-[#292725] [color-scheme:light]">
      <div className="flex min-h-full min-w-[720px]">
        <aside className="w-[278px] shrink-0 border-r border-[#e8e5df] bg-[#fbfaf8] px-3 py-4">
          <div className="flex items-center gap-2 px-2 pb-4">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-[#262321] text-[#f9f8f5]">
              <Icon name="gesture" size={17} />
            </span>
            <div>
              <div className="text-[13px] font-semibold tracking-[-0.02em]">SubDesign</div>
              <div className="text-[9px] uppercase tracking-[0.12em] text-[#9b958d]">design workspace</div>
            </div>
          </div>

          <div className="border-t border-[#ece9e4] pt-3">
            <div className="grid grid-cols-4 border-b border-[#e9e6e0] text-[10px] text-[#817b74]">
              {SURFACES.map((surface) => (
                <button
                  key={surface.id}
                  type="button"
                  onClick={() => setSurfaceId(surface.id)}
                  className={`-mb-px border-b px-1 py-2 transition-colors ${
                    activeSurface.id === surface.id
                      ? 'border-[#292725] font-semibold text-[#292725]'
                      : 'border-transparent hover:text-[#292725]'
                  }`}
                >
                  {surface.id === 'design-system'
                    ? 'System'
                    : surface.title.replace('產品', '').replace('資料', '').replace('與報告', '')}
                </button>
              ))}
            </div>

            <div className="px-2 py-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-semibold">New {activeSurface.title}</span>
                <Icon name={activeSurface.icon} size={15} className="text-[#a19a92]" />
              </div>

              <label className="block">
                <span className="sr-only">設計 brief</span>
                <textarea
                  value={brief}
                  onChange={(event) => setBrief(event.target.value)}
                  placeholder="描述你想建立的設計…"
                  className="min-h-[74px] w-full resize-y rounded-md border border-[#e5e1db] bg-white px-2.5 py-2 text-[11px] leading-relaxed text-[#34312e] outline-none placeholder:text-[#b2aca5] focus:border-[#c96646] focus:ring-2 focus:ring-[#c96646]/10"
                />
              </label>

              <label className="mt-3 block">
                <span className="mb-1.5 block text-[10px] font-medium text-[#6f6962]">Audience</span>
                <input
                  value={audience}
                  onChange={(event) => setAudience(event.target.value)}
                  placeholder="誰會使用？"
                  className="h-8 w-full rounded-md border border-[#e5e1db] bg-white px-2.5 text-[10px] outline-none placeholder:text-[#b2aca5] focus:border-[#c96646]"
                />
              </label>

              <label className="mt-3 block">
                <span className="mb-1.5 block text-[10px] font-medium text-[#6f6962]">Platform</span>
                <select
                  value={platform}
                  onChange={(event) => setPlatform(event.target.value as SubDesignPlatform)}
                  className="h-8 w-full rounded-md border border-[#e5e1db] bg-white px-2 text-[10px] outline-none focus:border-[#c96646]"
                >
                  {PLATFORMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>

              <div className="mt-4">
                <div className="mb-2 text-[10px] font-medium text-[#6f6962]">Fidelity</div>
                <div className="grid grid-cols-2 gap-2">
                  {FIDELITIES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setFidelity(item.id)}
                      className={`rounded-md border p-2 text-left transition-colors ${
                        fidelity === item.id
                          ? 'border-[#c96646] bg-[#fffaf7] ring-1 ring-[#c96646]/15'
                          : 'border-[#e8e4df] bg-white hover:border-[#cfc9c1]'
                      }`}
                    >
                      <Icon name={item.icon} size={18} className={fidelity === item.id ? 'text-[#c96646]' : 'text-[#a29c94]'} />
                      <div className="mt-1.5 text-[10px] font-medium leading-none">{item.title}</div>
                      <div className="mt-1 text-[9px] text-[#968f87]">{item.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <label className="mt-4 block">
                <span className="mb-1.5 block text-[10px] font-medium text-[#6f6962]">Constraints</span>
                <textarea
                  value={constraints}
                  onChange={(event) => setConstraints(event.target.value)}
                  placeholder="每行一項，例如：不能改 API"
                  className="min-h-[48px] w-full resize-y rounded-md border border-[#e5e1db] bg-white px-2.5 py-2 text-[10px] leading-relaxed outline-none placeholder:text-[#b2aca5] focus:border-[#c96646]"
                />
              </label>

              <label className="mt-3 block">
                <span className="mb-1.5 block text-[10px] font-medium text-[#6f6962]">Acceptance criteria</span>
                <textarea
                  value={acceptanceCriteria}
                  onChange={(event) => setAcceptanceCriteria(event.target.value)}
                  placeholder="完成時如何驗收？"
                  className="min-h-[48px] w-full resize-y rounded-md border border-[#e5e1db] bg-white px-2.5 py-2 text-[10px] leading-relaxed outline-none placeholder:text-[#b2aca5] focus:border-[#c96646]"
                />
              </label>

              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-[#6f6962]">
                  <span>Design system</span>
                  {systemsLoading ? <span className="text-[#aaa39b]">掃描中…</span> : null}
                </div>
                <select
                  value={designSystemId}
                  onChange={(event) => setDesignSystemId(event.target.value)}
                  className="h-8 w-full rounded-md border border-[#e5e1db] bg-white px-2 text-[10px] outline-none focus:border-[#c96646]"
                >
                  <option value="">不指定（執行時掃描）</option>
                  {systems.map((system) => <option key={system.id} value={system.id}>{system.title}</option>)}
                </select>
                {selectedSystem ? (
                  <div className="mt-2 rounded-md border border-[#ece4db] bg-[#fffaf7] px-2 py-2 text-[9px] text-[#81766e]">
                    <div className="font-semibold text-[#5f554d]">{selectedSystem.title}</div>
                    <div className="mt-1 flex items-center gap-1.5">
                      {selectedSystem.colors.slice(0, 5).map((color) => <span key={color} className="h-3 w-3 rounded-full border border-black/10" style={{ backgroundColor: color }} title={color} />)}
                      <span className="truncate">{selectedSystem.typography || 'Typography 待補'}</span>
                    </div>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={startSubDesign}
                className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-md bg-[#c96646] px-3 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-[#b95638] focus:outline-none focus:ring-2 focus:ring-[#c96646] focus:ring-offset-2"
              >
                <Icon name="add" size={15} />
                Create brief
              </button>
              <p className="mt-3 text-center text-[9px] leading-relaxed text-[#a29b93]">建立後會先進入 Plan，選定 direction 後才解鎖 Build。</p>
            </div>
          </div>

          <div className="mt-auto border-t border-[#ece9e4] px-2 pt-3 text-[9px] text-[#9c958e]">
            <div className="flex items-center gap-1.5"><Icon name="shield" size={12} /> Plan mode · HITL enabled</div>
            <div className="mt-1.5 flex items-center gap-1.5"><Icon name="auto_awesome" size={12} /> Brief → Direction → Deliver</div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex h-[53px] items-center justify-between border-b border-[#e8e5df] bg-[#fbfaf8] px-6">
            <div className="flex h-full items-center gap-5 text-[11px] text-[#7b756e]">
              {([['recent', 'Recent'], ['templates', 'Templates'], ['systems', 'Design systems']] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`h-full border-b-2 transition-colors ${
                    activeTab === id ? 'border-[#292725] font-semibold text-[#292725]' : 'border-transparent hover:text-[#292725]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex h-7 w-44 items-center gap-1.5 rounded-md border border-[#e8e4df] bg-white px-2 text-[#aea7a0]">
              <Icon name="search" size={13} />
              <span className="sr-only">搜尋 SubDesign</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search…" className="min-w-0 flex-1 bg-transparent text-[10px] text-[#4a4540] outline-none placeholder:text-[#aea7a0]" />
            </label>
          </header>

          <section className="px-7 py-6">
            <div className="flex items-center justify-between">
              <div className="flex rounded-full bg-[#efede8] p-0.5 text-[10px]">
                <span className="rounded-full bg-[#292725] px-3 py-1 font-medium text-white">{activeTab === 'recent' ? 'Recent' : activeTab === 'templates' ? 'Templates' : 'Systems'}</span>
                <span className="px-3 py-1 text-[#938d85]">{briefs.length} saved briefs</span>
              </div>
              <button type="button" onClick={() => void refreshSystems(projectRoot || undefined)} className="flex items-center gap-1 text-[10px] text-[#9b938b] hover:text-[#292725]" title="重新掃描 DESIGN.md">
                <Icon name="refresh" size={13} />
                {systemsLoading ? 'Scanning…' : `${systems.length} systems`}
              </button>
            </div>

            {activeTab === 'recent' ? (
              <>
                <div className="mt-7 flex items-center justify-between">
                  <div>
                    <div className="text-[12px] font-semibold">Saved design briefs</div>
                    <p className="mt-1 text-[10px] text-[#958e86]">可恢復中斷的設計流程，direction 與 stage 會跟著 thread 保存。</p>
                  </div>
                  <span className="text-[10px] text-[#a39c94]">{filteredBriefs.length} results</span>
                </div>
                {filteredBriefs.length ? (
                  <div className="mt-4 grid max-w-4xl gap-2 md:grid-cols-2">
                    {filteredBriefs.map((item) => {
                      const surface = SURFACES.find((candidate) => candidate.id === item.surface) || SURFACES[0]
                      return (
                        <button key={item.id} type="button" onClick={() => resumeBrief(item)} className="group rounded-md border border-[#e7e3de] bg-white p-3 text-left transition-all hover:-translate-y-0.5 hover:border-[#c96646]/50 hover:shadow-sm">
                          <div className="flex items-start gap-2">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#f3f1ed] text-[#a19a92]"><Icon name={surface.icon} size={16} /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[11px] font-semibold text-[#322f2b]">{item.objective}</span>
                              <span className="mt-1 block text-[9px] text-[#9d958d]">{surface.title} · {stageLabel(item.stage)} · {formatRelativeTime(item.updatedAt)}</span>
                            </span>
                            <Icon name="chevron_right" size={15} className="mt-1 text-[#b0a9a1] transition-transform group-hover:translate-x-0.5" />
                          </div>
                          <div className="mt-3 flex items-center gap-1">
                            {STAGES.map((stage) => <span key={stage} className={`h-1 flex-1 rounded-full ${STAGES.indexOf(stage) <= STAGES.indexOf(item.stage) ? 'bg-[#c96646]' : 'bg-[#ece8e3]'}`} title={stageLabel(stage)} />)}
                          </div>
                          <div className="mt-2 flex items-center justify-between text-[9px] text-[#aaa29a]">
                            <span>{item.selectedDirectionId ? `Direction · ${item.selectedDirectionId}` : '等待 direction 選擇'}</span>
                            <span>{item.designSystemId || '未指定 system'}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="mt-4 max-w-2xl rounded-md border border-dashed border-[#ded8d0] bg-[#fbfaf8] px-4 py-7 text-center text-[10px] text-[#a39b93]">還沒有保存的 brief。從左側填寫目標後建立第一個 SubDesign session。</div>
                )}
              </>
            ) : null}

            {activeTab === 'templates' ? (
              <>
                <div className="mt-7 flex items-center justify-between">
                  <div><div className="text-[12px] font-semibold">Start from a surface</div><p className="mt-1 text-[10px] text-[#958e86]">選擇輸出型態，具體模板會由既有 agent loop 依 brief 生成。</p></div>
                  <span className="text-[10px] text-[#a39c94]">{filteredSurfaces.length} surfaces</span>
                </div>
                <div className="mt-5 grid max-w-4xl grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
                  {filteredSurfaces.map((surface) => {
                    const selected = surface.id === activeSurface.id
                    return (
                      <button key={surface.id} type="button" onClick={() => setSurfaceId(surface.id)} className={`overflow-hidden rounded-md border bg-white text-left transition-all hover:-translate-y-0.5 hover:shadow-sm ${selected ? 'border-[#c96646] shadow-[0_0_0_2px_rgba(201,102,70,0.12)]' : 'border-[#e7e3de]'}`}>
                        <div className="flex h-[82px] items-center justify-center border-b border-[#efebe6] bg-[#f3f1ed]"><div className="grid h-10 w-9 place-items-center rounded-sm border border-[#ded9d2] bg-white text-[#b2aba3] shadow-[0_2px_4px_rgba(42,36,30,0.04)]"><Icon name={surface.icon} size={18} /></div></div>
                        <div className="px-3 py-2.5"><div className="truncate text-[11px] font-semibold text-[#322f2b]">{surface.title}</div><div className="mt-1 truncate text-[9px] text-[#a19a92]">{selected ? '選取中' : surface.deliverable}</div></div>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : null}

            {activeTab === 'systems' ? (
              <>
                <div className="mt-7 flex items-start justify-between gap-4"><div><div className="text-[12px] font-semibold">Design system registry</div><p className="mt-1 max-w-xl text-[10px] leading-relaxed text-[#958e86]">讀取專案根目錄的 DESIGN.md 與 .subagents/subdesign/design-systems/*；只解析摘要，不會自動發出網路請求。</p></div><span className="text-[10px] text-[#a39c94]">{filteredSystems.length} systems</span></div>
                {systemsError ? <div className="mt-4 rounded-md border border-[#ead2c9] bg-[#fff7f3] px-3 py-2 text-[10px] text-[#a24f36]">{systemsError}</div> : null}
                {filteredSystems.length ? (
                  <div className="mt-5 grid max-w-4xl gap-3 md:grid-cols-2">
                    {filteredSystems.map((system) => (
                      <button key={system.id} type="button" onClick={() => { setDesignSystemId(system.id); setActiveTab('templates') }} className={`rounded-md border bg-white p-3 text-left transition-colors hover:border-[#c96646]/60 ${designSystemId === system.id ? 'border-[#c96646] ring-1 ring-[#c96646]/15' : 'border-[#e7e3de]'}`}>
                        <div className="flex items-start justify-between gap-3"><div><div className="text-[11px] font-semibold">{system.title}</div><div className="mt-1 text-[9px] text-[#a19a92]">{system.id} · {system.sourcePath}</div></div><Icon name="palette" size={16} className="text-[#c96646]" /></div>
                        {system.description ? <p className="mt-2 text-[10px] leading-relaxed text-[#817a73]">{system.description}</p> : null}
                        <div className="mt-3 flex items-center gap-2"><div className="flex gap-1">{system.colors.slice(0, 6).map((color) => <span key={color} className="h-4 w-4 rounded-full border border-black/10" style={{ backgroundColor: color }} title={color} />)}</div><span className="truncate text-[9px] text-[#a19a92]">{system.typography || 'Typography 未解析'}</span></div>
                        <div className="mt-2 text-[9px] text-[#aaa29a]">{system.sections.length} sections · {system.tokenPaths.length} token/assets references</div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-5 max-w-2xl rounded-md border border-dashed border-[#ded8d0] bg-[#fbfaf8] px-4 py-7 text-center text-[10px] text-[#a39b93]">{projectRoot ? '尚未找到 DESIGN.md。可在專案中建立它，或在 SubDesign Plan stage 讓 agent 透過 HITL 建立 versioned design system。' : '先在主畫面的 Project context 選擇專案，才能掃描 DESIGN.md。'}</div>
                )}
              </>
            ) : null}

            <div className="mt-8 grid max-w-5xl gap-3 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.6fr)]">
              <ArtifactRail artifacts={artifacts} selectedKey={selectedArtifact ? `${selectedArtifact.id}:${selectedArtifact.revision}` : null} onSelect={(artifact) => setSelectedArtifactKey(`${artifact.id}:${artifact.revision}`)} />
              <ArtifactPreview artifact={selectedArtifact} />
            </div>
            <div className="mt-3 grid max-w-5xl gap-3 lg:grid-cols-2">
              <CritiquePanel critique={latestCritique} />
              <ArtifactDeliveryPanel artifact={selectedArtifact} critiquePassed={Boolean(latestCritique && critiqueAllowsDeliver(latestCritique))} />
            </div>

            <div className="mt-8 max-w-4xl border-t border-[#e9e6e1] pt-4">
              <div className="flex items-start justify-between gap-5">
                <div><div className="text-[11px] font-semibold">{activeSurface.title}</div><p className="mt-1 max-w-lg text-[11px] leading-relaxed text-[#837c74]">{activeSurface.description} 首期交付為 {activeSurface.deliverable}。</p></div>
                <button type="button" onClick={startSubDesign} className="shrink-0 text-[11px] font-semibold text-[#b95638] hover:text-[#8f422c]">Create this design →</button>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
