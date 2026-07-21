/**
 * Shared dispatch outcome shape — pure types only.
 * Used by runDispatch (runner) and taskRunTypes.ExternalRunResult (lifecycle).
 */
import type { PostStateOutcome } from './types'
import type { LocalRunnerKind } from './localCliRun'

export type DispatchResult = {
  path: 'builtin' | 'cli'
  /** Phase 5: same outcome shape, different execution semantics. */
  executionKind?: 'loop' | 'external'
  kind?: LocalRunnerKind
  status: string
  result?: string
  error?: string
  postState?: PostStateOutcome
}
