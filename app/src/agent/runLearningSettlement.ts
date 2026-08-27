export type RunLearningMode = 'explicit' | 'automatic'

export type RunLearningFinalOutcome = {
  status: string
  executionKind?: 'loop' | 'external'
  dodMet?: boolean
}

export type RunLearningDecision = {
  commit: boolean
  reason:
    | 'eligible-explicit'
    | 'eligible-automatic'
    | 'external-runner'
    | 'non-success'
    | 'dod-unmet'
}

/**
 * The one policy table for task-run learning settlement.
 *
 * Explicit "remember" requests only require a successfully interpreted and
 * answered builtin run. Automatic learning is stricter: the same run must
 * also carry positive DoD evidence. External CLI output is never promoted to
 * shared memory automatically because it does not execute under scoped Host
 * recall/write authority.
 */
export function decideRunLearningSettlement(
  mode: RunLearningMode,
  outcome: RunLearningFinalOutcome,
): RunLearningDecision {
  if (outcome.executionKind !== 'loop') {
    return { commit: false, reason: 'external-runner' }
  }
  if (outcome.status !== 'success') {
    return { commit: false, reason: 'non-success' }
  }
  if (mode === 'explicit') {
    return { commit: true, reason: 'eligible-explicit' }
  }
  if (outcome.dodMet !== true) {
    return { commit: false, reason: 'dod-unmet' }
  }
  return { commit: true, reason: 'eligible-automatic' }
}
