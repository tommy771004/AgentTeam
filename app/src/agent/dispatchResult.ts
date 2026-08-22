/**
 * Shared dispatch outcome shape — pure types only.
 * Used by runDispatch (runner) and taskRunTypes.ExternalRunResult (lifecycle).
 */
import type { PostStateOutcome } from './types.ts'
import type { LocalRunnerKind } from './localCliRun.ts'
import type { ExternalCliTerminalClassification } from './externalCliRunSession.ts'

export type DispatchResult = {
  path: 'builtin' | 'cli'
  /** Phase 5: same outcome shape, different execution semantics. */
  executionKind?: 'loop' | 'external'
  kind?: LocalRunnerKind
  status: string
  result?: string
  error?: string
  /** Host-owned external settlement evidence; retained through coordinator finalization. */
  terminalClassification?: ExternalCliTerminalClassification
  postState?: PostStateOutcome
}
