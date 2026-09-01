/**
 * Shared dispatch outcome shape — pure types only.
 * Used by runDispatch (runner) and taskRunTypes.ExternalRunResult (lifecycle).
 */
import type { PostStateOutcome } from './types.ts'
import type { LocalRunnerKind } from './localCliRun.ts'
import type { ExternalCliTerminalClassification } from './externalCliRunSession.ts'
import type { TurnRecord } from './turnRecord.ts'
import type { GoalVerdict, RunExecutionSettlement } from './goalOutcome.ts'

export type DispatchResult = {
  path: 'builtin' | 'cli'
  /** Phase 5: same outcome shape, different execution semantics. */
  executionKind?: 'loop' | 'external'
  kind?: LocalRunnerKind
  status: string
  executionSettlement?: RunExecutionSettlement
  goalVerdict?: GoalVerdict
  goalContractDigest?: string
  acceptanceDigest?: string
  stopReason?: string
  /** Final Host loop evidence; external CLI never supplies DoD truth. */
  orchestration?: {
    iterations?: number
    maxIterations?: number
    dodMet?: boolean
    executionKind?: 'loop' | 'external'
  }
  result?: string
  error?: string
  /** Host-owned external settlement evidence; retained through coordinator finalization. */
  terminalClassification?: ExternalCliTerminalClassification
  postState?: PostStateOutcome
  /** Host-authored trace exposed for headless evaluation and audit projection. */
  turnRecord?: TurnRecord
}
