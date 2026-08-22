import { critiqueAllowsDeliver } from './critique.ts'
import type { SubDesignRunPreparation } from './pluginExecutionPreparation.ts'
import type { PluginInput } from '../openDesign/pluginContract.ts'
import type { OpenDesignProvenance } from '../openDesign/catalog.ts'
import type { ExternalRunOpts, ExternalRunResult } from '../taskRunTypes.ts'
import type { LoopType } from '../types.ts'
import type { ThreadRunner } from '../../store/threadStore.ts'
import {
  SUBDESIGN_STAGES,
  stageLabel,
} from './types.ts'
import type {
  DesignSystemSummary,
  SubDesignArtifact,
  SubDesignBrief,
  SubDesignCritique,
  SubDesignCritiqueSession,
  SubDesignFidelity,
  SubDesignPlatform,
  SubDesignReference,
  SubDesignStage,
  SubDesignSurface,
} from './types.ts'
import type { PluginInputValues } from './pluginInputs.ts'

export type SubDesignWorkspaceRunStatus = 'idle' | 'active' | 'success' | 'failed' | 'halted' | 'awaiting-user'
export type SubDesignWorkspaceCritiqueStatus = 'not-started' | 'running' | 'passed' | 'needs-revision' | 'interrupted' | 'failed'
export type SubDesignWorkspaceStageState = 'completed' | 'active' | 'pending' | 'locked'
export type SubDesignWorkspaceGateStatus = 'ready' | 'blocked' | 'complete'
export type SubDesignWorkspaceAction = 'complete-brief' | 'choose-direction' | 'start-build' | 'review-critique' | 'deliver' | 'inspect'

export type SubDesignWorkspaceStage = {
  id: SubDesignStage
  label: string
  state: SubDesignWorkspaceStageState
  description: string
}

export type SubDesignWorkspaceGate = {
  id: SubDesignStage
  label: string
  status: SubDesignWorkspaceGateStatus
  title: string
  reason?: string
  action: SubDesignWorkspaceAction
}

export type SubDesignWorkspaceViewModel = {
  briefId: string
  objective: string
  currentStage: SubDesignStage
  stages: SubDesignWorkspaceStage[]
  nextGate: SubDesignWorkspaceGate
  runStatus: SubDesignWorkspaceRunStatus
  critiqueStatus: SubDesignWorkspaceCritiqueStatus
  hasCompleteArtifact: boolean
  latestArtifact: SubDesignArtifact | null
  selectedDirectionTitle?: string
}

export type SubDesignWorkspaceInput = {
  brief: SubDesignBrief
  artifacts?: SubDesignArtifact[]
  selectedArtifact?: SubDesignArtifact | null
  critique?: SubDesignCritique | null
  critiqueSession?: SubDesignCritiqueSession | null
  runStatus?: string
}

const ACTIVE_RUN_STATUSES = new Set(['parsing', 'running', 'manual_intervention'])

function deriveRunStatus(value: string | undefined): SubDesignWorkspaceRunStatus {
  if (!value || value === 'idle') return 'idle'
  if (ACTIVE_RUN_STATUSES.has(value)) return 'active'
  if (value === 'awaiting_user') return 'awaiting-user'
  if (value === 'success') return 'success'
  if (value === 'halted' || value === 'aborted') return 'halted'
  if (value === 'failed') return 'failed'
  return 'idle'
}

function deriveCritiqueStatus(critique: SubDesignCritique | null | undefined, session: SubDesignCritiqueSession | null | undefined): SubDesignWorkspaceCritiqueStatus {
  if (session?.status === 'running') return 'running'
  if (session?.status === 'interrupted') return 'interrupted'
  if (session?.status === 'failed') return 'failed'
  if (critique?.verdict === 'pass') return 'passed'
  if (critique?.verdict === 'needs-revision') return 'needs-revision'
  return 'not-started'
}

function latestArtifactOf(artifacts: SubDesignArtifact[], selectedArtifact?: SubDesignArtifact | null): SubDesignArtifact | null {
  if (selectedArtifact) return selectedArtifact
  return [...artifacts]
    .filter((artifact) => artifact.status !== 'error')
    .sort((a, b) => {
      if (b.revision !== a.revision) return b.revision - a.revision
      return b.updatedAt.localeCompare(a.updatedAt)
    })[0] || null
}

