import type { PiTurnSettlement } from './piHostRun.ts'

export const RUN_EXECUTION_SETTLEMENTS = [
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const

export type RunExecutionSettlement = (typeof RUN_EXECUTION_SETTLEMENTS)[number]

export const GOAL_VERDICTS = [
  'passed',
  'failed',
  'blocked',
  'unverifiable',
  'exhausted',
  'cancelled',
  'interrupted',
  'not-applicable',
] as const

export type GoalVerdict = (typeof GOAL_VERDICTS)[number]
export type GoalOutcomeProjection = GoalVerdict | 'legacy-unverified'
export type AppFinalizationStatus = 'pending' | 'completed' | 'not-applicable'

export type DeriveRunOutcomeInput = Readonly<{
  turnSettlement?: PiTurnSettlement
  executionSettlement?: RunExecutionSettlement
  goalVerdict?: GoalVerdict
  /** Previously derived display fact; accepted only at legacy read boundaries. */
  legacyGoalProjection?: GoalOutcomeProjection
  appFinalization?: AppFinalizationStatus
  executionKind?: 'loop' | 'external'
  legacyStatus?: string
  legacyDodMet?: boolean
  iterations?: number
  maxIterations?: number
}>

export type RunOutcomeProjection = Readonly<{
  turnSettlement?: PiTurnSettlement
  executionSettlement?: RunExecutionSettlement
  /** Present only when a new canonical authority supplied a Goal verdict. */
  goalVerdict?: GoalVerdict
  /** May conservatively describe a legacy record without minting Goal truth. */
  goalProjection?: GoalOutcomeProjection
  appFinalization?: AppFinalizationStatus
}>

const EXECUTION_SETTLEMENT_SET = new Set<string>(RUN_EXECUTION_SETTLEMENTS)
const GOAL_VERDICT_SET = new Set<string>(GOAL_VERDICTS)
const APP_FINALIZATION_SET = new Set<string>(['pending', 'completed', 'not-applicable'])

export function isRunExecutionSettlement(value: unknown): value is RunExecutionSettlement {
  return typeof value === 'string' && EXECUTION_SETTLEMENT_SET.has(value)
}

export function isGoalVerdict(value: unknown): value is GoalVerdict {
  return typeof value === 'string' && GOAL_VERDICT_SET.has(value)
}

export function isGoalOutcomeProjection(value: unknown): value is GoalOutcomeProjection {
  return value === 'legacy-unverified' || isGoalVerdict(value)
}

export function isAppFinalizationStatus(value: unknown): value is AppFinalizationStatus {
  return typeof value === 'string' && APP_FINALIZATION_SET.has(value)
}

export function executionSettlementFromTurnSettlement(settlement: PiTurnSettlement): RunExecutionSettlement {
  switch (settlement) {
    case 'answered':
    case 'empty': return 'completed'
    case 'truncated':
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    case 'interrupted': return 'interrupted'
  }
}

function executionSettlementFromLegacyStatus(status: string | undefined): RunExecutionSettlement | undefined {
  switch ((status || '').trim().toLowerCase()) {
    case 'success':
    case 'warning': return 'completed'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    case 'halted':
    case 'interrupted': return 'interrupted'
    default: return undefined
  }
}

function spentIterationBudget(input: DeriveRunOutcomeInput): boolean {
  return Number.isFinite(input.iterations)
    && Number.isFinite(input.maxIterations)
    && Number(input.iterations) >= Number(input.maxIterations)
    && Number(input.maxIterations) > 0
}

function legacyGoalProjection(
  input: DeriveRunOutcomeInput,
  executionSettlement: RunExecutionSettlement | undefined,
): GoalOutcomeProjection | undefined {
  if (input.executionKind === 'external' && executionSettlement) return 'not-applicable'
  // A live renderer status (for example `running`) is not a legacy terminal
  // record and must not manufacture `legacy-unverified` over canonical
  // execution facts while the Acceptance Gate is still checking.
  if (!input.legacyStatus || !executionSettlement || !executionSettlementFromLegacyStatus(input.legacyStatus)) return undefined
  if (executionSettlement === 'cancelled') return 'cancelled'
  if (executionSettlement === 'interrupted') return 'interrupted'
  if (executionSettlement === 'failed') return 'failed'
  if (input.legacyDodMet === true) return 'passed'
  if (input.legacyDodMet === false) return spentIterationBudget(input) ? 'exhausted' : 'failed'
  return 'legacy-unverified'
}

/**
 * The one compatibility boundary for run outcome facts. New authorities pass
 * canonical fields; old records are projected conservatively and never gain a
 * fabricated GoalVerdict.
 */
export function deriveRunOutcome(input: DeriveRunOutcomeInput): RunOutcomeProjection {
  const executionSettlement = input.executionSettlement
    ?? (input.turnSettlement ? executionSettlementFromTurnSettlement(input.turnSettlement) : undefined)
    ?? executionSettlementFromLegacyStatus(input.legacyStatus)
  const goalProjection = input.goalVerdict
    ?? input.legacyGoalProjection
    ?? legacyGoalProjection(input, executionSettlement)
  return {
    ...(input.turnSettlement ? { turnSettlement: input.turnSettlement } : {}),
    ...(executionSettlement ? { executionSettlement } : {}),
    ...(input.goalVerdict ? { goalVerdict: input.goalVerdict } : {}),
    ...(goalProjection ? { goalProjection } : {}),
    ...(input.appFinalization ? { appFinalization: input.appFinalization } : {}),
  }
}
