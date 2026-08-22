import { v4 as uuid } from 'uuid'
import { buildSubDesignPrompt } from './prompt.ts'
import { prepareSubDesignRun } from './pluginExecutionPreparation.ts'
import { collectSubDesignModels, readHostModelSettings } from './modelDiscovery.ts'
import { loadOpenDesignCatalog } from '../openDesign/catalog.ts'
import {
  createSubDesignHostEventSubscription,
  type SubDesignWorkspaceHydrationRequest,
  type SubDesignWorkspaceDependencies,
  type SubDesignWorkspaceProviderProjection,
  type SubDesignWorkspaceProviderSaveResult,
} from './workspace.ts'
import { findLatestPassedSubDesignPreference } from './preference.ts'
import { hydrateProviderFlags } from './providers/providerFlags.ts'
import {
  DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS,
  DEFAULT_STORYBOOK_PROVIDER_SETTINGS,
  loadAllProviderRuns,
  loadExperimentalSurfaceSettings,
  loadStorybookProviderState,
  saveExperimentalSurfaceSettings,
  saveStorybookProviderSettings,
  type ExperimentalSurfaceSettings,
  type StorybookProviderSettings,
} from './providers/providerSettings.ts'
import { runTask } from '../taskRunCoordinator.ts'
import { hydrateSubDesignStores } from '../../store/subDesignPersistence.ts'
import { useProjectStore } from '../../store/projectStore.ts'
import { useSubDesignArtifactStore } from '../../store/subDesignArtifactStore.ts'
import { useSubDesignCritiqueStore } from '../../store/subDesignCritiqueStore.ts'
import { useSubDesignCritiqueSessionStore } from '../../store/subDesignCritiqueSessionStore.ts'
import { useSubDesignExportStore } from '../../store/subDesignExportStore.ts'
import { useSubDesignStore } from '../../store/subDesignStore.ts'
import { useThreadStore } from '../../store/threadStore.ts'
import { useAgentStore } from '../../store/agentStore.ts'
import { useRunActivityStore } from '../../store/runActivityStore.ts'
import { useLearningStore } from '../../store/learningStore.ts'
import { useOpenDesignPackStore } from '../../store/openDesignPackStore.ts'
import { useSettingsStore } from '../../store/settingsStore.ts'

export type SubDesignWorkspaceIntegrationOptions = {
  navigate: (path: string) => void
}

/**
 * Renderer integration boundary for the workspace seam.
 *
 * The page supplies only the router. Store coordination, provider settings and
 * runs, Pi Host feature detection, and the typed event adapter stay here so the
 * page does not become another workflow owner.
 */