function describeStage(stage: SubDesignStage, state: SubDesignWorkspaceStageState): string {
  if (state === 'completed') return '已完成'
  if (state === 'active') return '目前階段'
  if (state === 'locked') return '尚未開放'
  if (stage === 'direction') return '等待方向選擇'
  if (stage === 'build') return '等待開始建置'
  if (stage === 'critique') return '等待 artifact 完成'
  if (stage === 'deliver') return '等待 critique pass'
  return '等待 brief'
}

function stageState(currentStage: SubDesignStage, stage: SubDesignStage, hasDirection: boolean, hasPassingCritique: boolean): SubDesignWorkspaceStageState {
  const currentIndex = SUBDESIGN_STAGES.indexOf(currentStage)
  const stageIndex = SUBDESIGN_STAGES.indexOf(stage)
  if (stageIndex < currentIndex) return 'completed'
  if (stageIndex === currentIndex) return 'active'
  if (stage === 'build' && !hasDirection) return 'locked'
  if (stage === 'deliver' && !hasPassingCritique) return 'locked'
  return stageIndex === currentIndex + 1 ? 'pending' : 'locked'
}

function makeGate(input: {
  brief: SubDesignBrief
  runStatus: SubDesignWorkspaceRunStatus
  critiqueStatus: SubDesignWorkspaceCritiqueStatus
  hasCompleteArtifact: boolean
  hasPassingCritique: boolean
}): SubDesignWorkspaceGate {
  const { brief, runStatus, critiqueStatus, hasCompleteArtifact, hasPassingCritique } = input
  if (brief.stage === 'brief') {
    return {
      id: 'direction',
      label: stageLabel('direction'),
      status: brief.selectedDirectionId ? 'ready' : 'blocked',
      title: brief.selectedDirectionId ? '準備進入 Direction' : '等待選擇 design direction',
      reason: brief.selectedDirectionId ? undefined : '尚未選定 design direction，不能進入 Build。',
      action: brief.selectedDirectionId ? 'start-build' : 'choose-direction',
    }
  }
  if (brief.stage === 'direction') {
    return {
      id: 'build',
      label: stageLabel('build'),
      status: brief.selectedDirectionId ? 'ready' : 'blocked',
      title: runStatus === 'active' ? 'Build 正在執行' : '準備開始 Build',
      reason: brief.selectedDirectionId ? undefined : '請先完成 direction gate。',
      action: runStatus === 'active' ? 'inspect' : brief.selectedDirectionId ? 'start-build' : 'choose-direction',
    }
  }
  if (brief.stage === 'build') {
    if (runStatus === 'active' || runStatus === 'awaiting-user') {
      return { id: 'build', label: stageLabel('build'), status: 'ready', title: runStatus === 'awaiting-user' ? 'Build 等待你的決定' : 'Build 正在執行', action: 'inspect' }
    }
    if ((runStatus === 'failed' || runStatus === 'halted') && !hasCompleteArtifact) {
      return { id: 'build', label: stageLabel('build'), status: 'ready', title: runStatus === 'failed' ? '上一次 Build 失敗，可重新執行' : 'Build 已中止，可重新執行', reason: '尚未產生完整 artifact。', action: 'start-build' }
    }
    return {
      id: hasCompleteArtifact ? 'critique' : 'build',
      label: hasCompleteArtifact ? stageLabel('critique') : stageLabel('build'),
      status: hasCompleteArtifact ? 'ready' : 'blocked',
      title: hasCompleteArtifact ? 'Artifact 已完成，開始 Critique' : '等待 artifact 產生完成',
      reason: hasCompleteArtifact ? undefined : '目前還沒有可供 review 的完整 artifact。',
      action: hasCompleteArtifact ? 'review-critique' : 'start-build',
    }
  }
  if (brief.stage === 'critique') {
    if (critiqueStatus === 'running') return { id: 'critique', label: stageLabel('critique'), status: 'ready', title: 'Critique 正在執行', action: 'inspect' }
    if (critiqueStatus === 'passed' || hasPassingCritique) return { id: 'deliver', label: stageLabel('deliver'), status: 'ready', title: 'Critique 已通過，可以交付', action: 'deliver' }
    return {
      id: 'critique',
      label: stageLabel('critique'),
      status: hasCompleteArtifact ? 'ready' : 'blocked',
      title: critiqueStatus === 'needs-revision' ? '需要依 Critique 調整 artifact' : '等待 Critique review',
      reason: hasCompleteArtifact ? undefined : '需要先有完整 artifact 才能開始 Critique。',
      action: hasCompleteArtifact ? 'review-critique' : 'start-build',
    }
  }
  return {
    id: 'deliver',
    label: stageLabel('deliver'),
    status: hasPassingCritique ? 'ready' : 'blocked',
    title: hasPassingCritique ? 'Artifact 已通過，可以交付' : '交付已鎖定',
    reason: hasPassingCritique ? undefined : '只有通過 Critique 的 artifact 才能交付。',
    action: hasPassingCritique ? 'deliver' : 'review-critique',
  }
}

