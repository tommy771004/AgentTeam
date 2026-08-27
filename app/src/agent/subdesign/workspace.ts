import type { SubDesignRunPreparation } from './pluginExecutionPreparation.ts'
import type { SubDesignPluginExecutionProjection } from './pluginExecution.ts'
import type { PluginInput } from '../openDesign/pluginContract.ts'
import type { OpenDesignCatalogRecord, OpenDesignProvenance } from '../openDesign/catalog.ts'
import type { ExternalRunOpts, ExternalRunResult } from '../taskRunTypes.ts'
import type { AgentState, LoopType } from '../types.ts'
import type { MemoryEntry } from '../hermes/types.ts'
import type { CliProviderConfig } from '../cliProviders.ts'
import type { Thread, ThreadRunner } from '../../store/threadStore.ts'
import type { SubDesignModelDiscovery } from './modelDiscovery.ts'
import { createStreamingEnvelope, mergeStreamingUpdate, pluginRunArtifactId, type StreamingEnvelope } from './streamingEnvelope.ts'
import { isProviderEnabled } from './providers/providerFlags.ts'
import type {
  SubDesignBrief,
  SubDesignBriefPatch,
  SubDesignArtifact,
  SubDesignCritique,
  SubDesignCritiqueSession,
  SubDesignFidelity,
  SubDesignPlatform,
  SubDesignReference,
  SubDesignSurface,
} from './types.ts'
import type { PluginInputValues } from './pluginInputs.ts'
import type { OpenDesignContentPackManifest } from '../openDesign/packs.ts'
import type { SubDesignPreference } from './preference.ts'
import {
  DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS,
  DEFAULT_STORYBOOK_PROVIDER_SETTINGS,
  type ExperimentalSurfaceSettings,
  type StorybookProviderSettings,
} from './providers/providerSettings.ts'
import { buildPinnedCommentContext, parsePinnedCommentPayload, type SubDesignPinnedComment } from './pinnedComments.ts'
import { deriveSubDesignWorkspace, type SubDesignWorkspaceViewModel } from './workspaceProjection.ts'
import { orchestrationFromAgent } from '../runLifecycle.ts'
import type { SubDesignWorkspaceHostEventListener } from './workspaceHostEvents.ts'

/**
 * The renderer-side workflow seam for SubDesign.
 *
 * This controller deliberately knows only the boundaries it coordinates. The
 * stores, router, Host bridge and task-run coordinator are supplied as
 * dependencies so a test can drive the same interface without reaching into
 * JSX or Zustand internals. The Host remains canonical; this state is only a
 * disposable UI Projection and coordination status.
 */
export type SubDesignWorkspaceCreateInput = {
  objective: string
  surface: SubDesignSurface
  platform?: SubDesignPlatform
  fidelity?: SubDesignFidelity
  templateId?: string
  skillIds?: string[]
  provenance?: OpenDesignProvenance[]
  runner: ThreadRunner
}

export type SubDesignWorkspaceBriefInput = Omit<SubDesignWorkspaceCreateInput, 'runner'> & {
  threadId: string
  audience?: string
  references?: SubDesignReference[]
  constraints?: string[]
  acceptanceCriteria?: string[]
  projectRoot?: string
}

export type SubDesignWorkspaceThread = {
  runner?: ThreadRunner
  loopType?: LoopType | null
}

export type SubDesignWorkspacePreparationInput = {
  brief: SubDesignBrief
  runId: string
  projectRoot?: string
  pluginInputs?: PluginInputValues
}

export type SubDesignWorkspaceCapabilities = {
  electron: boolean
  hostEvents: boolean
}

export type SubDesignWorkspaceHydrationRequest = {
  projectRoot: string
  /** False once a newer project hydration has superseded this request. */
  isCurrent: () => boolean
}

export type SubDesignWorkspaceCatalog = {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  records: OpenDesignCatalogRecord[]
  warning?: string
}

export { createSubDesignHostEventSubscription, type SubDesignWorkspaceHostEvent } from './workspaceHostEvents.ts'
export {
  deriveSubDesignWorkspace,
  type SubDesignWorkspaceAction,
  type SubDesignWorkspaceCritiqueStatus,
  type SubDesignWorkspaceGate,
  type SubDesignWorkspaceGateStatus,
  type SubDesignWorkspaceInput,
  type SubDesignWorkspaceRunStatus,
  type SubDesignWorkspaceStage,
  type SubDesignWorkspaceStageState,
  type SubDesignWorkspaceViewModel,
} from './workspaceProjection.ts'

export type SubDesignWorkspaceRunPhase = 'idle' | 'starting' | 'blocked' | 'failed'

export type SubDesignWorkspaceRunProjection = {
  phase: SubDesignWorkspaceRunPhase
  runId?: string
  reason?: string
}