export function createSubDesignWorkspaceDependencies(
  options: SubDesignWorkspaceIntegrationOptions,
): SubDesignWorkspaceDependencies {
  const hostApi = typeof window !== 'undefined' ? window.subagents?.piHost : undefined
  let providerProjection: SubDesignWorkspaceProviderProjection = {
    storybookSettings: { ...DEFAULT_STORYBOOK_PROVIDER_SETTINGS },
    storybookRuns: [],
    providerRuns: [],
    experimentalSettings: { ...DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS },
  }
  const readProviderProjection = (): SubDesignWorkspaceProviderProjection => ({
    storybookSettings: { ...providerProjection.storybookSettings },
    storybookRuns: [...providerProjection.storybookRuns],
    providerRuns: [...providerProjection.providerRuns],
    experimentalSettings: { ...providerProjection.experimentalSettings },
  })
  const refreshProviderState = async (
    projectRoot?: string,
    isCurrent?: () => boolean,
  ): Promise<SubDesignWorkspaceProviderProjection> => {
    const [storybook, providerRuns, experimentalSettings] = await Promise.all([
      loadStorybookProviderState(projectRoot),
      loadAllProviderRuns(projectRoot),
      loadExperimentalSurfaceSettings(projectRoot),
    ])
    if (isCurrent && !isCurrent()) return readProviderProjection()
    providerProjection = {
      storybookSettings: storybook.settings,
      storybookRuns: [...storybook.runs],
      providerRuns: [...providerRuns],
      experimentalSettings,
    }
    hydrateProviderFlags(experimentalSettings)
    return readProviderProjection()
  }
  const saveStorybookSettings = async (
    value: Pick<StorybookProviderSettings, 'enabled' | 'endpoint'>,
    projectRoot?: string,
  ): Promise<SubDesignWorkspaceProviderSaveResult<StorybookProviderSettings>> => {
    const result = await saveStorybookProviderSettings(value, projectRoot)
    if (result.ok) {
      providerProjection = { ...providerProjection, storybookSettings: result.settings }
    }
    return result
  }
  const saveExperimentalSettings = async (
    value: Pick<ExperimentalSurfaceSettings, 'mcpApps' | 'streaming'>,
    projectRoot?: string,
  ): Promise<SubDesignWorkspaceProviderSaveResult<ExperimentalSurfaceSettings>> => {
    const result = await saveExperimentalSurfaceSettings(value, projectRoot)
    if (result.ok) {
      providerProjection = { ...providerProjection, experimentalSettings: result.settings }
      hydrateProviderFlags(result.settings)
    }
    return result
  }
  return {
    findBrief: (id) => useSubDesignStore.getState().findById(id),
    getThread: (id) => {
      const thread = useThreadStore.getState().threads.find((item) => item.id === id)
      return thread ? { runner: thread.runner, loopType: thread.loopType } : null
    },
    createThread: (input) => useThreadStore.getState().createThread(input),
    bindBriefToThread: (threadId, briefId) => useThreadStore.getState().setSubDesignBriefId(threadId, briefId),
    createBrief: (input) => useSubDesignStore.getState().createBrief(input),
    selectBrief: (id) => useSubDesignStore.getState().selectBrief(id),
    getDesignSystem: (id) => useSubDesignStore.getState().systems.find((system) => system.id === id) || null,
    readPresentation: (routeBriefId) => {
      const projectRoot = useProjectStore.getState().root
      const subDesign = useSubDesignStore.getState()
      const threadState = useThreadStore.getState()
      const linkedThread = routeBriefId
        ? threadState.threads.find((thread) => thread.subDesignBriefId === routeBriefId) || null
        : null
      const linkedThreadRunId = linkedThread ? useAgentStore.getState().getRunIdForThread(linkedThread.id) : null
      const linkedAgent = linkedThreadRunId ? useAgentStore.getState().runStates[linkedThreadRunId] : null
      const activityActive = linkedThreadRunId
        ? useRunActivityStore.getState().getPresentation(linkedThreadRunId)?.active || false
        : false
      const artifacts = [...useSubDesignArtifactStore.getState().artifacts]
      const critiques = [...useSubDesignCritiqueStore.getState().critiques]
      const briefs = [...subDesign.briefs]
      return {
        projectRoot,
        activeBrief: routeBriefId ? subDesign.findById(routeBriefId) : null,
        briefs,
        systems: [...subDesign.systems],
        systemsLoading: subDesign.systemsLoading,
        systemsError: subDesign.systemsError,
        threads: [...threadState.threads],
        runningThreadIds: [...threadState.runningThreadIds],
        linkedThread,
        linkedThreadRunId,
        linkedAgent: linkedAgent ? { status: linkedAgent.status, executionKind: linkedAgent.executionKind } : null,
        activityActive,
        runIsLive: false,
        artifacts,
        critiques,
        critiqueSession: useSubDesignCritiqueSessionStore.getState().current,
        memoryEntries: [...useLearningStore.getState().memory.entries],
        cliProviders: [...useSettingsStore.getState().settings.cliProviders],
        installedOpenDesignPacks: [...useOpenDesignPackStore.getState().packs],
        openDesignPackBusyId: useOpenDesignPackStore.getState().busyId,
        openDesignPackError: useOpenDesignPackStore.getState().error,
        latestPassedPreference: findLatestPassedSubDesignPreference(briefs, artifacts, critiques, {
          projectRoot,
          memoryEntries: useLearningStore.getState().memory.entries,
        }),
        storybookSettings: providerProjection.storybookSettings,
        storybookRuns: [...providerProjection.storybookRuns],
        providerRuns: [...providerProjection.providerRuns],
        experimentalSettings: providerProjection.experimentalSettings,
      }
    },
    subscribePresentation: (listener) => {
      const unsubscribeProject = useProjectStore.subscribe(listener)
      const unsubscribeThreads = useThreadStore.subscribe(listener)
      const unsubscribeAgents = useAgentStore.subscribe(listener)
      const unsubscribeActivity = useRunActivityStore.subscribe(listener)
      const unsubscribeSubDesign = useSubDesignStore.subscribe(listener)
      const unsubscribeArtifacts = useSubDesignArtifactStore.subscribe(listener)
      const unsubscribeCritiques = useSubDesignCritiqueStore.subscribe(listener)
      const unsubscribeCritiqueSession = useSubDesignCritiqueSessionStore.subscribe(listener)
      const unsubscribeLearning = useLearningStore.subscribe(listener)
      const unsubscribePacks = useOpenDesignPackStore.subscribe(listener)
      const unsubscribeSettings = useSettingsStore.subscribe(listener)
      return () => {
        unsubscribeProject()
        unsubscribeThreads()
        unsubscribeAgents()
        unsubscribeActivity()
        unsubscribeSubDesign()
        unsubscribeArtifacts()
        unsubscribeCritiques()
        unsubscribeCritiqueSession()
        unsubscribeLearning()
        unsubscribePacks()
        unsubscribeSettings()
      }
    },
    subscribeModelChanges: (listener) => useSettingsStore.subscribe(listener),
    refreshProviderState,
    saveStorybookProviderSettings: saveStorybookSettings,
    saveExperimentalSurfaceSettings: saveExperimentalSettings,
    updateBrief: (id, patch, projectRoot) => useSubDesignStore.getState().updateBrief(id, patch, projectRoot),
    selectDirection: (id, directionId, projectRoot) => useSubDesignStore.getState().selectDirection(id, directionId, undefined, projectRoot),
    refreshSystems: (projectRoot, options) => useSubDesignStore.getState().refreshSystems(projectRoot, options),
    installOpenDesignPack: (record, projectRoot) => useOpenDesignPackStore.getState().install(record, projectRoot),
    setOpenDesignPackEnabled: (record, enabled) => useOpenDesignPackStore.getState().setEnabled(record, enabled),
    setRunPanel: (visible) => useThreadStore.getState().setShowRunPanel(visible),
    selectThread: (id) => useThreadStore.getState().selectThread(id),
    stopExecution: (runId) => useAgentStore.getState().stopExecution(runId),
    prepareRun: (input) => prepareSubDesignRun(input),
    runTask,
    buildPrompt: (brief, system) => buildSubDesignPrompt(brief, system || undefined),
    navigate: options.navigate,
    hydrateProject: async ({ projectRoot, isCurrent }: SubDesignWorkspaceHydrationRequest) => {
      if (!isCurrent()) return
      useThreadStore.getState().hydrate()
      if (!isCurrent()) return
      useSubDesignStore.getState().setProjectRoot(projectRoot)
      useSubDesignArtifactStore.getState().setProjectRoot(projectRoot)
      useSubDesignCritiqueStore.getState().setProjectRoot(projectRoot)
      useSubDesignExportStore.getState().setProjectRoot(projectRoot)
      useOpenDesignPackStore.getState().setProjectRoot(projectRoot)
      await hydrateSubDesignStores(projectRoot || undefined, { isCurrent })
      if (!isCurrent()) return
      await Promise.all([
        useSubDesignStore.getState().refreshSystems(projectRoot || undefined, { isCurrent }),
      ])
    },
    loadCatalog: async () => loadOpenDesignCatalog(),
    onCatalogLoaded: async (records) => {
      const catalog = [...records]
      const packs = useOpenDesignPackStore.getState()
      packs.reindex(catalog)
      await packs.rehydrateEnabled(catalog)
    },
    discoverModels: async () => {
      const host = await readHostModelSettings()
      const settings = useSettingsStore.getState().settings
      return collectSubDesignModels({
        cliProviders: settings.cliProviders,
        discoveredModels: settings.discoveredModels,
        host,
      })
    },
    subscribeHostEvents: createSubDesignHostEventSubscription(hostApi?.onEvent),
    createRunId: () => `run_${uuid().slice(0, 12)}`,
    getProjectRoot: () => useProjectStore.getState().root,
    getCapabilities: () => ({
      electron: Boolean(hostApi),
      hostEvents: Boolean(hostApi?.onEvent),
    }),
  }
}