export function deriveSubDesignWorkspace(input: SubDesignWorkspaceInput): SubDesignWorkspaceViewModel {
  const artifacts = (input.artifacts || []).filter((artifact) => artifact.briefId === input.brief.id)
  const selectedArtifact = input.selectedArtifact?.briefId === input.brief.id ? input.selectedArtifact : null
  const latestArtifact = latestArtifactOf(artifacts, selectedArtifact)
  const hasCompleteArtifact = artifacts.some((artifact) => artifact.status === 'complete')
  const critique = input.critique && (!selectedArtifact || input.critique.artifactId === selectedArtifact.id) ? input.critique : null
  const critiqueSession = input.critiqueSession && input.critiqueSession.briefId === input.brief.id && (!selectedArtifact || input.critiqueSession.artifactId === selectedArtifact.id)
    ? input.critiqueSession
    : null
  const critiqueStatus = deriveCritiqueStatus(critique, critiqueSession)
  const hasPassingCritique = Boolean(latestArtifact?.status === 'complete' && critique && critiqueAllowsDeliver(critique))
  const runStatus = deriveRunStatus(input.runStatus)
  const hasDirection = Boolean(input.brief.selectedDirectionId)
  const stages = SUBDESIGN_STAGES.map((stage) => {
    const state = stageState(input.brief.stage, stage, hasDirection, hasPassingCritique)
    return { id: stage, label: stageLabel(stage), state, description: describeStage(stage, state) }
  })
  return {
    briefId: input.brief.id,
    objective: input.brief.objective,
    currentStage: input.brief.stage,
    stages,
    nextGate: makeGate({ brief: input.brief, runStatus, critiqueStatus, hasCompleteArtifact, hasPassingCritique }),
    runStatus,
    critiqueStatus,
    hasCompleteArtifact,
    latestArtifact,
    selectedDirectionTitle: input.brief.directions.find((direction) => direction.id === input.brief.selectedDirectionId)?.title,
  }
}

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
  designSystemId?: string
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

export type SubDesignWorkspaceRunPhase = 'idle' | 'starting' | 'blocked' | 'failed'

export type SubDesignWorkspaceProjection = {
  routeBriefId: string | null
  activeBrief: SubDesignBrief | null
  projectRoot: string
  pluginInputs: PluginInputValues
  pluginDeclaredInputs: PluginInput[]
  selectedModelId: string
  run: {
    phase: SubDesignWorkspaceRunPhase
    runId?: string
    reason?: string
  }
  hydration: {
    status: 'idle' | 'loading' | 'ready' | 'failed'
    reason?: string
  }
  capabilities: SubDesignWorkspaceCapabilities
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
  getDesignSystem: (id?: string) => DesignSystemSummary | null
  prepareRun: (input: SubDesignWorkspacePreparationInput) => Promise<SubDesignRunPreparation>
  runTask: (input: ExternalRunOpts) => Promise<ExternalRunResult>
  buildPrompt: (brief: SubDesignBrief, designSystem: DesignSystemSummary | null) => string
  navigate: (path: string) => void
  hydrateProject?: (projectRoot: string) => Promise<void>
  refreshProviderState?: () => Promise<void>
  createRunId: () => string
  getProjectRoot: () => string
  getCapabilities: () => SubDesignWorkspaceCapabilities
}

