/**
 * Internal pure derivation for the SubDesign workspace facade.
 *
 * Callers use `workspace.ts`; keeping this implementation separate makes the
 * public seam small while preserving a deterministic projection function for
 * the shipped-module smoke.
 */
import { critiqueAllowsDeliver } from './critique.ts'
import {
  isIterationExhausted,
  iterationExhaustedLabel,
  type RunOrchestrationSnapshot,
} from '../runLifecycle.ts'
import { SUBDESIGN_STAGES, stageLabel } from './types.ts'
import type {
  SubDesignArtifact,
  SubDesignBrief,
  SubDesignCritique,
  SubDesignCritiqueSession,
  SubDesignStage,
} from './types.ts'

export type SubDesignWorkspaceRunStatus =
  | 'idle'
  | 'active'
  | 'success'
  /** Settled as success with the DoD unmet and the iteration budget spent. */
  | 'exhausted'
  | 'failed'
  | 'halted'
  | 'awaiting-user'
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
  /**
   * Badge wording for `runStatus`. Owned here so the workspace header renders
   * the projection instead of re-deciding what a terminal run means.
   */
  runStatusLabel: string
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
  /** Iteration/DoD settlement for the run behind `runStatus`. */
  orchestration?: RunOrchestrationSnapshot
}

const ACTIVE_RUN_STATUSES = new Set(['parsing', 'running', 'manual_intervention'])

function deriveRunStatus(
  value: string | undefined,
  orchestration: RunOrchestrationSnapshot | undefined,
): SubDesignWorkspaceRunStatus {
  if (!value || value === 'idle') return 'idle'
  if (ACTIVE_RUN_STATUSES.has(value)) return 'active'
  if (value === 'awaiting_user') return 'awaiting-user'
  if (value === 'success') return isIterationExhausted(orchestration) ? 'exhausted' : 'success'
  if (value === 'halted' || value === 'aborted') return 'halted'
  if (value === 'failed') return 'failed'
  return 'idle'
}

const RUN_STATUS_LABELS: Partial<Record<SubDesignWorkspaceRunStatus, string>> = {
  active: 'LIVE',
  'awaiting-user': 'ACTION NEEDED',
  failed: 'FAILED',
  halted: 'HALTED',
}

/**
 * One wording source for the workspace run badge.
 *
 * `idle` and a quietly settled `success` keep reading from the stage (READY on
 * deliver, otherwise IDLE) exactly as before; only a truncated run gets its own
 * copy, and that copy is the shared lifecycle wording, not a local string.
 */
export function subDesignRunStatusLabel(
  status: SubDesignWorkspaceRunStatus,
  orchestration?: RunOrchestrationSnapshot,
  stage?: SubDesignStage,
): string {
  if (status === 'exhausted') return iterationExhaustedLabel(orchestration?.iterations)
  return RUN_STATUS_LABELS[status] || (stage === 'deliver' ? 'READY' : 'IDLE')
}

function deriveCritiqueStatus(
  critique: SubDesignCritique | null | undefined,
  session: SubDesignCritiqueSession | null | undefined,
): SubDesignWorkspaceCritiqueStatus {
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

function stageState(
  currentStage: SubDesignStage,
  stage: SubDesignStage,
  hasDirection: boolean,
  hasPassingCritique: boolean,
): SubDesignWorkspaceStageState {
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
  const runStatus = deriveRunStatus(input.runStatus, input.orchestration)
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
    runStatusLabel: subDesignRunStatusLabel(runStatus, input.orchestration, input.brief.stage),
    critiqueStatus,
    hasCompleteArtifact,
    latestArtifact,
    selectedDirectionTitle: input.brief.directions.find((direction) => direction.id === input.brief.selectedDirectionId)?.title,
  }
}