export type SubDesignWorkspaceProviderProjection = {
  storybookSettings: StorybookProviderSettings
  storybookRuns: SubDesignPluginExecutionProjection[]
  providerRuns: SubDesignPluginExecutionProjection[]
  experimentalSettings: ExperimentalSurfaceSettings
}

export type SubDesignWorkspaceProviderSaveResult<T> =
  | { ok: true; settings: T }
  | { ok: false; reason: string }

export type SubDesignWorkspacePresentation = {
  projectRoot: string
  activeBrief: SubDesignBrief | null
  briefs: SubDesignBrief[]
  threads: Thread[]
  runningThreadIds: string[]
  linkedThread: Thread | null
  linkedThreadRunId: string | null
  linkedAgent: Pick<AgentState, 'status' | 'executionKind' | 'currentIteration' | 'orchestration'> | null
  activityActive: boolean
  /** Derived by the workspace from the brief-scoped run and live inputs. */
  runIsLive: boolean
  artifacts: SubDesignArtifact[]
  critiques: SubDesignCritique[]
  critiqueSession: SubDesignCritiqueSession | null
  memoryEntries: MemoryEntry[]
  cliProviders: CliProviderConfig[]
  installedOpenDesignPacks: OpenDesignContentPackManifest[]
  openDesignPackBusyId: string | null
  openDesignPackError: string | null
  latestPassedPreference: SubDesignPreference | null
  storybookSettings: StorybookProviderSettings
  storybookRuns: SubDesignPluginExecutionProjection[]
  providerRuns: SubDesignPluginExecutionProjection[]
  experimentalSettings: ExperimentalSurfaceSettings
}

export type SubDesignWorkspaceProjection = {
  routeBriefId: string | null
  activeBrief: SubDesignBrief | null
  projectRoot: string
  pluginInputs: PluginInputValues
  pluginDeclaredInputs: PluginInput[]
  selectedModelId: string
  run: SubDesignWorkspaceRunProjection
  runsByBriefId: Record<string, SubDesignWorkspaceRunProjection>
  hydration: {
    status: 'idle' | 'loading' | 'ready' | 'failed'
    reason?: string
  }
  catalog: SubDesignWorkspaceCatalog
  modelDiscovery: SubDesignModelDiscovery | null
  modelDiscoveryStatus: 'idle' | 'loading' | 'ready' | 'failed'
  modelDiscoveryWarning?: string
  streams: Record<string, StreamingEnvelope>
  capabilities: SubDesignWorkspaceCapabilities
  presentation: SubDesignWorkspacePresentation
  workspace: SubDesignWorkspaceViewModel | null
  selectedArtifact: SubDesignArtifact | null
  latestCritique: SubDesignCritique | null
  workspacesByBriefId: Record<string, SubDesignWorkspaceViewModel>
}

export type SubDesignWorkspaceActionFailure = {
  ok: false
  kind: 'invalid' | 'missing-brief' | 'busy' | 'blocked' | 'failed'
  reason: string
  declaredInputs?: PluginInput[]
}

export type SubDesignWorkspaceActionSuccess = {
  ok: true
  brief: SubDesignBrief
  run?: ExternalRunResult
  /** restoreArtifactRevision 成功時的新 revision artifact。 */
  restoredArtifact?: SubDesignArtifact
}

export type SubDesignWorkspaceActionResult = SubDesignWorkspaceActionSuccess | SubDesignWorkspaceActionFailure

