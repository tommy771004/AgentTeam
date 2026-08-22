import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { v4 as uuid } from 'uuid'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { critiqueAllowsDeliver } from '../agent/subdesign/critique'
import { buildSubDesignPrompt } from '../agent/subdesign/prompt'
import { prepareSubDesignRun } from '../agent/subdesign/pluginExecutionPreparation'
import { hydrateProviderFlags, isProviderEnabled } from '../agent/subdesign/providers/providerFlags'
import {
  OPEN_DESIGN_EXPLORE_SOURCE,
  OPEN_DESIGN_TEMPLATE_SOURCE,
  SUBDESIGN_TEMPLATE_CATEGORIES,
  getOpenDesignExploreTemplates,
  openDesignRecordToTemplate,
  setSubDesignTemplateCache,
  type SubDesignTemplateCategory,
  type SubDesignTemplateCollection,
} from '../agent/subdesign/templateCatalog'
import { loadOpenDesignCatalog, type OpenDesignCatalogRecord } from '../agent/openDesign/catalog'
import type { DesignSystemSummary, SubDesignBrief, SubDesignPlatform, SubDesignSurface } from '../agent/subdesign/types'
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
import { SubDesignUnifiedFixture } from '../components/subdesign/SubDesignUnified.fixture'
import { SubDesignWorkspaceHeader } from '../components/subdesign/SubDesignWorkspaceHeader'
import { SubDesignRunInspector } from '../components/subdesign/SubDesignRunInspector'
import { SubDesignProjectStudio } from '../components/subdesign/SubDesignProjectStudio'
import { SubDesignStudioNav } from '../components/subdesign/SubDesignStudioNav'
import { createSubDesignWorkspace, deriveSubDesignWorkspace } from '../agent/subdesign/workspace'
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
import {
  DEFAULT_STORYBOOK_PROVIDER_SETTINGS,
  DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS,
  loadAllProviderRuns,
  loadExperimentalSurfaceSettings,
  loadStorybookProviderState,
  saveExperimentalSurfaceSettings,
  type ExperimentalSurfaceSettings,
  saveStorybookProviderSettings,
  type StorybookProviderSettings,
} from '../agent/subdesign/providers/providerSettings.ts'
import type { SubDesignPluginExecutionProjection } from '../agent/subdesign/pluginExecution.ts'
import {
  createStreamingEnvelope,
  mergeStreamingUpdate,
  pluginRunArtifactId,
  type StreamingEnvelope,
  type StreamingUpdate,
} from '../agent/subdesign/streamingEnvelope.ts'
import { collectSubDesignModels, readHostModelSettings } from '../agent/subdesign/modelDiscovery.ts'

type DesignSurface = {
  id: SubDesignSurface
  title: string
  description: string
  icon: string
}

