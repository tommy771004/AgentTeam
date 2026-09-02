/**
 * SubDesign pipeline stage states projected to conversation activity.
 * queued → running → completed | failed | blocked | cancelled
 */

export type PipelineStageState = 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled'

export type Settlement = {
  runId: string
  terminal: 'success' | 'failure' | 'blocked' | 'cancelled'
  summary: string
  providerKind?: string
  stageState?: PipelineStageState
  dodMet?: boolean
}

export function isProviderSuccessNotDodMet(providerKind: string, dodMet?: boolean): boolean {
  return providerKind === 'success' && dodMet !== true
}
