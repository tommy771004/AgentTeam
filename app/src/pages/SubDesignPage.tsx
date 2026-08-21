import { useCallback, useEffect, useMemo, useState } from 'react'
import { v4 as uuid } from 'uuid'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { critiqueAllowsDeliver } from '../agent/subdesign/critique'
import { buildSubDesignPrompt } from '../agent/subdesign/prompt'
import { prepareSubDesignRun } from '../agent/subdesign/pluginExecutionPreparation'
import type { PluginInputValues } from '../agent/subdesign/pluginInputs'
import { hydrateProviderFlags } from '../agent/subdesign/providers/providerFlags'
import type { PluginInput } from '../agent/openDesign/pluginContract'
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
import type { SubDesignPlatform, SubDesignSurface } from '../agent/subdesign/types'
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
import { SubDesignConversationLanding } from '../components/subdesign/SubDesignConversationLanding'
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
  const [templateCollection, setTemplateCollection] = useState<SubDesignTemplateCollection>('explore')
  const [templateId, setTemplateId] = useState<string | undefined>()
  const [templateQuery, setTemplateQuery] = useState('')
  const [designSystemPackId, setDesignSystemPackId] = useState<string | undefined>()
  const [catalogRecords, setCatalogRecords] = useState<OpenDesignCatalogRecord[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogWarning, setCatalogWarning] = useState('')
  const [selectedArtifactKey, setSelectedArtifactKey] = useState<string | null>(null)
  const [startingRun, setStartingRun] = useState(false)
  const [storybookSettings, setStorybookSettings] = useState<StorybookProviderSettings>(DEFAULT_STORYBOOK_PROVIDER_SETTINGS)
  const [storybookRuns, setStorybookRuns] = useState<SubDesignPluginExecutionProjection[]>([])
  const [providerRuns, setProviderRuns] = useState<SubDesignPluginExecutionProjection[]>([])
  const [experimentalSettings, setExperimentalSettings] = useState<ExperimentalSurfaceSettings>(
    DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS,
  )
  // Values collected by the plugin input form, and whatever the contract still
  // requires. A blocked run surfaces the form rather than starting without them.
  const [pluginInputs, setPluginInputs] = useState<PluginInputValues>({})
  const [pluginDeclaredInputs, setPluginDeclaredInputs] = useState<PluginInput[]>([])

  const refreshStorybookState = useCallback(async () => {
    const [state, runs, experimental] = await Promise.all([
      loadStorybookProviderState(projectRoot || undefined),
      loadAllProviderRuns(projectRoot || undefined),
      loadExperimentalSurfaceSettings(projectRoot || undefined),
    ])
    setStorybookSettings(state.settings)
    setStorybookRuns(state.runs)
    setProviderRuns(runs)
    setExperimentalSettings(experimental)
    // Apply the project's choice to the synchronous render-path gate.
    hydrateProviderFlags(experimental)
  }, [projectRoot])

  // Plugin inputs belong to one brief's plugin. Switching briefs must not carry
  // the previous plugin's answers into a different contract.
  useEffect(() => {
    setPluginInputs({})
    setPluginDeclaredInputs([])
  }, [routeBriefId])

  /**
   * Wraps the shared preparation so a block on unfilled inputs surfaces the
   * form. Keeps the recording in one place instead of at each run start.
   */
  const prepareSubDesignRunTracked = useCallback(
    async (input: Parameters<typeof prepareSubDesignRun>[0]) => {
      const prepared = await prepareSubDesignRun(input)
      setPluginDeclaredInputs(prepared.declaredInputs ?? [])
      return prepared
    },
    [],
  )

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
  const exploreTemplates = useMemo(
    () => getOpenDesignExploreTemplates(allTemplates),
    [allTemplates],
  )
  const collectionTemplates = templateCollection === 'explore' ? exploreTemplates : allTemplates
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
    void refreshStorybookState()
    void refreshSystems(projectRoot || undefined)
  }, [
    projectRoot,
    refreshStorybookState,
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
    if (!brief.trim() || startingRun) return
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
    setStartingRun(true)
    setShowRunPanel(false)
    try {
      const runId = `run_${uuid().slice(0, 12)}`
      const pluginExecution = await prepareSubDesignRunTracked({
        pluginInputs,
        brief: created,
        runId,
        projectRoot: projectRoot || undefined,
      })
      await runTask({
        runId,
        objective: buildSubDesignPrompt(
          created,
          systems.find((system) => system.id === preferredDesignSystemId),
        ),
        sourceKind: 'composer',
        reuseThreadId: threadId,
        runner,
        overrides: pluginExecution.overrides,
      })
    } finally {
      setStartingRun(false)
      void refreshStorybookState()
    }
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
      const runId = `run_${uuid().slice(0, 12)}`
      const pluginExecution = await prepareSubDesignRunTracked({
        pluginInputs,
        brief: activeBrief,
        runId,
        projectRoot: projectRoot || undefined,
      })
      await runTask({
        runId,
        objective: buildSubDesignPrompt(activeBrief, selectedSystem),
        sourceKind: 'composer',
        reuseThreadId: activeBrief.threadId,
        runner: linkedThread?.runner || 'builtin',
        loopType: linkedThread?.loopType || undefined,
        overrides: pluginExecution.overrides,
      })
    } finally {
      setStartingRun(false)
      void refreshStorybookState()
    }
  }

  const submitStudioFollowUp = async (value: string) => {
    if (!activeBrief || startingRun || !value.trim()) return
    setStartingRun(true)
    setShowRunPanel(false)
    try {
      const runId = `run_${uuid().slice(0, 12)}`
      const pluginExecution = await prepareSubDesignRunTracked({
        pluginInputs,
        brief: activeBrief,
        runId,
        projectRoot: projectRoot || undefined,
      })
      await runTask({
        runId,
        objective: value.trim(),
        sourceKind: 'composer',
        reuseThreadId: activeBrief.threadId,
        runner: linkedThread?.runner || 'builtin',
        loopType: linkedThread?.loopType || undefined,
        overrides: pluginExecution.overrides,
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
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('prototype') === 'subdesign-unified') {
    return <SubDesignUnifiedFixture />
  }

  if (routeBriefId && activeBrief && workspace) {
    const activeSystem = systems.find((system) => system.id === activeBrief.designSystemId) || null
    return (
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
        onSubmitPluginInputs={(values) => {
          setPluginInputs(values)
          setPluginDeclaredInputs([])
        }}
        artifactStream={
          selectedArtifact
            ? providerRuns.find((run) => run.artifact?.id === selectedArtifact.id)?.stream ?? null
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
    )
  }

  const isLanding = !activeBrief
  return (
    <div className={`h-full min-w-0 overflow-auto ${isLanding ? 'bg-[#fdfcfa] text-[#111111]' : 'bg-background text-on-background'}`}>
      <main className={`mx-auto w-full ${isLanding ? 'max-w-[980px] px-4 pb-12 pt-6 md:px-6' : 'max-w-[1240px] px-5 pb-16 pt-8 md:px-8 lg:pt-12'}`}>
        {!isLanding && (
          <SubDesignStudioNav
            active="studio"
            studioHref={activeBrief ? `/subdesign/${activeBrief.id}` : '/subdesign'}
            systemsHref={`/design-systems?returnTo=${encodeURIComponent(activeBrief ? `/subdesign/${activeBrief.id}` : '/subdesign')}${activeBrief ? `&briefId=${encodeURIComponent(activeBrief.id)}` : ''}`}
            contextLabel={activeBrief ? activeBrief.objective : '從 brief 選擇品牌契約，再生成與驗證產物'}
            onNavigate={navigate}
          />
        )}
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
        {!activeBrief ? (
          <SubDesignConversationLanding
            brief={brief}
            onBriefChange={setBrief}
            template={selectedCatalogRecord ? allTemplates.find((t) => t.id === selectedCatalogRecord.id) || null : null}
            onClearTemplate={() => setTemplateId(undefined)}
            onPickTemplate={(t) => {
              setTemplateId(t.id)
              if (t.surface) setSurfaceId(t.surface)
              setBrief((v) => v || t.suggestedObjective)
            }}
            templates={allTemplates}
            examples={exploreTemplates.slice(0, 8)}
            designSystemLabel={selectedSystem?.title || 'No design system'}
            workingDirectoryLabel={projectRoot ? projectRoot.split(/[\\/]/).filter(Boolean).pop()! : 'Select working directory'}
            onBrowseDesignSystems={() => navigate(`/design-systems?returnTo=${encodeURIComponent('/subdesign')}`)}
            onRefreshSystems={() => void refreshSystems(projectRoot || undefined)}
            activeCategory={templateCategory === 'all' ? 'all' : templateCategory === 'prototype' ? 'creative' : templateCategory === 'deck' ? 'pitch' : templateCategory === 'live-artifact' ? 'engineering' : templateCategory === 'hyperframes' ? 'course' : 'all'}
            onSelectCategory={(id) => {
              const map: Record<string, SubDesignTemplateCategory> = {
                all: 'all',
                creative: 'prototype',
                engineering: 'live-artifact',
                pitch: 'deck',
                course: 'hyperframes',
                reports: 'deck',
                product: 'prototype',
              }
              setTemplateCategory(map[id] || 'all')
            }}
            canSend={Boolean(brief.trim())}
            onSend={startSubDesign}
            onStartWithPrompt={(prompt, tmpl) => {
              setBrief(prompt)
              if (tmpl) {
                setTemplateId(tmpl.id)
                if (tmpl.surface) setSurfaceId(tmpl.surface)
              }
              setTimeout(() => {
                if (prompt.trim()) void startSubDesign()
              }, 0)
            }}
          />
        ) : (
          <section className="mx-auto max-w-[820px] text-center">
            <h1 className="font-[family-name:var(--font-sora)] text-[34px] font-semibold tracking-tight text-on-surface md:text-[42px]">建立另一個設計</h1>
            <p className="mt-3 text-[14px] text-outline">目前專案狀態保留在上方；你可以從新的 brief 開始另一個設計。</p>
            <div className="mx-auto mt-6 max-w-[820px] overflow-hidden rounded-[18px] border border-[#e2c5b8] bg-white">
              <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Turn my notes into a presentation" rows={3} className="w-full resize-none bg-transparent px-6 py-5 text-[15px] leading-relaxed text-[#1a1a1a] outline-none placeholder:text-[#b8b0a8]" />
              <div className="flex items-center justify-end gap-2 border-t border-[#f0e6df] px-4 py-3">
                <button type="button" onClick={startSubDesign} disabled={!brief.trim()} className="inline-flex items-center gap-1.5 rounded-full bg-[#c07a56] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                  <Icon name="send" size={14} /> Send
                </button>
              </div>
            </div>
          </section>
        )}
        {!isLanding && (
          <>
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
                  className={`group flex min-h-[176px] flex-col rounded-2xl border p-4 text-left transition-colors ${
                    selected
                      ? 'border-primary/45 bg-primary/[0.08]'
                      : unavailable
                        ? 'cursor-not-allowed border-white/[0.07] bg-surface-container-low/60 opacity-65'
                        : 'border-white/10 bg-surface-container-low hover:border-primary/30 hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="flex items-center justify-between text-[11px] text-outline">
                    <span className="tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                    <Icon name={template.icon} size={19} className={selected ? 'text-primary' : 'text-outline group-hover:text-on-surface'} />
                  </span>
                  <span className="mt-5 block text-[15px] font-semibold leading-snug text-on-surface">{template.title}</span>
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
                </button>
              )
            })}
          </div>
          {!catalogLoading && visibleTemplates.length === 0 ? (
            <p className="mt-5 rounded-xl bg-surface-container-low px-4 py-5 text-center text-[12px] text-outline" role="status">
              找不到符合目前類型與關鍵字的範本。
            </p>
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
          </>
        )}
      </main>
    </div>
  )
}