export type SubDesignWorkspaceDependencies = {
  findBrief: (id: string) => SubDesignBrief | null
  getThread: (id: string) => SubDesignWorkspaceThread | null
  createThread: (opts: {
    title: string
    agentMode: 'plan'
    thinkingDepth: 'deep'
    runner: ThreadRunner
    projectRoot?: string
  }) => string
  bindBriefToThread: (threadId: string, briefId: string) => void
  createBrief: (input: SubDesignWorkspaceBriefInput) => SubDesignBrief
  selectBrief: (id: string | null) => void
  prepareRun: (input: SubDesignWorkspacePreparationInput) => Promise<SubDesignRunPreparation>
  runTask: (input: ExternalRunOpts) => Promise<ExternalRunResult>
  buildPrompt: (brief: SubDesignBrief) => string
  navigate: (path: string) => void
  hydrateProject?: (request: SubDesignWorkspaceHydrationRequest) => Promise<void>
  restoreArtifact?: (artifactId: string, revision: number, projectRoot?: string) => Promise<{ ok: true; artifact: SubDesignArtifact } | { ok: false; errors: string[] }>
  preparePinnedPatchScope?: (input: {
    artifact: { id: string; title?: string; revision: number }
    pins: SubDesignPinnedComment[]
    projectRoot?: string
  }) => Promise<{ ok: true; scopeId: string } | { ok: false; error: string }>
  refreshProviderState?: (projectRoot?: string, isCurrent?: () => boolean) => Promise<SubDesignWorkspaceProviderProjection>
  saveStorybookProviderSettings?: (
    value: Pick<StorybookProviderSettings, 'enabled' | 'endpoint'>,
    projectRoot?: string,
  ) => Promise<SubDesignWorkspaceProviderSaveResult<StorybookProviderSettings>>
  saveExperimentalSurfaceSettings?: (
    value: Pick<ExperimentalSurfaceSettings, 'mcpApps' | 'streaming'>,
    projectRoot?: string,
  ) => Promise<SubDesignWorkspaceProviderSaveResult<ExperimentalSurfaceSettings>>
  loadCatalog?: () => Promise<{ records: OpenDesignCatalogRecord[]; warnings?: string[] }>
  onCatalogLoaded?: (records: readonly OpenDesignCatalogRecord[]) => Promise<void> | void
  discoverModels?: () => Promise<SubDesignModelDiscovery | null>
  readPresentation?: (routeBriefId: string | null) => SubDesignWorkspacePresentation
  subscribePresentation?: (listener: () => void) => () => void
  subscribeModelChanges?: (listener: () => void) => () => void
  updateBrief?: (id: string, patch: SubDesignBriefPatch, projectRoot?: string) => SubDesignBrief | null
  selectDirection?: (id: string, directionId: string, projectRoot?: string) => { ok: boolean; error?: string; brief: SubDesignBrief }
  installOpenDesignPack?: (record: OpenDesignCatalogRecord, projectRoot?: string) => Promise<OpenDesignContentPackManifest | null>
  setOpenDesignPackEnabled?: (record: OpenDesignCatalogRecord, enabled: boolean) => Promise<boolean>
  setRunPanel?: (visible: boolean) => void
  selectThread?: (id: string) => void
  stopExecution?: (runId?: string) => void
  subscribeHostEvents?: (listener: SubDesignWorkspaceHostEventListener) => () => void
  createRunId: () => string
  getProjectRoot: () => string
  getCapabilities: () => SubDesignWorkspaceCapabilities
}

type WorkspaceState = {
  routeBriefId: string | null
  projectRoot: string
  pluginInputs: PluginInputValues
  pluginDeclaredInputsByBriefId: Record<string, PluginInput[]>
  selectedModelId: string
  runsByBriefId: Record<string, SubDesignWorkspaceRunProjection>
  hydration: SubDesignWorkspaceProjection['hydration']
  catalog: SubDesignWorkspaceCatalog
  modelDiscovery: SubDesignModelDiscovery | null
  modelDiscoveryStatus: 'idle' | 'loading' | 'ready' | 'failed'
  modelDiscoveryWarning?: string
  streams: Record<string, StreamingEnvelope>
  selectedArtifactKey: string | null
  provider: SubDesignWorkspaceProviderProjection
}

const EMPTY_PLUGIN_INPUTS: PluginInputValues = {}

function idleRun(): SubDesignWorkspaceRunProjection {
  return { phase: 'idle' }
}

function resetPluginContext(
  state: WorkspaceState,
  briefId?: string | null,
  clearDeclaredInputs = true,
): void {
  state.pluginInputs = { ...EMPTY_PLUGIN_INPUTS }
  if (briefId && clearDeclaredInputs) state.pluginDeclaredInputsByBriefId[briefId] = []
}

function commandFailure(
  kind: SubDesignWorkspaceActionFailure['kind'],
  reason: string,
  declaredInputs?: PluginInput[],
): SubDesignWorkspaceActionFailure {
  return { ok: false, kind, reason, ...(declaredInputs ? { declaredInputs } : {}) }
}

function emptyPresentation(projectRoot: string): SubDesignWorkspacePresentation {
  return {
    projectRoot,
    activeBrief: null,
    briefs: [],
    threads: [],
    runningThreadIds: [],
    linkedThread: null,
    linkedThreadRunId: null,
    linkedAgent: null,
    activityActive: false,
    runIsLive: false,
    artifacts: [],
    critiques: [],
    critiqueSession: null,
    memoryEntries: [],
    cliProviders: [],
    installedOpenDesignPacks: [],
    openDesignPackBusyId: null,
    openDesignPackError: null,
    latestPassedPreference: null,
    storybookSettings: { ...DEFAULT_STORYBOOK_PROVIDER_SETTINGS },
    storybookRuns: [],
    providerRuns: [],
    experimentalSettings: { ...DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS },
  }
}

