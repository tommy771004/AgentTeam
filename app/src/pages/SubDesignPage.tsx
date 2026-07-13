import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { critiqueAllowsDeliver } from '../agent/subdesign/critique'
import { buildSubDesignPrompt } from '../agent/subdesign/prompt'
import type { SubDesignPlatform, SubDesignStage } from '../agent/subdesign/types'
import { stageLabel } from '../agent/subdesign/types'
import { Icon } from '../components/Icon'
import { ArtifactDeliveryPanel } from '../components/subdesign/ArtifactDeliveryPanel'
import { ArtifactPreview } from '../components/subdesign/ArtifactPreview'
import { ArtifactRail } from '../components/subdesign/ArtifactRail'
import { CritiquePanel } from '../components/subdesign/CritiquePanel'
import { useAgentStore } from '../store/agentStore'
import { useProjectStore } from '../store/projectStore'
import { useSubDesignArtifactStore } from '../store/subDesignArtifactStore'
import { useSubDesignCritiqueStore } from '../store/subDesignCritiqueStore'
import { useSubDesignExportStore } from '../store/subDesignExportStore'
import { hydrateSubDesignStores } from '../store/subDesignPersistence'
import { useSubDesignStore } from '../store/subDesignStore'
import { useThreadStore } from '../store/threadStore'

type DesignSurface = {
  id: 'prototype' | 'dashboard' | 'design-system' | 'deck'
  title: string
  icon: string
}

const SURFACES: readonly DesignSurface[] = [
  { id: 'prototype', title: '產品原型', icon: 'web' },
  { id: 'dashboard', title: '資料儀表板', icon: 'dashboard' },
  { id: 'design-system', title: 'Design System', icon: 'palette' },
  { id: 'deck', title: '簡報與報告', icon: 'slideshow' },
]

const PLATFORMS: ReadonlyArray<{ id: SubDesignPlatform; label: string }> = [
  { id: 'responsive', label: 'Responsive web' },
  { id: 'web-desktop', label: 'Web desktop' },
  { id: 'mobile-ios', label: 'Mobile iOS' },
  { id: 'desktop-app', label: 'Desktop app' },
]

const STAGES: readonly SubDesignStage[] = ['brief', 'direction', 'build', 'critique', 'deliver']
const STAGE_NAMES: Record<SubDesignStage, string> = {
  brief: '需求',
  direction: '方向',
  build: '建立',
  critique: '檢查',
  deliver: '交付',
}

function formatRelativeTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '最近'
  const minutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60_000))
  if (minutes < 60) return `${minutes} 分鐘前`
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小時前`
  return `${Math.round(minutes / 1440)} 天前`
}

function StageRail({ stage }: { stage: SubDesignStage | null }) {
  const activeIndex = stage ? STAGES.indexOf(stage) : 0

  return (
    <ol aria-label="SubDesign 流程" className="flex items-start gap-0 px-1">
      {STAGES.map((item, index) => {
        const current = index === activeIndex
        const complete = index < activeIndex
        return (
          <li key={item} className="flex min-w-0 flex-1 items-start last:flex-none">
            <div className="flex min-w-[42px] flex-col items-center gap-1.5">
              <span
                className={`grid h-7 w-7 place-items-center rounded-full border text-[11px] font-semibold ${
                  current
                    ? 'border-primary bg-primary text-on-primary shadow-[0_0_18px_rgba(125,216,240,0.28)]'
                    : complete
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-white/12 bg-white/[0.03] text-outline'
                }`}
              >
                {complete ? <Icon name="check" size={14} /> : index + 1}
              </span>
              <span className={`whitespace-nowrap text-[11px] ${current ? 'font-semibold text-primary' : 'text-outline'}`}>
                {STAGE_NAMES[item]}
              </span>
            </div>
            {index < STAGES.length - 1 ? (
              <span className={`mt-3 h-px min-w-2 flex-1 ${complete ? 'bg-primary/45' : 'bg-white/10'}`} />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export function SubDesignPage() {
  const navigate = useNavigate()
  const createThread = useThreadStore((state) => state.createThread)
  const setSubDesignBriefId = useThreadStore((state) => state.setSubDesignBriefId)
  const setDraftInput = useAgentStore((state) => state.setDraftInput)
  const projectRoot = useProjectStore((state) => state.root)
  const briefs = useSubDesignStore((state) => state.briefs)
  const selectedBriefId = useSubDesignStore((state) => state.selectedBriefId)
  const selectBrief = useSubDesignStore((state) => state.selectBrief)
  const setProjectRoot = useSubDesignStore((state) => state.setProjectRoot)
  const systems = useSubDesignStore((state) => state.systems)
  const systemsLoading = useSubDesignStore((state) => state.systemsLoading)
  const refreshSystems = useSubDesignStore((state) => state.refreshSystems)
  const createBrief = useSubDesignStore((state) => state.createBrief)
  const artifacts = useSubDesignArtifactStore((state) => state.artifacts)
  const setArtifactProjectRoot = useSubDesignArtifactStore((state) => state.setProjectRoot)
  const setCritiqueProjectRoot = useSubDesignCritiqueStore((state) => state.setProjectRoot)
  const setExportProjectRoot = useSubDesignExportStore((state) => state.setProjectRoot)

  const [surfaceId, setSurfaceId] = useState<DesignSurface['id']>('prototype')
  const [platform, setPlatform] = useState<SubDesignPlatform>('responsive')
  const [brief, setBrief] = useState('')
  const [designSystemId, setDesignSystemId] = useState('')
  const [selectedArtifactKey, setSelectedArtifactKey] = useState<string | null>(null)

  const activeSurface = useMemo(
    () => SURFACES.find((surface) => surface.id === surfaceId) || SURFACES[0],
    [surfaceId],
  )
  const activeBrief = briefs.find((item) => item.id === selectedBriefId) || briefs[0] || null
  const selectedSystem = systems.find((system) => system.id === designSystemId)
  const visibleArtifacts = activeBrief
    ? artifacts.filter((artifact) => artifact.briefId === activeBrief.id)
    : []
  const selectedArtifact =
    visibleArtifacts.find((artifact) => `${artifact.id}:${artifact.revision}` === selectedArtifactKey) ||
    visibleArtifacts[0] ||
    null
  const latestCritique = useSubDesignCritiqueStore((state) =>
    selectedArtifact ? state.latestForArtifact(selectedArtifact.id) : null,
  )

  useEffect(() => {
    setProjectRoot(projectRoot || '')
    setArtifactProjectRoot(projectRoot || '')
    setCritiqueProjectRoot(projectRoot || '')
    setExportProjectRoot(projectRoot || '')
    void hydrateSubDesignStores(projectRoot || undefined)
    void refreshSystems(projectRoot || undefined)
  }, [
    projectRoot,
    refreshSystems,
    setArtifactProjectRoot,
    setCritiqueProjectRoot,
    setExportProjectRoot,
    setProjectRoot,
  ])

  useEffect(() => {
    if (!activeBrief) return
    setSurfaceId(activeBrief.surface)
    setDesignSystemId(activeBrief.designSystemId || '')
  }, [activeBrief])

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
      platform,
      fidelity: 'high-fidelity',
      designSystemId: designSystemId || undefined,
      projectRoot: projectRoot || undefined,
    })
    setSubDesignBriefId(threadId, created.id)
    selectBrief(created.id)
    setDraftInput(buildSubDesignPrompt(created, selectedSystem))
    navigate(`/?thread=${threadId}`)
  }

  const resumeBrief = (id: string) => {
    const item = briefs.find((briefItem) => briefItem.id === id)
    if (!item) return
    selectBrief(item.id)
    setSurfaceId(item.surface)
    setDesignSystemId(item.designSystemId || '')
    navigate(`/?thread=${item.threadId}`)
  }

  return (
    <div className="h-full min-w-0 overflow-auto bg-background text-on-background">
      <main className="mx-auto w-full max-w-[1180px] px-5 py-7 md:px-8 lg:py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-[family-name:var(--font-sora)] text-[25px] font-semibold tracking-tight text-on-surface">
              SubDesign
            </h1>
            <p className="mt-1 text-[13px] text-outline">建立可交付的設計 artifact。</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshSystems(projectRoot || undefined)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[12px] font-medium text-outline transition-colors hover:border-primary/30 hover:text-primary"
          >
            <Icon name="refresh" size={14} />
            {systemsLoading ? '掃描中…' : '更新 Design systems'}
          </button>
        </header>

        <section className="mt-8">
          <StageRail stage={activeBrief?.stage || null} />
        </section>

        <section className="app-panel mt-7 overflow-hidden">
          <div className="px-5 pb-0 pt-5 md:px-6 md:pt-6">
            <label htmlFor="subdesign-brief" className="sr-only">設計目標</label>
            <textarea
              id="subdesign-brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="描述你想建立的設計…"
              className="min-h-[128px] w-full resize-y bg-transparent text-[18px] leading-relaxed text-on-surface outline-none placeholder:text-outline/70"
            />
          </div>
          <div className="flex flex-col gap-3 border-t border-white/[0.08] px-5 py-4 md:flex-row md:items-center md:px-6">
            <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="relative">
                <span className="sr-only">輸出類型</span>
                <select
                  value={surfaceId}
                  onChange={(event) => setSurfaceId(event.target.value as DesignSurface['id'])}
                  className="h-10 w-full appearance-none rounded-xl border border-white/10 bg-surface-container-low px-3 pr-8 text-[12px] text-on-surface outline-none focus:border-primary/45"
                >
                  {SURFACES.map((surface) => (
                    <option key={surface.id} value={surface.id}>{surface.title}</option>
                  ))}
                </select>
                <Icon name="expand_more" size={16} className="pointer-events-none absolute right-2.5 top-3 text-outline" />
              </label>
              <label className="relative">
                <span className="sr-only">平台</span>
                <select
                  value={platform}
                  onChange={(event) => setPlatform(event.target.value as SubDesignPlatform)}
                  className="h-10 w-full appearance-none rounded-xl border border-white/10 bg-surface-container-low px-3 pr-8 text-[12px] text-on-surface outline-none focus:border-primary/45"
                >
                  {PLATFORMS.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
                <Icon name="expand_more" size={16} className="pointer-events-none absolute right-2.5 top-3 text-outline" />
              </label>
              <label className="relative">
                <span className="sr-only">Design system</span>
                <select
                  value={designSystemId}
                  onChange={(event) => setDesignSystemId(event.target.value)}
                  className="h-10 w-full appearance-none rounded-xl border border-white/10 bg-surface-container-low px-3 pr-8 text-[12px] text-on-surface outline-none focus:border-primary/45"
                >
                  <option value="">使用專案 Design system</option>
                  {systems.map((system) => (
                    <option key={system.id} value={system.id}>{system.title}</option>
                  ))}
                </select>
                <Icon name="expand_more" size={16} className="pointer-events-none absolute right-2.5 top-3 text-outline" />
              </label>
            </div>
            <button
              type="button"
              onClick={startSubDesign}
              className="macos-btn inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[13px] font-semibold text-on-primary shadow-[0_8px_24px_rgba(43,184,217,0.18)] hover:bg-primary-container focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <Icon name="arrow_forward" size={16} />開始設計
            </button>
          </div>
        </section>

        {activeBrief ? (
          <section className="mt-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-on-surface">{activeBrief.objective}</h2>
                <p className="mt-1 text-[12px] text-outline">{stageLabel(activeBrief.stage)} · {formatRelativeTime(activeBrief.updatedAt)}</p>
              </div>
              <button
                type="button"
                onClick={() => resumeBrief(activeBrief.id)}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:text-primary-fixed"
              >
                繼續此設計 <Icon name="arrow_forward" size={14} />
              </button>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
              <ArtifactRail
                artifacts={visibleArtifacts}
                selectedKey={selectedArtifact ? `${selectedArtifact.id}:${selectedArtifact.revision}` : null}
                onSelect={(artifact) => setSelectedArtifactKey(`${artifact.id}:${artifact.revision}`)}
              />
              <ArtifactPreview artifact={selectedArtifact} />
            </div>

            {selectedArtifact ? (
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <CritiquePanel critique={latestCritique} />
                <ArtifactDeliveryPanel
                  artifact={selectedArtifact}
                  critiquePassed={Boolean(latestCritique && critiqueAllowsDeliver(latestCritique))}
                />
              </div>
            ) : null}
          </section>
        ) : briefs.length ? (
          <section className="mt-10">
            <h2 className="text-[15px] font-semibold text-on-surface">最近的設計</h2>
            <div className="mt-3 divide-y divide-white/[0.08] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              {briefs.slice(0, 6).map((item) => {
                const surface = SURFACES.find((candidate) => candidate.id === item.surface) || SURFACES[0]
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => resumeBrief(item.id)}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.04]"
                  >
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Icon name={surface.icon} size={16} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-on-surface">{item.objective}</span><span className="mt-1 block text-[11px] text-outline">{surface.title} · {stageLabel(item.stage)}</span></span>
                    <span className="text-[11px] text-outline">{formatRelativeTime(item.updatedAt)}</span>
                    <Icon name="chevron_right" size={16} className="text-outline" />
                  </button>
                )
              })}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  )
}
