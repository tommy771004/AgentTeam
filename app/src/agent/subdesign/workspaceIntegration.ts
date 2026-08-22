import { v4 as uuid } from 'uuid'
import { buildSubDesignPrompt } from './prompt.ts'
import { prepareSubDesignRun } from './pluginExecutionPreparation.ts'
import { collectSubDesignModels, readHostModelSettings } from './modelDiscovery.ts'
import { loadOpenDesignCatalog } from '../openDesign/catalog.ts'
import {
  createSubDesignHostEventSubscription,
  type SubDesignWorkspaceDependencies,
} from './workspace.ts'
import { runTask } from '../taskRunCoordinator.ts'
import { hydrateSubDesignStores } from '../../store/subDesignPersistence.ts'
import { useProjectStore } from '../../store/projectStore.ts'
import { useSubDesignArtifactStore } from '../../store/subDesignArtifactStore.ts'
import { useSubDesignCritiqueStore } from '../../store/subDesignCritiqueStore.ts'
import { useSubDesignExportStore } from '../../store/subDesignExportStore.ts'
import { useSubDesignStore } from '../../store/subDesignStore.ts'
import { useThreadStore } from '../../store/threadStore.ts'
import { useOpenDesignPackStore } from '../../store/openDesignPackStore.ts'
import { useSettingsStore } from '../../store/settingsStore.ts'

export type SubDesignWorkspaceIntegrationOptions = {
  navigate: (path: string) => void
  refreshProviderState?: () => Promise<void>
  refreshProjectProviderState?: (projectRoot: string) => Promise<void>
}

/**
 * Renderer integration boundary for the workspace seam.
 *
 * The page supplies presentation-only callbacks (router and provider-state
 * projection updates). Store coordination, Pi Host feature detection and the
 * typed event adapter stay here so the page does not become another workflow
 * owner.
 */
export function createSubDesignWorkspaceDependencies(
  options: SubDesignWorkspaceIntegrationOptions,
): SubDesignWorkspaceDependencies {
  const hostApi = typeof window !== 'undefined' ? window.subagents?.piHost : undefined
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
    prepareRun: (input) => prepareSubDesignRun(input),
    runTask,
    buildPrompt: (brief, system) => buildSubDesignPrompt(brief, system || undefined),
    navigate: options.navigate,
    hydrateProject: async (projectRoot) => {
      useThreadStore.getState().hydrate()
      await useProjectStore.getState().setRoot(projectRoot)
      useSubDesignStore.getState().setProjectRoot(projectRoot)
      useSubDesignArtifactStore.getState().setProjectRoot(projectRoot)
      useSubDesignCritiqueStore.getState().setProjectRoot(projectRoot)
      useSubDesignExportStore.getState().setProjectRoot(projectRoot)
      useOpenDesignPackStore.getState().setProjectRoot(projectRoot)
      await hydrateSubDesignStores(projectRoot || undefined)
      await Promise.all([
        useSubDesignStore.getState().refreshSystems(projectRoot || undefined),
        options.refreshProjectProviderState?.(projectRoot),
      ])
    },
    refreshProviderState: options.refreshProviderState,
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
