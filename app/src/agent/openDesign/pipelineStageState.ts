/**
 * Pipeline stage states projected to conversation activity.
 * queued → running → completed | failed | blocked | cancelled
 */

export type PipelineStageState = 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled'

export type StageProjection = {
  runId: string
  stageId: string
  state: PipelineStageState
  startedAt?: string
  finishedAt?: string
  summary?: string
}

export type Settlement = {
  runId: string
  terminal: 'success' | 'failure' | 'blocked' | 'cancelled'
  summary: string
  providerKind?: string
  stageState?: PipelineStageState
  dodMet?: boolean
}

export function deriveSettlement(stageState: PipelineStageState, providerKind: string): Settlement['terminal'] {
  if (stageState === 'cancelled') return 'cancelled'
  if (stageState === 'blocked' || providerKind === 'blocked') return 'blocked'
  if (stageState === 'failed' || providerKind === 'failure') return 'failure'
  if (stageState === 'completed' && providerKind === 'success') return 'success'
  return 'failure'
}

export function isProviderSuccessNotDodMet(providerKind: string, dodMet?: boolean): boolean {
  return providerKind === 'success' && dodMet !== true
}
