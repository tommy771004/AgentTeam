/**
 * Legacy renderer delegation contract.
 *
 * Production child admission moved to Pi Host `agents/spawn`. These exported
 * shapes remain temporarily for saved settings and old callers, but the
 * renderer cannot own a second budget, lifecycle, queue, worktree, or
 * settlement path.
 */

import type { LlmSettings, PermissionPolicy, PermissionProjection, ToolCallRecord } from '../types.ts'
import type { ThreadRunner } from '../../store/threadStore.ts'
import type { DelegateCapabilityMode } from './capabilityMode.ts'
import type { ExternalCliDelegateContract } from '../runners/types.ts'

export type DelegateRole = 'leaf' | 'orchestrator'

export interface DelegateTaskInput {
  goal: string
  context?: string
  role?: DelegateRole
  maxRounds?: number
  background?: boolean
  notifyOnComplete?: boolean
  inheritCapabilities?: string[]
  capabilityMode?: DelegateCapabilityMode
  persona?: string
  resumeFrom?: string
  isolation?: 'none' | 'worktree'
  parentRunId?: string
  parentThreadId?: string
  sourceKind?: string
  runner?: ThreadRunner
  projectRoot?: string
  parentPermissionPolicy?: PermissionPolicy
  parentPermissionProjection?: PermissionProjection
  parentMcpAgentId?: string
}

export interface DelegateTaskResult {
  id: string
  role: DelegateRole
  goal: string
  ok: boolean
  summary: string
  tokensUsed: number
  toolCalls: ToolCallRecord[]
  durationMs: number
  depth: number
}

export type PreparedDelegateSpawn = {
  ok: true
  id: string
  role: DelegateRole
  depth: number
  childProjectRoot?: string
  worktreeNote: string
  childModel: string
  blockedTools: string[]
  preloadCapabilityIds: string[]
  extraSystemContext: string
  externalCliContract: ExternalCliDelegateContract
  personaName?: string
} | {
  ok: false
  result: DelegateTaskResult
}

function hostOnlyFailure(input: DelegateTaskInput): DelegateTaskResult {
  return {
    id: `host-only-${Date.now().toString(36)}`,
    role: input.role || 'leaf',
    goal: input.goal,
    ok: false,
    summary: 'Renderer delegation lifecycle 已凍結；請透過 Pi Host agents/spawn，由 Host 執行 admission、tree budget、workspace lease 與 settlement。',
    tokensUsed: 0,
    toolCalls: [],
    durationMs: 0,
    depth: 0,
  }
}

/** @deprecated Compatibility-only; never creates a child or reserves budget. */
export async function prepareDelegateSpawn(
  _settings: LlmSettings,
  input: DelegateTaskInput,
): Promise<PreparedDelegateSpawn> {
  return { ok: false, result: hostOnlyFailure(input) }
}

/** @deprecated Production delegation must enter through Pi Host agents/spawn. */
export async function spawnDelegateViaRunTask(
  _settings: LlmSettings,
  input: DelegateTaskInput,
): Promise<DelegateTaskResult> {
  return hostOnlyFailure(input)
}

/** @deprecated Batch size and rollout budgets are Host tree-scoped. */
export async function runDelegateBatch(
  _settings: LlmSettings,
  tasks: DelegateTaskInput[],
): Promise<DelegateTaskResult[]> {
  return tasks.map(hostOnlyFailure)
}