type WorkspaceState = {
  routeBriefId: string | null
  projectRoot: string
  pluginInputs: PluginInputValues
  pluginDeclaredInputs: PluginInput[]
  selectedModelId: string
  run: SubDesignWorkspaceProjection['run']
  hydration: SubDesignWorkspaceProjection['hydration']
}

const EMPTY_PLUGIN_INPUTS: PluginInputValues = {}

function commandFailure(
  kind: SubDesignWorkspaceActionFailure['kind'],
  reason: string,
  declaredInputs?: PluginInput[],
): SubDesignWorkspaceActionFailure {
  return { ok: false, kind, reason, ...(declaredInputs ? { declaredInputs } : {}) }
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
}

export function createSubDesignWorkspace(deps: SubDesignWorkspaceDependencies): SubDesignWorkspaceController {
  const listeners = new Set<() => void>()
  const state: WorkspaceState = {
    routeBriefId: null,
    projectRoot: deps.getProjectRoot() || '',
    pluginInputs: { ...EMPTY_PLUGIN_INPUTS },
    pluginDeclaredInputs: [],
    selectedModelId: '',
    run: { phase: 'idle' },
    hydration: { status: 'idle' },
  }

  let projection: SubDesignWorkspaceProjection = makeProjection()

  function makeProjection(): SubDesignWorkspaceProjection {
    const activeBrief = state.routeBriefId ? deps.findBrief(state.routeBriefId) : null
    return {
      routeBriefId: state.routeBriefId,
      activeBrief,
      projectRoot: state.projectRoot,
      pluginInputs: { ...state.pluginInputs },
      pluginDeclaredInputs: [...state.pluginDeclaredInputs],
      selectedModelId: state.selectedModelId,
      run: { ...state.run },
      hydration: { ...state.hydration },
      capabilities: { ...deps.getCapabilities() },
    }
  }

  function publish() {
    projection = makeProjection()
    for (const listener of listeners) listener()
  }

  function setRun(run: WorkspaceState['run']) {
    state.run = run
    publish()
  }

  async function runBrief(
    brief: SubDesignBrief,
    objective: string,
    runner?: ThreadRunner,
  ): Promise<SubDesignWorkspaceActionResult> {
    if (state.run.phase === 'starting') return commandFailure('busy', 'SubDesign 已有一個 run 正在準備中。')

    const runId = deps.createRunId()
    setRun({ phase: 'starting', runId })
    let prepared: SubDesignRunPreparation
    try {
      prepared = await deps.prepareRun({
        brief,
        runId,
        projectRoot: state.projectRoot || undefined,
        pluginInputs: state.pluginInputs,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'SubDesign run preparation 失敗。'
      setRun({ phase: 'failed', runId, reason })
      return commandFailure('failed', reason)
    }

    state.pluginDeclaredInputs = prepared.declaredInputs ? [...prepared.declaredInputs] : []
    // Missing provenance/project capability is an advisory fallback: the
    // brief can still run through the built-in workflow without a provider.
    // Trust decisions and declared inputs are hard blocks because forwarding
    // an incomplete plugin request would silently violate its contract.
    if (prepared.blockedReason && (prepared.declaredInputs?.length || prepared.trust)) {
      setRun({ phase: 'blocked', runId, reason: prepared.blockedReason })
      return commandFailure('blocked', prepared.blockedReason, prepared.declaredInputs)
    }

    const thread = deps.getThread(brief.threadId)
    const selectedModel = state.selectedModelId.trim()
    const overrides = selectedModel
      ? { ...(prepared.overrides || {}), model: selectedModel }
      : prepared.overrides
    const request: ExternalRunOpts = {
      runId,
      objective,
      sourceKind: 'composer',
      reuseThreadId: brief.threadId,
      runner: runner || thread?.runner || 'builtin',
      loopType: thread?.loopType || undefined,
      ...(overrides ? { overrides } : {}),
      ...(state.projectRoot ? { projectRoot: state.projectRoot } : {}),
    }

    try {
      const result = await deps.runTask(request)
      if (result.skipped || result.error) {
        const reason = result.error || 'SubDesign run 未被 coordinator admission 接受。'
        setRun({ phase: 'failed', runId, reason })
        return commandFailure('failed', reason)
      }
      setRun({ phase: 'idle' })
      return { ok: true, brief, run: result }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'SubDesign run 失敗。'
      setRun({ phase: 'failed', runId, reason })
      return commandFailure('failed', reason)
    } finally {
      if (deps.refreshProviderState) {
        try {
          await deps.refreshProviderState()
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
      return () => listeners.delete(listener)
    },

    sync: ({ routeBriefId, projectRoot }) => {
      const nextRoute = routeBriefId === undefined ? state.routeBriefId : routeBriefId || null
      if (nextRoute !== state.routeBriefId) {
        state.routeBriefId = nextRoute
        state.pluginInputs = { ...EMPTY_PLUGIN_INPUTS }
        state.pluginDeclaredInputs = []
        if (state.run.phase === 'blocked') state.run = { phase: 'idle' }
        if (nextRoute && deps.findBrief(nextRoute)) deps.selectBrief(nextRoute)
      }
      if (projectRoot !== undefined && projectRoot !== state.projectRoot) {
        state.projectRoot = projectRoot
        state.pluginInputs = { ...EMPTY_PLUGIN_INPUTS }
        state.pluginDeclaredInputs = []
      }
      publish()
    },

    hydrate: async (projectRoot = deps.getProjectRoot() || '') => {
      state.projectRoot = projectRoot
      state.pluginInputs = { ...EMPTY_PLUGIN_INPUTS }
      state.pluginDeclaredInputs = []
      state.hydration = { status: 'loading' }
      publish()
      try {
        await deps.hydrateProject?.(projectRoot)
        state.hydration = { status: 'ready' }
      } catch (error) {
        state.hydration = {
          status: 'failed',
          reason: error instanceof Error ? error.message : 'SubDesign project hydration 失敗。',
        }
      }
      publish()
      return projection
    },

    create: async (input) => {
      const objective = input.objective.trim()
      if (!objective) return commandFailure('invalid', '請先輸入 SubDesign brief。')
      if (state.run.phase === 'starting') return commandFailure('busy', 'SubDesign 已有一個 run 正在準備中。')

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
        designSystemId: input.designSystemId,
        templateId: input.templateId,
        skillIds: input.skillIds,
        provenance: input.provenance,
        projectRoot: state.projectRoot || undefined,
      })
      deps.bindBriefToThread(threadId, brief.id)
      deps.selectBrief(brief.id)
      state.routeBriefId = brief.id
      publish()
      deps.navigate(`/subdesign/${brief.id}`)
      const prompt = deps.buildPrompt(brief, deps.getDesignSystem(brief.designSystemId))
      return runBrief(brief, prompt, input.runner)
    },

    resume: (briefId) => {
      const brief = deps.findBrief(briefId)
      if (!brief) return commandFailure('missing-brief', `找不到這個 SubDesign brief：${briefId}。`)
      state.routeBriefId = brief.id
      state.pluginInputs = { ...EMPTY_PLUGIN_INPUTS }
      state.pluginDeclaredInputs = []
      deps.selectBrief(brief.id)
      publish()
      deps.navigate(`/subdesign/${brief.id}`)
      return { ok: true, brief }
    },

    start: async () => {
      const brief = state.routeBriefId ? deps.findBrief(state.routeBriefId) : null
      if (!brief) return commandFailure('missing-brief', '目前沒有可執行的 SubDesign brief。')
      const prompt = deps.buildPrompt(brief, deps.getDesignSystem(brief.designSystemId))
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
      state.pluginDeclaredInputs = []
      if (state.run.phase === 'blocked') state.run = { phase: 'idle' }
      publish()
    },

    setModel: (modelId) => {
      const next = modelId.trim()
      if (next === state.selectedModelId) return
      state.selectedModelId = next
      publish()
    },
  }

  return controller
}