export type SubDesignWorkspaceController = {
  getProjection: () => SubDesignWorkspaceProjection
  subscribe: (listener: () => void) => () => void
  sync: (input: { routeBriefId?: string | null; projectRoot?: string }) => void
  hydrate: (projectRoot?: string) => Promise<SubDesignWorkspaceProjection>
  create: (input: SubDesignWorkspaceCreateInput) => Promise<SubDesignWorkspaceActionResult>
  resume: (briefId: string) => SubDesignWorkspaceActionResult
  start: () => Promise<SubDesignWorkspaceActionResult>
  followUp: (value: string) => Promise<SubDesignWorkspaceActionResult>
  setPluginInputs: (values: PluginInputValues) => void
  setModel: (modelId: string) => void
  refreshCatalog: () => Promise<SubDesignWorkspaceProjection>
  refreshModels: () => Promise<SubDesignWorkspaceProjection>
  updateBrief: (id: string, patch: SubDesignBriefPatch, projectRoot?: string) => SubDesignBrief | null
  selectDirection: (id: string, directionId: string, projectRoot?: string) => { ok: boolean; error?: string; brief: SubDesignBrief }
  installOpenDesignPack: (record: OpenDesignCatalogRecord, projectRoot?: string) => Promise<OpenDesignContentPackManifest | null>
  setOpenDesignPackEnabled: (record: OpenDesignCatalogRecord, enabled: boolean) => Promise<boolean>
  setRunPanel: (visible: boolean) => void
  selectThread: (id: string) => void
  restoreArtifactRevision: (input: { artifactId: string; revision: number; projectRoot?: string }) => Promise<SubDesignWorkspaceActionResult>
  submitPinnedComments: (input: { artifact: { id: string; title?: string; revision: number }; pins: unknown }) => Promise<SubDesignWorkspaceActionResult>
  stopExecution: (runId?: string) => void
  setSelectedArtifact: (key: string | null) => void
  saveStorybookProviderSettings: (
    value: Pick<StorybookProviderSettings, 'enabled' | 'endpoint'>,
    projectRoot?: string,
  ) => Promise<SubDesignWorkspaceProviderSaveResult<StorybookProviderSettings>>
  saveExperimentalSurfaceSettings: (
    value: Pick<ExperimentalSurfaceSettings, 'mcpApps' | 'streaming'>,
    projectRoot?: string,
  ) => Promise<SubDesignWorkspaceProviderSaveResult<ExperimentalSurfaceSettings>>
}