const SURFACES: readonly DesignSurface[] = [
  { id: 'prototype', title: '產品原型', description: '網頁、桌面或行動介面', icon: 'web' },
  { id: 'dashboard', title: '即時看板', description: '資料與決策工作台', icon: 'dashboard' },
  { id: 'design-system', title: 'Design System', description: '品牌規則與元件語言', icon: 'palette' },
  { id: 'deck', title: '簡報與報告', description: '可交付的敘事內容', icon: 'slideshow' },
  { id: 'video', title: '動態影像', description: '影片幀與動效敘事', icon: 'movie' },
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
  const stopExecution = useAgentStore((state) => state.stopExecution)
  const projectRoot = useProjectStore((state) => state.root)
  const cliProviders = useSettingsStore((state) => state.settings.cliProviders)
  const briefs = useSubDesignStore((state) => state.briefs)
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
  const [templateCollection, setTemplateCollection] = useState<SubDesignTemplateCollection>('explore')
  const [templateId, setTemplateId] = useState<string | undefined>()
  const [templateQuery, setTemplateQuery] = useState('')
  const [designSystemPackId, setDesignSystemPackId] = useState<string | undefined>()
  const [catalogRecords, setCatalogRecords] = useState<OpenDesignCatalogRecord[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogWarning, setCatalogWarning] = useState('')
  const [selectedArtifactKey, setSelectedArtifactKey] = useState<string | null>(null)
  const [storybookSettings, setStorybookSettings] = useState<StorybookProviderSettings>(DEFAULT_STORYBOOK_PROVIDER_SETTINGS)
  const [storybookRuns, setStorybookRuns] = useState<SubDesignPluginExecutionProjection[]>([])
  const [providerRuns, setProviderRuns] = useState<SubDesignPluginExecutionProjection[]>([])
  const [experimentalSettings, setExperimentalSettings] = useState<ExperimentalSurfaceSettings>(
    DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS,
  )
  // Live streaming envelopes keyed by deterministic artifactId (plugin_<runId>_<stageId>)
  const [liveStreams, setLiveStreams] = useState<Record<string, StreamingEnvelope>>({})
  // Model discovery — aggregated from CLI providers + host settings
  const [modelDiscovery, setModelDiscovery] = useState<ReturnType<typeof collectSubDesignModels> | null>(null)

  const refreshStorybookState = useCallback(async (requestedProjectRoot?: string) => {
    const currentProjectRoot = requestedProjectRoot ?? useProjectStore.getState().root
    const [state, runs, experimental] = await Promise.all([
      loadStorybookProviderState(currentProjectRoot || undefined),
      loadAllProviderRuns(currentProjectRoot || undefined),
      loadExperimentalSurfaceSettings(currentProjectRoot || undefined),
    ])
    setStorybookSettings(state.settings)
    setStorybookRuns(state.runs)
    setProviderRuns(runs)
    setExperimentalSettings(experimental)
    // Apply the project's choice to the synchronous render-path gate.
    hydrateProviderFlags(experimental)
  }, [])

  const workspaceDependencies = useMemo(() => ({
    findBrief: (id: string) => useSubDesignStore.getState().findById(id),
    getThread: (id: string) => {
      const thread = useThreadStore.getState().threads.find((item) => item.id === id)
      return thread ? { runner: thread.runner, loopType: thread.loopType } : null
    },
    createThread: (opts: Parameters<typeof createThread>[0]) => createThread(opts),
    bindBriefToThread: (threadId: string, briefId: string) => setSubDesignBriefId(threadId, briefId),
    createBrief: (input: Parameters<typeof createBrief>[0]) => createBrief(input),
    selectBrief: (id: string | null) => selectBrief(id),
    getDesignSystem: (id?: string) => useSubDesignStore.getState().systems.find((system) => system.id === id) || null,
    prepareRun: (input: Parameters<typeof prepareSubDesignRun>[0]) => prepareSubDesignRun(input),
    runTask,
    buildPrompt: (brief: SubDesignBrief, system: DesignSystemSummary | null) =>
      // Keep the prompt builder behind the workspace boundary.
      buildSubDesignPrompt(brief, system || undefined),
    navigate,
    hydrateProject: async (root: string) => {
      hydrateThreads()
      setProjectRoot(root)
      setArtifactProjectRoot(root)
      setCritiqueProjectRoot(root)
      setExportProjectRoot(root)
      setOpenDesignPackProjectRoot(root)
      await hydrateSubDesignStores(root || undefined)
      await Promise.all([refreshStorybookState(root), refreshSystems(root || undefined)])
    },
    refreshProviderState: () => refreshStorybookState(),
    createRunId: () => `run_${uuid().slice(0, 12)}`,
    getProjectRoot: () => useProjectStore.getState().root,
    getCapabilities: () => ({
      electron: typeof window !== 'undefined' && Boolean(window.subagents?.piHost),
      hostEvents: typeof window !== 'undefined' && Boolean(window.subagents?.piHost?.onEvent),
    }),
  }), [
    createBrief,
    createThread,
    hydrateThreads,
    navigate,
    refreshStorybookState,
    refreshSystems,
    selectBrief,
    setArtifactProjectRoot,
    setCritiqueProjectRoot,
    setExportProjectRoot,
    setOpenDesignPackProjectRoot,
    setProjectRoot,
    setSubDesignBriefId,
  ])
  const workspaceController = useMemo(
    () => createSubDesignWorkspace(workspaceDependencies),
    [workspaceDependencies],
  )
  const workspaceProjection = useSyncExternalStore(
    workspaceController.subscribe,
    workspaceController.getProjection,
    workspaceController.getProjection,
  )
  const startingRun = workspaceProjection.run.phase === 'starting'
  const pluginDeclaredInputs = workspaceProjection.pluginDeclaredInputs
  const selectedModelId = workspaceProjection.selectedModelId

  // Live pipeline streaming — host/pipeline-stream → liveStreams (typed events)
  useEffect(() => {
    const api = window.subagents?.piHost?.onEvent
    if (!api) return
    const unsub = api((event) => {
      if (event.event !== 'host/pipeline-stream') return
      if (!isProviderEnabled('streaming')) return
      const payload = event.payload as { runId: string; sessionId: string; stageId: string; providerId: string; update: StreamingUpdate }
      if (!payload?.update || !payload.runId || !payload.stageId) return
      const artifactId = pluginRunArtifactId(payload.runId, payload.stageId)
      setLiveStreams((prev) => {
        const existing = prev[artifactId]
        const base = existing || createStreamingEnvelope({ artifactId, artifactKind: 'html', runId: payload.runId, stageId: payload.stageId })
        const merged = mergeStreamingUpdate(base, payload.update)
        return merged.envelope === base ? prev : { ...prev, [artifactId]: merged.envelope }
      })
    })
    return () => { try { (unsub as unknown as () => void)?.() } catch { /* ignore */ } }
  }, [])

  // Model discovery — aggregate CLI providers + discovered + host current
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const host = await readHostModelSettings()
      if (cancelled) return
      const settings = useSettingsStore.getState().settings
      const discovery = collectSubDesignModels({
        cliProviders: settings.cliProviders,
        discoveredModels: settings.discoveredModels,
        host,
      })
      if (cancelled) return
      setModelDiscovery(discovery)
      if (!workspaceController.getProjection().selectedModelId) workspaceController.setModel(discovery.current.model)
    }
    void load()
    // Re-collect when settings change (cliProviders/discoveredModels)
    const unsub = useSettingsStore.subscribe(() => { void load() })
    return () => { cancelled = true; (unsub as unknown as () => void)?.() }
  }, [workspaceController])

  const activeSurface = useMemo(
    () => SURFACES.find((surface) => surface.id === surfaceId) || SURFACES[0],
    [surfaceId],
  )
  const routeBrief = workspaceProjection.activeBrief
  const activeBrief = routeBriefId ? routeBrief : null
  const activeBriefId = activeBrief?.id
  const activeBriefSurface = activeBrief?.surface
  const activeBriefDesignSystemId = activeBrief?.designSystemId
  const activeBriefTemplateId = activeBrief?.templateId
  const selectedSystem = systems.find((system) => system.id === designSystemId)
  const allTemplates = useMemo(
    () =>
      catalogRecords
        .filter((record) => record.kind === 'template' || record.kind === 'prompt')
        .map(openDesignRecordToTemplate),
    [catalogRecords],
  )
  useEffect(() => {
    setSubDesignTemplateCache(allTemplates)
  }, [allTemplates])
  const exploreTemplates = useMemo(
    () => getOpenDesignExploreTemplates(allTemplates),
    [allTemplates],
  )
  const collectionTemplates = templateCollection === 'explore' ? exploreTemplates : allTemplates
  // Catalog loaded and has templates, but not one carries an exploreRank —
  // that is a stale/ungenerated index, not an empty search result.
  const exploreIndexMissing = templateCollection === 'explore'
    && allTemplates.length > 0
    && exploreTemplates.length === 0
  const visibleTemplates = useMemo(() => collectionTemplates.filter((template) =>
      (templateCategory === 'all' || template.category === templateCategory) &&
      `${template.title} ${template.summary}`.toLowerCase().includes(templateQuery.trim().toLowerCase()),
    ),
    [collectionTemplates, templateCategory, templateQuery],
  )
  const categoryCounts = useMemo(() => {
    const counts = new Map<SubDesignTemplateCategory, number>()
    for (const template of collectionTemplates) counts.set(template.category, (counts.get(template.category) || 0) + 1)
    return counts
  }, [collectionTemplates])
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
    workspaceController.sync({ routeBriefId, projectRoot })
  }, [briefs, projectRoot, routeBriefId, workspaceController])

  useEffect(() => {
    void workspaceController.hydrate(projectRoot || '')
  }, [projectRoot, workspaceController])

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
    if (!routeBriefId) return
    // SubDesign owns the live thread presentation on this route. The global
    // transcript remains available through the explicit「執行摘要」action.
    setShowRunPanel(false)
  }, [linkedThreadRunId, routeBriefId, setShowRunPanel])

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

  const startSubDesign = async () => {
    const preferredDesignSystemId = designSystemId || latestPassedPreference?.designSystemId
    const preferredTemplateId = templateId || latestPassedPreference?.templateId
    setShowRunPanel(false)
    await workspaceController.create({
      objective: brief,
      surface: activeSurface.id,
      platform,
      fidelity: 'high-fidelity',
      designSystemId: preferredDesignSystemId,
      templateId: preferredTemplateId,
      skillIds: selectedCatalogRecord?.entryPaths.some((entry) => /SKILL\.md$/i.test(entry))
        ? [selectedCatalogRecord.id]
        : latestPassedPreference?.skillIds,
      provenance: selectedCatalogRecord ? [selectedCatalogRecord] : latestPassedPreference?.provenance,
      runner,
    })
  }

  const resumeBrief = (id: string) => {
    const result = workspaceController.resume(id)
    if (!result.ok) return
    setSurfaceId(result.brief.surface)
    setDesignSystemId(result.brief.designSystemId || '')
    setTemplateId(result.brief.templateId)
  }

  const startBriefRun = async () => {
    if (!activeBrief || runIsLive) return
    setShowRunPanel(false)
    await workspaceController.start()
  }

  const submitStudioFollowUp = async (value: string) => {
    if (!activeBrief || !value.trim()) return
    setShowRunPanel(false)
    await workspaceController.followUp(value)
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
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('prototype') === 'subdesign-unified') {
    return <SubDesignUnifiedFixture />
  }

  if (routeBriefId && activeBrief && workspace) {
    const activeSystem = systems.find((system) => system.id === activeBrief.designSystemId) || null
    const modelBar = modelDiscovery && modelDiscovery.models.length > 0 ? (
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-surface-container-low/20 px-3 text-[10px]">
        <Icon name="neurology" size={13} className="text-primary" />
        <span className="font-medium text-outline">模型</span>
        <label className="relative ml-1">
          <span className="sr-only">選擇模型</span>
          <select
            value={selectedModelId}
            onChange={(e) => workspaceController.setModel(e.target.value)}
            disabled={runIsLive || startingRun}
            className="h-7 max-w-[260px] appearance-none rounded-lg bg-white/[0.06] pl-2.5 pr-7 text-[11px] text-on-surface outline-none hover:bg-white/[0.08] disabled:opacity-40"
          >
            {modelDiscovery.models.map((m) => (
              <option key={`${m.providerId}:${m.id}`} value={m.id}>
                {m.providerName} · {m.label}
              </option>
            ))}
          </select>
          <Icon name="expand_more" size={13} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-outline" />
        </label>
        <span className="hidden text-[9px] text-outline sm:inline">
          共 {modelDiscovery.models.length} 個可用模型 · {modelDiscovery.sourceCounts.cli} CLI 已授權
        </span>
        <span className="ml-auto hidden items-center gap-1 text-[9px] text-outline sm:inline-flex">
          <span className={`h-1.5 w-1.5 rounded-full ${runIsLive ? 'bg-primary' : 'bg-outline/40'}`} />
          {runIsLive ? '執行中使用此模型' : '下一輪生效'}
        </span>
      </div>
    ) : modelDiscovery ? (
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-amber-500/10 px-3 text-[10px] text-amber-700">
        <Icon name="info" size={13} />
        <span>尚未發現可用模型；在 設定 中授權 CLI 或在 /models 完成探測後，此處會顯示可選清單。</span>
        <span className="ml-auto text-[9px] opacity-70">當前 Host：{modelDiscovery.current.model || '未設定'}</span>
      </div>
    ) : null
    return (
      <>
        {modelBar}
        <SubDesignProjectStudio
        brief={activeBrief}
        workspace={workspace}
        designSystem={activeSystem}
        thread={linkedThread || null}
        artifacts={visibleArtifacts}
        selectedArtifact={selectedArtifact}
        critique={latestCritique}
        critiquePassed={Boolean(latestCritique && critiqueAllowsDeliver(latestCritique))}
        runIsLive={runIsLive}
        runId={linkedThreadRunId}
        startingRun={startingRun}
        onBack={() => navigate('/subdesign')}
        onOpenDesignSystems={() => navigate(`/design-systems?returnTo=${encodeURIComponent(`/subdesign/${activeBrief.id}`)}&briefId=${encodeURIComponent(activeBrief.id)}`)}
        onStartRun={() => void startBriefRun()}
        onStopRun={() => { if (linkedThreadRunId) stopExecution(linkedThreadRunId) }}
        onSubmitFollowUp={submitStudioFollowUp}
        onOpenTranscript={openTranscript}
        onSelectArtifact={(artifact) => setSelectedArtifactKey(`${artifact.id}:${artifact.revision}`)}
        onSelectDirection={(directionId) => { selectDirection(activeBrief.id, directionId, undefined, projectRoot || undefined) }}
        storybookSettings={storybookSettings}
        latestStorybookRun={storybookRuns.find((item) => item.briefId === activeBrief.id) || storybookRuns[0] || null}
        experimentalSettings={experimentalSettings}
        onSaveExperimentalSettings={async (value) => {
          const result = await saveExperimentalSurfaceSettings(value, projectRoot || undefined)
          if (result.ok) {
            setExperimentalSettings(result.settings)
            hydrateProviderFlags(result.settings)
          }
          return result
        }}
        pluginDeclaredInputs={pluginDeclaredInputs}
        onSubmitPluginInputs={(values) => workspaceController.setPluginInputs(values)}
        artifactStream={
          selectedArtifact
            ? liveStreams[selectedArtifact.id]
              || providerRuns.find((run) => run.artifact?.id === selectedArtifact.id)?.stream
              || null
            : null
        }
        onSaveStorybookSettings={async (value) => {
          const result = await saveStorybookProviderSettings(value, projectRoot || undefined)
          if (result.ok) {
            setStorybookSettings(result.settings)
            return { ok: true }
          }
          return { ok: false, reason: result.reason }
        }}
      />
      </>
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
                className="macos-btn inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-container focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-40"
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
          <div className="flex flex-col gap-5 border-b border-white/[0.08] pb-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-[22px] font-semibold tracking-tight text-on-surface">探索全部資源</h2>
                <p className="mt-1 max-w-[620px] text-[12px] leading-relaxed text-outline">
                  先瀏覽 OpenDesign 官網精選的 24 個範本，也可切換到完整本機 catalog。選定後會保留來源、digest 與授權證據。
                </p>
              </div>
              <div className="flex items-center gap-5" role="group" aria-label="範本資源集合">
                {([
                  { id: 'explore', label: `官方精選 ${exploreTemplates.length}` },
                  { id: 'all', label: `本機全部 ${allTemplates.length}` },
                ] as const).map((collection) => {
                  const selected = collection.id === templateCollection
                  return (
                    <button
                      key={collection.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setTemplateCollection(collection.id)
                        setTemplateCategory('all')
                      }}
                      className={`border-b-2 py-2 text-[12px] font-medium transition-colors ${
                        selected
                          ? 'border-primary text-on-surface'
                          : 'border-transparent text-outline hover:text-on-surface'
                      }`}
                    >
                      {collection.label}
                    </button>
                  )
                })}
                <a
                  href={templateCollection === 'explore' ? OPEN_DESIGN_EXPLORE_SOURCE : OPEN_DESIGN_TEMPLATE_SOURCE}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-outline transition-colors hover:text-primary"
                >
                  查看來源 <Icon name="open_in_new" size={13} />
                </a>
              </div>
            </div>
            <label className="relative w-full max-w-[460px]">
              <span className="sr-only">搜尋 Open Design template</span>
              <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
              <input
                value={templateQuery}
                onChange={(event) => setTemplateQuery(event.target.value)}
                placeholder={templateCollection === 'explore' ? '搜尋 24 個官方精選範本…' : '搜尋完整本機 OpenDesign catalog…'}
                className="h-10 w-full rounded-xl border border-white/10 bg-surface-container-low pl-9 pr-3 text-[12px] text-on-surface outline-none placeholder:text-outline/70 focus:border-primary/40"
              />
            </label>
            <div className="flex w-full gap-5 overflow-x-auto [scrollbar-width:none]" aria-label="範本類型">
              {SUBDESIGN_TEMPLATE_CATEGORIES.map((category) => {
                const selected = category.id === templateCategory
                const count = category.id === 'all' ? collectionTemplates.length : categoryCounts.get(category.id) || 0
                return (
                  <button
                    key={category.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setTemplateCategory(category.id)}
                    className={`shrink-0 border-b-2 py-2 text-[12px] transition-colors ${
                      selected
                        ? 'border-primary text-on-surface'
                        : 'border-transparent text-outline hover:text-on-surface'
                    }`}
                  >
                    {category.label} <span className="ml-1 text-[10px] opacity-65">{count}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleTemplates.map((template, index) => {
              const selected = template.id === templateId
              const unavailable = template.availability === 'requires-capability'
              const categoryLabel = SUBDESIGN_TEMPLATE_CATEGORIES.find((category) => category.id === template.category)?.label || template.category
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
                  className={`group flex min-h-[176px] flex-col overflow-hidden rounded-2xl border text-left transition-colors ${
                    selected
                      ? 'border-primary/45 bg-primary/[0.08]'
                      : unavailable
                        ? 'cursor-not-allowed border-white/[0.07] bg-surface-container-low/60 opacity-65'
                        : 'border-white/10 bg-surface-container-low hover:border-primary/30 hover:bg-white/[0.04]'
                  }`}
                >
                  {template.previewImage ? (
                    <img
                      src={template.previewImage}
                      alt={`${template.title} 預覽`}
                      className="h-28 w-full object-cover border-b border-white/10"
                      loading="lazy"
                      onError={(e) => {
                        ;(e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  ) : null}
                  <div className="flex flex-1 flex-col p-4">
                    <span className="flex items-center justify-between text-[11px] text-outline">
                      <span className="tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                      <Icon name={template.icon} size={19} className={selected ? 'text-primary' : 'text-outline group-hover:text-on-surface'} />
                    </span>
                    <span className="mt-3 block text-[15px] font-semibold leading-snug text-on-surface">{template.title}</span>
                    <span className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-outline">{template.summary}</span>
                    {template.contractNotice ? (
                      <span className="mt-3 line-clamp-2 text-[10px] leading-relaxed text-error">{template.contractNotice}</span>
                    ) : null}
                    <span className="mt-auto flex items-end justify-between gap-3 pt-4 text-[10px] text-outline">
                      <span>{categoryLabel}</span>
                      <span>
                        {template.contractNotice
                          ? '契約不相容'
                          : unavailable
                            ? '需要額外 capability'
                            : selected
                              ? '已選取'
                              : '可直接選用'}
                      </span>
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
          {!catalogLoading && visibleTemplates.length === 0 ? (
            exploreIndexMissing ? (
              /*
               * The collection's membership and order live on the inventory's
               * `exploreRank`, which only exists once the index has been
               * generated. Without this the picker just shows an empty grid and
               * the cause is invisible — say what is wrong and how to fix it.
               */
              <p className="mt-5 rounded-xl border border-secondary/25 bg-secondary/[0.08] px-4 py-5 text-center text-[12px] leading-relaxed text-secondary" role="status">
                本機索引沒有官方精選標記（exploreRank），所以這個集合是空的。
                <br />
                請執行 <code className="font-mono">npm run open-design:index</code> 重新產生
                <code className="font-mono"> public/open-design/OPEN_DESIGN_INVENTORY.json</code>，或先切換到「本機全部」。
              </p>
            ) : (
              <p className="mt-5 rounded-xl bg-surface-container-low px-4 py-5 text-center text-[12px] text-outline" role="status">
                找不到符合目前類型與關鍵字的範本。
              </p>
            )
          ) : null}
          {selectedCatalogRecord ? (
            <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/[0.05] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-on-surface">{installedOpenDesignPack ? '已納入本機 content pack' : '將這個 Open Design 內容納入工作流？'}</p>
                <p className="mt-1 truncate text-[11px] text-outline">{selectedCatalogRecord.sourcePath} · digest {selectedCatalogRecord.digest.slice(0, 12)}… · {selectedCatalogRecord.licensePaths.length ? '已找到授權檔' : '未找到授權檔'}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[10px] text-outline">內容類型：{selectedCatalogRecord.kind}</span>
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
            {' '}不具相容 surface 或 runtime 的項目會標示所需 capability。參考來源：{' '}
            <a href={OPEN_DESIGN_TEMPLATE_SOURCE} target="_blank" rel="noreferrer" className="text-primary transition-colors hover:text-on-surface">Open Design templates</a>
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
