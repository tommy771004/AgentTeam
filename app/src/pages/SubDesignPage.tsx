import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { critiqueAllowsDeliver } from '../agent/subdesign/critique'
import { buildSubDesignPrompt } from '../agent/subdesign/prompt'
import {
  OPEN_DESIGN_TEMPLATE_SOURCE,
  SUBDESIGN_TEMPLATE_CATEGORIES,
  openDesignRecordToTemplate,
  setSubDesignTemplateCache,
  type SubDesignTemplateCategory,
} from '../agent/subdesign/templateCatalog'
import { loadOpenDesignCatalog, type OpenDesignCatalogRecord } from '../agent/openDesign/catalog'
import type { SubDesignPlatform } from '../agent/subdesign/types'
import { stageLabel } from '../agent/subdesign/types'
import { findLatestPassedSubDesignPreference } from '../agent/subdesign/preference'
import { Icon } from '../components/Icon'
import { ArtifactDeliveryPanel } from '../components/subdesign/ArtifactDeliveryPanel'
import { ArtifactPreview } from '../components/subdesign/ArtifactPreview'
import { ArtifactRail } from '../components/subdesign/ArtifactRail'
import { CritiquePanel } from '../components/subdesign/CritiquePanel'
import { CritiqueTheater } from '../components/subdesign/CritiqueTheater'
import { ArtifactTweakPanel } from '../components/subdesign/ArtifactTweakPanel'
import { ReferenceImportPanel } from '../components/subdesign/ReferenceImportPanel'
import { SubDesignFlowPrototype } from '../components/subdesign/SubDesignFlow.prototype'
import { SubDesignWorkspaceHeader } from '../components/subdesign/SubDesignWorkspaceHeader'
import { SubDesignRunInspector } from '../components/subdesign/SubDesignRunInspector'
import { SubDesignProjectStudio } from '../components/subdesign/SubDesignProjectStudio'
import { SubDesignStudioNav } from '../components/subdesign/SubDesignStudioNav'
import { deriveSubDesignWorkspace } from '../agent/subdesign/workspace'
import { runTask } from '../agent/taskRunCoordinator'
import { useAgentStore } from '../store/agentStore'
import { useLearningStore } from '../store/learningStore'
import { useProjectStore } from '../store/projectStore'
import { useSubDesignArtifactStore } from '../store/subDesignArtifactStore'
import { useSubDesignCritiqueStore } from '../store/subDesignCritiqueStore'
import { useSubDesignCritiqueSessionStore } from '../store/subDesignCritiqueSessionStore'
import { useSubDesignExportStore } from '../store/subDesignExportStore'
import { hydrateSubDesignStores } from '../store/subDesignPersistence'
import { useSubDesignStore } from '../store/subDesignStore'
import { useThreadStore } from '../store/threadStore'
import { useRunActivityStore } from '../store/runActivityStore'
import { useOpenDesignPackStore } from '../store/openDesignPackStore'
import { useSettingsStore } from '../store/settingsStore'
import type { ThreadRunner } from '../store/threadStore'

type DesignSurface = {
  id: 'prototype' | 'dashboard' | 'design-system' | 'deck'
  title: string
  description: string
  icon: string
}

const SURFACES: readonly DesignSurface[] = [
  { id: 'prototype', title: '產品原型', description: '網頁、桌面或行動介面', icon: 'web' },
  { id: 'dashboard', title: '即時看板', description: '資料與決策工作台', icon: 'dashboard' },
  { id: 'design-system', title: 'Design System', description: '品牌規則與元件語言', icon: 'palette' },
  { id: 'deck', title: '簡報與報告', description: '可交付的敘事內容', icon: 'slideshow' },
]

const PLATFORMS: ReadonlyArray<{ id: SubDesignPlatform; label: string }> = [
  { id: 'responsive', label: 'Responsive web' },
  { id: 'web-desktop', label: 'Web desktop' },
  { id: 'mobile-ios', label: 'Mobile iOS' },
  { id: 'desktop-app', label: 'Desktop app' },
]

const RUNNER_LABELS: Partial<Record<ThreadRunner, string>> = {
  builtin: 'Built-in Agent',
  codex: 'Codex CLI',
  claude: 'Claude CLI',
  grok: 'Grok CLI',
  opencode: 'OpenCode CLI',
  gemini: 'Gemini CLI',
  cursor: 'Cursor CLI',
}

function formatRelativeTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '最近'
  const minutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60_000))
  if (minutes < 60) return `${minutes} 分鐘前`
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小時前`
  return `${Math.round(minutes / 1440)} 天前`
}

function SelectChevron() {
  return <Icon name="expand_more" size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-outline" />
}

export function SubDesignPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { briefId: routeBriefId } = useParams<{ briefId?: string }>()
  const createThread = useThreadStore((state) => state.createThread)
  const setSubDesignBriefId = useThreadStore((state) => state.setSubDesignBriefId)
  const hydrateThreads = useThreadStore((state) => state.hydrate)
  const threads = useThreadStore((state) => state.threads)
  const getRunIdForThread = useAgentStore((state) => state.getRunIdForThread)
  const projectRoot = useProjectStore((state) => state.root)
  const cliProviders = useSettingsStore((state) => state.settings.cliProviders)
  const briefs = useSubDesignStore((state) => state.briefs)
  const selectedBriefId = useSubDesignStore((state) => state.selectedBriefId)
  const selectBrief = useSubDesignStore((state) => state.selectBrief)
  const setProjectRoot = useSubDesignStore((state) => state.setProjectRoot)
  const systems = useSubDesignStore((state) => state.systems)
  const systemsLoading = useSubDesignStore((state) => state.systemsLoading)
  const refreshSystems = useSubDesignStore((state) => state.refreshSystems)
  const createBrief = useSubDesignStore((state) => state.createBrief)
  const updateBrief = useSubDesignStore((state) => state.updateBrief)
  const selectDirection = useSubDesignStore((state) => state.selectDirection)
  const artifacts = useSubDesignArtifactStore((state) => state.artifacts)
  const critiques = useSubDesignCritiqueStore((state) => state.critiques)
  const critiqueSession = useSubDesignCritiqueSessionStore((state) => state.current)
  const memoryEntries = useLearningStore((state) => state.memory.entries)
  const setArtifactProjectRoot = useSubDesignArtifactStore((state) => state.setProjectRoot)
  const setCritiqueProjectRoot = useSubDesignCritiqueStore((state) => state.setProjectRoot)
  const setExportProjectRoot = useSubDesignExportStore((state) => state.setProjectRoot)
  const installOpenDesignPack = useOpenDesignPackStore((state) => state.install)
  const setOpenDesignPackEnabled = useOpenDesignPackStore((state) => state.setEnabled)
  const openDesignPackBusyId = useOpenDesignPackStore((state) => state.busyId)
  const openDesignPackError = useOpenDesignPackStore((state) => state.error)
  const rehydrateOpenDesignPacks = useOpenDesignPackStore((state) => state.rehydrateEnabled)
  const reindexOpenDesignPacks = useOpenDesignPackStore((state) => state.reindex)
  const setOpenDesignPackProjectRoot = useOpenDesignPackStore((state) => state.setProjectRoot)
  const runningThreadIds = useThreadStore((state) => state.runningThreadIds)
  const setShowRunPanel = useThreadStore((state) => state.setShowRunPanel)
  const linkedThread = useThreadStore((state) =>
    routeBriefId ? state.threads.find((thread) => thread.subDesignBriefId === routeBriefId) : null,
  )
  const linkedThreadRunId = linkedThread?.id ? getRunIdForThread(linkedThread.id) : null
  const linkedAgent = useAgentStore((state) =>
    linkedThreadRunId ? state.runStates[linkedThreadRunId] : null,
  )
  const activityActive = useRunActivityStore((state) =>
    linkedThreadRunId ? state.getPresentation(linkedThreadRunId)?.active || false : false,
  )

  const [surfaceId, setSurfaceId] = useState<DesignSurface['id']>('prototype')
  const [platform, setPlatform] = useState<SubDesignPlatform>('responsive')
  const [brief, setBrief] = useState('')
  const [designSystemId, setDesignSystemId] = useState('')
  const [runner, setRunner] = useState<ThreadRunner>('builtin')
  const [templateCategory, setTemplateCategory] = useState<SubDesignTemplateCategory>('all')
  const [templateId, setTemplateId] = useState<string | undefined>()
  const [templateQuery, setTemplateQuery] = useState('')
  const [designSystemPackId, setDesignSystemPackId] = useState<string | undefined>()
  const [catalogRecords, setCatalogRecords] = useState<OpenDesignCatalogRecord[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogWarning, setCatalogWarning] = useState('')
  const [selectedArtifactKey, setSelectedArtifactKey] = useState<string | null>(null)
  const [startingRun, setStartingRun] = useState(false)

  const activeSurface = useMemo(
    () => SURFACES.find((surface) => surface.id === surfaceId) || SURFACES[0],
    [surfaceId],
  )
  const routeBrief = routeBriefId ? briefs.find((item) => item.id === routeBriefId) || null : null
  const activeBrief = routeBriefId ? routeBrief : null
  const activeBriefId = activeBrief?.id
  const activeBriefSurface = activeBrief?.surface
  const activeBriefDesignSystemId = activeBrief?.designSystemId
  const activeBriefTemplateId = activeBrief?.templateId
  const selectedSystem = systems.find((system) => system.id === designSystemId)
  const allTemplates = useMemo(
    () => catalogRecords.filter((record) => record.kind === 'template').map(openDesignRecordToTemplate),
    [catalogRecords],
  )
  useEffect(() => {
    setSubDesignTemplateCache(allTemplates)
  }, [allTemplates])
  const visibleTemplates = allTemplates.filter((template) =>
    (templateCategory === 'all' || template.category === templateCategory) &&
    `${template.title} ${template.summary}`.toLowerCase().includes(templateQuery.trim().toLowerCase()),
  )
  const categoryCounts = useMemo(() => {
    const counts = new Map<SubDesignTemplateCategory, number>()
    for (const template of allTemplates) counts.set(template.category, (counts.get(template.category) || 0) + 1)
    return counts
  }, [allTemplates])
  const visibleArtifacts = activeBrief
    ? artifacts.filter((artifact) => artifact.briefId === activeBrief.id)
    : []
  const selectedArtifact =
    visibleArtifacts.find((artifact) => `${artifact.id}:${artifact.revision}` === selectedArtifactKey) ||
    visibleArtifacts[0] ||
    null
  const latestCritique = useSubDesignCritiqueStore((state) =>
    selectedArtifact ? state.latestForArtifact(selectedArtifact.id, selectedArtifact.revision) : null,
  )
  const availableRunners = useMemo(() => {
    const values: ThreadRunner[] = ['builtin']
    for (const provider of cliProviders || []) {
      if (!provider.enabled || !provider.authorized) continue
      const candidate: ThreadRunner | null = provider.kind === 'anthropic'
        ? 'claude'
        : provider.kind === 'google'
          ? 'gemini'
          : provider.kind === 'opencode' || provider.kind === 'cursor' || provider.kind === 'codex' || provider.kind === 'grok'
            ? provider.kind
            : null
      if (candidate && !values.includes(candidate)) values.push(candidate)
    }
    return values
  }, [cliProviders])
  const workspace = activeBrief
    ? deriveSubDesignWorkspace({
        brief: activeBrief,
        artifacts: visibleArtifacts,
        selectedArtifact,
        critique: latestCritique,
        critiqueSession,
        runStatus: startingRun ? 'running' : linkedAgent?.status,
      })
    : null
  const selectedCatalogRecord = catalogRecords.find((record) => record.id === templateId) || null
  const latestPassedPreference = useMemo(
    () => findLatestPassedSubDesignPreference(briefs, artifacts, critiques, { projectRoot, memoryEntries }),
    [artifacts, briefs, critiques, memoryEntries, projectRoot],
  )
  const installedOpenDesignPack = useOpenDesignPackStore((state) =>
    selectedCatalogRecord ? state.installed(selectedCatalogRecord) : null,
  )
  // Design System Packs are vendor DESIGN.md content (kind:'design-system'), distinct from the
  // project-owned Design Systems scanned by refreshSystems() — see CONTEXT.md and
  // docs/adr/0001-opendesign-catalog-is-source-of-truth.md. Installing one copies it into
  // .subagents/subdesign/design-systems/<id>/ via the same copyVendorPack IPC templates use.
  const designSystemPackRecords = useMemo(
    () => catalogRecords.filter((record) => record.kind === 'design-system'),
    [catalogRecords],
  )
  const selectedDesignSystemPackRecord = designSystemPackRecords.find((record) => record.id === designSystemPackId) || null
  const installedDesignSystemPack = useOpenDesignPackStore((state) =>
    selectedDesignSystemPackRecord ? state.installed(selectedDesignSystemPackRecord) : null,
  )

  const runIsLive = Boolean(
      activeBrief &&
      (startingRun || runningThreadIds.includes(activeBrief.threadId)) &&
      (startingRun ||
        Boolean(linkedThreadRunId) ||
        activityActive ||
        ['running', 'parsing', 'manual_intervention', 'awaiting_user'].includes(
          linkedAgent?.status || 'idle',
        )),
  )

  useEffect(() => {
    hydrateThreads()
  }, [hydrateThreads])

  useEffect(() => {
    if (routeBriefId) {
      if (briefs.some((item) => item.id === routeBriefId) && selectedBriefId !== routeBriefId) selectBrief(routeBriefId)
      return
    }
    if (!selectedBriefId && briefs[0]) selectBrief(briefs[0].id)
  }, [briefs, routeBriefId, selectBrief, selectedBriefId])

  useEffect(() => {
    setProjectRoot(projectRoot || '')
    setArtifactProjectRoot(projectRoot || '')
    setCritiqueProjectRoot(projectRoot || '')
    setExportProjectRoot(projectRoot || '')
    setOpenDesignPackProjectRoot(projectRoot || '')
    void hydrateSubDesignStores(projectRoot || undefined)
    void refreshSystems(projectRoot || undefined)
  }, [
    projectRoot,
    refreshSystems,
    setArtifactProjectRoot,
    setCritiqueProjectRoot,
    setExportProjectRoot,
    setOpenDesignPackProjectRoot,
    setProjectRoot,
  ])

  useEffect(() => {
    let active = true
    setCatalogLoading(true)
    void loadOpenDesignCatalog().then((index) => {
      if (!active) return
      setCatalogRecords(index.records)
      setCatalogWarning(index.warnings[0] || '')
      setCatalogLoading(false)
      reindexOpenDesignPacks(index.records)
      void rehydrateOpenDesignPacks(index.records)
    })
    return () => {
      active = false
    }
  }, [reindexOpenDesignPacks, rehydrateOpenDesignPacks])

  useEffect(() => {
    if (!activeBriefId || !activeBriefSurface) return
    setSurfaceId(activeBriefSurface)
    setDesignSystemId(activeBriefDesignSystemId || '')
    setTemplateId(activeBriefTemplateId)
  }, [activeBriefDesignSystemId, activeBriefId, activeBriefSurface, activeBriefTemplateId])

  useEffect(() => {
    const requestedDesignSystemId = new URLSearchParams(location.search).get('designSystemId')
    if (!requestedDesignSystemId || !systems.some((system) => system.id === requestedDesignSystemId)) return
    setDesignSystemId(requestedDesignSystemId)
    if (activeBrief && activeBrief.designSystemId !== requestedDesignSystemId) {
      updateBrief(activeBrief.id, { designSystemId: requestedDesignSystemId }, projectRoot || undefined)
    }
  }, [activeBrief, location.search, projectRoot, systems, updateBrief])

  useEffect(() => {
    if (!latestPassedPreference) return
    if (!designSystemId && latestPassedPreference.designSystemId) setDesignSystemId(latestPassedPreference.designSystemId)
    if (!templateId && latestPassedPreference.templateId) setTemplateId(latestPassedPreference.templateId)
  }, [designSystemId, latestPassedPreference, templateId])

  const startSubDesign = () => {
    const preferredDesignSystemId = designSystemId || latestPassedPreference?.designSystemId
    const preferredTemplateId = templateId || latestPassedPreference?.templateId
    const threadId = createThread({
      title: `SubDesign · ${activeSurface.title}`,
      agentMode: 'plan',
      thinkingDepth: 'deep',
      runner,
    })
    const created = createBrief({
      threadId,
      surface: activeSurface.id,
      objective: brief,
      platform,
      fidelity: 'high-fidelity',
      designSystemId: preferredDesignSystemId,
      templateId: preferredTemplateId,
      skillIds: selectedCatalogRecord?.entryPaths.some((entry) => /SKILL\.md$/i.test(entry))
        ? [selectedCatalogRecord.id]
        : latestPassedPreference?.skillIds,
      provenance: selectedCatalogRecord ? [selectedCatalogRecord] : latestPassedPreference?.provenance,
      projectRoot: projectRoot || undefined,
    })
    setSubDesignBriefId(threadId, created.id)
    selectBrief(created.id)
    navigate(`/subdesign/${created.id}`)
  }

  const resumeBrief = (id: string) => {
    const item = briefs.find((briefItem) => briefItem.id === id)
    if (!item) return
    selectBrief(item.id)
    setSurfaceId(item.surface)
    setDesignSystemId(item.designSystemId || '')
    setTemplateId(item.templateId)
    navigate(`/subdesign/${item.id}`)
  }

  const startBriefRun = async () => {
    if (!activeBrief || startingRun || runIsLive) return
    setStartingRun(true)
    setShowRunPanel(false)
    try {
      await runTask({
        objective: buildSubDesignPrompt(activeBrief, selectedSystem),
        sourceKind: 'composer',
        reuseThreadId: activeBrief.threadId,
        runner: linkedThread?.runner || 'builtin',
        loopType: linkedThread?.loopType || undefined,
      })
    } finally {
      setStartingRun(false)
    }
  }

  const openTranscript = () => {
    if (!activeBrief) return
    const threadStore = useThreadStore.getState()
    threadStore.selectThread(activeBrief.threadId)
    threadStore.setShowRunPanel(true)
    navigate(`/?thread=${encodeURIComponent(activeBrief.threadId)}`)
  }

  // PROTOTYPE only: compare three read-only project-flow layouts on this real route.
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('prototype') === 'subdesign-flow') {
    return <SubDesignFlowPrototype />
  }

  if (routeBriefId && activeBrief && workspace) {
    const activeSystem = systems.find((system) => system.id === activeBrief.designSystemId) || null
    return (
      <SubDesignProjectStudio
        brief={activeBrief}
        workspace={workspace}
        designSystem={activeSystem}
        artifacts={visibleArtifacts}
        selectedArtifact={selectedArtifact}
        critique={latestCritique}
        critiquePassed={Boolean(latestCritique && critiqueAllowsDeliver(latestCritique))}
        runIsLive={runIsLive}
        runId={linkedThreadRunId}
        executionKind={linkedAgent?.executionKind}
        startingRun={startingRun}
        onBack={() => navigate('/subdesign')}
        onOpenDesignSystems={() => navigate(`/design-systems?returnTo=${encodeURIComponent(`/subdesign/${activeBrief.id}`)}&briefId=${encodeURIComponent(activeBrief.id)}`)}
        onStartRun={() => void startBriefRun()}
        onOpenTranscript={openTranscript}
        onSelectArtifact={(artifact) => setSelectedArtifactKey(`${artifact.id}:${artifact.revision}`)}
        onSelectDirection={(directionId) => { selectDirection(activeBrief.id, directionId, undefined, projectRoot || undefined) }}
      />
    )
  }

  return (
    <div className="h-full min-w-0 overflow-auto bg-background text-on-background">
      <main className="mx-auto w-full max-w-[1240px] px-5 pb-16 pt-8 md:px-8 lg:pt-12">
        <SubDesignStudioNav
          active="studio"
          studioHref={activeBrief ? `/subdesign/${activeBrief.id}` : '/subdesign'}
          systemsHref={`/design-systems?returnTo=${encodeURIComponent(activeBrief ? `/subdesign/${activeBrief.id}` : '/subdesign')}${activeBrief ? `&briefId=${encodeURIComponent(activeBrief.id)}` : ''}`}
          contextLabel={activeBrief ? activeBrief.objective : '從 brief 選擇品牌契約，再生成與驗證產物'}
          onNavigate={navigate}
        />
        {routeBriefId && briefs.length > 0 && !activeBrief ? (
          <section className="mx-auto mb-6 max-w-[820px] rounded-2xl border border-error/25 bg-error/10 px-4 py-3 text-[12px] text-error">
            找不到這個 SubDesign brief：<span className="font-mono">{routeBriefId}</span>。請回到 SubDesign 首頁選擇既有設計。
          </section>
        ) : null}
        {workspace ? (
          <SubDesignWorkspaceHeader
            workspace={workspace}
            designSystem={systems.find((system) => system.id === activeBrief?.designSystemId) || null}
            onOpenDesignSystem={() => navigate(`/design-systems?returnTo=${encodeURIComponent(activeBrief ? `/subdesign/${activeBrief.id}` : '/subdesign')}${activeBrief ? `&briefId=${encodeURIComponent(activeBrief.id)}` : ''}`)}
            onPrimaryAction={workspace.nextGate.action === 'start-build' && !runIsLive ? () => void startBriefRun() : undefined}
            primaryActionLabel={startingRun ? '啟動中…' : '在此頁開始 Build'}
          />
        ) : null}
        {activeBrief && runIsLive && linkedThreadRunId ? (
          <SubDesignRunInspector
            workspace={workspace!}
            runId={linkedThreadRunId}
            executionKind={linkedAgent?.executionKind}
            onOpenTranscript={openTranscript}
          />
        ) : null}
        <section className="mx-auto max-w-[820px] text-center">
          <h1 className="font-[family-name:var(--font-sora)] text-[34px] font-semibold tracking-tight text-on-surface md:text-[42px]">
            {activeBrief ? '建立另一個設計' : '你今天想設計什麼？'}
          </h1>
          <p className="mt-3 text-[14px] text-outline">{activeBrief ? '目前專案狀態保留在上方；你可以從新的 brief 開始另一個設計。' : '從一個 brief 開始，交給 SubAgents 完成設計流程。'}</p>
        </section>

        <section className="mx-auto mt-7 max-w-[820px]">
          <div className="overflow-hidden rounded-[22px] border border-primary/40 bg-surface-container-low shadow-raised">
            <label htmlFor="subdesign-brief" className="sr-only">設計目標</label>
            <textarea
              id="subdesign-brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="例如：設計一個商品詳情頁"
              className="min-h-[172px] w-full resize-y bg-transparent px-6 py-5 text-[17px] leading-relaxed text-on-surface outline-none placeholder:text-outline/70"
            />
            <div className="flex flex-col gap-3 border-t border-white/[0.08] px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="relative sm:w-[160px]">
                <select
                  value={surfaceId}
                  onChange={(event) => setSurfaceId(event.target.value as DesignSurface['id'])}
                  className="h-11 w-full appearance-none rounded-xl border border-white/10 bg-black/10 px-3 pr-8 text-[13px] font-medium text-on-surface outline-none focus:border-primary/45"
                  aria-label="設計範本"
                >
                  {SURFACES.map((surface) => <option key={surface.id} value={surface.id}>{surface.title}</option>)}
                </select>
                <SelectChevron />
              </div>
              <div className="relative sm:w-[145px]">
                <select
                  value={platform}
                  onChange={(event) => setPlatform(event.target.value as SubDesignPlatform)}
                  className="h-11 w-full appearance-none rounded-xl border border-white/10 bg-black/10 px-3 pr-8 text-[13px] font-medium text-on-surface outline-none focus:border-primary/45"
                  aria-label="設計平台"
                >
                  {PLATFORMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
                <SelectChevron />
              </div>
              <div className="relative sm:w-[170px]">
                <select
                  value={designSystemId}
                  onChange={(event) => {
                    const nextId = event.target.value
                    setDesignSystemId(nextId)
                    if (activeBrief) updateBrief(activeBrief.id, { designSystemId: nextId || undefined }, projectRoot || undefined)
                  }}
                  className="h-11 w-full appearance-none rounded-xl border border-white/10 bg-black/10 px-3 pr-8 text-[13px] font-medium text-on-surface outline-none focus:border-primary/45"
                  aria-label="Design system"
                >
                  <option value="">Neutral / project default</option>
                  {systems.map((system) => <option key={system.id} value={system.id}>{system.title}</option>)}
                </select>
                <SelectChevron />
              </div>
              <div className="relative sm:w-[145px]">
                <select
                  value={runner}
                  onChange={(event) => setRunner(event.target.value as ThreadRunner)}
                  className="h-11 w-full appearance-none rounded-xl border border-white/10 bg-black/10 px-3 pr-8 text-[13px] font-medium text-on-surface outline-none focus:border-primary/45"
                  aria-label="Design agent"
                >
                  {availableRunners.map((item) => <option key={item} value={item}>{RUNNER_LABELS[item] || item}</option>)}
                </select>
                <SelectChevron />
              </div>
              <span className="hidden flex-1 sm:block" />
              <button
                type="button"
                onClick={startSubDesign}
                disabled={!brief.trim()}
                className="macos-btn inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[13px] font-semibold text-on-primary shadow-[0_8px_22px_rgba(43,184,217,0.18)] hover:bg-primary-container focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="send" size={17} />建立設計
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-[12px] text-outline">
            <span className="inline-flex items-center gap-1.5"><Icon name="palette" size={15} className="text-primary" /><strong className="font-semibold text-on-surface-variant">{selectedSystem?.title || 'Project default'}</strong><span className="text-outline">將套用到下一次生成</span></span>
            <button type="button" onClick={() => navigate(`/design-systems?returnTo=${encodeURIComponent(activeBrief ? `/subdesign/${activeBrief.id}` : '/subdesign')}${activeBrief ? `&briefId=${encodeURIComponent(activeBrief.id)}` : ''}`)} className="inline-flex items-center gap-1 text-[11px] text-outline hover:text-primary" aria-label="瀏覽與套用 Design system"><Icon name="tune" size={13} />瀏覽與套用</button>
            <span className="h-4 w-px bg-white/10" aria-hidden />
            <span className="inline-flex items-center gap-1.5 truncate"><Icon name="folder" size={15} />{projectRoot ? projectRoot.split(/[\\/]/).filter(Boolean).pop() : '尚未選擇工作目錄'}</span>
            <button
              type="button"
              onClick={() => void refreshSystems(projectRoot || undefined)}
              className="ml-auto inline-flex items-center gap-1 text-[12px] text-outline hover:text-primary"
            >
              <Icon name="refresh" size={14} />{systemsLoading ? '掃描中…' : '更新'}
            </button>
          </div>
        </section>

        {surfaceId === 'design-system' ? (
          <section className="mx-auto mt-8 max-w-[820px]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[13px] font-semibold text-outline">或從 Design System Pack 安裝</h2>
              <span className="text-[11px] text-outline">{designSystemPackRecords.length} 個本機收錄的 pack</span>
            </div>
            {designSystemPackRecords.length ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {designSystemPackRecords.map((record) => {
                  const selected = record.id === designSystemPackId
                  return (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => setDesignSystemPackId(record.id)}
                      className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        selected
                          ? 'border-primary/45 bg-primary/[0.08]'
                          : 'border-white/10 bg-surface-container-low hover:border-primary/30 hover:bg-white/[0.04]'
                      }`}
                    >
                      <span className="block text-[13px] font-medium text-on-surface">{record.title}</span>
                      <span className="mt-0.5 block text-[11px] text-outline">{record.summary}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-dashed border-white/12 bg-white/[0.02] px-4 py-3 text-[11px] text-outline">
                目前本機 Open Design vendor 目錄尚未收錄任何 design-system pack（沒有 DESIGN.md）。可直接在下方建立全新 brief，或先到「管理」建立第一份 Design System。
              </p>
            )}
            {selectedDesignSystemPackRecord ? (
              <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/[0.05] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-on-surface">{installedDesignSystemPack ? '已安裝為專案 Design System' : '安裝這個 pack 到目前專案？'}</p>
                  <p className="mt-1 truncate text-[11px] text-outline">{selectedDesignSystemPackRecord.sourcePath} · digest {selectedDesignSystemPackRecord.digest.slice(0, 12)}… · {selectedDesignSystemPackRecord.licensePaths.length ? '已找到授權檔' : '未找到授權檔'}</p>
                </div>
                <button
                  type="button"
                  disabled={openDesignPackBusyId === `open-design:${selectedDesignSystemPackRecord.id}` || !projectRoot}
                  onClick={async () => {
                    if (installedDesignSystemPack) {
                      await setOpenDesignPackEnabled(selectedDesignSystemPackRecord, !installedDesignSystemPack.enabled)
                      return
                    }
                    const installed = await installOpenDesignPack(selectedDesignSystemPackRecord, projectRoot || undefined)
                    if (installed) void refreshSystems(projectRoot || undefined)
                  }}
                  className="shrink-0 rounded-lg border border-primary/35 px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
                >
                  {openDesignPackBusyId === `open-design:${selectedDesignSystemPackRecord.id}` ? '處理中…' : installedDesignSystemPack?.enabled ? '停用 pack' : installedDesignSystemPack ? '啟用 pack' : '安裝為 Design System'}
                </button>
              </div>
            ) : null}
            {!projectRoot ? <p className="mt-2 text-[11px] text-secondary">安裝需要先選擇工作目錄。</p> : null}
          </section>
        ) : null}

        <section className="mx-auto mt-10 max-w-[1120px]">
          <div className="flex flex-col items-center gap-3">
            <h2 className="text-center text-[13px] font-semibold text-outline">從範本開始</h2>
            <label className="relative w-full max-w-[420px]">
              <span className="sr-only">搜尋 Open Design template</span>
              <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
              <input
                value={templateQuery}
                onChange={(event) => setTemplateQuery(event.target.value)}
                placeholder="搜尋本機 Open Design template…"
                className="h-10 w-full rounded-xl border border-white/10 bg-surface-container-low pl-9 pr-3 text-[12px] text-on-surface outline-none placeholder:text-outline/70 focus:border-primary/40"
              />
            </label>
            <div className="flex w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
              {SUBDESIGN_TEMPLATE_CATEGORIES.map((category) => {
                const selected = category.id === templateCategory
                const count = category.id === 'all' ? allTemplates.length : categoryCounts.get(category.id) || 0
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setTemplateCategory(category.id)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
                      selected
                        ? 'border-primary bg-primary text-on-primary'
                        : 'border-white/10 bg-surface-container-low text-outline hover:border-primary/35 hover:text-on-surface'
                    }`}
                  >
                    {category.label} <span className="opacity-70">{count}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {visibleTemplates.map((template) => {
              const selected = template.id === templateId
              const unavailable = template.availability === 'requires-capability'
              return (
                <button
                  key={template.id}
                  type="button"
                  disabled={unavailable}
                  onClick={() => {
                    if (!template.surface) return
                    setTemplateId(template.id)
                    setSurfaceId(template.surface)
                    setBrief((current) => current || template.suggestedObjective)
                  }}
                  className={`group min-h-[166px] rounded-2xl border text-left transition-all ${
                    selected
                      ? 'border-primary/45 bg-primary/[0.08]'
                      : unavailable
                        ? 'cursor-not-allowed border-white/[0.07] bg-surface-container-low/60 opacity-65'
                        : 'border-white/10 bg-surface-container-low hover:border-primary/30 hover:bg-white/[0.04]'
                  }`}
                >
                  <span className={`grid h-[92px] place-items-center border-b ${selected ? 'border-primary/20 text-primary' : 'border-white/[0.07] text-outline group-hover:text-primary'}`}>
                    <Icon name={template.icon} size={34} />
                  </span>
                  <span className="block px-4 pb-4 pt-3">
                    <span className="flex items-center justify-between gap-2 text-[14px] font-semibold text-on-surface">
                      <span>{template.title}</span>
                      {unavailable ? <span className="text-[10px] font-medium text-outline">尚未啟用</span> : null}
                    </span>
                    <span className="mt-1 block text-[12px] text-outline">{template.summary}</span>
                  </span>
                </button>
              )
            })}
          </div>
          {selectedCatalogRecord ? (
            <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/[0.05] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-on-surface">{installedOpenDesignPack ? '已納入本機 content pack' : '將這個 Open Design 內容納入工作流？'}</p>
                <p className="mt-1 truncate text-[11px] text-outline">{selectedCatalogRecord.sourcePath} · digest {selectedCatalogRecord.digest.slice(0, 12)}… · {selectedCatalogRecord.licensePaths.length ? '已找到授權檔' : '未找到授權檔'}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-outline">{selectedCatalogRecord.kind}</span>
                <button
                  type="button"
                  disabled={openDesignPackBusyId === `open-design:${selectedCatalogRecord.id}`}
                  onClick={() => {
                    if (installedOpenDesignPack) void setOpenDesignPackEnabled(selectedCatalogRecord, !installedOpenDesignPack.enabled)
                    else void installOpenDesignPack(selectedCatalogRecord, projectRoot || undefined)
                  }}
                  className="rounded-lg border border-primary/35 px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
                >
                  {openDesignPackBusyId === `open-design:${selectedCatalogRecord.id}` ? '處理中…' : installedOpenDesignPack?.enabled ? '停用 pack' : installedOpenDesignPack ? '啟用 pack' : '安裝 pack'}
                </button>
              </div>
            </div>
          ) : null}
          {openDesignPackError ? <p className="mt-2 text-[11px] text-error">Content pack：{openDesignPackError}</p> : null}
          <p className="mt-4 text-center text-[11px] text-outline">
            {catalogLoading ? '正在讀取本機 Open Design inventory…' : catalogWarning ? `Inventory fallback：${catalogWarning}` : `已索引 ${allTemplates.length} 個本機 vendor template。`}
            {' '}圖像、影片、HyperFrames 與音訊需先啟用對應 capability。參考來源：{' '}
            <a href={OPEN_DESIGN_TEMPLATE_SOURCE} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open Design templates</a>
          </p>
        </section>

        {briefs.length ? (
          <section className="mx-auto mt-11 max-w-[820px]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[13px] font-semibold text-outline">繼續最近設計</h2>
              {activeBrief ? <span className="text-[12px] text-primary">{stageLabel(activeBrief.stage)}</span> : null}
            </div>
            <div className="mt-3 divide-y divide-white/[0.08] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              {briefs.slice(0, 4).map((item) => {
                const surface = SURFACES.find((candidate) => candidate.id === item.surface) || SURFACES[0]
                const itemArtifacts = artifacts.filter((artifact) => artifact.briefId === item.id)
                const itemLatestArtifact = [...itemArtifacts].sort((left, right) => {
                  if (right.revision !== left.revision) return right.revision - left.revision
                  return right.updatedAt.localeCompare(left.updatedAt)
                })[0]
                const itemCritique = itemLatestArtifact
                  ? critiques
                      .filter((critique) => critique.artifactId === itemLatestArtifact.id && critique.revision === itemLatestArtifact.revision)
                      .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''))[0]
                  : null
                const itemThread = threads.find((thread) => thread.id === item.threadId)
                const itemRunStatus = runningThreadIds.includes(item.threadId) ? 'running' : itemThread?.lastStatus
                const itemWorkspace = deriveSubDesignWorkspace({
                  brief: item,
                  artifacts: itemArtifacts,
                  selectedArtifact: itemLatestArtifact,
                  critique: itemCritique,
                  runStatus: itemRunStatus,
                })
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => resumeBrief(item.id)}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.04]"
                  >
                    <span className="grid h-8 w-5 place-items-center text-primary"><Icon name={surface.icon} size={16} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-on-surface">{item.objective}</span><span className="mt-1 block truncate text-[11px] text-outline">{surface.title} · {stageLabel(itemWorkspace.currentStage)} · {itemWorkspace.nextGate.title}</span>{itemWorkspace.latestArtifact ? <span className="mt-1 block truncate text-[10px] text-outline/75">artifact · {itemWorkspace.latestArtifact.title} · revision {itemWorkspace.latestArtifact.revision}</span> : null}</span>
                    <span className="text-[11px] text-outline">{formatRelativeTime(item.updatedAt)}</span>
                    <Icon name="chevron_right" size={16} className="text-outline" />
                  </button>
                )
              })}
            </div>
          </section>
        ) : null}

        <section className="mx-auto mt-8 max-w-[820px]">
          <ReferenceImportPanel brief={activeBrief} />
        </section>

        {selectedArtifact ? (
          <section className="mx-auto mt-11 max-w-[1120px]">
            <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
              <ArtifactRail
                artifacts={visibleArtifacts}
                selectedKey={`${selectedArtifact.id}:${selectedArtifact.revision}`}
                onSelect={(artifact) => setSelectedArtifactKey(`${artifact.id}:${artifact.revision}`)}
              />
              <ArtifactPreview artifact={selectedArtifact} />
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-3">
              <div className="xl:col-span-3">
                <CritiqueTheater brief={activeBrief} artifact={selectedArtifact} critique={latestCritique} />
              </div>
              <ArtifactTweakPanel artifact={selectedArtifact} />
              <CritiquePanel critique={latestCritique} />
              <ArtifactDeliveryPanel
                artifact={selectedArtifact}
                critique={latestCritique}
                critiquePassed={Boolean(latestCritique && critiqueAllowsDeliver(latestCritique))}
              />
            </div>
          </section>
        ) : null}
      </main>
    </div>
  )
}
