/**
 * Canonical public Task run seam.
 *
 * Invalid requests terminate here without loading renderer stores. Admitted
 * requests enter the single internal execution owner lazily.
 */

import { normalizeTaskObjective } from './taskRunInput.ts'
import type {
  TaskRunInput,
  TaskRunResult,
} from './taskRunContracts'

export type {
  ExternalRunOpts,
  ExternalRunResult,
  RunDispatchSnapshot,
  RunSourceKind,
  TaskRunInput,
  TaskRunResult,
} from './taskRunContracts'

export function normalizeTaskRunInput(input: TaskRunInput): TaskRunInput {
  return normalizeTaskObjective(input)
}

export async function runTask(input: TaskRunInput): Promise<TaskRunResult> {
  const normalized = normalizeTaskRunInput(input)
  if (!normalized.objective && !normalized.attachments?.length) {
    return {
      path: 'builtin',
      status: 'failed',
      error: 'empty objective',
      threadId: null,
    }
  }
  const { executeTaskRun } = await import('./taskRunExecution')
  return executeTaskRun(normalized, { reenterTask: runTask })
}