export function createSubDesignWorkspace(deps: SubDesignWorkspaceDependencies): SubDesignWorkspaceController {
  const listeners = new Set<() => void>()
  const state: WorkspaceState = {
    routeBriefId: null,
    projectRoot: deps.getProjectRoot() || '',
    pluginInputs: { ...EMPTY_PLUGIN_INPUTS },
    pluginDeclaredInputsByBriefId: {},
    selectedModelId: '',
    runsByBriefId: {},
    hydration: { status: 'idle' },
    catalog: { status: 'idle', records: [] },
    modelDiscovery: null,
    modelDiscoveryStatus: 'idle',
    streams: {},
    selectedArtifactKey: null,
    provider: {
      storybookSettings: { ...DEFAULT_STORYBOOK_PROVIDER_SETTINGS },
      storybookRuns: [],
      providerRuns: [],
      experimentalSettings: { ...DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS },
    },
  }

  let projection: SubDesignWorkspaceProjection = makeProjection()
  let hydrationGeneration = 0

  function makeProjection(): SubDesignWorkspaceProjection {
    const basePresentation = deps.readPresentation?.(state.routeBriefId) || emptyPresentation(state.projectRoot)
    const activeBrief = basePresentation.activeBrief || (state.routeBriefId ? deps.findBrief(state.routeBriefId) : null)
    const activeRun = activeBrief ? state.runsByBriefId[activeBrief.id] || idleRun() : idleRun()
    const activePluginDeclaredInputs = activeBrief ? state.pluginDeclaredInputsByBriefId[activeBrief.id] || [] : []
    const visibleArtifacts = activeBrief
      ? basePresentation.artifacts.filter((artifact) => artifact.briefId === activeBrief.id)
      : []
    const selectedArtifact = state.selectedArtifactKey
      ? visibleArtifacts.find((artifact) => `${artifact.id}:${artifact.revision}` === state.selectedArtifactKey) || null
      : null
    const projectedArtifact = selectedArtifact || visibleArtifacts[0] || null
    const latestCritique = projectedArtifact
      ? basePresentation.critiques
          .filter((critique) => critique.artifactId === projectedArtifact.id && critique.revision === projectedArtifact.revision)
          .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''))[0] || null
      : null
    const deriveBriefWorkspace = (brief: SubDesignBrief, selected?: SubDesignArtifact | null) => {
      const artifacts = basePresentation.artifacts.filter((artifact) => artifact.briefId === brief.id)
      const artifact = selected || [...artifacts]
        .filter((item) => item.status !== 'error')
        .sort((left, right) => right.revision - left.revision || right.updatedAt.localeCompare(left.updatedAt))[0] || null
      const critique = artifact
        ? basePresentation.critiques
            .filter((item) => item.artifactId === artifact.id && item.revision === artifact.revision)
            .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''))[0] || null
        : null
      const thread = basePresentation.threads.find((item) => item.id === brief.threadId)
      const isActiveBrief = brief.id === activeBrief?.id
      const runStatus = isActiveBrief
        ? (activeRun.phase === 'starting' ? 'running' : basePresentation.linkedAgent?.status)
        : basePresentation.runningThreadIds.includes(brief.threadId) ? 'running' : thread?.lastStatus
      return deriveSubDesignWorkspace({
        brief,
        artifacts,
        selectedArtifact: artifact,
        critique,
        critiqueSession: basePresentation.critiqueSession?.briefId === brief.id ? basePresentation.critiqueSession : null,
        runStatus,
        // Only the linked run carries settlement evidence; a stale thread status
        // has none, so it stays a plain terminal state rather than guessing.
        orchestration: isActiveBrief ? orchestrationFromAgent(basePresentation.linkedAgent) : undefined,
      })
    }
    const workspacesByBriefId = Object.fromEntries(
      basePresentation.briefs.map((brief) => [brief.id, deriveBriefWorkspace(brief, brief.id === activeBrief?.id ? projectedArtifact : null)]),
    )
    const workspace = activeBrief ? workspacesByBriefId[activeBrief.id] || null : null
    const runIsLive = Boolean(
      activeBrief &&
      (activeRun.phase === 'starting' || basePresentation.runningThreadIds.includes(activeBrief.threadId)) &&
      (activeRun.phase === 'starting' ||
        Boolean(basePresentation.linkedThreadRunId) ||
        basePresentation.activityActive ||
        ['running', 'parsing', 'manual_intervention', 'awaiting_user'].includes(basePresentation.linkedAgent?.status || 'idle')),
    )
    const presentation: SubDesignWorkspacePresentation = {
      ...basePresentation,
      projectRoot: state.projectRoot,
      activeBrief,
      runIsLive,
      briefs: [...basePresentation.briefs],
      threads: [...basePresentation.threads],
      runningThreadIds: [...basePresentation.runningThreadIds],
      artifacts: [...basePresentation.artifacts],
      critiques: [...basePresentation.critiques],
      memoryEntries: [...basePresentation.memoryEntries],
      cliProviders: [...basePresentation.cliProviders],
      installedOpenDesignPacks: [...basePresentation.installedOpenDesignPacks],
      storybookSettings: { ...state.provider.storybookSettings },
      storybookRuns: [...state.provider.storybookRuns],
      providerRuns: [...state.provider.providerRuns],
      experimentalSettings: { ...state.provider.experimentalSettings },
    }
    return {
      routeBriefId: state.routeBriefId,
      activeBrief,
      projectRoot: state.projectRoot,
      pluginInputs: { ...state.pluginInputs },
      pluginDeclaredInputs: [...activePluginDeclaredInputs],
      selectedModelId: state.selectedModelId,
      run: { ...activeRun },
      runsByBriefId: Object.fromEntries(Object.entries(state.runsByBriefId).map(([briefId, run]) => [briefId, { ...run }])),
      hydration: { ...state.hydration },
      catalog: { ...state.catalog, records: [...state.catalog.records] },
      modelDiscovery: state.modelDiscovery
        ? {
            ...state.modelDiscovery,
            models: [...state.modelDiscovery.models],
            sourceCounts: { ...state.modelDiscovery.sourceCounts },
            current: { ...state.modelDiscovery.current },
          }
        : null,
      modelDiscoveryStatus: state.modelDiscoveryStatus,
      modelDiscoveryWarning: state.modelDiscoveryWarning,
      streams: { ...state.streams },
      capabilities: { ...deps.getCapabilities() },
      presentation,
      workspace,
      selectedArtifact: projectedArtifact,
      latestCritique,
      workspacesByBriefId,
    }
  }

  function publish() {
    projection = makeProjection()
    for (const listener of listeners) listener()
  }

  function setRun(briefId: string, run: SubDesignWorkspaceRunProjection) {
    state.runsByBriefId[briefId] = run
    publish()
  }

  let unsubscribeHostEvents: (() => void) | undefined
  let unsubscribePresentation: (() => void) | undefined
  let unsubscribeModelChanges: (() => void) | undefined

  function startPresentation() {
    if (unsubscribePresentation || !deps.subscribePresentation) return
    unsubscribePresentation = deps.subscribePresentation(() => {
      const projectRoot = deps.getProjectRoot() || ''
      if (projectRoot !== state.projectRoot) {
        state.projectRoot = projectRoot
        resetPluginContext(state, state.routeBriefId)
      }
      publish()
    })
  }

  function startModelChanges() {
    if (unsubscribeModelChanges || !deps.subscribeModelChanges) return
    unsubscribeModelChanges = deps.subscribeModelChanges(() => { void controller.refreshModels() })
  }

  function startHostEvents() {
    if (unsubscribeHostEvents || !deps.subscribeHostEvents) return
    unsubscribeHostEvents = deps.subscribeHostEvents((event) => {
      if (!isProviderEnabled('streaming')) return
      const { runId, stageId, update } = event.payload
      const artifactId = pluginRunArtifactId(runId, stageId)
      const existing = state.streams[artifactId]
      const base = existing || createStreamingEnvelope({
        artifactId,
        artifactKind: 'html',
        runId,
        stageId,
      })
      const merged = mergeStreamingUpdate(base, update)
      if (merged.envelope === base) return
      state.streams = { ...state.streams, [artifactId]: merged.envelope }
      publish()
    })
  }

  function stopHostEvents() {
    unsubscribeHostEvents?.()
    unsubscribeHostEvents = undefined
  }

  function stopPresentation() {
    unsubscribePresentation?.()
    unsubscribePresentation = undefined
    unsubscribeModelChanges?.()
    unsubscribeModelChanges = undefined
  }

  async function runBrief(
    brief: SubDesignBrief,
    objective: string,
    runner?: ThreadRunner,
  ): Promise<SubDesignWorkspaceActionResult> {
    if (state.runsByBriefId[brief.id]?.phase === 'starting') return commandFailure('busy', 'SubDesign 已有一個 run 正在準備中。')

    const runId = deps.createRunId()
    const runProjectRoot = state.projectRoot
    const runPluginInputs = { ...state.pluginInputs }
    const runModelId = state.selectedModelId.trim()
    setRun(brief.id, { phase: 'starting', runId })
    let prepared: SubDesignRunPreparation
    try {
      prepared = await deps.prepareRun({
        brief,
        runId,
        projectRoot: runProjectRoot || undefined,
        pluginInputs: runPluginInputs,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'SubDesign run preparation 失敗。'
      setRun(brief.id, { phase: 'failed', runId, reason })
      return commandFailure('failed', reason)
    }

    state.pluginDeclaredInputsByBriefId[brief.id] = prepared.declaredInputs ? [...prepared.declaredInputs] : []
    // Missing provenance/project capability is an advisory fallback: the
    // brief can still run through the built-in workflow without a provider.
    // Trust decisions and declared inputs are hard blocks because forwarding
    // an incomplete plugin request would silently violate its contract.
    if (prepared.blockedReason && (prepared.declaredInputs?.length || prepared.trust)) {
      setRun(brief.id, { phase: 'blocked', runId, reason: prepared.blockedReason })
      return commandFailure('blocked', prepared.blockedReason, prepared.declaredInputs)
    }

    const thread = deps.getThread(brief.threadId)
    const overrides = runModelId
      ? { ...(prepared.overrides || {}), model: runModelId }
      : prepared.overrides
    const request: ExternalRunOpts = {
      runId,
      objective,
      sourceKind: 'composer',
      reuseThreadId: brief.threadId,
      runner: runner || thread?.runner || 'builtin',
      loopType: thread?.loopType || undefined,
      ...(overrides ? { overrides } : {}),
      ...(runProjectRoot ? { projectRoot: runProjectRoot } : {}),
    }

    try {
      const result = await deps.runTask(request)
      if (result.skipped || result.error) {
        const reason = result.error || 'SubDesign run 未被 coordinator admission 接受。'
        setRun(brief.id, { phase: 'failed', runId, reason })
        return commandFailure('failed', reason)
      }
      setRun(brief.id, idleRun())
      return { ok: true, brief, run: result }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'SubDesign run 失敗。'
      setRun(brief.id, { phase: 'failed', runId, reason })
      return commandFailure('failed', reason)
    } finally {
      if (deps.refreshProviderState) {
        try {
          const provider = await deps.refreshProviderState(
            runProjectRoot || undefined,
            () => state.projectRoot === runProjectRoot,
          )
          state.provider = provider
          publish()
        } catch {
          // Provider refresh is disposable presentation state and never turns
          // an already-admitted Task run into a second failure.
        }
      }
    }
  }

  const controller: SubDesignWorkspaceController = {
    getProjection: () => projection,

    subscribe: (listener) => {
      listeners.add(listener)
      startHostEvents()
      startPresentation()
      startModelChanges()
      return () => {
        listeners.delete(listener)
        if (!listeners.size) {
          stopHostEvents()
          stopPresentation()
        }
      }
    },

    sync: ({ routeBriefId, projectRoot }) => {
      const nextRoute = routeBriefId === undefined ? state.routeBriefId : routeBriefId || null
      if (nextRoute !== state.routeBriefId) {
        state.routeBriefId = nextRoute
        // Switching conversations resets only the editable draft. Keep each
        // brief's declared contract visible when the user returns to a
        // blocked brief; the projection is already scoped by active brief.
        resetPluginContext(state, nextRoute, false)
        if (nextRoute && deps.findBrief(nextRoute)) deps.selectBrief(nextRoute)
      }
      if (projectRoot !== undefined && projectRoot !== state.projectRoot) {
        state.projectRoot = projectRoot
        resetPluginContext(state, state.routeBriefId)
      }
      publish()
    },

    hydrate: async (projectRoot = deps.getProjectRoot() || '') => {
      const generation = ++hydrationGeneration
      state.projectRoot = projectRoot
      resetPluginContext(state, state.routeBriefId)
      // Do not carry the previous project's provider records through a
      // pending bind or a failed refresh. The integration will replace this
      // disposable projection only after the current project is confirmed.
      state.provider = {
        storybookSettings: { ...DEFAULT_STORYBOOK_PROVIDER_SETTINGS },
        storybookRuns: [],
        providerRuns: [],
        experimentalSettings: { ...DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS },
      }
      state.hydration = { status: 'loading' }
      publish()
      const isCurrent = () => generation === hydrationGeneration && state.projectRoot === projectRoot
      try {
        await deps.hydrateProject?.({ projectRoot, isCurrent })
        if (!isCurrent()) return projection
        if (deps.refreshProviderState) {
          const provider = await deps.refreshProviderState(projectRoot, isCurrent)
          if (!isCurrent()) return projection
          state.provider = provider
        }
        state.hydration = { status: 'ready' }
      } catch (error) {
        if (!isCurrent()) return projection
        state.hydration = {
          status: 'failed',
          reason: error instanceof Error ? error.message : 'SubDesign project hydration 失敗。',
        }
      }
      publish()
      return projection
    },

    refreshCatalog: async () => {
      if (!deps.loadCatalog) return projection
      state.catalog = { ...state.catalog, status: 'loading' }
      publish()
      try {
        const index = await deps.loadCatalog()
        state.catalog = {
          status: 'ready',
          records: [...index.records],
          warning: index.warnings?.[0],
        }
        await deps.onCatalogLoaded?.(index.records)
      } catch (error) {
        state.catalog = {
          status: 'failed',
          records: [],
          warning: error instanceof Error ? error.message : 'OpenDesign catalog 載入失敗。',
        }
      }
      publish()
      return projection
    },

    refreshModels: async () => {
      if (!deps.discoverModels) return projection
      state.modelDiscoveryStatus = 'loading'
      state.modelDiscoveryWarning = undefined
      publish()
      try {
        const discovery = await deps.discoverModels()
        state.modelDiscovery = discovery
        state.modelDiscoveryStatus = 'ready'
        if (!state.selectedModelId && discovery?.current.model) state.selectedModelId = discovery.current.model
      } catch (error) {
        state.modelDiscovery = null
        state.modelDiscoveryStatus = 'failed'
        state.modelDiscoveryWarning = error instanceof Error ? error.message : '模型發現失敗。'
      }
      publish()
      return projection
    },

    create: async (input) => {
      const objective = input.objective.trim()
      if (!objective) return commandFailure('invalid', '請先輸入 SubDesign brief。')

      const threadId = deps.createThread({
        title: `SubDesign · ${input.surface}`,
        agentMode: 'plan',
        thinkingDepth: 'deep',
        runner: input.runner,
        projectRoot: state.projectRoot || undefined,
      })
      const brief = deps.createBrief({
        threadId,
        surface: input.surface,
        objective,
        platform: input.platform,
        fidelity: input.fidelity || 'high-fidelity',
        templateId: input.templateId,
        skillIds: input.skillIds,
        provenance: input.provenance,
        projectRoot: state.projectRoot || undefined,
      })
      deps.bindBriefToThread(threadId, brief.id)
      deps.selectBrief(brief.id)
      state.routeBriefId = brief.id
      resetPluginContext(state, brief.id)
      publish()
      deps.navigate(`/subdesign/${brief.id}`)
      const prompt = deps.buildPrompt(brief)
      return runBrief(brief, prompt, input.runner)
    },

    resume: (briefId) => {
      const brief = deps.findBrief(briefId)
      if (!brief) return commandFailure('missing-brief', `找不到這個 SubDesign brief：${briefId}。`)
      state.routeBriefId = brief.id
      resetPluginContext(state, brief.id)
      deps.selectBrief(brief.id)
      publish()
      deps.navigate(`/subdesign/${brief.id}`)
      return { ok: true, brief }
    },

    start: async () => {
      const brief = state.routeBriefId ? deps.findBrief(state.routeBriefId) : null
      if (!brief) return commandFailure('missing-brief', '目前沒有可執行的 SubDesign brief。')
      const prompt = deps.buildPrompt(brief)
      return runBrief(brief, prompt)
    },

    followUp: async (value) => {
      const objective = value.trim()
      if (!objective) return commandFailure('invalid', '請先輸入 follow-up。')
      const brief = state.routeBriefId ? deps.findBrief(state.routeBriefId) : null
      if (!brief) return commandFailure('missing-brief', '目前沒有可執行的 SubDesign brief。')
      return runBrief(brief, objective)
    },

    setPluginInputs: (values) => {
      state.pluginInputs = { ...values }
      if (state.routeBriefId) state.pluginDeclaredInputsByBriefId[state.routeBriefId] = []
      if (state.routeBriefId && state.runsByBriefId[state.routeBriefId]?.phase === 'blocked') {
        state.runsByBriefId[state.routeBriefId] = idleRun()
      }
      publish()
    },

    setModel: (modelId) => {
      const next = modelId.trim()
      if (next === state.selectedModelId) return
      state.selectedModelId = next
      publish()
    },

    updateBrief: (id, patch, projectRoot) => {
      const brief = deps.updateBrief?.(id, patch, projectRoot)
      publish()
      return brief || null
    },

    selectDirection: (id, directionId, projectRoot) => {
      const result = deps.selectDirection?.(id, directionId, projectRoot) || {
        ok: false,
        error: 'SubDesign direction adapter 尚未提供。',
        brief: deps.findBrief(id) as SubDesignBrief,
      }
      publish()
      return result
    },

    installOpenDesignPack: async (record, projectRoot) => {
      const installed = await deps.installOpenDesignPack?.(record, projectRoot)
      publish()
      return installed || null
    },

    setOpenDesignPackEnabled: async (record, enabled) => {
      const result = await deps.setOpenDesignPackEnabled?.(record, enabled)
      publish()
      return result || false
    },

    setRunPanel: (visible) => {
      deps.setRunPanel?.(visible)
      publish()
    },

    selectThread: (id) => {
      deps.selectThread?.(id)
      publish()
    },

    stopExecution: (runId) => {
      deps.stopExecution?.(runId)
      publish()
    },

    setSelectedArtifact: (key) => {
      if (state.selectedArtifactKey === key) return
      state.selectedArtifactKey = key
      publish()
    },

    submitPinnedComments: async (input) => {
      const parsed = parsePinnedCommentPayload({ pins: input.pins })
      if (!parsed.ok) return commandFailure('invalid', parsed.errors.join('；'))
      const briefId = state.routeBriefId
      const brief = briefId ? deps.findBrief(briefId) : null
      if (!brief) return commandFailure('missing-brief', '目前沒有可執行的 SubDesign brief。')
      if (state.runsByBriefId[brief.id]?.phase === 'starting' || deps.readPresentation?.(brief.id)?.runIsLive === true) {
        return commandFailure('busy', 'SubDesign 已有一個 run 正在準備中。')
      }
      if (!deps.preparePinnedPatchScope) return commandFailure('failed', 'Pin 修正需要 Electron Host scoped patch 支援。')
      const scope = await deps.preparePinnedPatchScope({
        artifact: input.artifact,
        pins: parsed.pins,
        projectRoot: state.projectRoot || undefined,
      })
      if (!scope.ok) return commandFailure('invalid', scope.error)
      const objective = buildPinnedCommentContext(input.artifact, parsed.pins, scope.scopeId)
      return runBrief(brief, objective)
    },

    restoreArtifactRevision: async (input) => {
      const briefId = state.routeBriefId
      const runPhase = briefId ? state.runsByBriefId[briefId]?.phase : undefined
      // Live guard：run 起始中，或 presentation 判定 live（running thread / activity）
      // 時拒絕還原——live → terminal 只走一次，寫性操作不得插隊。
      const presentationLive = briefId ? deps.readPresentation?.(briefId)?.runIsLive === true : false
      if (runPhase === 'starting' || presentationLive) {
        return commandFailure('busy', 'Run 進行中，無法還原 artifact revision；請先停止或等待完成。')
      }
      if (!deps.restoreArtifact) return commandFailure('failed', '還原需要 Electron workspace API。')
      const result = await deps.restoreArtifact(input.artifactId, input.revision, input.projectRoot || (state.projectRoot || undefined))
      if (!result.ok) return commandFailure('failed', result.errors.join('；'))
      publish()
      const brief = briefId ? deps.findBrief(briefId) : null
      if (!brief) return commandFailure('missing-brief', '目前沒有可執行的 SubDesign brief。')
      return { ok: true, brief, restoredArtifact: result.artifact }
    },

    saveStorybookProviderSettings: async (value, projectRoot = state.projectRoot || undefined) => {
      const result = await deps.saveStorybookProviderSettings?.(value, projectRoot)
        || { ok: false as const, reason: 'Storybook provider adapter 尚未提供。' }
      if (result.ok) {
        state.provider = { ...state.provider, storybookSettings: result.settings }
        publish()
      }
      return result
    },

    saveExperimentalSurfaceSettings: async (value, projectRoot = state.projectRoot || undefined) => {
      const result = await deps.saveExperimentalSurfaceSettings?.(value, projectRoot)
        || { ok: false as const, reason: 'Experimental provider adapter 尚未提供。' }
      if (result.ok) {
        state.provider = { ...state.provider, experimentalSettings: result.settings }
        publish()
      }
      return result
    },
  }

  return controller
}
